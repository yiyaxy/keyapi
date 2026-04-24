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
