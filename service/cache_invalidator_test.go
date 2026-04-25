package service

import (
	"context"
	"strconv"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/alicebob/miniredis/v2"
	"github.com/go-redis/redis/v8"
)

type fakeReloader struct {
	option        atomic.Int32
	channelFull   atomic.Int32
	tenantRouting atomic.Int32
	tenantOption  atomic.Int32
	lastOptionKey atomic.Value // string
	lastTenantKey atomic.Value // string
	lastTenantOpt atomic.Value // string "<tid>:<key>"
}

func (f *fakeReloader) ReloadOption(key string) error {
	f.option.Add(1)
	f.lastOptionKey.Store(key)
	return nil
}
func (f *fakeReloader) ReloadChannelCache() { f.channelFull.Add(1) }
func (f *fakeReloader) ReloadTenantRoutingCache(tenantId int) {
	f.tenantRouting.Add(1)
	f.lastTenantKey.Store(strconv.Itoa(tenantId))
}
func (f *fakeReloader) InvalidateTenantOptionKey(tenantId int, key string) {
	f.tenantOption.Add(1)
	f.lastTenantOpt.Store(strconv.Itoa(tenantId) + ":" + key)
}

func TestStartCacheInvalidator_DispatchesByType(t *testing.T) {
	s := miniredis.RunT(t)
	prevRDB := common.RDB
	prevEnabled := common.RedisEnabled
	prevInstance := common.InstanceID
	common.RDB = redis.NewClient(&redis.Options{Addr: s.Addr()})
	common.RedisEnabled = true
	common.InstanceID = "subscriber-instance"
	t.Cleanup(func() {
		_ = common.RDB.Close()
		common.RDB = prevRDB
		common.RedisEnabled = prevEnabled
		common.InstanceID = prevInstance
	})

	r := &fakeReloader{}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go startCacheInvalidatorWith(ctx, r)
	time.Sleep(100 * time.Millisecond)

	// 模拟其他实例发送 — 直接在 msg 里填 InstanceID，不动全局
	publishAs(t, "peer-A", common.InvalidateMessage{Type: "option", Key: "Notice"})
	publishAs(t, "peer-A", common.InvalidateMessage{Type: "channel_full"})
	publishAs(t, "peer-A", common.InvalidateMessage{Type: "tenant_routing", Key: "7"})
	publishAs(t, "peer-A", common.InvalidateMessage{Type: "tenant_option", Key: "42:ChannelDisableThreshold"})
	// 自己的消息（应被 selfID 过滤）
	publishAs(t, "subscriber-instance", common.InvalidateMessage{Type: "option", Key: "ShouldIgnore"})

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if r.option.Load() == 1 && r.channelFull.Load() == 1 && r.tenantRouting.Load() == 1 && r.tenantOption.Load() == 1 {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if r.option.Load() != 1 {
		t.Errorf("option reload count = %d, want 1", r.option.Load())
	}
	if r.channelFull.Load() != 1 {
		t.Errorf("channel_full reload count = %d, want 1", r.channelFull.Load())
	}
	if r.tenantRouting.Load() != 1 {
		t.Errorf("tenant_routing reload count = %d, want 1", r.tenantRouting.Load())
	}
	if r.tenantOption.Load() != 1 {
		t.Errorf("tenant_option reload count = %d, want 1", r.tenantOption.Load())
	}
	if got := r.lastOptionKey.Load(); got != "Notice" {
		t.Errorf("last option key = %v, want Notice", got)
	}
	if got := r.lastTenantOpt.Load(); got != "42:ChannelDisableThreshold" {
		t.Errorf("last tenant_option key = %v, want 42:ChannelDisableThreshold", got)
	}
}

// publishAs 显式在 msg 里填 InstanceID，避免改全局 common.InstanceID 造成 race。
func publishAs(t *testing.T, instanceID string, msg common.InvalidateMessage) {
	t.Helper()
	msg.InstanceID = instanceID
	if err := common.PublishInvalidate(msg); err != nil {
		t.Fatalf("publish: %v", err)
	}
}
