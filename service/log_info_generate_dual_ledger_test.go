package service

import (
	"testing"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/types"
)

func TestAddDualLedgerLogFields(t *testing.T) {
	info := &relaycommon.RelayInfo{
		PriceMarkupRatio: 1.25,
		PriceData: types.PriceData{
			PlatformCostQuota:        80,
			PlatformCostChannelRatio: 0.8,
		},
	}
	other := map[string]interface{}{}
	AddDualLedgerLogFields(info, other, 100)

	if other["pricing_version"] != "dual-ledger-v1" {
		t.Fatalf("pricing_version = %v", other["pricing_version"])
	}
	if other["user_bill_quota"] != 100 {
		t.Fatalf("user_bill_quota = %v", other["user_bill_quota"])
	}
	if other["platform_cost_quota"] != 80 {
		t.Fatalf("platform_cost_quota = %v", other["platform_cost_quota"])
	}
	if other["tenant_markup_ratio"] != 1.25 {
		t.Fatalf("tenant_markup_ratio = %v", other["tenant_markup_ratio"])
	}
	if other["platform_cost_channel_ratio"] != 0.8 {
		t.Fatalf("platform_cost_channel_ratio = %v", other["platform_cost_channel_ratio"])
	}
}
