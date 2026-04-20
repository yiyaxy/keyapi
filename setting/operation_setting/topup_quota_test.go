package operation_setting

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
)

func TestComputeTopupQuotaDelta(t *testing.T) {
	origDisplay := generalSetting.QuotaDisplayType
	origCustomRate := generalSetting.CustomCurrencyExchangeRate
	origUsdRate := USDExchangeRate
	origQPU := common.QuotaPerUnit
	t.Cleanup(func() {
		generalSetting.QuotaDisplayType = origDisplay
		generalSetting.CustomCurrencyExchangeRate = origCustomRate
		USDExchangeRate = origUsdRate
		common.QuotaPerUnit = origQPU
	})

	common.QuotaPerUnit = 500_000
	USDExchangeRate = 7.3
	generalSetting.CustomCurrencyExchangeRate = 0.9

	cases := []struct {
		name     string
		mode     string
		amount   int64
		expected int64
	}{
		{name: "USD / $1 -> 500k quota", mode: QuotaDisplayTypeUSD, amount: 1, expected: 500_000},
		{name: "USD / $10 -> 5M quota", mode: QuotaDisplayTypeUSD, amount: 10, expected: 5_000_000},
		{name: "CNY / 10 -> 684931 quota", mode: QuotaDisplayTypeCNY, amount: 10, expected: 684_931},
		{name: "CNY / 1 -> 68493 quota", mode: QuotaDisplayTypeCNY, amount: 1, expected: 68_493},
		{name: "CNY / 73 -> 5M quota", mode: QuotaDisplayTypeCNY, amount: 73, expected: 5_000_000},
		{name: "TOKENS / 500k -> 500k quota", mode: QuotaDisplayTypeTokens, amount: 500_000, expected: 500_000},
		{name: "TOKENS / 1M -> 1M quota", mode: QuotaDisplayTypeTokens, amount: 1_000_000, expected: 1_000_000},
		{name: "CUSTOM / 10 @ 0.9 -> 5555555", mode: QuotaDisplayTypeCustom, amount: 10, expected: 5_555_555},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			generalSetting.QuotaDisplayType = tc.mode
			got := ComputeTopupQuotaDelta(tc.amount)
			if got != tc.expected {
				t.Fatalf("mode=%s amount=%d: got %d, want %d", tc.mode, tc.amount, got, tc.expected)
			}
		})
	}
}

func TestComputeTopupQuotaDelta_NonPositive(t *testing.T) {
	origDisplay := generalSetting.QuotaDisplayType
	t.Cleanup(func() {
		generalSetting.QuotaDisplayType = origDisplay
	})

	generalSetting.QuotaDisplayType = QuotaDisplayTypeUSD
	if got := ComputeTopupQuotaDelta(0); got != 0 {
		t.Fatalf("amount=0: got %d, want 0", got)
	}
	if got := ComputeTopupQuotaDelta(-5); got != 0 {
		t.Fatalf("amount=-5: got %d, want 0", got)
	}
}

func TestComputeTopupQuotaDelta_ZeroRate(t *testing.T) {
	origDisplay := generalSetting.QuotaDisplayType
	origUsdRate := USDExchangeRate
	origCustomRate := generalSetting.CustomCurrencyExchangeRate
	t.Cleanup(func() {
		generalSetting.QuotaDisplayType = origDisplay
		USDExchangeRate = origUsdRate
		generalSetting.CustomCurrencyExchangeRate = origCustomRate
	})

	generalSetting.QuotaDisplayType = QuotaDisplayTypeCNY
	USDExchangeRate = 0
	if got := ComputeTopupQuotaDelta(10); got != 0 {
		t.Fatalf("CNY/rate=0: got %d, want 0", got)
	}

	generalSetting.QuotaDisplayType = QuotaDisplayTypeCustom
	generalSetting.CustomCurrencyExchangeRate = 0
	if got := ComputeTopupQuotaDelta(10); got != 0 {
		t.Fatalf("CUSTOM/rate=0: got %d, want 0", got)
	}
}
