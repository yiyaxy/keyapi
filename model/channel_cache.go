package model

import (
	"errors"
	"fmt"
	"math/rand"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
)

var group2model2channels map[string]map[string][]int // enabled channel
var channelsIDM map[int]*Channel                     // all channels include disabled
var channelSyncLock sync.RWMutex

var (
	// In-memory routing preferences per tenant. Rebuilt by ReloadTenantRoutingCache.
	tenantRoutingMu       sync.RWMutex
	tenantMode            = map[int]string{}           // tenantId -> mode
	tenantDisabledChannel = map[int]map[int]struct{}{} // tenantId -> set of channel_id
)

// ReloadTenantRoutingCache refreshes mode + disabled-set for one tenant
// from DB. Call whenever tenant_options.platform_channel_mode or
// tenant_channel_overrides changes. See spec §4.3.
func ReloadTenantRoutingCache(tenantId int) {
	if tenantId <= 0 {
		return
	}
	mode, _ := GetTenantPlatformChannelMode(tenantId)
	dis, _ := GetTenantDisabledPlatformChannels(tenantId)

	tenantRoutingMu.Lock()
	defer tenantRoutingMu.Unlock()
	tenantMode[tenantId] = mode
	tenantDisabledChannel[tenantId] = dis
}

// InvalidateTenantRoutingCache refreshes the cache for a single tenant.
// Alias for ReloadTenantRoutingCache — kept for naming clarity at call sites.
func InvalidateTenantRoutingCache(tenantId int) {
	ReloadTenantRoutingCache(tenantId)
}

// GetCachedTenantMode returns the cached mode or the default when unloaded.
func GetCachedTenantMode(tenantId int) string {
	tenantRoutingMu.RLock()
	defer tenantRoutingMu.RUnlock()
	if m, ok := tenantMode[tenantId]; ok {
		return m
	}
	return PlatformChannelModePrivatePriority
}

// GetCachedTenantDisabledChannels returns the cached disabled set (non-nil
// even when unloaded — callers can range safely).
func GetCachedTenantDisabledChannels(tenantId int) map[int]struct{} {
	tenantRoutingMu.RLock()
	defer tenantRoutingMu.RUnlock()
	if s, ok := tenantDisabledChannel[tenantId]; ok {
		return s
	}
	return map[int]struct{}{}
}

// reloadAllTenantRoutingCaches warms per-tenant preferences at startup.
// Called at the end of InitChannelCache.
func reloadAllTenantRoutingCaches() {
	var tenants []Tenant
	WithTenantBypass(DB).Where("status = ?", TenantStatusActive).Find(&tenants)
	for _, t := range tenants {
		ReloadTenantRoutingCache(t.Id)
	}
}

// tenantGroupKey builds a composite cache key "tenantId:group" for tenant-isolated channel lookup.
func tenantGroupKey(tenantId int, group string) string {
	return fmt.Sprintf("%d:%s", tenantId, group)
}

// ReloadChannelCache rebuilds the global channel cache from DB.
// Same implementation as InitChannelCache; provided as a semantic alias
// for cache-invalidate subscriber call sites.
func ReloadChannelCache() {
	InitChannelCache()
}

func InitChannelCache() {
	if !common.MemoryCacheEnabled {
		return
	}
	// 跨租户加载全量 channels / abilities 到内存缓存；
	// 缓存 key 为 tenantId:group，按租户分桶。
	newChannelId2channel := make(map[int]*Channel)
	var channels []*Channel
	WithTenantBypass(DB).Find(&channels)
	for _, channel := range channels {
		newChannelId2channel[channel.Id] = channel
	}
	var abilities []*Ability
	WithTenantBypass(DB).Find(&abilities)
	groups := make(map[string]bool)
	for _, ability := range abilities {
		groups[tenantGroupKey(ability.TenantId, ability.Group)] = true
	}
	newGroup2model2channels := make(map[string]map[string][]int)
	for group := range groups {
		newGroup2model2channels[group] = make(map[string][]int)
	}
	for _, channel := range channels {
		if channel.Status != common.ChannelStatusEnabled {
			continue // skip disabled channels
		}
		channelGroups := strings.Split(channel.Group, ",")
		for _, group := range channelGroups {
			tgKey := tenantGroupKey(channel.TenantId, group)
			if _, ok := newGroup2model2channels[tgKey]; !ok {
				newGroup2model2channels[tgKey] = make(map[string][]int)
			}
			models := strings.Split(channel.Models, ",")
			for _, model := range models {
				newGroup2model2channels[tgKey][model] = append(newGroup2model2channels[tgKey][model], channel.Id)
			}
		}
	}

	// sort by priority
	for group, model2channels := range newGroup2model2channels {
		for model, channels := range model2channels {
			sort.Slice(channels, func(i, j int) bool {
				return newChannelId2channel[channels[i]].GetPriority() > newChannelId2channel[channels[j]].GetPriority()
			})
			newGroup2model2channels[group][model] = channels
		}
	}

	channelSyncLock.Lock()
	group2model2channels = newGroup2model2channels
	//channelsIDM = newChannelId2channel
	for i, channel := range newChannelId2channel {
		if channel.ChannelInfo.IsMultiKey {
			channel.Keys = channel.GetKeys()
			if channel.ChannelInfo.MultiKeyMode == constant.MultiKeyModePolling {
				if oldChannel, ok := channelsIDM[i]; ok {
					// 存在旧的渠道，如果是多key且轮询，保留轮询索引信息
					if oldChannel.ChannelInfo.IsMultiKey && oldChannel.ChannelInfo.MultiKeyMode == constant.MultiKeyModePolling {
						channel.ChannelInfo.MultiKeyPollingIndex = oldChannel.ChannelInfo.MultiKeyPollingIndex
					}
				}
			}
		}
	}
	channelsIDM = newChannelId2channel
	channelSyncLock.Unlock()
	common.SysLog("channels synced from database")

	// Warm per-tenant routing preferences (mode + disabled overrides).
	reloadAllTenantRoutingCaches()
}

// GetChannelGroupsCopy returns a copy of group names that have at least one enabled channel for the given tenant.
// The result is the union of tenant-specific groups and platform groups (tenant_id=0 / scope=platform).
func GetChannelGroupsCopy(tenantId int) map[string]bool {
	if !common.MemoryCacheEnabled {
		return getChannelGroupsFromDB(tenantId)
	}
	channelSyncLock.RLock()
	defer channelSyncLock.RUnlock()
	tenantPrefix := fmt.Sprintf("%d:", tenantId)
	platformPrefix := "0:"
	result := make(map[string]bool)
	for tgKey := range group2model2channels {
		if strings.HasPrefix(tgKey, tenantPrefix) {
			result[strings.TrimPrefix(tgKey, tenantPrefix)] = true
		} else if tenantId != 0 && strings.HasPrefix(tgKey, platformPrefix) {
			// Also include platform groups (scope=platform / tenant_id=0) for non-platform callers.
			result[strings.TrimPrefix(tgKey, platformPrefix)] = true
		}
	}
	return result
}

// GroupHasChannels checks if a group has at least one enabled channel for the given tenant.
func GroupHasChannels(group string, tenantId int) bool {
	if !common.MemoryCacheEnabled {
		q := DB.Model(&Ability{}).Where(commonGroupCol+" = ? AND enabled = ?", group, true)
		if tenantId > 0 {
			q = q.Where("tenant_id = ?", tenantId)
		}
		var count int64
		q.Count(&count)
		return count > 0
	}
	channelSyncLock.RLock()
	defer channelSyncLock.RUnlock()
	tgKey := tenantGroupKey(tenantId, group)
	_, ok := group2model2channels[tgKey]
	return ok
}

// getChannelGroupsFromDB queries distinct groups from abilities table (non-cache fallback).
// Returns the union of tenant-specific groups and platform groups (tenant_id=0).
func getChannelGroupsFromDB(tenantId int) map[string]bool {
	var groups []string
	q := DB.Model(&Ability{}).Where("enabled = ?", true)
	if tenantId > 0 {
		// Include both tenant-specific and platform (tenant_id=0) groups.
		q = q.Where("tenant_id = ? OR tenant_id = ?", tenantId, 0)
	}
	q.Distinct(commonGroupCol).Pluck(commonGroupCol, &groups)
	result := make(map[string]bool)
	for _, g := range groups {
		result[g] = true
	}
	return result
}

func SyncChannelCache(frequency int) {
	for {
		time.Sleep(time.Duration(frequency) * time.Second)
		common.SysLog("syncing channels from database")
		InitChannelCache()
	}
}

func GetRandomSatisfiedChannel(tenantId int, group string, model string, retry int) (*Channel, error) {
	// if memory cache is disabled, get channel directly from database
	if !common.MemoryCacheEnabled {
		return GetChannel(group, model, retry, tenantId)
	}

	channelSyncLock.RLock()
	defer channelSyncLock.RUnlock()

	tgKey := tenantGroupKey(tenantId, group)
	platformKey := tenantGroupKey(0, group)

	gather := func(modelName string) []int {
		var out []int
		if m, ok := group2model2channels[tgKey]; ok {
			out = append(out, m[modelName]...)
		}
		if m, ok := group2model2channels[platformKey]; ok {
			out = append(out, m[modelName]...)
		}
		return out
	}
	channels := gather(model)
	if len(channels) == 0 {
		normalizedModel := ratio_setting.FormatMatchingModelName(model)
		channels = gather(normalizedModel)
	}

	// Partition into tenant-owned vs platform candidates, drop disabled platforms,
	// and apply the tenant's mode preference.
	mode := GetCachedTenantMode(tenantId)
	disabled := GetCachedTenantDisabledChannels(tenantId)
	var tenantOwn, platform []int
	for _, id := range channels {
		c := channelsIDM[id]
		if c == nil {
			continue
		}
		if c.Scope == ChannelScopePlatform {
			if _, off := disabled[id]; off {
				continue
			}
			platform = append(platform, id)
		} else {
			tenantOwn = append(tenantOwn, id)
		}
	}
	switch mode {
	case PlatformChannelModeOnlyPrivate:
		channels = tenantOwn
	case PlatformChannelModeOnlyPlatform:
		channels = platform
	case PlatformChannelModePlatformPriority:
		if len(platform) > 0 {
			channels = platform
		} else {
			channels = tenantOwn
		}
	default: // private_priority (also handles "" and invalid)
		if len(tenantOwn) > 0 {
			channels = tenantOwn
		} else {
			channels = platform
		}
	}
	channels = filterCooledDownChannelIds(tenantId, channels)
	if len(channels) == 0 {
		return nil, nil
	}

	if len(channels) == 1 {
		if channel, ok := channelsIDM[channels[0]]; ok {
			return channel, nil
		}
		return nil, fmt.Errorf("数据库一致性错误，渠道# %d 不存在，请联系管理员修复", channels[0])
	}

	uniquePriorities := make(map[int]bool)
	for _, channelId := range channels {
		if channel, ok := channelsIDM[channelId]; ok {
			uniquePriorities[int(channel.GetPriority())] = true
		} else {
			return nil, fmt.Errorf("数据库一致性错误，渠道# %d 不存在，请联系管理员修复", channelId)
		}
	}
	var sortedUniquePriorities []int
	for priority := range uniquePriorities {
		sortedUniquePriorities = append(sortedUniquePriorities, priority)
	}
	sort.Sort(sort.Reverse(sort.IntSlice(sortedUniquePriorities)))

	if retry >= len(uniquePriorities) {
		retry = len(uniquePriorities) - 1
	}
	targetPriority := int64(sortedUniquePriorities[retry])

	// get the priority for the given retry number
	var sumWeight = 0
	var targetChannels []*Channel
	for _, channelId := range channels {
		if channel, ok := channelsIDM[channelId]; ok {
			if channel.GetPriority() == targetPriority {
				weight := channel.GetWeight()
				if ChannelCooldownEnabledForTenant(tenantId) {
					weight = effectiveCooldownWeight(channel.Id, weight)
				}
				sumWeight += weight
				targetChannels = append(targetChannels, channel)
			}
		} else {
			return nil, fmt.Errorf("数据库一致性错误，渠道# %d 不存在，请联系管理员修复", channelId)
		}
	}

	if len(targetChannels) == 0 {
		return nil, errors.New(fmt.Sprintf("no channel found, group: %s, model: %s, priority: %d", group, model, targetPriority))
	}

	// smoothing factor and adjustment
	smoothingFactor := 1
	smoothingAdjustment := 0

	if sumWeight == 0 {
		// when all channels have weight 0, set sumWeight to the number of channels and set smoothing adjustment to 100
		// each channel's effective weight = 100
		sumWeight = len(targetChannels) * 100
		smoothingAdjustment = 100
	} else if sumWeight/len(targetChannels) < 10 {
		// when the average weight is less than 10, set smoothing factor to 100
		smoothingFactor = 100
	}

	// Calculate the total weight of all channels up to endIdx
	totalWeight := sumWeight * smoothingFactor

	// Generate a random value in the range [0, totalWeight)
	randomWeight := rand.Intn(totalWeight)

	// Find a channel based on its weight
	for _, channel := range targetChannels {
		weight := channel.GetWeight()
		if ChannelCooldownEnabledForTenant(tenantId) {
			weight = effectiveCooldownWeight(channel.Id, weight)
		}
		randomWeight -= weight*smoothingFactor + smoothingAdjustment
		if randomWeight < 0 {
			return channel, nil
		}
	}
	// return null if no channel is not found
	return nil, errors.New("channel not found")
}

func CacheGetChannel(id int) (*Channel, error) {
	if !common.MemoryCacheEnabled {
		return GetChannelById(id, true)
	}
	channelSyncLock.RLock()
	defer channelSyncLock.RUnlock()

	c, ok := channelsIDM[id]
	if !ok {
		return nil, fmt.Errorf("渠道# %d，已不存在", id)
	}
	return c, nil
}

func CacheGetChannelInfo(id int) (*ChannelInfo, error) {
	if !common.MemoryCacheEnabled {
		channel, err := GetChannelById(id, true)
		if err != nil {
			return nil, err
		}
		return &channel.ChannelInfo, nil
	}
	channelSyncLock.RLock()
	defer channelSyncLock.RUnlock()

	c, ok := channelsIDM[id]
	if !ok {
		return nil, fmt.Errorf("渠道# %d，已不存在", id)
	}
	return &c.ChannelInfo, nil
}

func CacheUpdateChannelStatus(id int, status int) {
	if !common.MemoryCacheEnabled {
		return
	}
	channelSyncLock.Lock()
	defer channelSyncLock.Unlock()
	if channel, ok := channelsIDM[id]; ok {
		channel.Status = status
	}
	if status != common.ChannelStatusEnabled {
		// delete the channel from group2model2channels
		for group, model2channels := range group2model2channels {
			for model, channels := range model2channels {
				for i, channelId := range channels {
					if channelId == id {
						// remove the channel from the slice
						group2model2channels[group][model] = append(channels[:i], channels[i+1:]...)
						break
					}
				}
			}
		}
	}
}

func CacheUpdateChannel(channel *Channel) {
	if !common.MemoryCacheEnabled {
		return
	}
	channelSyncLock.Lock()
	defer channelSyncLock.Unlock()
	if channel == nil {
		return
	}

	println("CacheUpdateChannel:", channel.Id, channel.Name, channel.Status, channel.ChannelInfo.MultiKeyPollingIndex)

	println("before:", channelsIDM[channel.Id].ChannelInfo.MultiKeyPollingIndex)
	channelsIDM[channel.Id] = channel
	println("after :", channelsIDM[channel.Id].ChannelInfo.MultiKeyPollingIndex)
}
