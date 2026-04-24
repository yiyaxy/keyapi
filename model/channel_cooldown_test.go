package model

import (
	"math"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/channel_stability"
)

func TestChannelCooldownSetGetClearDBFallback(t *testing.T) {
	channel := &Channel{
		Type:        1,
		Key:         "cooldown-key",
		Status:      common.ChannelStatusEnabled,
		Name:        "cooldown-db-fallback",
		Models:      "cooldown-model",
		Group:       "default",
		Scope:       ChannelScopeTenant,
		TenantId:    123,
		CreatedTime: 1,
	}
	if err := WithTenantBypass(DB).Create(channel).Error; err != nil {
		t.Fatalf("create channel: %v", err)
	}
	t.Cleanup(func() {
		_ = WithTenantBypass(DB).Delete(&Channel{}, channel.Id).Error
	})

	if err := SetChannelCooldown(channel.Id, "status=429", time.Minute); err != nil {
		t.Fatalf("set cooldown: %v", err)
	}
	cooldown, ok := GetChannelCooldown(channel.Id)
	if !ok {
		t.Fatalf("expected active cooldown")
	}
	if cooldown.Reason != "status=429" {
		t.Fatalf("cooldown reason = %q, want status=429", cooldown.Reason)
	}
	if cooldown.Until <= channelCooldownNowMs() {
		t.Fatalf("cooldown until = %d, want future", cooldown.Until)
	}

	if err := ClearChannelCooldown(channel.Id); err != nil {
		t.Fatalf("clear cooldown: %v", err)
	}
	if _, ok := GetChannelCooldown(channel.Id); ok {
		t.Fatalf("expected cleared cooldown")
	}
}

func TestFilterCooledDownChannelsFallsBackWhenAllFiltered(t *testing.T) {
	prev := ChannelCooldownEnabledForTenant
	ChannelCooldownEnabledForTenant = func(int) bool { return true }
	t.Cleanup(func() { ChannelCooldownEnabledForTenant = prev })

	first := &Channel{Name: "cooldown-first", Type: 1, Key: "k1", Status: common.ChannelStatusEnabled, Scope: ChannelScopeTenant, TenantId: 124}
	second := &Channel{Name: "cooldown-second", Type: 1, Key: "k2", Status: common.ChannelStatusEnabled, Scope: ChannelScopeTenant, TenantId: 124}
	if err := WithTenantBypass(DB).Create(first).Error; err != nil {
		t.Fatalf("create first: %v", err)
	}
	if err := WithTenantBypass(DB).Create(second).Error; err != nil {
		t.Fatalf("create second: %v", err)
	}
	t.Cleanup(func() {
		_ = WithTenantBypass(DB).Delete(&Channel{}, []int{first.Id, second.Id}).Error
	})

	if err := SetChannelCooldown(first.Id, "status=429", time.Minute); err != nil {
		t.Fatalf("set first cooldown: %v", err)
	}
	if err := SetChannelCooldown(second.Id, "status=503", time.Minute); err != nil {
		t.Fatalf("set second cooldown: %v", err)
	}

	original := []int{first.Id, second.Id}
	if got := filterCooledDownChannelIds(124, original); len(got) != len(original) {
		t.Fatalf("all cooled channels should fall back to original list, got %#v", got)
	}

	if err := ClearChannelCooldown(second.Id); err != nil {
		t.Fatalf("clear second cooldown: %v", err)
	}
	got := filterCooledDownChannelIds(124, original)
	if len(got) != 1 || got[0] != second.Id {
		t.Fatalf("filter result = %#v, want only second channel", got)
	}
}

func TestWarmupFactorProgression(t *testing.T) {
	cfg := channel_stability.Default().Cooldown
	cooldownUntil := int64(1_000_000)
	lastCooldownAt := cooldownUntil - 30_000

	cases := []struct {
		elapsedMs int64
		want      float64
	}{
		{elapsedMs: 0, want: 0.10},
		{elapsedMs: 30_000, want: 0.20},
		{elapsedMs: 90_000, want: 0.80},
		{elapsedMs: 120_000, want: 1},
	}
	for _, tc := range cases {
		got := warmupFactor(cooldownUntil, lastCooldownAt, cooldownUntil+tc.elapsedMs, cfg)
		if math.Abs(got-tc.want) > 0.0001 {
			t.Fatalf("warmupFactor elapsed=%d = %v, want %v", tc.elapsedMs, got, tc.want)
		}
	}
}
