package model

import "testing"

func TestTenantRoutingPrefs_ReflectsStoredValues(t *testing.T) {
	if DB == nil {
		t.Skip("no DB")
	}
	tenantId := 44
	// Seed DB
	_ = SetTenantChannelDisabled(tenantId, 777, true)
	defer SetTenantChannelDisabled(tenantId, 777, false)
	_ = SetTenantPlatformChannelMode(tenantId, PlatformChannelModeOnlyPlatform)

	// Load into cache
	ReloadTenantRoutingCache(tenantId)

	mode := GetCachedTenantMode(tenantId)
	if mode != PlatformChannelModeOnlyPlatform {
		t.Errorf("mode = %q, want only_platform", mode)
	}
	dis := GetCachedTenantDisabledChannels(tenantId)
	if _, ok := dis[777]; !ok {
		t.Error("channel 777 should be in disabled set")
	}
}

func TestGetCachedTenantMode_DefaultWhenNotLoaded(t *testing.T) {
	// Fresh tenant never Reload'd
	mode := GetCachedTenantMode(99999)
	if mode != PlatformChannelModePrivatePriority {
		t.Errorf("default mode = %q, want private_priority", mode)
	}
}

func TestGetCachedTenantDisabledChannels_EmptyMapWhenNotLoaded(t *testing.T) {
	s := GetCachedTenantDisabledChannels(99998)
	if s == nil {
		t.Error("must return non-nil empty map, not nil, to let callers safely range")
	}
	if len(s) != 0 {
		t.Error("empty")
	}
}
