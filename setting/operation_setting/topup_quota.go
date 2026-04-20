package operation_setting

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/shopspring/decimal"
)

// ComputeTopupQuotaDelta converts a raw topup request amount from the
// current display unit into the authoritative raw quota to credit.
func ComputeTopupQuotaDelta(amount int64) int64 {
	if amount <= 0 {
		return 0
	}

	divisor := decimal.NewFromInt(1)
	switch GetQuotaDisplayType() {
	case QuotaDisplayTypeUSD:
		// already USD-equivalent
	case QuotaDisplayTypeCNY:
		if USDExchangeRate <= 0 {
			return 0
		}
		divisor = decimal.NewFromFloat(USDExchangeRate)
	case QuotaDisplayTypeTokens:
		if common.QuotaPerUnit <= 0 {
			return 0
		}
		divisor = decimal.NewFromFloat(common.QuotaPerUnit)
	case QuotaDisplayTypeCustom:
		rate := generalSetting.CustomCurrencyExchangeRate
		if rate <= 0 {
			return 0
		}
		divisor = decimal.NewFromFloat(rate)
	default:
		return 0
	}

	qpu := decimal.NewFromFloat(common.QuotaPerUnit)
	return decimal.NewFromInt(amount).Div(divisor).Mul(qpu).IntPart()
}
