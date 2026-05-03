# OpenAI 协议网关注入图像生成与编辑能力

**日期**：2026-05-02
**作者**：wsg + Codex
**状态**：Design — 待评审
**关联 Phase**：Phase 1（OpenAI Chat Completions SSE 主路径 + Responses 兼容）

## 1. 背景与目标

### 1.1 背景

keyapi 已支持 OpenAI 兼容入口，包括 `/v1/chat/completions`、`/v1/responses`、`/v1/responses/compact`，并已有独立的图像生成 relay 能力。但 OpenAI 兼容客户端在只接入文本模型时，通常不能直接触发 keyapi 的图像生成或图像编辑能力。

Claude 协议侧已有一份设计文档：`docs/superpowers/specs/2026-05-02-claude-image-injection-design.md`。本设计只处理 OpenAI 协议，不复用 Anthropic SSE 事件状态机。

### 1.2 目标

让走 keyapi OpenAI 兼容入口的客户端，在不改客户端业务逻辑的前提下，通过 OpenAI tool/function calling 获得图像生成与图像编辑能力。

Phase 1 的主路径是：

- `/v1/chat/completions`，`stream=true`
- OpenAI Chat Completions 风格工具调用：`delta.tool_calls`
- 生成/编辑结果通过 tool message 回灌，再续发同一轮模型请求

### 1.3 非目标

- 不把 Anthropic `tool_use/tool_result` 结构塞进 OpenAI 请求
- 不支持 `/v1/responses/compact` 的图像工具注入
- 不实现多张图同时生成，固定 `n=1`
- 不实现视频生成、音频生成、文件编辑
- 不实现每日/每月图像生成配额
- 不要求所有 OpenAI 兼容上游都支持相同的 Responses API 事件格式

## 2. 决策总表

| # | 维度 | 决策 |
|---|---|---|
| Q1 | 支持协议 | Phase 1 支持 `/v1/chat/completions`；`/v1/responses` 作为后续兼容适配；不支持 `/v1/responses/compact` 注入 |
| Q2 | 触发方式 | 在请求 `tools` 中注入 `generate_image` / `edit_image` 两个 `function` tool，由模型自主决定是否调用 |
| Q3 | SSE 主路径 | Chat Completions SSE 解析 `choices[].delta.tool_calls`，在 `finish_reason=tool_calls` 后执行 round-trip |
| Q4 | 图回灌方式 | 构造 OpenAI tool message：`{"role":"tool","tool_call_id":"...","content":"..."}`，内容优先包含图片 URL 与结构化元数据 |
| Q5 | 图片给模型看 | 若续发模型支持视觉输入，则在后续 user message 中追加 `image_url` block；否则只回传图片 URL 文本 |
| Q6 | 图片存储 | 复用共享 image service：S3 兼容存储，presigned URL，默认 TTL 24h，对象生命周期 30 天 |
| Q7 | 开关粒度 | 复用 `Token.EnableImageGen`；平台总开关复用 `image_gen.enabled` |
| Q8 | 计费 | 底层图像 relay 独立 relay log + 独立扣费；主 OpenAI 对话照常按 token 计费 |
| Q9 | 编辑原图指代 | 当前请求内扫描 `image_url` block，分配 `img_<hash>`；跨轮编辑需依赖客户端回传图片或后续落库索引 |
| Q10 | 多协议边界 | `relay/imagegen/core` 共享执行与存储；`relay/imagegen/openai` 只处理 OpenAI 请求/响应协议 |

## 3. 总体架构

新增 OpenAI 协议适配层，不与 Claude 适配层共享拦截状态机：

```text
relay/imagegen/
├── core/
│   ├── executor.go       Generate/Edit，调用底层图像 relay
│   ├── storage.go        ImageStorage 抽象
│   ├── storage_s3.go     S3 兼容实现
│   ├── ids.go            image_id 生成
│   └── result.go         Result/Error 通用结构
├── anthropic/            Claude 协议适配，见 Claude spec
└── openai/
    ├── middleware.go     OpenAI 入口中间件
    ├── chat_tools.go     Chat Completions function tool schema
    ├── chat_injector.go  tools 注入、image_id 预处理
    ├── chat_stream.go    Chat SSE 状态机
    ├── chat_roundtrip.go tool message 构造与二次请求
    ├── responses_tools.go
    ├── responses_stream.go
    └── *_test.go
```

中间件挂载位置：

1. 认证和 token 解析之后
2. OpenAI relay helper 之前
3. 仅对以下路径启用：
   - `/v1/chat/completions`
   - `/pg/chat/completions`
   - 后续可扩展 `/v1/responses`

## 4. Chat Completions 数据流

### 4.1 请求注入

客户端原始请求：

```json
{
  "model": "gpt-4.1",
  "stream": true,
  "messages": [
    {
      "role": "user",
      "content": "画一只在月亮上的猫"
    }
  ]
}
```

网关注入后：

```json
{
  "model": "gpt-4.1",
  "stream": true,
  "messages": [
    {
      "role": "user",
      "content": "画一只在月亮上的猫"
    }
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "generate_image",
        "description": "Generate one image from a text prompt.",
        "parameters": {
          "type": "object",
          "properties": {
            "prompt": { "type": "string" },
            "model": { "type": "string", "enum": ["<动态填充>"] },
            "aspect_ratio": { "type": "string", "enum": ["1:1", "16:9", "9:16", "4:3", "3:4"] }
          },
          "required": ["prompt"]
        }
      }
    }
  ],
  "tool_choice": "auto"
}
```

注入规则：

- 若 `image_gen.enabled=false` 或 `token.EnableImageGen=false`，请求原样透传。
- 若用户已自带 `generate_image` 或 `edit_image`，对应同名 tool 不覆盖，其他未冲突 tool 可继续注入。
- 若 `tool_choice` 强制指定非 imagegen tool，本请求不注入 imagegen tool，避免改变用户强制工具选择语义。
- 若 `tools` 不为空，追加 imagegen tools；若为空，初始化为数组。
- 若 `parallel_tool_calls` 未设置，Phase 1 可设置为 `false`，降低一次响应里多个图像工具调用的复杂度。

### 4.2 图片输入预处理

OpenAI Chat 图片通常在 message content 中：

```json
{
  "role": "user",
  "content": [
    { "type": "text", "text": "把这张图背景换成蓝色" },
    {
      "type": "image_url",
      "image_url": {
        "url": "data:image/png;base64,..."
      }
    }
  ]
}
```

网关扫描 `messages[].content[]` 中的 `image_url`：

- 支持 `data:image/...;base64,...`
- 支持 `https://...` 远程图片 URL，但编辑前需要下载为 bytes；下载失败则返回 tool error
- 为每张图片生成 `img_<hash12>`
- 在同一条 user message 里追加或前置文本：

```json
{ "type": "text", "text": "[image_id: img_a3f2c8d1e5b6]" }
```

`edit_image` 默认使用当前轮最后一张图片；如果工具参数包含 `image_id`，则按 `image_id` 精确查找。

### 4.3 SSE 拦截状态机

OpenAI Chat Completions SSE 示例：

```text
data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_x","type":"function","function":{"name":"generate_image","arguments":"{\"prompt\":\""}}]}}]}
data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"a cat on the moon\"}"}}]}}]}
data: {"choices":[{"finish_reason":"tool_calls","delta":{}}]}
data: [DONE]
```

状态机按 `choice.index + tool_calls[].index` 聚合：

```text
pass_through
  ├─ 普通文本 delta：直接透传
  ├─ 发现 imagegen tool_call：进入 capture_tool_call
  └─ 其他 tool_call：直接透传，不执行

capture_tool_call
  ├─ 累积 id/type/function.name/function.arguments
  ├─ 暂存后续 tool_call delta，不向客户端 flush imagegen tool_call
  ├─ 等 finish_reason=tool_calls
  └─ 解析完整 arguments，执行 round-trip

round_trip
  ├─ 调 core.Executor.Generate/Edit
  ├─ 上传存储，生成 URL
  ├─ 构造 assistant tool_calls message
  ├─ 构造 role=tool message
  ├─ 二次请求上游 OpenAI Chat Completions，stream=true
  └─ 将二次请求 SSE 继续透传给客户端
```

Phase 1 限制：

- 同一轮只执行第一个 imagegen tool call。
- 如果模型同时返回多个 tool call，imagegen tool call 执行；其他 tool call 不由网关执行，并返回错误说明给模型，避免客户端收到半截工具调用。
- 若上游返回普通文本后又返回 imagegen tool call，已透传文本不回滚；tool 执行后续接模型回答。

### 4.4 Round-trip 消息构造

第一次模型响应捕获到：

```json
{
  "id": "call_img_123",
  "type": "function",
  "function": {
    "name": "generate_image",
    "arguments": "{\"prompt\":\"a cat on the moon\",\"aspect_ratio\":\"1:1\"}"
  }
}
```

图像生成成功后，二次请求 messages 追加：

```json
{
  "role": "assistant",
  "content": null,
  "tool_calls": [
    {
      "id": "call_img_123",
      "type": "function",
      "function": {
        "name": "generate_image",
        "arguments": "{\"prompt\":\"a cat on the moon\",\"aspect_ratio\":\"1:1\"}"
      }
    }
  ]
}
```

再追加 tool message：

```json
{
  "role": "tool",
  "tool_call_id": "call_img_123",
  "content": "{\"ok\":true,\"image_url\":\"https://s3.../img.png?X-Amz-...\",\"image_id\":\"img_result_xxx\",\"width\":1024,\"height\":1024}"
}
```

如果二次请求模型支持视觉输入，可追加一条 user message 让模型看到图像：

```json
{
  "role": "user",
  "content": [
    { "type": "text", "text": "Generated image result [image_id: img_result_xxx]." },
    { "type": "image_url", "image_url": { "url": "https://s3.../img.png?X-Amz-..." } }
  ]
}
```

默认策略：

- 对视觉模型：追加 `image_url` block，使模型能看见生成结果。
- 对非视觉模型：只追加 tool message JSON，让模型把 URL 发给用户。
- **视觉模型识别方式**：项目当前没有集中的"模型能力"元数据表，按**模型名前缀/正则匹配**判定，已知规则示例：`*-vision*`、`gpt-4o*`、`gpt-4.1*`、`claude-*`、`gemini-*-pro`、`grok-*-vision`。具体白名单维护在 `relay/imagegen/openai/vision_models.go`，未命中按**非视觉模型**处理（保守降级）。后续若引入集中元数据表，改为读元数据。

**二次请求（带 tool_result 续发上游）的 `tools` 字段处理**：

- **不再携带 imagegen tools**（`generate_image` / `edit_image`），防止模型连环画图陷入死循环
- 用户自带的其它 tools 仍按原样透传
- `tool_choice` 字段：若原请求是 `"auto"` 则改为 `"none"`（强制模型不再调工具，只续写）；若原请求强制了非 imagegen 工具则保留原值

## 5. Responses API 兼容设计

`/v1/responses` 不与 Chat Completions 共用流式状态机。Responses 事件通常包括：

- `response.output_item.added`
- `response.function_call_arguments.delta`
- `response.function_call_arguments.done`
- `response.output_item.done`
- `response.completed`

Responses tool schema 使用：

```json
{
  "type": "function",
  "name": "generate_image",
  "description": "Generate one image from a text prompt.",
  "parameters": {
    "type": "object",
    "properties": {
      "prompt": { "type": "string" },
      "model": { "type": "string" },
      "aspect_ratio": { "type": "string" }
    },
    "required": ["prompt"]
  }
}
```

Responses round-trip 追加 input item：

```json
{
  "type": "function_call_output",
  "call_id": "call_img_123",
  "output": "{\"ok\":true,\"image_url\":\"https://s3...\"}"
}
```

Phase 1 可以只写设计和测试样本，不默认启用 Responses 注入。原因：

- 当前项目已有 Chat Completions 与 Responses 互转逻辑，过早在两边都注入会增加重复执行风险。
- OpenClaw 或 Codex 类客户端可能优先使用 `/v1/responses`，但 Responses 的事件格式在兼容渠道之间差异更大。

## 6. Tool Schema

### 6.1 generate_image

```json
{
  "type": "function",
  "function": {
    "name": "generate_image",
    "description": "Generate one image from a text prompt. Use only when the user explicitly asks for image generation, illustration, drawing, poster, icon, photo, or visual content.",
    "parameters": {
      "type": "object",
      "properties": {
        "prompt": {
          "type": "string",
          "description": "Detailed image prompt. Include subject, style, composition, lighting, background, and any important constraints."
        },
        "model": {
          "type": "string",
          "enum": ["<动态填充：管理员白名单中的图像模型>"],
          "description": "Optional. Defaults to platform image_gen.default_model."
        },
        "aspect_ratio": {
          "type": "string",
          "enum": ["1:1", "16:9", "9:16", "4:3", "3:4"],
          "description": "Optional. Defaults to 1:1."
        }
      },
      "required": ["prompt"]
    }
  }
}
```

### 6.2 edit_image

```json
{
  "type": "function",
  "function": {
    "name": "edit_image",
    "description": "Edit an existing image based on a text instruction. By default edit the most recent image in the current user turn. Use image_id when the user refers to a specific image tag.",
    "parameters": {
      "type": "object",
      "properties": {
        "prompt": {
          "type": "string",
          "description": "Instruction describing how to modify the image."
        },
        "image_id": {
          "type": "string",
          "pattern": "^img_[a-f0-9]{12}$",
          "description": "Optional gateway-assigned image id."
        },
        "model": {
          "type": "string",
          "enum": ["<动态填充>"]
        },
        "aspect_ratio": {
          "type": "string",
          "enum": ["1:1", "16:9", "9:16", "4:3", "3:4"]
        }
      },
      "required": ["prompt"]
    }
  }
}
```

## 7. 错误处理

| 场景 | 处理 |
|---|---|
| 平台或 token 图像开关关闭 | 请求原样透传 |
| 用户强制 `tool_choice` 到其他 tool | 请求原样透传，不注入 imagegen tool |
| 用户自带同名 imagegen tool | 对应同名 tool 不覆盖，记 warning log |
| `arguments` JSON 拼接失败 | 构造 tool error output，让模型解释参数错误 |
| 图像 relay 失败 | tool output 返回 `{"ok":false,"error":"Image generation failed: <reason>"}`，图像 relay log 标记 failed，不扣费 |
| `edit_image` 找不到原图 | tool output 返回 `{"ok":false,"error":"No image found in conversation to edit. Please upload an image first."}` |
| 远程图片下载失败 | tool output 返回 `{"ok":false,"error":"Failed to fetch source image."}` |
| S3 上传失败 | tool output 返回 `{"ok":false,"error":"Image generated but failed to persist. Please retry."}` |
| 二次请求 OpenAI 上游失败 | 对客户端返回 OpenAI 风格 5xx error；若 SSE 已开始，发送 error chunk 后结束 |
| 客户端断连 | 取消图像 relay 和二次请求上下文 |

## 8. 多轮对话与 image_id

OpenAI Chat Completions 是无状态接口。多轮对话依赖客户端每次把历史 `messages` 传回来。

Phase 1 的 `image_id` 是请求内引用：

- 从当前请求可见的 `image_url` 内容或 URL 派生
- 用于同一轮 `edit_image` 精确定位原图
- 不保证客户端下一轮只带 `img_xxx` 文本就能编辑

若要支持跨轮只凭 `image_id` 编辑，需要新增持久化索引：

```text
image_id -> owner_token_id / object_key / source_type / created_at / expires_at
```

建议作为 Phase 2。

## 9. 安全与风险

- **工具滥用**：模型可能被诱导反复调用图像工具。Phase 1 关闭 parallel tool calls，并限制每轮最多执行一个 imagegen tool call。
- **成本外溢**：老 token 默认开启理论上有成本风险，但本项目最终决策为：**新 token 与迁移老 token 均默认 `true`**（与 Claude spec 一致），追求一致体验。运维兜底走平台总开关 `image_gen.enabled` —— 升级期间若想暂停，把它设为 `false` 即可，所有 token 立即失效，无需逐个改。
- **URL 泄露**：presigned URL 是临时凭证，bucket 必须 private，TTL 默认 24h。
- **远程图片 SSRF**：`edit_image` 下载远程 URL 时必须限制协议为 `https/http`，禁止内网 IP、localhost、file URL，并设置大小和超时限制。
- **Prompt 注入**：用户文本可伪造 `[image_id: img_xxx]`。网关只信任预处理阶段登记的 image_id 映射，不信任纯文本标签。
- **协议兼容差异**：OpenAI 兼容渠道对 tool_calls 流式 delta 的细节不同。状态机必须按项目现有 `dto.ChatCompletionsStreamResponse` 做容错解析。

## 10. 测试策略

### 10.1 单测

- `openai/chat_injector_test.go`
  - 无 tools 时注入
  - 已有 tools 时追加
  - 同名 tool 不覆盖
  - 强制其他 `tool_choice` 时不注入
  - image_url 生成稳定 `image_id`

- `openai/chat_stream_test.go`
  - 普通 SSE 透明透传
  - `delta.tool_calls` 多 chunk arguments 拼接
  - `finish_reason=tool_calls` 后触发执行
  - 非 imagegen tool_call 不拦截
  - `[DONE]` 处理

- `openai/chat_roundtrip_test.go`
  - assistant tool_calls message 构造
  - role=tool message 构造
  - 视觉模型追加 `image_url` user message
  - 非视觉模型只返回 URL JSON

- `core/executor_test.go`
  - Generate/Edit 调用底层 relay
  - 计费和错误传播

- `core/storage_s3_test.go`
  - MinIO 集成测试，验证 Put 和 PresignGet

### 10.2 端到端

- `/v1/chat/completions stream=true`，用户请求画图，最终 SSE 返回图片 URL 和模型说明。
- 上传 `data:image/png;base64,...`，请求编辑背景，最终返回编辑结果。
- 强制 `tool_choice` 到用户自带工具，确认 imagegen 不注入。
- 配错 S3，确认 tool error 能让模型解释失败。
- 客户端断连，确认上下文取消。

### 10.3 回归

- 现有 OpenAI relay 测试必须通过。
- 已有 Chat Completions 到 Claude/Gemini/Responses 的转换链路不能重复执行 imagegen tool。
- 对 `/v1/responses/compact` 不应注入任何 imagegen tool。

## 11. 实施分片建议（与 Claude spec 统一的 PR 序列）

> 本 PR 序列**与 Claude spec 共用**，避免 `core/` 被两条线重复实现。详细见 Claude spec §9。这里再列一遍便于查阅：

| PR | 内容 | 涉及 spec |
|----|------|-----------|
| **PR-1** | `core/` 包骨架；`Token.EnableImageGen` 字段 + 迁移（默认 `true`，含老 token）；配置项；S3 接口占位 | 共享 |
| **PR-2** | `core/storage_s3.go` 完整实现 + MinIO 集成测试 | 共享 |
| **PR-3** | `core/executor.go` Generate + 底层 gemini-image relay 联调 + 计费 log 验证 | 共享 |
| **PR-4** | `anthropic/` 包：tool schema + injector（仅 `generate_image`）+ Interceptor SSE 状态机 + 单测 | Claude |
| **PR-5** | `anthropic/` 非流式响应解析 + Anthropic e2e 联调 | Claude |
| **PR-6** | `openai/` 包：tool schema + injector + Chat Completions SSE 状态机 + 单测 | OpenAI |
| **PR-7** | `openai/` Chat round-trip 闭环（assistant tool_calls + role=tool message + 二次请求）+ e2e | OpenAI |
| **PR-8** | `core/executor.go` Edit + image_id 预处理（双协议各自接入 `edit_image`） | 共享 + 双协议 |
| **PR-9** | OpenAI Responses API 适配（实现完整，**feature flag 默认关**，Phase 1 不开启） | OpenAI |
| **PR-10** | 错误处理打磨 + 部署 runbook + 端到端冒烟 | 共享 |

OpenAI 协议侧用户可见效果从 **PR-7** 开始（Chat round-trip 闭合）。`/v1/responses` 注入要等 PR-9 落地、并由运维显式 `image_gen.responses_api.enabled=true` 才生效。

## 12. 与 Claude 设计的关系

两份设计共享：

- token 级开关
- 平台总开关
- 图像模型白名单
- 图像 executor
- S3 storage
- relay log 和计费链路

两份设计不共享：

- 请求 tool schema
- SSE 事件解析
- tool result/message 构造
- 二次请求消息结构

核心边界：

```text
Claude adapter 负责 Anthropic 协议
OpenAI adapter 负责 OpenAI 协议
core image service 只负责生成、编辑、存储、计费
```

这样可以避免后续维护中出现“一个状态机同时理解 Anthropic 和 OpenAI”的不可控复杂度。
