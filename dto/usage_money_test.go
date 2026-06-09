package dto

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestUsageMoneyJSON(t *testing.T) {
	// nil 指针 → 字段省略
	var u Usage
	b, err := json.Marshal(u)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if strings.Contains(string(b), "usage_money") {
		t.Fatalf("nil UsageMoney should be omitted, got %s", b)
	}

	// 值为 0 → 字段出现且为 0(区别于"未计算")
	zero := 0.0
	u.UsageMoney = &zero
	b, _ = json.Marshal(u)
	if !strings.Contains(string(b), `"usage_money":0`) {
		t.Fatalf("zero UsageMoney should serialize as 0, got %s", b)
	}

	// 正常值
	v := 0.0123
	u.UsageMoney = &v
	b, _ = json.Marshal(u)
	if !strings.Contains(string(b), `"usage_money":0.0123`) {
		t.Fatalf("UsageMoney value missing, got %s", b)
	}
}
