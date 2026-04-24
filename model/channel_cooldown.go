package model

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/channel_stability"

	"github.com/go-redis/redis/v8"
	"gorm.io/gorm"
)

type ChannelCooldown struct {
	ChannelId      int
	Until          int64
	Reason         string
	Count          int
	LastCooldownAt int64
}

var ChannelCooldownEnabledForTenant = func(_ int) bool { return false }

func channelCooldownKey(channelId int) string {
	return fmt.Sprintf("channel:cooldown:%d", channelId)
}

func channelCooldownCountKey(channelId int) string {
	return fmt.Sprintf("channel:cooldown_count:%d", channelId)
}

func channelCooldownNowMs() int64 {
	return time.Now().UnixMilli()
}

func SetChannelCooldown(channelId int, reason string, duration time.Duration) error {
	if channelId <= 0 || duration <= 0 {
		return nil
	}
	reason = truncateCooldownReason(reason)
	nowMs := channelCooldownNowMs()
	untilMs := nowMs + duration.Milliseconds()

	if common.RedisEnabled && common.RDB != nil {
		if err := common.RedisSet(channelCooldownKey(channelId), reason, duration); err != nil {
			common.SysLog(fmt.Sprintf("failed to write channel cooldown to redis: channel_id=%d, error=%v", channelId, err))
		}
	}

	update := map[string]interface{}{
		"cooldown_until":   untilMs,
		"cooldown_reason":  reason,
		"last_cooldown_at": nowMs,
	}
	if err := WithTenantBypass(DB).Model(&Channel{}).Where("id = ?", channelId).Updates(update).Error; err != nil {
		return err
	}
	updateCachedChannelCooldown(channelId, untilMs, reason, nowMs)
	return nil
}

func GetChannelCooldown(channelId int) (*ChannelCooldown, bool) {
	if channelId <= 0 {
		return nil, false
	}
	if cd, ok := getChannelCooldownFromRedis(channelId); ok {
		return cd, true
	}
	cd, ok := getChannelCooldownFromDB(channelId)
	if !ok {
		return nil, false
	}
	if cd.Until <= channelCooldownNowMs() {
		return nil, false
	}
	return cd, true
}

func ClearChannelCooldown(channelId int) error {
	if channelId <= 0 {
		return nil
	}
	if common.RedisEnabled && common.RDB != nil {
		if err := common.RedisDel(channelCooldownKey(channelId)); err != nil {
			common.SysLog(fmt.Sprintf("failed to clear channel cooldown redis key: channel_id=%d, error=%v", channelId, err))
		}
	}
	update := map[string]interface{}{
		"cooldown_until":  0,
		"cooldown_reason": "",
	}
	if err := WithTenantBypass(DB).Model(&Channel{}).Where("id = ?", channelId).Updates(update).Error; err != nil {
		return err
	}
	updateCachedChannelCooldown(channelId, 0, "", 0)
	return nil
}

func IncrChannelCooldownCount(channelId int) (int, error) {
	if channelId <= 0 {
		return 0, nil
	}
	if common.RedisEnabled && common.RDB != nil {
		count, err := incrChannelCooldownCountRedis(channelId)
		if err == nil {
			_ = WithTenantBypass(DB).Model(&Channel{}).Where("id = ?", channelId).Update("cooldown_count", count).Error
			updateCachedChannelCooldownCount(channelId, int(count))
			return int(count), nil
		}
		common.SysLog(fmt.Sprintf("failed to increment channel cooldown count in redis: channel_id=%d, error=%v", channelId, err))
	}

	if err := WithTenantBypass(DB).Model(&Channel{}).
		Where("id = ?", channelId).
		Update("cooldown_count", gorm.Expr("cooldown_count + ?", 1)).Error; err != nil {
		return 0, err
	}
	var channel Channel
	if err := WithTenantBypass(DB).Select("cooldown_count").First(&channel, "id = ?", channelId).Error; err != nil {
		return 0, err
	}
	updateCachedChannelCooldownCount(channelId, channel.CooldownCount)
	return channel.CooldownCount, nil
}

func ChannelWarmupFactor(channelId int) float64 {
	if channelId <= 0 {
		return 1
	}
	var channel Channel
	err := WithTenantBypass(DB).Select("cooldown_until", "last_cooldown_at").
		First(&channel, "id = ?", channelId).Error
	if err != nil {
		return 1
	}
	return warmupFactor(channel.CooldownUntil, channel.LastCooldownAt, channelCooldownNowMs(), channel_stability.Get().Cooldown)
}

func filterCooledDownChannelIds(tenantId int, channelIds []int) []int {
	if !ChannelCooldownEnabledForTenant(tenantId) || len(channelIds) <= 1 {
		return channelIds
	}
	filtered := make([]int, 0, len(channelIds))
	for _, channelId := range channelIds {
		if _, cooledDown := GetChannelCooldown(channelId); cooledDown {
			continue
		}
		filtered = append(filtered, channelId)
	}
	if len(filtered) == 0 {
		return channelIds
	}
	return filtered
}

func filterCooledDownAbilities(tenantId int, abilities []Ability) []Ability {
	if !ChannelCooldownEnabledForTenant(tenantId) || len(abilities) <= 1 {
		return abilities
	}
	filtered := make([]Ability, 0, len(abilities))
	for _, ability := range abilities {
		if _, cooledDown := GetChannelCooldown(ability.ChannelId); cooledDown {
			continue
		}
		filtered = append(filtered, ability)
	}
	if len(filtered) == 0 {
		return abilities
	}
	return filtered
}

func effectiveCooldownWeight(channelId int, configuredWeight int) int {
	factor := ChannelWarmupFactor(channelId)
	if factor >= 1 {
		return configuredWeight
	}
	if factor <= 0 {
		return 0
	}
	weighted := int(math.Round(float64(configuredWeight) * factor))
	if configuredWeight > 0 && weighted < 1 {
		return 1
	}
	return weighted
}

func warmupFactor(cooldownUntilMs int64, lastCooldownAtMs int64, nowMs int64, cfg channel_stability.CooldownConfig) float64 {
	if cooldownUntilMs <= 0 || lastCooldownAtMs <= 0 || nowMs < cooldownUntilMs {
		return 1
	}
	stepMs := cfg.WarmupStepMs
	if stepMs <= 0 {
		stepMs = channel_stability.DefaultWarmupStepMs
	}
	durationMs := cfg.WarmupDurationMs
	if durationMs <= 0 {
		durationMs = channel_stability.DefaultWarmupDurationMs
	}
	startFactor := cfg.WarmupStartFactor
	if startFactor <= 0 || startFactor > 1 {
		startFactor = channel_stability.DefaultWarmupStartFactor
	}
	elapsedMs := nowMs - cooldownUntilMs
	if elapsedMs >= int64(durationMs) {
		return 1
	}
	steps := elapsedMs / int64(stepMs)
	factor := startFactor * math.Pow(2, float64(steps))
	if factor > 1 {
		return 1
	}
	return factor
}

func getChannelCooldownFromRedis(channelId int) (*ChannelCooldown, bool) {
	if !common.RedisEnabled || common.RDB == nil {
		return nil, false
	}
	ctx := context.Background()
	reason, err := common.RDB.Get(ctx, channelCooldownKey(channelId)).Result()
	if errors.Is(err, redis.Nil) {
		return nil, false
	}
	if err != nil {
		common.SysLog(fmt.Sprintf("failed to read channel cooldown from redis: channel_id=%d, error=%v", channelId, err))
		return nil, false
	}
	ttl, err := common.RDB.TTL(ctx, channelCooldownKey(channelId)).Result()
	if err != nil || ttl <= 0 {
		return nil, false
	}
	count := 0
	if raw, err := common.RDB.Get(ctx, channelCooldownCountKey(channelId)).Result(); err == nil {
		count, _ = strconv.Atoi(raw)
	}
	return &ChannelCooldown{
		ChannelId: channelId,
		Until:     channelCooldownNowMs() + ttl.Milliseconds(),
		Reason:    reason,
		Count:     count,
	}, true
}

func getChannelCooldownFromDB(channelId int) (*ChannelCooldown, bool) {
	var channel Channel
	err := WithTenantBypass(DB).Select("id", "cooldown_until", "cooldown_reason", "cooldown_count", "last_cooldown_at").
		First(&channel, "id = ?", channelId).Error
	if err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			common.SysLog(fmt.Sprintf("failed to read channel cooldown from db: channel_id=%d, error=%v", channelId, err))
		}
		return nil, false
	}
	return &ChannelCooldown{
		ChannelId:      channel.Id,
		Until:          channel.CooldownUntil,
		Reason:         channel.CooldownReason,
		Count:          channel.CooldownCount,
		LastCooldownAt: channel.LastCooldownAt,
	}, true
}

func incrChannelCooldownCountRedis(channelId int) (int64, error) {
	ctx := context.Background()
	key := channelCooldownCountKey(channelId)
	count, err := common.RDB.Incr(ctx, key).Result()
	if err != nil {
		return 0, err
	}
	countWindowMs := channel_stability.Get().Cooldown.CountWindowMs
	if countWindowMs <= 0 {
		countWindowMs = channel_stability.DefaultCooldownCountWindowMs
	}
	if err := common.RDB.Expire(ctx, key, time.Duration(countWindowMs)*time.Millisecond).Err(); err != nil {
		return 0, err
	}
	return count, nil
}

func truncateCooldownReason(reason string) string {
	reason = strings.TrimSpace(reason)
	if len(reason) <= 128 {
		return reason
	}
	return reason[:128]
}

func updateCachedChannelCooldown(channelId int, untilMs int64, reason string, lastCooldownAtMs int64) {
	if !common.MemoryCacheEnabled {
		return
	}
	channelSyncLock.Lock()
	defer channelSyncLock.Unlock()
	channel, ok := channelsIDM[channelId]
	if !ok || channel == nil {
		return
	}
	channel.CooldownUntil = untilMs
	channel.CooldownReason = reason
	if lastCooldownAtMs != 0 {
		channel.LastCooldownAt = lastCooldownAtMs
	}
}

func updateCachedChannelCooldownCount(channelId int, count int) {
	if !common.MemoryCacheEnabled || count == 0 {
		return
	}
	channelSyncLock.Lock()
	defer channelSyncLock.Unlock()
	channel, ok := channelsIDM[channelId]
	if !ok || channel == nil {
		return
	}
	channel.CooldownCount = count
}
