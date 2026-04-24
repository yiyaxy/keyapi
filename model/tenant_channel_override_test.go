package model

import (
	"errors"
	"testing"
)

func TestTenantChannelOverride_SetAndListDisabled(t *testing.T) {
	if DB == nil {
		t.Skip("no DB")
	}
	tenantId := 42
	channelId := 99
	// ensure clean slate
	_ = WithTenantBypass(DB).Where("tenant_id = ? AND channel_id = ?", tenantId, channelId).Delete(&TenantChannelOverride{})

	if err := SetTenantChannelDisabled(tenantId, channelId, true); err != nil {
		t.Fatalf("set disabled: %v", err)
	}
	ids, err := GetTenantDisabledPlatformChannels(tenantId)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if _, ok := ids[channelId]; !ok {
		t.Fatalf("expected channel %d in disabled set", channelId)
	}

	if err := SetTenantChannelDisabled(tenantId, channelId, false); err != nil {
		t.Fatalf("clear disabled: %v", err)
	}
	ids, _ = GetTenantDisabledPlatformChannels(tenantId)
	if _, ok := ids[channelId]; ok {
		t.Fatalf("expected channel %d removed after enabling", channelId)
	}
}

// TestTenantChannelOverride_AdminLockBlocksTenantEnable 覆盖核心新语义：
// 平台超管禁用某渠道后，租户不能通过自己的 toggle API 再打开它。
// 若此校验失效，LO 观察到的 "超管禁了但租户那边还能启用" bug 就会回归。
func TestTenantChannelOverride_AdminLockBlocksTenantEnable(t *testing.T) {
	if DB == nil {
		t.Skip("no DB")
	}
	tenantId := 77
	channelId := 888
	_ = WithTenantBypass(DB).Where("tenant_id = ? AND channel_id = ?", tenantId, channelId).Delete(&TenantChannelOverride{})

	// admin 强制禁用 → 预期 locked_by_admin=true
	if err := SetTenantChannelDisabledAsAdmin(tenantId, channelId, true); err != nil {
		t.Fatalf("admin disable: %v", err)
	}
	locked, _ := GetTenantLockedPlatformChannels(tenantId)
	if _, ok := locked[channelId]; !ok {
		t.Fatalf("expected channel %d in locked set after admin disable", channelId)
	}

	// 租户尝试 enable（disabled=false）→ 应该报 ErrTenantChannelLocked
	err := SetTenantChannelDisabledAsTenant(tenantId, channelId, false)
	if !errors.Is(err, ErrTenantChannelLocked) {
		t.Fatalf("tenant enable on admin-locked row: want ErrTenantChannelLocked, got %v", err)
	}
	// 租户尝试 disable（幂等操作）也要拒绝——不能篡改 admin 写的 row
	err = SetTenantChannelDisabledAsTenant(tenantId, channelId, true)
	if !errors.Is(err, ErrTenantChannelLocked) {
		t.Fatalf("tenant disable on admin-locked row: want ErrTenantChannelLocked, got %v", err)
	}

	// DB 状态未变：channel 仍被禁用
	ids, _ := GetTenantDisabledPlatformChannels(tenantId)
	if _, ok := ids[channelId]; !ok {
		t.Fatalf("channel %d should still be disabled after failed tenant writes", channelId)
	}

	// admin 清除后：租户可以再次自由 toggle
	if err := SetTenantChannelDisabledAsAdmin(tenantId, channelId, false); err != nil {
		t.Fatalf("admin clear: %v", err)
	}
	if err := SetTenantChannelDisabledAsTenant(tenantId, channelId, true); err != nil {
		t.Fatalf("tenant disable after admin clear: %v", err)
	}
	locked, _ = GetTenantLockedPlatformChannels(tenantId)
	if _, ok := locked[channelId]; ok {
		t.Fatalf("tenant-self disable must not set locked_by_admin")
	}

	_ = WithTenantBypass(DB).Where("tenant_id = ? AND channel_id = ?", tenantId, channelId).Delete(&TenantChannelOverride{})
}
