package common

import "github.com/shopspring/decimal"

func GetTrustQuota() int {
	return int(10 * QuotaPerUnit)
}

// QuotaToUSD 将整数额度换算为 USD(QuotaPerUnit quota = $1),四舍五入到 6 位小数。
// 位于 package common,故直接引用 QuotaPerUnit(无包前缀)。
func QuotaToUSD(quota int) float64 {
	return decimal.NewFromInt(int64(quota)).
		Div(decimal.NewFromFloat(QuotaPerUnit)).
		Round(6).
		InexactFloat64()
}
