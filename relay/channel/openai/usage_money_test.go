package openai

import (
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
)

func TestPatchUsageMoneyIntoJSON(t *testing.T) {
	// 含 usage 节点 → 注入 usage_money,且保留 usage 内其它(含未知)字段
	in := `{"id":"x","usage":{"prompt_tokens":10,"completion_tokens":5,"vendor_extra":"keep"}}`
	out := string(patchUsageMoneyIntoJSON(common.StringToByteSlice(in), 0.01))
	if !strings.Contains(out, `"usage_money":0.01`) {
		t.Fatalf("usage_money not injected: %s", out)
	}
	if !strings.Contains(out, `"vendor_extra":"keep"`) {
		t.Fatalf("unknown upstream field dropped: %s", out)
	}
	if !strings.Contains(out, `"prompt_tokens":10`) {
		t.Fatalf("existing usage field dropped: %s", out)
	}

	// 无 usage 节点 → 原样返回
	noUsage := `{"id":"x"}`
	if got := string(patchUsageMoneyIntoJSON(common.StringToByteSlice(noUsage), 0.01)); got != noUsage {
		t.Fatalf("body without usage should be unchanged, got %s", got)
	}

	// 非法 JSON → 原样返回
	bad := `not json`
	if got := string(patchUsageMoneyIntoJSON(common.StringToByteSlice(bad), 0.01)); got != bad {
		t.Fatalf("invalid json should be unchanged, got %s", got)
	}
}

func TestComputeUsageMoney(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())

	info := &relaycommon.RelayInfo{}
	info.PriceData = types.PriceData{
		ModelRatio:      2,
		CompletionRatio: 3,
		GroupRatioInfo:  types.GroupRatioInfo{GroupRatio: 1},
	}

	// 公式(无 cache/image/audio):(prompt + completion*completionRatio) * (modelRatio*groupRatio)
	// = (1000 + 500*3) * (2*1) = 2500 * 2 = 5000 quota → 5000/500000 = $0.01
	usage := &dto.Usage{PromptTokens: 1000, CompletionTokens: 500}
	money, ok := computeUsageMoney(c, info, usage)
	if !ok {
		t.Fatalf("expected ok=true for non-zero tokens")
	}
	if money != 0.01 {
		t.Fatalf("computeUsageMoney = %v, want 0.01", money)
	}

	// 无 token → ok=false(字段应省略)
	if _, ok := computeUsageMoney(c, info, &dto.Usage{}); ok {
		t.Fatalf("expected ok=false for zero tokens")
	}
	// nil usage → ok=false
	if _, ok := computeUsageMoney(c, info, nil); ok {
		t.Fatalf("expected ok=false for nil usage")
	}
}
