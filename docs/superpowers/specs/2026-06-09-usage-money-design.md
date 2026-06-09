# usage_money 响应字段设计

- 日期: 2026-06-09
- 状态: 已通过设计评审,待实现计划
- 范围: 在返回给调用方的 OpenAI 兼容响应 `usage` 对象中新增 `usage_money` 字段(本次消耗的金额,USD)

## 背景与目标

调用方希望在每次请求的响应里直接拿到「本次消耗了多少钱」,而不必自己根据 token 和价格表反算。

项目已有完整的额度(quota)计费体系:

- 每次请求最终消耗的整数额度由 `service/text_quota.go` 的 `calculateTextQuotaSummary(...)`(返回值 `summary.Quota`)算出,并在 `PostTextConsumeQuota` 中真实扣费。
- 金额换算常量:`common.QuotaPerUnit = 500000`,即 **500000 quota = $1 USD**。
- `dto.Usage` 已有一个未使用的 `Cost any json:"cost,omitempty"` 字段(OpenRouter 风格),本设计**不复用**它,改为新增语义明确的 `usage_money`。

目标:在 **OpenAI 兼容格式**(`/v1/chat/completions`)的响应 `usage` 对象里,**流式与非流式都**带上 `usage_money`,且其值**严格等于本次真实扣费金额**。

## 已确认的决策

| 维度 | 决策 |
|------|------|
| 暴露位置 | API 响应的 `usage` 对象(实时,每次请求都带) |
| 币种/形式 | USD,单个 `float`,值 = `quota / QuotaPerUnit` |
| 覆盖范围 | OpenAI 兼容格式,流式 + 非流式 |
| 实现方向 | 方案 A:中转层接管 usage 序列化 |
| Claude/Gemini 透传格式 | 本次不做(超出范围) |

## 核心约束(决定方案的关键事实)

在最常见的 OpenAI 透传场景里,中转层是把**上游原始字节原样转发**给调用方的:

- 非流式 `OpenaiHandler`(`relay/channel/openai/relay-openai.go`):当没有 `forceFormat`、usage 未被改写时,直接 `break` 并 `IOCopyBytesGracefully` 发送上游原始 body,`simpleResponse.Usage` 不会被重新序列化进去。
- 流式 `OaiStreamHandler`:当上游自带 usage chunk(`containStreamUsage == true`),该 chunk 在 `relay-openai.go:262` 被原样转发。

> **结论**:要保证 `usage_money` 每次都出现,中转层必须接管 usage 的序列化,放弃「裸透传上游字节」这一优化。这是方案 A 的既定代价。

## 设计

### 1. 数据模型

`dto/openai_response.go` 的 `Usage` 结构新增字段:

```go
// UsageMoney 为本次请求消耗的金额,单位 USD(= quota / QuotaPerUnit)。
// 指针类型:nil 表示无法计费/未计算(JSON 中省略);0 表示成本确为 0(如免费模型)。
UsageMoney *float64 `json:"usage_money,omitempty"`
```

- 用**指针**是为了区分「未计算/无法计费」(nil → `omitempty` 省略)与「成本确为 0」(0.0)。
- 单位固定 **USD**。
- 数值用 `shopspring/decimal` 四舍五入到 **6 位小数**,避免浮点毛刺(如 `0.0012340000001`),6 位足以表达单次请求的最小金额($0.000002 = 1 quota)。

### 2. 金额计算入口(单一来源)

在 `service` 包导出薄封装,复用既有的纯计算函数:

```go
// ComputeTextQuota 返回本次请求的应扣额度(整数 quota)。
// 它复用 calculateTextQuotaSummary,与 PostTextConsumeQuota 的扣费口径完全一致。
func ComputeTextQuota(ctx *gin.Context, relayInfo *relaycommon.RelayInfo, usage *dto.Usage) int {
    return calculateTextQuotaSummary(ctx, relayInfo, usage).Quota
}
```

并在 `common/quota.go`(已有 `QuotaPerUnit` 与同类纯工具函数 `GetTrustQuota`,无现成换算函数可复用)新增 quota→USD 换算:

```go
// QuotaToUSD 将整数额度换算为 USD,四舍五入到 6 位小数。
// 位于 package common,故直接引用 QuotaPerUnit(无包前缀)。
func QuotaToUSD(quota int) float64 {
    return decimal.NewFromInt(int64(quota)).
        Div(decimal.NewFromFloat(QuotaPerUnit)).
        Round(6).
        InexactFloat64()
}
```

**一致性保证**:`calculateTextQuotaSummary` 是纯函数,只依赖 `relayInfo.PriceData`、`usage` 以及在请求早期就已 set 好的若干 ctx 值;`Quota` 完全由这些决定(唯一随时间变化的 `UseTimeSeconds` 不参与 `Quota`)。因此 handler 阶段调用 `ComputeTextQuota` 得到的金额,与稍后 `PostTextConsumeQuota` 扣费用的 `summary.Quota`,在相同输入下严格相等 → **`usage_money` == 真实扣费**。无需跨包缓存。

### 3. 非流式注入(`OpenaiHandler`)

在 `applyUsagePostProcessing(info, &simpleResponse.Usage, responseBody)` 之后、写出响应之前:

1. `quota := service.ComputeTextQuota(c, info, &simpleResponse.Usage)`
2. `money := service.QuotaToUSD(quota)`;`simpleResponse.Usage.UsageMoney = &money`
3. 对 `RelayFormatOpenAI` 分支:**用 bodyMap 补丁**方式注入——把上游 body 反序列化为 `map[string]interface{}`,把 `usage` 节点替换/补上 `usage_money` 字段后重新 `Marshal`,再 `IOCopyBytesGracefully` 发送。
   - 采用 bodyMap 补丁而非整体重序列化 `simpleResponse`,是为了**保留上游 usage 里我们结构体未定义的字段**。
   - 复用现有 `usageModified` 分支(`relay-openai.go:540-548`)已有的 bodyMap 模式,将其推广为「总是注入 `usage_money`」。

边界:当 `usage` 完全缺失/无法计费(见 §5),不设置 `UsageMoney`,行为退回原样透传。

### 4. 流式注入(`OaiStreamHandler`)

在 `handleLastResponse(...)` 返回后(此时 `usage` 已确定、`containStreamUsage` 已知)、`applyUsagePostProcessing` 之后,**只算一次**金额:

1. `quota := service.ComputeTextQuota(c, info, usage)`;`money := service.QuotaToUSD(quota)`;`usage.UsageMoney = &money`
   - 覆盖「上游没带 usage、由我们合成最后 chunk」的情况:`HandleFinalResponse` → `GenerateFinalUsageResponse(... *usage)` 序列化的就是这个 `usage`,`usage_money` 自动带出。
2. 若 `containStreamUsage`(上游自带 usage chunk,会在 `relay-openai.go:262` 透传):把 `money` **补丁进 `lastStreamData`**(反序列化该 chunk → 在其 `usage` 节点写入 `usage_money` → 重新序列化回 `lastStreamData`),随后既有的转发逻辑发送的就是带 money 的 chunk。

**不重复发送**:case 1 走合成 chunk,case 2 走透传 chunk,二者互斥(`HandleFinalResponse` 仅在 `!containStreamUsage` 时合成),`usage_money` 恰好各出现一次。

### 5. 边界与一致性

- **能算出 quota 就带**(即使为 0,如免费模型 → `usage_money: 0`)。
- **`usage` 完全缺失 / 无法计费 / `total_tokens == 0`**:不设置 `UsageMoney`(nil → 省略字段),不臆造金额。
- **精度**:6 位小数,USD。
- **一致性**:`usage_money` 与真实扣费在相同输入下严格相等。
- **范围**:仅 `RelayFormatOpenAI`。同函数内的 `RelayFormatClaude` / `RelayFormatGemini` 转换分支不改动。

### 6. 测试

- 单测 `QuotaToUSD`:典型 quota → USD 换算、四舍五入到 6 位、0 值。
- 单测 `ComputeTextQuota`:与 `PostTextConsumeQuota` 口径一致(同输入同结果)。
- 非流式:响应 `usage` 含 `usage_money`,值 == 实际扣费;免费模型 → `0`;`usage` 缺失 → 字段省略;上游 usage 含我方未定义字段时这些字段仍保留。
- 流式 case 1(上游不带 usage):合成的最终 usage chunk 含 `usage_money`。
- 流式 case 2(上游自带 usage chunk):透传 chunk 被补丁,含 `usage_money`,且只出现一次。

## 受影响文件

| 文件 | 改动 |
|------|------|
| `dto/openai_response.go` | `Usage` 新增 `UsageMoney *float64` |
| `service/text_quota.go` | 导出 `ComputeTextQuota` |
| `common/quota.go` | 新增 `QuotaToUSD` |
| `relay/channel/openai/relay-openai.go` | `OpenaiHandler` 非流式注入;`OaiStreamHandler` 流式注入 |
| 对应 `_test.go` | 新增上述单测/集成测试 |

## 非目标(YAGNI)

- 不支持 CNY / 多币种 / 跟随展示币种(如需,后续在 §1 字段上扩展)。
- 不覆盖 Claude(`/v1/messages`)、Gemini 透传格式。
- 不改动消费日志/账单查询接口(本次只做响应体)。
- 不复用既有 `Cost` 字段。
