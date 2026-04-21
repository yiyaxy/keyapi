package payment

import (
	"math"
	"testing"

	"github.com/QuantumNous/new-api/setting/operation_setting"
)

func TestGetPayMoney_CustomDisplayUsesExchangeRate(t *testing.T) {
	gs := operation_setting.GetGeneralSetting()
	ps := operation_setting.GetPaymentSetting()
	origDisplay := gs.QuotaDisplayType
	origRate := gs.CustomCurrencyExchangeRate
	origPrice := operation_setting.Price
	origDiscount := ps.AmountDiscount
	t.Cleanup(func() {
		gs.QuotaDisplayType = origDisplay
		gs.CustomCurrencyExchangeRate = origRate
		operation_setting.Price = origPrice
		ps.AmountDiscount = origDiscount
	})

	gs.QuotaDisplayType = operation_setting.QuotaDisplayTypeCustom
	gs.CustomCurrencyExchangeRate = 0.9
	operation_setting.Price = 7.3
	ps.AmountDiscount = map[int]float64{}

	got := getPayMoney(5, "")
	want := 5.0 / 0.9 * 7.3
	if math.Abs(got-want) > 1e-9 {
		t.Fatalf("CUSTOM amount=5: got %.12f, want %.12f", got, want)
	}
}

func TestGetPayMoney_CustomDisplayZeroRateReturnsZero(t *testing.T) {
	gs := operation_setting.GetGeneralSetting()
	origDisplay := gs.QuotaDisplayType
	origRate := gs.CustomCurrencyExchangeRate
	origPrice := operation_setting.Price
	t.Cleanup(func() {
		gs.QuotaDisplayType = origDisplay
		gs.CustomCurrencyExchangeRate = origRate
		operation_setting.Price = origPrice
	})

	gs.QuotaDisplayType = operation_setting.QuotaDisplayTypeCustom
	gs.CustomCurrencyExchangeRate = 0
	operation_setting.Price = 7.3

	if got := getPayMoney(5, ""); got != 0 {
		t.Fatalf("CUSTOM/rate=0: got %.12f, want 0", got)
	}
}
