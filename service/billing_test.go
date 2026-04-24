package service

import "testing"

// TestStripMarkup_LegacyReverseMarkup covers the retained helper for legacy
// callers. The dual-ledger platform-cost path reads PriceData.PlatformCost*
// directly and should not call this helper.
func TestStripMarkup_LegacyReverseMarkup(t *testing.T) {
	cases := []struct {
		name   string
		quota  int
		markup float64
		want   int
	}{
		{"passthrough markup 1.0", 100, 1.0, 100},
		{"absorb 4x discount", 100, 2.5, 40},
		{"partial absorb", 60, 1.5, 40},
		{"zero markup treated as 1", 50, 0, 50},
		{"negative markup treated as 1", 50, -0.5, 50},
		{"zero quota", 0, 2.5, 0},
		{"negative quota", -5, 2.5, 0},
		{"rounds up", 3, 2.5, 2},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := StripMarkup(tc.quota, tc.markup)
			if got != tc.want {
				t.Fatalf("StripMarkup(%d, %v) = %d, want %d", tc.quota, tc.markup, got, tc.want)
			}
		})
	}
}
