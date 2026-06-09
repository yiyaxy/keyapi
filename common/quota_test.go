package common

import (
	"math"
	"testing"
)

func TestQuotaToUSD(t *testing.T) {
	cases := []struct {
		name  string
		quota int
		want  float64
	}{
		{"one dollar", 500000, 1},
		{"one cent", 5000, 0.01},
		{"zero", 0, 0},
		{"single quota unit rounds to 6 decimals", 1, 0.000002}, // 1/500000 = 0.000002
		{"rounds to six decimals", 3, 0.000006},                 // 3/500000 = 0.000006
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := QuotaToUSD(c.quota)
			if math.Abs(got-c.want) > 1e-9 {
				t.Fatalf("QuotaToUSD(%d) = %v, want %v", c.quota, got, c.want)
			}
		})
	}
}
