package service

import "testing"

// TestStripMarkup_CapDecouplesFromUserFacingMarkup 覆盖 platform_quota_cap
// 语义修复：markup 乘入后的 "用户账单" 不能直接用于扣 cap，必须还原成
// "租户真实成本"。否则租户把 markup 调高吸收 channel 折扣时，cap 会按
// 虚高的用户账单提前爆掉（LO 发现的 bug）。
func TestStripMarkup_CapDecouplesFromUserFacingMarkup(t *testing.T) {
	cases := []struct {
		name   string
		quota  int
		markup float64
		want   int
	}{
		// 透传场景：markup=1，cap 扣减 = 用户账单（无变化）
		{"passthrough markup 1.0", 100, 1.0, 100},
		// 吸收场景：4 折 channel + markup=2.5，用户账单=100，真实成本=40
		{"absorb 4x discount", 100, 2.5, 40},
		// 部分吸收：markup=1.5，用户账单=60，真实成本=40
		{"partial absorb", 60, 1.5, 40},
		// markup=0 / 负数：视作无 markup（防御性）
		{"zero markup treated as 1", 50, 0, 50},
		{"negative markup treated as 1", 50, -0.5, 50},
		// 边界：quota=0 / 负数直接返 0，避免后续 increment 写 0/负
		{"zero quota", 0, 2.5, 0},
		{"negative quota", -5, 2.5, 0},
		// 向上取整：避免小额请求因除法丢精度后累加到 0
		{"rounds up", 3, 2.5, 2}, // 3/2.5=1.2 → ceil=2
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
