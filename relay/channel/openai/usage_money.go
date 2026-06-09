package openai

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

// computeUsageMoney 计算本次请求消耗的金额(USD)。
// ok=false 表示无法计费(usage 缺失或无可计费 token),调用方应保持 UsageMoney 为 nil(省略字段)。
// 金额经由 service.CalculateTextQuota 得到,与 PostTextConsumeQuota 的扣费口径完全一致。
func computeUsageMoney(c *gin.Context, info *relaycommon.RelayInfo, usage *dto.Usage) (float64, bool) {
	if usage == nil || (usage.PromptTokens == 0 && usage.CompletionTokens == 0) {
		return 0, false
	}
	quota := service.CalculateTextQuota(c, info, usage)
	return common.QuotaToUSD(quota), true
}

// patchUsageMoneyIntoJSON 把 usage_money 注入一段 JSON(完整响应体或单条 stream chunk)的
// 顶层 usage 节点,保留 usage 内其它字段。解析失败或无 usage 节点时原样返回。
func patchUsageMoneyIntoJSON(data []byte, money float64) []byte {
	var m map[string]interface{}
	if err := common.Unmarshal(data, &m); err != nil {
		return data
	}
	usageMap, ok := m["usage"].(map[string]interface{})
	if !ok {
		return data
	}
	usageMap["usage_money"] = money
	patched, err := common.Marshal(m)
	if err != nil {
		return data
	}
	return patched
}
