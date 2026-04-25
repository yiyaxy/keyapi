package service

import (
	"context"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

// CacheReloader is the dependency surface needed by the invalidate subscriber.
// Defining it as an interface lets tests swap in a fake without spinning up GORM.
type CacheReloader interface {
	ReloadOption(key string) error
	ReloadChannelCache()
	ReloadTenantRoutingCache(tenantId int)
	InvalidateTenantOptionKey(tenantId int, key string)
}

type modelReloader struct{}

func (modelReloader) ReloadOption(key string) error   { return model.ReloadOption(key) }
func (modelReloader) ReloadChannelCache()             { model.ReloadChannelCache() }
func (modelReloader) ReloadTenantRoutingCache(id int) { model.ReloadTenantRoutingCache(id) }
func (modelReloader) InvalidateTenantOptionKey(tenantId int, key string) {
	// 注意：直接操作底层 tenantOptionCache，不走对外的 InvalidateTenantOptionCacheKey
	// — 后者会再 publish 一次，N 个 peer 互相反弹会形成网状放大。
	tenantOptionCache.Delete(cacheKey(tenantId, key))
}

// StartCacheInvalidator runs the subscriber loop in the current goroutine.
// Wire from main: trace.GoJob("cacheinvalsub", service.StartCacheInvalidator)
func StartCacheInvalidator() {
	startCacheInvalidatorWith(context.Background(), modelReloader{})
}

func startCacheInvalidatorWith(ctx context.Context, r CacheReloader) {
	common.SubscribeInvalidate(ctx, func(msg common.InvalidateMessage) {
		switch msg.Type {
		case "option":
			if err := r.ReloadOption(msg.Key); err != nil {
				common.SysLog("invalidate option reload failed: " + msg.Key + ": " + err.Error())
				return
			}
			common.SysLog("invalidate option reload: " + msg.Key)
		case "channel_full":
			r.ReloadChannelCache()
			common.SysLog("invalidate channel_full reload")
		case "tenant_routing":
			id, err := strconv.Atoi(msg.Key)
			if err != nil {
				common.SysLog("invalidate: bad tenant id: " + msg.Key)
				return
			}
			r.ReloadTenantRoutingCache(id)
			common.SysLog("invalidate tenant_routing reload: " + msg.Key)
		case "tenant_option":
			// key 格式 "<tenantId>:<optionKey>"
			parts := strings.SplitN(msg.Key, ":", 2)
			if len(parts) != 2 {
				common.SysLog("invalidate: bad tenant_option key: " + msg.Key)
				return
			}
			tid, err := strconv.Atoi(parts[0])
			if err != nil {
				common.SysLog("invalidate: bad tenant_option tenant id: " + msg.Key)
				return
			}
			r.InvalidateTenantOptionKey(tid, parts[1])
			common.SysLog("invalidate tenant_option evict: " + msg.Key)
		default:
			common.SysLog("invalidate: unknown type: " + msg.Type)
		}
	})
}
