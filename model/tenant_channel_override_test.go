package model

import (
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
