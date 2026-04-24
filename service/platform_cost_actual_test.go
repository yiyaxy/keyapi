package service

import (
	"testing"

	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/types"
)

func TestComputePlatformCostActualText_TokenRatio(t *testing.T) {
	pd := types.PriceData{
		PlatformCostModelRatio:   1.0,
		PlatformCostChannelRatio: 1.0,
		CompletionRatio:          1.0,
	}
	usage := &dto.Usage{PromptTokens: 100, CompletionTokens: 50}
	got := ComputePlatformCostActualText(nil, nil, pd, usage)
	if got != 150 {
		t.Fatalf("got %d want 150", got)
	}
}

func TestComputePlatformCostActualText_IgnoresGroupAndMarkup(t *testing.T) {
	pd := types.PriceData{
		PlatformCostModelRatio:   1.0,
		PlatformCostChannelRatio: 1.0,
		CompletionRatio:          1.0,
		GroupRatioInfo:           types.GroupRatioInfo{GroupRatio: 0.1},
		OtherRatios:              map[string]float64{"platform_markup": 10.0},
	}
	usage := &dto.Usage{PromptTokens: 100}
	got := ComputePlatformCostActualText(nil, nil, pd, usage)
	if got != 100 {
		t.Fatalf("got %d want 100", got)
	}
}

func TestComputePlatformCostActualText_UsesPlatformCostChannelRatio(t *testing.T) {
	pd := types.PriceData{
		PlatformCostModelRatio:   1.0,
		PlatformCostChannelRatio: 2.0,
		CompletionRatio:          1.0,
	}
	usage := &dto.Usage{PromptTokens: 100}
	got := ComputePlatformCostActualText(nil, nil, pd, usage)
	if got != 200 {
		t.Fatalf("got %d want 200", got)
	}
}

func TestComputePlatformCostActualRealtime_IgnoresGroupRatio(t *testing.T) {
	info := &relaycommon.RelayInfo{
		OriginModelName: "gpt-4o-realtime-preview",
		PriceData: types.PriceData{
			PlatformCostModelRatio:   1.0,
			PlatformCostChannelRatio: 1.0,
			GroupRatioInfo:           types.GroupRatioInfo{GroupRatio: 0.1},
		},
	}
	usage := &dto.RealtimeUsage{
		InputTokenDetails:  dto.InputTokenDetails{TextTokens: 100},
		OutputTokenDetails: dto.OutputTokenDetails{TextTokens: 50},
	}
	got := ComputePlatformCostActualRealtime(info, usage)
	if got <= 50 {
		t.Fatalf("got %d, GroupRatio likely leaked", got)
	}
}
