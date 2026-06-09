# usage_money 响应字段 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 OpenAI 兼容响应(`/v1/chat/completions`,流式 + 非流式)的 `usage` 对象中新增 `usage_money` 字段,表示本次请求消耗的金额(USD),其值严格等于真实扣费。

**Architecture:** 中转层接管 usage 序列化(放弃裸透传上游字节)。金额由已有纯函数 `service.CalculateTextQuota` 算出 quota,再经 `common.QuotaToUSD` 换算为 USD。非流式在 `OpenaiHandler` 用 JSON 补丁把 `usage_money` 注入响应 body;流式在 `OaiStreamHandler` 分两种情况注入:上游自带 usage chunk 时打补丁后转发,上游不带时由我们合成的最终 usage chunk 带出。

**Tech Stack:** Go,`github.com/shopspring/decimal`,`github.com/stretchr/testify`,gin。模块路径 `github.com/QuantumNous/new-api`。测试用 `go test`。

**关键事实(实现者必读):**
- 金额换算常量 `common.QuotaPerUnit = 500000`,即 `500000 quota = $1 USD`。
- `service.CalculateTextQuota(ctx, relayInfo, usage) int`(`service/text_quota.go:291`)**已存在**,返回与 `PostTextConsumeQuota` 完全一致的应扣 quota,且为纯计算 → 直接复用,**不要新增同义函数**。
- `applyUsagePostProcessing`(`relay/channel/openai/relay-openai.go:951`)会修改 `usage`(给部分渠道补 `CachedTokens`,影响 quota),且**幂等**;金额必须在它之后计算。
- 项目 JSON 收发统一用 `common.Marshal` / `common.Unmarshal`(json-iterator),字符串/字节互转用 `common.StringToByteSlice`。

---

## File Structure

| 文件 | 职责 | 改动 |
|------|------|------|
| `common/quota.go` | quota↔货币 纯换算工具 | 新增 `QuotaToUSD` |
| `common/quota_test.go` | 上面的单测 | 新建 |
| `dto/openai_response.go` | OpenAI 响应数据结构 | `Usage` 加字段 `UsageMoney *float64` |
| `dto/usage_money_test.go` | `Usage` JSON 序列化单测 | 新建 |
| `relay/channel/openai/usage_money.go` | usage_money 计算与注入助手 | 新建 `computeUsageMoney` / `patchUsageMoneyIntoJSON` |
| `relay/channel/openai/usage_money_test.go` | 上面的单测 | 新建 |
| `relay/channel/openai/relay-openai.go` | OpenAI handler | `OpenaiHandler` / `OaiStreamHandler` 接入注入点 |

每个文件职责单一;新逻辑集中在 `usage_money.go` 这一个聚焦文件里,`relay-openai.go` 只加调用点,改动最小。

---

## Task 1: `common.QuotaToUSD` 货币换算

**Files:**
- Create: `common/quota_test.go`
- Modify: `common/quota.go`

- [ ] **Step 1: 写失败的测试**

写入 `common/quota_test.go`:

```go
package common

import "testing"

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
			if got != c.want {
				t.Fatalf("QuotaToUSD(%d) = %v, want %v", c.quota, got, c.want)
			}
		})
	}
}
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `go test ./common/ -run TestQuotaToUSD -v`
Expected: 编译失败 —— `undefined: QuotaToUSD`

- [ ] **Step 3: 实现**

在 `common/quota.go` 顶部补 import 并新增函数(完整文件应为):

```go
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
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `go test ./common/ -run TestQuotaToUSD -v`
Expected: PASS(5 个子用例全过)

- [ ] **Step 5: 提交**

```bash
git add common/quota.go common/quota_test.go
git commit -m "feat(common): add QuotaToUSD for quota->USD conversion"
```

---

## Task 2: `dto.Usage` 新增 `UsageMoney` 字段

**Files:**
- Create: `dto/usage_money_test.go`
- Modify: `dto/openai_response.go:222-242`(`Usage` 结构体)

- [ ] **Step 1: 写失败的测试**

写入 `dto/usage_money_test.go`:

```go
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
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `go test ./dto/ -run TestUsageMoneyJSON -v`
Expected: 编译失败 —— `u.UsageMoney undefined`

- [ ] **Step 3: 实现**

在 `dto/openai_response.go` 的 `Usage` 结构体内,`Cost any` 字段之后(`}` 之前)新增字段:

```go
	// UsageMoney 为本次请求消耗的金额,单位 USD(= quota / QuotaPerUnit)。
	// 指针类型:nil 表示无法计费/未计算(JSON 省略);0 表示成本确为 0(如免费模型)。
	UsageMoney *float64 `json:"usage_money,omitempty"`
```

改动后该结构体尾部应类似:

```go
	// OpenRouter Params
	Cost any `json:"cost,omitempty"`

	// UsageMoney 为本次请求消耗的金额,单位 USD(= quota / QuotaPerUnit)。
	// 指针类型:nil 表示无法计费/未计算(JSON 省略);0 表示成本确为 0(如免费模型)。
	UsageMoney *float64 `json:"usage_money,omitempty"`
}
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `go test ./dto/ -run TestUsageMoneyJSON -v`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add dto/openai_response.go dto/usage_money_test.go
git commit -m "feat(dto): add usage_money field to Usage"
```

---

## Task 3: openai 包注入助手(`computeUsageMoney` / `patchUsageMoneyIntoJSON`)

**Files:**
- Create: `relay/channel/openai/usage_money.go`
- Create: `relay/channel/openai/usage_money_test.go`

- [ ] **Step 1: 写失败的测试**

写入 `relay/channel/openai/usage_money_test.go`:

```go
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
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `go test ./relay/channel/openai/ -run 'TestPatchUsageMoneyIntoJSON|TestComputeUsageMoney' -v`
Expected: 编译失败 —— `undefined: patchUsageMoneyIntoJSON` / `undefined: computeUsageMoney`

- [ ] **Step 3: 实现**

写入 `relay/channel/openai/usage_money.go`:

```go
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
	if usage == nil || usage.PromptTokens+usage.CompletionTokens == 0 {
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
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `go test ./relay/channel/openai/ -run 'TestPatchUsageMoneyIntoJSON|TestComputeUsageMoney' -v`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add relay/channel/openai/usage_money.go relay/channel/openai/usage_money_test.go
git commit -m "feat(openai): add usage_money compute and JSON injection helpers"
```

---

## Task 4: 非流式注入(`OpenaiHandler`)

**Files:**
- Modify: `relay/channel/openai/relay-openai.go:536`(注入金额计算)
- Modify: `relay/channel/openai/relay-openai.go:538-556`(OpenAI 分支始终注入)

- [ ] **Step 1: 在 usage 后处理之后计算并写入金额**

定位(`relay-openai.go:536`):

```go
	applyUsagePostProcessing(info, &simpleResponse.Usage, responseBody)

	switch info.RelayFormat {
```

改为(在 `switch` 之前插入金额计算):

```go
	applyUsagePostProcessing(info, &simpleResponse.Usage, responseBody)

	// 计算本次消耗金额(USD)并写入 usage.usage_money
	if money, ok := computeUsageMoney(c, info, &simpleResponse.Usage); ok {
		simpleResponse.Usage.UsageMoney = &money
	}

	switch info.RelayFormat {
```

- [ ] **Step 2: 让 OpenAI 分支始终注入 usage_money(不再裸透传)**

定位现有 OpenAI 分支(`relay-openai.go:539-556`):

```go
	case types.RelayFormatOpenAI:
		if usageModified {
			var bodyMap map[string]interface{}
			err = common.Unmarshal(responseBody, &bodyMap)
			if err != nil {
				return nil, types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusInternalServerError)
			}
			bodyMap["usage"] = simpleResponse.Usage
			responseBody, _ = common.Marshal(bodyMap)
		}
		if forceFormat {
			responseBody, err = common.Marshal(simpleResponse)
			if err != nil {
				return nil, types.NewError(err, types.ErrorCodeBadResponseBody)
			}
		} else {
			break
		}
```

整体替换为:

```go
	case types.RelayFormatOpenAI:
		if forceFormat {
			// 整体重序列化,simpleResponse.Usage 已含 usage_money
			responseBody, err = common.Marshal(simpleResponse)
			if err != nil {
				return nil, types.NewError(err, types.ErrorCodeBadResponseBody)
			}
		} else if usageModified {
			// 上游未给 usage、我方已估算:用估算后的 usage(含 usage_money)替换 usage 节点
			var bodyMap map[string]interface{}
			if err = common.Unmarshal(responseBody, &bodyMap); err != nil {
				return nil, types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusInternalServerError)
			}
			bodyMap["usage"] = simpleResponse.Usage
			responseBody, _ = common.Marshal(bodyMap)
		} else if simpleResponse.Usage.UsageMoney != nil {
			// 常规透传场景:只把 usage_money 补丁进上游 body,保留上游 usage 其它字段
			responseBody = patchUsageMoneyIntoJSON(responseBody, *simpleResponse.Usage.UsageMoney)
		}
```

> 说明:`break` 移除后,该 `case` 自然结束。当 `UsageMoney == nil`(无法计费)时三个分支都不命中 → `responseBody` 保持上游原样,行为与改动前一致。

- [ ] **Step 3: 编译验证**

Run: `go build ./relay/channel/openai/`
Expected: 无错误(尤其确认不再有未使用变量、`break` 残留)

- [ ] **Step 4: 跑该包测试**

Run: `go test ./relay/channel/openai/ -v`
Expected: PASS(Task 3 的测试仍通过)

- [ ] **Step 5: 提交**

```bash
git add relay/channel/openai/relay-openai.go
git commit -m "feat(openai): inject usage_money into non-stream OpenAI responses"
```

---

## Task 5: 流式注入(`OaiStreamHandler`)

**Files:**
- Modify: `relay/channel/openai/relay-openai.go:258-264`(case 2:上游自带 usage chunk)
- Modify: `relay/channel/openai/relay-openai.go:300-302`(case 1:合成最终 usage chunk)

- [ ] **Step 1: case 2 —— 上游自带 usage chunk,转发前打补丁**

定位(`relay-openai.go:253-264`):

```go
	// 处理最后的响应
	shouldSendLastResp := true
	if err := handleLastResponse(lastStreamData, &responseId, &createAt, &systemFingerprint, &model, &usage,
		&containStreamUsage, info, &shouldSendLastResp); err != nil {
		logger.LogError(c, fmt.Sprintf("error handling last response: %s, lastStreamData: [%s]", err.Error(), lastStreamData))
	}

	if info.RelayFormat == types.RelayFormatOpenAI {
		if shouldSendLastResp && !needRewrite {
			_ = sendStreamData(c, info, lastStreamData, info.ChannelSetting.ForceFormat, info.ChannelSetting.ThinkingToContent)
		}
	}
```

在 `handleLastResponse` 调用块之后、`if info.RelayFormat == ...` 之前插入:

```go
	// case 2:上游自带 usage chunk(已确定 usage,且即将在下方/重写分支被转发)。
	// 先做与计费一致的(幂等)usage 后处理,再算钱,并把 usage_money 补丁进该 chunk,
	// 使后续无论从普通分支还是 needRewrite 分支转发的都是带 usage_money 的版本。
	if containStreamUsage {
		applyUsagePostProcessing(info, usage, common.StringToByteSlice(lastStreamData))
		if money, ok := computeUsageMoney(c, info, usage); ok {
			usage.UsageMoney = &money
			lastStreamData = string(patchUsageMoneyIntoJSON(common.StringToByteSlice(lastStreamData), money))
		}
	}
```

- [ ] **Step 2: case 1 —— 上游不带 usage,设置 usage_money 让合成 chunk 带出**

定位(`relay-openai.go:300-302`):

```go
	applyUsagePostProcessing(info, usage, common.StringToByteSlice(lastStreamData))

	HandleFinalResponse(c, info, lastStreamData, responseId, createAt, model, systemFingerprint, usage, containStreamUsage)
```

在 `applyUsagePostProcessing` 与 `HandleFinalResponse` 之间插入:

```go
	applyUsagePostProcessing(info, usage, common.StringToByteSlice(lastStreamData))

	// case 1:上游未带 usage,稍后由 HandleFinalResponse→GenerateFinalUsageResponse 合成最终
	// usage chunk;在此设置 usage_money 即可随合成 chunk 带出。(case 2 已在上方处理过,跳过避免重复)
	if !containStreamUsage {
		if money, ok := computeUsageMoney(c, info, usage); ok {
			usage.UsageMoney = &money
		}
	}

	HandleFinalResponse(c, info, lastStreamData, responseId, createAt, model, systemFingerprint, usage, containStreamUsage)
```

- [ ] **Step 3: 编译验证**

Run: `go build ./relay/channel/openai/`
Expected: 无错误

- [ ] **Step 4: 跑该包测试**

Run: `go test ./relay/channel/openai/ -v`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add relay/channel/openai/relay-openai.go
git commit -m "feat(openai): inject usage_money into streaming OpenAI responses"
```

---

## Task 6: 全量校验与手动冒烟

**Files:** 无(验证性任务)

- [ ] **Step 1: 全量编译**

Run: `go build ./...`
Expected: 无错误

- [ ] **Step 2: go vet 受影响包**

Run: `go vet ./common/ ./dto/ ./relay/channel/openai/`
Expected: 无告警

- [ ] **Step 3: 跑所有新增/相关测试**

Run: `go test ./common/ ./dto/ ./relay/channel/openai/ -v`
Expected: 全部 PASS

- [ ] **Step 4: 手动冒烟 —— 非流式**

(需本地起服务、配置好渠道与 key。)用真实/可计费模型发非流式请求:

```bash
curl -s http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer <your-key>" \
  -H "Content-Type: application/json" \
  -d '{"model":"<billable-model>","messages":[{"role":"user","content":"hi"}]}' | python -m json.tool
```

Expected:响应 `usage` 对象内含 `usage_money`(USD 浮点);其值 ≈ 后台该次消费日志金额(`quota/500000`)。

- [ ] **Step 5: 手动冒烟 —— 流式(两种上游)**

```bash
curl -N http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer <your-key>" \
  -H "Content-Type: application/json" \
  -d '{"model":"<billable-model>","stream":true,"stream_options":{"include_usage":true},"messages":[{"role":"user","content":"hi"}]}'
```

Expected:最后一个带 `usage` 的 chunk 内含 `usage_money`,且只出现一次。分别用「上游会回 usage 的模型」与「上游不回 usage 的模型/渠道」各验一次(对应 case 2 / case 1)。

- [ ] **Step 6: 最终提交(若有验证期间的微调)**

```bash
git add -A
git commit -m "test(openai): verify usage_money end-to-end"
```

> 说明:Handler 级注入(Task 4/5 的接线)依赖 HTTP/渠道/缓存环境,本包无既有测试桩,故以「纯助手单测 + 编译 + 手动冒烟」覆盖,不强行写脆弱的全 handler 自动化测试。

---

## Self-Review(已完成)

**Spec 覆盖:**
- §1 数据模型 → Task 2 ✅
- §2 计算入口(复用 `CalculateTextQuota`)+ `QuotaToUSD` → Task 1 + Task 3(`computeUsageMoney`)✅
- §3 非流式注入 → Task 4 ✅
- §4 流式注入(case 1 / case 2)→ Task 5 ✅
- §5 边界(token=0 省略、免费模型为 0、6 位精度、仅 OpenAI 格式)→ Task 1/3 测试 + `computeUsageMoney` 守卫 ✅
- §6 测试 → Task 1/2/3 单测 + Task 6 冒烟 ✅

**占位符扫描:** 无 TBD/TODO;所有代码步骤含完整代码与确切命令。

**类型一致性:** `QuotaToUSD(int) float64`、`computeUsageMoney(*gin.Context,*relaycommon.RelayInfo,*dto.Usage)(float64,bool)`、`patchUsageMoneyIntoJSON([]byte,float64)[]byte`、`UsageMoney *float64` —— 各任务调用处签名一致;复用既有 `service.CalculateTextQuota`(非新增)。
