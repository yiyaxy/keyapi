package channel_stability

import (
	"reflect"
	"testing"
)

func TestDefaultReturnsStreamBoundaryConfig(t *testing.T) {
	got := Default()
	if got.StreamBoundary.DefaultFirstTokenTimeoutMs != DefaultFirstTokenTimeoutMs {
		t.Fatalf("default first token timeout = %d, want %d", got.StreamBoundary.DefaultFirstTokenTimeoutMs, DefaultFirstTokenTimeoutMs)
	}
	if got.StreamBoundary.ModelFamilyOverrides["deepseek-r1"] != 30000 {
		t.Fatalf("expected deepseek-r1 stream timeout override, got %#v", got.StreamBoundary.ModelFamilyOverrides)
	}
	if got.Cooldown.BaseDurationMs != DefaultCooldownBaseDurationMs {
		t.Fatalf("default cooldown base = %d, want %d", got.Cooldown.BaseDurationMs, DefaultCooldownBaseDurationMs)
	}
	if got.Cooldown.EscalationLimit != DefaultCooldownEscalationLimit {
		t.Fatalf("default cooldown escalation limit = %d, want %d", got.Cooldown.EscalationLimit, DefaultCooldownEscalationLimit)
	}
}

func TestDefaultReturnsClone(t *testing.T) {
	got := Default()
	got.StreamBoundary.ModelFamilyOverrides["deepseek-r1"] = 1

	next := Default()
	if reflect.DeepEqual(got, next) {
		t.Fatalf("Default() reused mutable maps")
	}
}
