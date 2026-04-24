package types

import "testing"

func TestPriceData_PlatformCostFieldsDefaultsAreZero(t *testing.T) {
	var p PriceData
	if p.PlatformCostQuota != 0 {
		t.Fatalf("PlatformCostQuota default = %d, want 0", p.PlatformCostQuota)
	}
	if p.PlatformCostQuotaToPreConsume != 0 {
		t.Fatalf("PlatformCostQuotaToPreConsume default = %d, want 0", p.PlatformCostQuotaToPreConsume)
	}
	if p.PlatformCostChannelRatio != 0 {
		t.Fatalf("PlatformCostChannelRatio default = %v, want 0", p.PlatformCostChannelRatio)
	}
	if p.PlatformCostOtherRatios != nil {
		t.Fatalf("PlatformCostOtherRatios default = %v, want nil", p.PlatformCostOtherRatios)
	}
}

func TestPriceData_AddPlatformCostOtherRatio(t *testing.T) {
	var p PriceData
	p.AddPlatformCostOtherRatio("image_count", 3.0)
	if got := p.PlatformCostOtherRatios["image_count"]; got != 3.0 {
		t.Fatalf("image_count = %v, want 3", got)
	}
	p.AddPlatformCostOtherRatio("zero", 0)
	if _, exists := p.PlatformCostOtherRatios["zero"]; exists {
		t.Fatalf("zero ratio should not be stored")
	}
}
