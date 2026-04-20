package model

import (
	"testing"
)

func TestFilterByTenantMode_PrivatePriority(t *testing.T) {
	tenants := []Ability{{ChannelId: 1, Scope: ChannelScopeTenant, TenantId: 7}}
	platforms := []Ability{{ChannelId: 100, Scope: ChannelScopePlatform, TenantId: 0}}
	out := FilterByTenantMode(tenants, platforms, PlatformChannelModePrivatePriority, nil)
	if len(out) != 1 || out[0].ChannelId != 1 {
		t.Fatalf("private_priority should return only tenant row when both present: %+v", out)
	}
}

func TestFilterByTenantMode_PrivatePriorityFallback(t *testing.T) {
	platforms := []Ability{{ChannelId: 100, Scope: ChannelScopePlatform, TenantId: 0}}
	out := FilterByTenantMode(nil, platforms, PlatformChannelModePrivatePriority, nil)
	if len(out) != 1 || out[0].ChannelId != 100 {
		t.Fatalf("private_priority with no tenant rows should fall back to platform: %+v", out)
	}
}

func TestFilterByTenantMode_OnlyPrivate(t *testing.T) {
	tenants := []Ability{{ChannelId: 1, Scope: ChannelScopeTenant, TenantId: 7}}
	platforms := []Ability{{ChannelId: 100, Scope: ChannelScopePlatform, TenantId: 0}}
	out := FilterByTenantMode(tenants, platforms, PlatformChannelModeOnlyPrivate, nil)
	if len(out) != 1 || out[0].ChannelId != 1 {
		t.Fatalf("only_private should ignore platform: %+v", out)
	}
}

func TestFilterByTenantMode_OnlyPlatform(t *testing.T) {
	tenants := []Ability{{ChannelId: 1, Scope: ChannelScopeTenant, TenantId: 7}}
	platforms := []Ability{{ChannelId: 100, Scope: ChannelScopePlatform, TenantId: 0}}
	out := FilterByTenantMode(tenants, platforms, PlatformChannelModeOnlyPlatform, nil)
	if len(out) != 1 || out[0].ChannelId != 100 {
		t.Fatalf("only_platform should ignore tenant rows: %+v", out)
	}
}

func TestFilterByTenantMode_DisabledPlatformRemoved(t *testing.T) {
	platforms := []Ability{
		{ChannelId: 100, Scope: ChannelScopePlatform, TenantId: 0},
		{ChannelId: 101, Scope: ChannelScopePlatform, TenantId: 0},
	}
	disabled := map[int]struct{}{100: {}}
	out := FilterByTenantMode(nil, platforms, PlatformChannelModePrivatePriority, disabled)
	if len(out) != 1 || out[0].ChannelId != 101 {
		t.Fatalf("disabled platform channel should be removed: %+v", out)
	}
}

func TestFilterByTenantMode_PlatformPriorityWithDisabledFallsBack(t *testing.T) {
	tenants := []Ability{{ChannelId: 1, Scope: ChannelScopeTenant, TenantId: 7}}
	platforms := []Ability{{ChannelId: 100, Scope: ChannelScopePlatform, TenantId: 0}}
	disabled := map[int]struct{}{100: {}}
	out := FilterByTenantMode(tenants, platforms, PlatformChannelModePlatformPriority, disabled)
	// All platform channels disabled → fall back to tenant.
	if len(out) != 1 || out[0].ChannelId != 1 {
		t.Fatalf("platform_priority with all-disabled platform should fall back to tenant: %+v", out)
	}
}
