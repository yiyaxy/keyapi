package model

import "testing"

func TestChannel_PlatformCostRatioFieldIsNullablePointer(t *testing.T) {
	var ch Channel
	if ch.PlatformCostRatio != nil {
		t.Fatalf("default PlatformCostRatio = %v, want nil", ch.PlatformCostRatio)
	}
	v := 1.25
	ch.PlatformCostRatio = &v
	if *ch.PlatformCostRatio != 1.25 {
		t.Fatalf("round-trip failed: %v", *ch.PlatformCostRatio)
	}
}

func TestChannel_ResolvePlatformCostRatio(t *testing.T) {
	if got := (&Channel{}).ResolvePlatformCostRatio(); got != 1.0 {
		t.Fatalf("nil PlatformCostRatio = %v, want 1", got)
	}
	for _, v := range []float64{0, -0.5} {
		ch := &Channel{PlatformCostRatio: &v}
		if got := ch.ResolvePlatformCostRatio(); got != 1.0 {
			t.Fatalf("PlatformCostRatio=%v resolved to %v, want 1", v, got)
		}
	}
	v := 1.5
	ch := &Channel{PlatformCostRatio: &v}
	if got := ch.ResolvePlatformCostRatio(); got != 1.5 {
		t.Fatalf("PlatformCostRatio=%v resolved to %v, want 1.5", v, got)
	}
}

// Dual-ledger v1.1 (2026-04-24): when PlatformCostRatio is unset, inherit
// from ChannelSetting.channel_ratio on platform-scope channels so the common
// case "this channel is 0.7x everywhere" only needs one field.
func TestChannel_ResolvePlatformCostRatio_InheritsChannelRatioOnPlatformScope(t *testing.T) {
	setting := `{"channel_ratio": 0.7}`
	ch := &Channel{
		Scope:   ChannelScopePlatform,
		Setting: &setting,
	}
	if got := ch.ResolvePlatformCostRatio(); got != 0.7 {
		t.Fatalf("want 0.7 (inherited), got %v", got)
	}
}

// Explicit PlatformCostRatio must beat the channel_ratio inheritance — this
// is how admins express subsidy (channel_ratio=0.5 but platform_cost=1.0) or
// markup (channel_ratio=1.2 but platform_cost=1.5) scenarios.
func TestChannel_ResolvePlatformCostRatio_ExplicitOverridesInheritance(t *testing.T) {
	setting := `{"channel_ratio": 0.7}`
	explicit := 1.0
	ch := &Channel{
		Scope:             ChannelScopePlatform,
		Setting:           &setting,
		PlatformCostRatio: &explicit,
	}
	if got := ch.ResolvePlatformCostRatio(); got != 1.0 {
		t.Fatalf("want 1.0 (explicit wins), got %v", got)
	}
}

// Isolation invariant: tenant-scope channels must NEVER inherit from
// ChannelSetting.channel_ratio because that field is tenant-editable there.
// Cost ledger must not depend on any tenant-controllable value.
func TestChannel_ResolvePlatformCostRatio_TenantScopeSkipsInheritance(t *testing.T) {
	setting := `{"channel_ratio": 0.1}`
	ch := &Channel{
		Scope:   ChannelScopeTenant,
		Setting: &setting,
	}
	if got := ch.ResolvePlatformCostRatio(); got != 1.0 {
		t.Fatalf("tenant scope must fall back to 1.0, got %v", got)
	}
}

// Malformed setting JSON: silently fall back to 1.0, don't panic.
func TestChannel_ResolvePlatformCostRatio_MalformedSettingFallsBack(t *testing.T) {
	setting := `not valid json`
	ch := &Channel{
		Scope:   ChannelScopePlatform,
		Setting: &setting,
	}
	if got := ch.ResolvePlatformCostRatio(); got != 1.0 {
		t.Fatalf("malformed setting must fall back to 1.0, got %v", got)
	}
}

// Empty setting string: fall back to 1.0.
func TestChannel_ResolvePlatformCostRatio_EmptySettingFallsBack(t *testing.T) {
	setting := ``
	ch := &Channel{
		Scope:   ChannelScopePlatform,
		Setting: &setting,
	}
	if got := ch.ResolvePlatformCostRatio(); got != 1.0 {
		t.Fatalf("empty setting must fall back to 1.0, got %v", got)
	}
}

// setting missing channel_ratio (e.g. only other fields): fall back to 1.0,
// not 0.
func TestChannel_ResolvePlatformCostRatio_NoChannelRatioInSettingFallsBack(t *testing.T) {
	setting := `{"proxy": "http://example.com"}`
	ch := &Channel{
		Scope:   ChannelScopePlatform,
		Setting: &setting,
	}
	if got := ch.ResolvePlatformCostRatio(); got != 1.0 {
		t.Fatalf("missing channel_ratio must fall back to 1.0, got %v", got)
	}
}
