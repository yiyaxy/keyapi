package model

import "testing"

func TestTenantPlatformChannelMode_DefaultAndSet(t *testing.T) {
	if DB == nil {
		t.Skip("no DB")
	}
	tenantId := 43
	// Clean — column is "key" not "option_key"
	_ = WithTenantBypass(DB).Where("tenant_id = ? AND "+commonKeyCol+" = ?", tenantId, TenantOptionKeyPlatformChannelMode).Delete(&TenantOption{})

	mode, err := GetTenantPlatformChannelMode(tenantId)
	if err != nil {
		t.Fatalf("get default: %v", err)
	}
	if mode != PlatformChannelModePrivatePriority {
		t.Fatalf("default mode = %q, want %q", mode, PlatformChannelModePrivatePriority)
	}

	if err := SetTenantPlatformChannelMode(tenantId, PlatformChannelModeOnlyPlatform); err != nil {
		t.Fatalf("set: %v", err)
	}
	mode, _ = GetTenantPlatformChannelMode(tenantId)
	if mode != PlatformChannelModeOnlyPlatform {
		t.Fatalf("got %q after set, want %q", mode, PlatformChannelModeOnlyPlatform)
	}

	// invalid value rejected
	if err := SetTenantPlatformChannelMode(tenantId, "garbage"); err == nil {
		t.Fatal("expected error for invalid mode")
	}
}
