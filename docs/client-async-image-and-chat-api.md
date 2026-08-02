# 客户端对接文档 — 异步生图 & 聊天模型接口

本文档面向**接入 keyapi 的客户端开发者**,描述 4 个核心接口的请求/响应格式与使用方式:

| 类别 | 方法 | 路径 | 用途 |
|------|------|------|------|
| 异步生图 | POST | `/v1/images/async` | 提交异步生图任务 |
| 异步生图 | GET | `/v1/images/async/:task_id` | 查询异步任务结果 |
| 聊天(OpenAI) | POST | `/v1/responses` | OpenAI Responses API 兼容 |
| 聊天(Claude) | POST | `/v1/messages` | Anthropic Messages API 兼容 |

> 内部实现细节请参阅 `docs/openai-compatible-image-api.md`(同步生图、计费、路由)。

---

## 0. 通用约定

### 0.1 Base URL

```
https://your-host
```

把 `your-host` 替换为部署方提供的域名。

### 0.2 鉴权

所有接口都需要在 HTTP Header 携带由 keyapi 颁发的 token:

```
Authorization: Bearer sk-xxxxxxxxxxxx
```

> `/v1/messages` 同时兼容 Anthropic 原生 header(`x-api-key: sk-xxx` + `anthropic-version: 2023-06-01`),便于直接复用 Anthropic SDK。

### 0.3 Content-Type

JSON 请求统一使用:

```
Content-Type: application/json
```

### 0.4 错误结构

普通同步接口(`/v1/responses`、`/v1/messages`)返回标准 OpenAI / Anthropic 错误结构,HTTP 状态码反映错误类型。

异步生图接口出错时返回简化结构:

```json
{
  "code": "invalid_request",
  "message": "model is required",
  "type": "invalid_request_error",
  "request_id": "..."
}
```

常见状态码:

| 状态码 | 含义 |
|--------|------|
| 400 | 请求参数错误 |
| 401 | token 缺失或无效 |
| 402 | 账户余额不足 |
| 403 | 权限不足 / 模型不允许 |
| 429 | 触发限流 |
| 5xx | 上游或网关异常(异步接口已自动退款) |

---

## 1. POST `/v1/images/async` — 提交异步生图任务

### 1.1 适用场景

- 上游本身就是异步的渠道(如 apimart、即梦、万相等),同步接口可能因长时间等待而中断
- 客户端希望使用统一的 "提交 + 轮询" 模式,不区分上游是否同步

### 1.2 请求体

请求体与 `/v1/images/generations` 完全一致,可直接复用同步请求。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `model` | string | 是 | 模型名,如 `dall-e-3` / `gpt-image-1` / `gpt-image-2` / `flux-...` |
| `prompt` | string | 是 | 提示词 |
| `n` | uint | 否 | 生成张数,默认 1 |
| `size` | string | 否 | 尺寸或比例,如 `1024x1024` / `1792x1024` / `16:9` |
| `quality` | string | 否 | `standard` / `hd`(dall-e-3 等) |
| `response_format` | string | 否 | `url`(默认)或 `b64_json` |
| `resolution` | string | 否 | `1k` / `2k` / `4k`(新模型支持) |
| `style` / `background` / `moderation` / `output_format` / `output_compression` | any | 否 | 透传上游 |
| `extra_fields` / `user` | any | 否 | 透传 |

其他未识别字段会按渠道适配自动透传。

### 1.3 请求示例

```bash
curl https://your-host/v1/images/async \
  -H "Authorization: Bearer sk-xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-image-2",
    "prompt": "一只机甲猫",
    "size": "1024x1024",
    "n": 2,
    "response_format": "url"
  }'
```

### 1.4 成功响应(HTTP 200)

```json
{
  "task_id": "task_abc123Def456Ghi789",
  "status": "queued",
  "created": 1761234567
}
```

| 字段 | 说明 |
|------|------|
| `task_id` | 任务 ID,后续查询和分享都用这个 |
| `status` | 提交后固定为 `queued` |
| `created` | 任务创建时间(Unix 秒) |

### 1.5 失败响应

按照 [0.4 错误结构](#04-错误结构) 返回。提交失败(含余额不足、参数错误、上游硬性拒绝)会自动退还预扣额度。

---

## 2. GET `/v1/images/async/:task_id` — 查询任务

### 2.1 请求

只需在 URL 路径上携带 `task_id`,无 query 参数。需要 `Authorization: Bearer` header(任务只能由提交方查询)。

```bash
curl https://your-host/v1/images/async/task_abc123Def456Ghi789 \
  -H "Authorization: Bearer sk-xxx"
```

### 2.2 响应结构

固定字段集合(部分字段在不同状态下可能为 `null` 或省略):

```json
{
  "task_id": "task_abc123...",
  "status": "queued | processing | succeeded | failed",
  "progress": 0,
  "created": 1761234567,
  "completed": 1761234589,
  "result": null,
  "error": null
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `task_id` | string | 任务 ID |
| `status` | string | 任务状态,见 [2.3](#23-状态枚举) |
| `progress` | int | 0–100,可能为空(`omitempty`);异步上游会实时更新 |
| `created` | int64 | 任务创建时间(Unix 秒) |
| `completed` | int64 | 任务结束时间;仅 `succeeded` / `failed` 状态下出现 |
| `result` | object\|null | 仅 `succeeded` 时为 OpenAI `images/generations` 结构;否则 `null` |
| `error` | object\|null | 仅 `failed` 时存在 |

### 2.3 状态枚举

| `status` | 含义 |
|----------|------|
| `queued` | 已提交,尚未开始处理 |
| `processing` | 处理中(同步上游调用中或异步上游轮询中) |
| `succeeded` | 完成,`result` 可读 |
| `failed` | 失败,`error` 可读 |

### 2.4 进行中示例

```json
{
  "task_id": "task_abc123...",
  "status": "processing",
  "progress": 40,
  "created": 1761234567,
  "result": null,
  "error": null
}
```

### 2.5 成功示例

```json
{
  "task_id": "task_abc123...",
  "status": "succeeded",
  "progress": 100,
  "created": 1761234567,
  "completed": 1761234589,
  "result": {
    "created": 1761234589,
    "data": [
      { "url": "https://your-host/v1/images/async/task_abc123.../content/0" },
      { "url": "https://your-host/v1/images/async/task_abc123.../content/1" }
    ]
  },
  "error": null
}
```

要点:
- `result` 字段是 **完整的 OpenAI `images/generations` 响应**,可直接喂给 OpenAI SDK 解析
- 返回的 `url` 是 keyapi 自家域名的代理地址,**不是上游 URL**(避免上游过期或暴露真实出口)
- 图片字节通过 `GET /v1/images/async/:task_id/content/:index` 反代,凭原 token 鉴权
- 若提交时使用 `response_format=b64_json`,`result.data[i]` 会带 `b64_json` 字段,**不**走代理
- `data[i]` 的 `b64_json` 和 `revised_prompt` 即使没有值也会以空字符串 `""` 出现,**不是 `omitempty`**,客户端不要假设字段缺失

### 2.6 失败示例

```json
{
  "task_id": "task_abc123...",
  "status": "failed",
  "created": 1761234567,
  "completed": 1761234589,
  "result": null,
  "error": {
    "message": "upstream returned 429: rate limited",
    "code": "rate_limited"
  }
}
```

| 字段 | 说明 |
|------|------|
| `error.message` | 人类可读的错误描述 |
| `error.code` | 机器可读错误码,如 `rate_limited` / `task_failed` / `invalid_request` |

失败时已自动退款,无需客户端额外操作。

### 2.7 推荐的轮询策略

```text
1. 提交后立即查询一次
2. 若 status 为 queued / processing,按 2 秒(processing 可缩短到 1 秒)轮询
3. 收到 succeeded / failed 即停止
4. 设置最大轮询时长(如 5 分钟),超时则视为客户端放弃
```

服务端不会因客户端断开连接而中止任务,客户端可以"提交后离线",事后再来查。

---

## 3. POST `/v1/responses` — OpenAI Responses API

兼容 OpenAI 官方 [Responses API](https://platform.openai.com/docs/api-reference/responses) 协议,可直接使用 OpenAI 官方 SDK(把 `base_url` 指向 keyapi)。

### 3.1 请求体

主要字段(完全兼容 OpenAI,实际渠道支持以模型为准):

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `model` | string | 是 | 模型名,如 `gpt-5` / `gpt-4.1` / `o4-mini` 等 |
| `input` | string \| array | 是 | 用户输入。**部分上游模型只接受数组形式**(`[{"role":"user","content":"..."}]`),字符串形式可能被拒绝(返回 `Input must be a list`)。建议默认用数组 |
| `instructions` | string | 否 | 系统指令(等同 system message) |
| `stream` | bool | 否 | 流式输出,默认 `false` |
| `max_output_tokens` | int | 否 | 最大输出 token 数 |
| `temperature` | float | 否 | 采样温度 |
| `top_p` | float | 否 | 核采样阈值 |
| `tools` | array | 否 | 工具定义(function / file_search / web_search 等) |
| `tool_choice` | string \| object | 否 | 工具选择策略 |
| `reasoning` | object | 否 | 推理选项(如 `{"effort": "high"}`) |
| `include` | array | 否 | 控制响应包含的额外字段 |
| `conversation` | string \| object | 否 | 关联对话 ID,服务端连续记忆 |
| `previous_response_id` | string | 否 | 接续上一次的 response |
| `store` | bool | 否 | 是否服务端存储响应 |
| `metadata` | object | 否 | 自定义元数据 |
| `user` | string | 否 | 终端用户标识 |

### 3.2 请求示例(非流式)

```bash
curl https://your-host/v1/responses \
  -H "Authorization: Bearer sk-xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5",
    "input": [
      { "role": "user", "content": "用一句话解释什么是黑洞" }
    ],
    "max_output_tokens": 200
  }'
```

> ⚠️ 部分模型(如 `gpt-5.5`)**必须**带 `"stream": true` 才能调用,且不接受 `max_output_tokens`。详见 [5. 接入注意](#5-接入注意实测)。

### 3.3 响应

```json
{
  "id": "resp_abc123...",
  "object": "response",
  "created_at": 1761234567,
  "status": "completed",
  "model": "gpt-5",
  "output": [
    {
      "id": "msg_xxx",
      "type": "message",
      "role": "assistant",
      "content": [
        { "type": "output_text", "text": "黑洞是引力强到光也无法逃逸的天体。" }
      ]
    }
  ],
  "usage": {
    "input_tokens": 12,
    "output_tokens": 18,
    "total_tokens": 30
  }
}
```

| 字段 | 说明 |
|------|------|
| `id` | 响应 ID,可作为 `previous_response_id` 续写 |
| `status` | `completed` / `incomplete` / `failed` 等 |
| `output[]` | 输出项数组,可能包含 `message` / `tool_call` / `image_generation_call` 等不同 `type` |
| `usage` | token 用量,与计费一致 |
| `incomplete_details` | 若 `status=incomplete`,说明原因(如 `max_output_tokens`) |

### 3.4 流式响应

请求体设置 `"stream": true` 后,响应改为 `text/event-stream`,每行格式为标准 SSE:

```
event: response.created
data: {"type": "response.created", "response": {...}}

event: response.output_text.delta
data: {"type": "response.output_text.delta", "delta": "黑"}

event: response.output_text.delta
data: {"type": "response.output_text.delta", "delta": "洞"}

...

event: response.completed
data: {"type": "response.completed", "response": {...}}
```

事件类型与 OpenAI 官方一致,使用官方 SDK 可直接解析。

### 3.5 错误

按 OpenAI 标准错误结构返回:

```json
{
  "error": {
    "message": "Invalid model",
    "type": "invalid_request_error",
    "code": "model_not_found",
    "param": "model"
  }
}
```

---

## 4. POST `/v1/messages` — Anthropic Messages API

兼容 Anthropic 官方 [Messages API](https://docs.anthropic.com/en/api/messages),可直接使用 Anthropic 官方 SDK(把 `base_url` 指向 keyapi)。

### 4.1 鉴权

两种鉴权方式任选其一:

```
# 方式 A:keyapi 风格
Authorization: Bearer sk-xxx

# 方式 B:Anthropic 原生风格(便于直接复用 Anthropic SDK)
x-api-key: sk-xxx
anthropic-version: 2023-06-01
```

### 4.2 请求体

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `model` | string | 是 | 模型名,如 `claude-opus-4-7` / `claude-sonnet-4-6` / `claude-haiku-4-5` 等 |
| `messages` | array | 是 | 对话历史,元素 `{"role": "user"\|"assistant", "content": ...}` |
| `max_tokens` | int | 是 | 最大输出 token 数 |
| `system` | string \| array | 否 | 系统提示;数组形式可带 `cache_control` 做提示缓存 |
| `stream` | bool | 否 | 流式输出 |
| `temperature` | float | 否 | 采样温度,0–1 |
| `top_p` | float | 否 | 核采样阈值 |
| `top_k` | int | 否 | top-k 采样 |
| `stop_sequences` | array | 否 | 停止序列 |
| `tools` | array | 否 | 工具定义 |
| `tool_choice` | object | 否 | 工具选择策略 |
| `thinking` | object | 否 | 思考模式,如 `{"type": "enabled", "budget_tokens": 8000}` |
| `metadata` | object | 否 | 自定义元数据(如 `user_id`) |
| `service_tier` | string | 否 | 服务等级 |

`messages[i].content` 可以是字符串,也可以是块数组:

```json
[
  { "type": "text", "text": "看看这张图" },
  { "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": "..." } }
]
```

### 4.3 请求示例(非流式)

```bash
curl https://your-host/v1/messages \
  -H "x-api-key: sk-xxx" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-6",
    "max_tokens": 256,
    "messages": [
      { "role": "user", "content": "用一句话解释什么是黑洞" }
    ]
  }'
```

### 4.4 响应

```json
{
  "id": "msg_01ABC...",
  "type": "message",
  "role": "assistant",
  "model": "claude-sonnet-4-6",
  "content": [
    { "type": "text", "text": "黑洞是引力极强、连光也无法逃逸的天体。" }
  ],
  "stop_reason": "end_turn",
  "usage": {
    "input_tokens": 14,
    "output_tokens": 19,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0
  }
}
```

| 字段 | 说明 |
|------|------|
| `content[]` | 块数组,可能含 `text` / `tool_use` / `thinking` 等 |
| `stop_reason` | `end_turn` / `max_tokens` / `tool_use` / `stop_sequence` |
| `usage.cache_creation_input_tokens` | 写入提示缓存的 token 数 |
| `usage.cache_read_input_tokens` | 命中提示缓存的 token 数 |

### 4.5 流式响应

`"stream": true` 时返回 SSE:

```
event: message_start
data: {"type": "message_start", "message": {...}}

event: content_block_start
data: {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}

event: content_block_delta
data: {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "黑"}}

event: content_block_delta
data: {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "洞"}}

...

event: content_block_stop
data: {"type": "content_block_stop", "index": 0}

event: message_delta
data: {"type": "message_delta", "delta": {"stop_reason": "end_turn"}, "usage": {"output_tokens": 19}}

event: message_stop
data: {"type": "message_stop"}
```

事件序列与 Anthropic 官方一致。

### 4.6 工具调用示例

```json
{
  "model": "claude-sonnet-4-6",
  "max_tokens": 1024,
  "tools": [
    {
      "name": "get_weather",
      "description": "获取某城市的天气",
      "input_schema": {
        "type": "object",
        "properties": { "city": { "type": "string" } },
        "required": ["city"]
      }
    }
  ],
  "messages": [
    { "role": "user", "content": "北京今天天气怎么样?" }
  ]
}
```

响应中 `content` 会包含 `type: "tool_use"` 块,客户端执行工具后通过 `tool_result` 块继续对话。

### 4.7 提示缓存

`system` / `messages` / `tools` 中的块可以追加 `cache_control` 标记触发提示缓存,大幅降低长上下文成本:

```json
{
  "system": [
    {
      "type": "text",
      "text": "你是一个资深 Go 工程师...(长系统提示)",
      "cache_control": { "type": "ephemeral" }
    }
  ]
}
```

命中缓存时 `usage.cache_read_input_tokens` 会非零,计费按缓存折扣价计算。

### 4.8 错误

按 Anthropic 标准错误结构返回:

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "max_tokens is required"
  }
}
```

---

## 5. 接入注意(实测)

以下条目来自实测,均为上游模型/渠道侧行为,**接入前请按模型差异化处理**,避免 4xx 卡住。

### 5.1 `/v1/responses`:部分模型只能流式

`gpt-5.5` 等模型在非流式调用时直接返回:

```json
{
  "error": {
    "message": "Stream must be set to true",
    "type": "bad_response_status_code",
    "code": "bad_response_status_code"
  }
}
```

**对策**:这类模型必须带 `"stream": true`,客户端走 SSE 解析。是否必须流式建议按模型维护一张白名单。

### 5.2 `/v1/responses`:部分模型不接受 `max_output_tokens`

`gpt-5.5` 等模型对 `max_output_tokens` 字段返回:

```json
{ "error": { "message": "Unsupported parameter: max_output_tokens", "code": "bad_response_status_code" } }
```

**对策**:仅在已知支持的模型(如 `gpt-4.1`、`o4-mini` 等)上传该字段;对新版 reasoning 模型按需省略。

### 5.3 `/v1/responses`:`input` 推荐用数组形式

虽然 OpenAI 官方文档声称 `input` 可为字符串,但实测部分渠道(如对接 codex 的 gpt-5.x)只接受**消息数组**:

```json
{ "input": [{ "role": "user", "content": "..." }] }
```

字符串形式会返回:

```json
{ "error": { "message": "Input must be a list", "type": "bad_response_status_code" } }
```

**对策**:始终用数组形式,跨渠道最稳。

### 5.4 异步生图 succeeded 的空字段

`result.data[i]` 即使没有值,也会以空字符串出现:

```json
{
  "url": "https://your-host/v1/images/async/.../content/0",
  "b64_json": "",
  "revised_prompt": ""
}
```

**对策**:判断字段时用 `if (b64_json)`(JS 空串为 falsy)或 `len(b64_json) > 0`(Go),不要用 `b64_json in obj` 之类的存在性判断。

### 5.5 `/v1/models` 可能返回带前导空格的脏模型名

实测某些渠道 `data[]` 里同时出现 `"claude-sonnet-4-6"` 和 `" claude-sonnet-4-6"`(前导空格)。带空格的那个走 `/v1/messages` 时通常匹配不到上游(`No available channel for model ...`)。

**对策**:展示给最终用户前 `id.trim()`,或直接过滤掉带前后空格的条目。

### 5.6 Claude 系统提示缓存默认开启

实测一次冷调用 `/v1/messages` 也返回:

```json
"usage": {
  "input_tokens": 72,
  "cache_creation_input_tokens": 0,
  "cache_read_input_tokens": 140,
  "output_tokens": 48
}
```

说明此渠道**默认对系统提示开启缓存**。客户端做用量统计时:

- 真实计费 input 需要把 `input_tokens` + `cache_creation_input_tokens` + `cache_read_input_tokens` 都纳入(按各自单价)
- 不能只看 `input_tokens` 估算成本

### 5.7 中文请求体注意编码

在 Windows `cmd` / 老版 PowerShell 直接 `curl -d '{"...":"中文"}'` 可能因 shell 编码导致上游收到乱码,Claude 会回复"消息出现编码问题"。

**对策**:
- shell 调试时,把请求体写到 UTF-8 文件,用 `curl --data-binary @body.json`
- 程序内调用时,确保 HTTP body 是 UTF-8 字节并显式设置 `Content-Type: application/json; charset=utf-8`

---

## 6. 常见问题

**Q1. 异步生图任务能查多久?**
A: 任务持久化在数据库,未触发清理策略前都能查;但 `result.data[i].url` 背后的上游图片可能过期(取决于渠道),建议生成后及时下载。

**Q2. 同一个 token 能不能同时用 OpenAI 和 Anthropic 风格?**
A: 可以。`Authorization: Bearer sk-xxx` 在 `/v1/messages` 同样有效;选择 `x-api-key` 头只是为了直接复用官方 SDK。

**Q3. 异步生图能用 multipart 上传图片(图生图)吗?**
A: 当前 `/v1/images/async` 仅支持 JSON body(base64 或 URL 形式的图片放在请求体里)。multipart 形式的 `/v1/images/edits` 暂未支持异步版本。

**Q4. 流式 chat 接口断线后能续传吗?**
A: 不能。流式连接断开后任务即视为放弃,需要重新发起请求。如果需要"提交后离线 + 事后取结果"模式,可以走异步生图;但目前**聊天接口不提供异步任务化版本**。

**Q5. 如何拿到剩余余额?**
A: 不通过本文档接口暴露;请通过 keyapi 控制台 / 管理 API 查询。

---

## 7. 关联文档

- 同步生图接口与内部实现:`docs/openai-compatible-image-api.md`
- 异步生图设计文档:`docs/superpowers/specs/2026-04-29-async-image-generations-design.md`
- 多租户与渠道分发:`docs/multi-tenant-completion-status.md`
