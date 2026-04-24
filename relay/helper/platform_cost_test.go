package helper

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/types"
)

func TestComputePlatformCostEstimate_UsePrice(t *testing.T) {
	pd := types.PriceData{
		UsePrice:                 true,
		PlatformCostModelPrice:   2.0,
		PlatformCostChannelRatio: 1.0,
	}
	got := computePlatformCostQuotaForPerCall(&pd, 0)
	want := int(2.0 * common.QuotaPerUnit)
	if got != want {
		t.Fatalf("got %d want %d", got, want)
	}
}

func TestComputePlatformCostEstimate_TokenRatio(t *testing.T) {
	pd := types.PriceData{
		PlatformCostModelRatio:   0.5,
		PlatformCostChannelRatio: 1.2,
	}
	got := computePlatformCostQuotaForTokens(&pd, 1000)
	if got != 600 {
		t.Fatalf("got %d want 600", got)
	}
}

func TestComputePlatformCostEstimate_IgnoresGroupAndMarkup(t *testing.T) {
	pd := types.PriceData{
		PlatformCostModelRatio:   1.0,
		PlatformCostChannelRatio: 1.0,
		GroupRatioInfo:           types.GroupRatioInfo{GroupRatio: 0.1},
		OtherRatios:              map[string]float64{"platform_markup": 10.0},
	}
	got := computePlatformCostQuotaForTokens(&pd, 100)
	if got != 100 {
		t.Fatalf("got %d want 100", got)
	}
}

func TestComputePlatformCostEstimate_MinimumOne(t *testing.T) {
	pd := types.PriceData{
		PlatformCostModelRatio:   0.0001,
		PlatformCostChannelRatio: 1.0,
	}
	if got := computePlatformCostQuotaForTokens(&pd, 1); got != 1 {
		t.Fatalf("got %d want 1", got)
	}
	if got := computePlatformCostQuotaForTokens(&pd, 0); got != 0 {
		t.Fatalf("got %d want 0", got)
	}
}
