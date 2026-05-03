# Claude 协议网关注入图像生成与编辑能力

**日期**：2026-05-02
**作者**：wsg + Claude
**状态**：Design — 待评审
**关联 Phase**：Phase 1（仅文生图 + 图像编辑）

## 1. 背景与目标

### 1.1 背景
keyapi 是多模型聚合 SaaS 网关，已实现 Claude 协议（`/v1/messages`）转发到上游 Anthropic 或第三方 Claude 兼容服务，并独立支持多种图像生成通道（gemini-image / jimeng / sora 等）。但用户在 Claude Code 等 Anthropic 协议客户端中直接对话时，无法触发图像生成——因为 Claude 模型本身不出图。

### 1.2 目标
让所有走 keyapi `/v1/messages` 的 Claude 协议客户端**零客户端配置**地获得图像生成与编辑能力，体验上与 Claude 原生工具调用一致。

### 1.3 非目标（Phase 1 不做）
- 客户端 MCP 方案（用户需要单独 `claude mcp add`）
- 多张图同时生成（固定 `n=1`）
- 视频生成 / 音频 / 其他多模态
- 图像审核（moderation）的产品化钩子（沿用底层通道既有审核）
- 每日/每月图像生成配额（Phase 2 规划）
- web-next 控制台的"启用图像生成"开关 UI（本 spec 只保证后端字段就绪）

## 2. 决策总表

| # | 维度 | 决策 |
|---|---|---|
| Q1 | 触发方式 | 在 `/v1/messages` 注入 `generate_image` / `edit_image` 两个 tool，由 Claude 自主决定是否调用 |
| Q2 | 模型选择 | tool schema 暴露可选 `model` 枚举；缺省走平台默认；可选值=管理员已配置且在白名单的图像模型 |
| Q3 | Tool 参数 | `prompt`（必填）+ `model`（可选）+ `aspect_ratio`（可选）；固定 `n=1` |
| Q4 | 图回灌方式 | 上传到对象存储后，以 URL 形式作为 `tool_result` 的 image block 回灌 Claude |
| Q5 | 存储后端 | S3 兼容（AWS S3 / 阿里云 OSS / MinIO 等）使用 `aws-sdk-go-v2` |
| Q6 | 开关粒度 | `model.Token` 新增 `EnableImageGen bool`；新建默认 `true`；迁移老 token 也默认 `true` |
| Q7 | 计费 | 透传：底层图像通道独立 relay log + 独立扣费；主 Claude 对话照常按 token 扣 |
| Q8 | 编辑原图指代 | 默认取当前轮 user message 中最近的 image；可选 `image_id` 参数走精确指代（请求预处理时给每张图打 `img_<hash>` 标签） |
| 自决 1 | URL 访问 | S3 presigned URL，TTL 24h；对象生命周期 30 天后自动清理 |
| 自决 2 | 失败处理 | 以 `tool_result.is_error=true` 回灌 Claude，让其向用户解释；不中断对话 |
| 自决 3 | 流式回环 | 网关内部完成 round-trip，对客户端持续 SSE，客户端无感知 |
| 自决 4 | Phase 1 范围 | 仅文生图 + 图像编辑；图生视频、多图、moderation 钩子均不做 |

## 3. 总体架构

新特性以**装饰层**形式叠加在现有 `ClaudeHelper` 之上，不修改其核心逻辑。新增独立包 `relay/imagegen/`，对外暴露：

1. `Middleware()` — gin 中间件，挂在 Claude 路由链上认证之后、`ClaudeHelper` 之前
2. `ImageStorage` — 存储抽象接口，含 S3 实现

中间件做三件事：

1. **入口判定**：检查 `token.EnableImageGen`，关则直接放行不做任何注入
2. **请求预处理**：注入 `generate_image` + `edit_image` 两个 tool 定义；扫描所有 image block 注入 `[image_id: img_<hash>]` 标签
3. **响应拦截**：替换 `gin.ResponseWriter`，识别 `tool_use(generate_image|edit_image)`，执行 round-trip

### 3.1 数据流（流式 SSE，文生图）

```
客户端 → keyapi /v1/messages (stream=true)
  ↓ middleware.Auth
  ↓ imagegen.Middleware
  │   ├── 检查 token.EnableImageGen → true
  │   ├── InjectTool: 追加 generate_image / edit_image 到 req.tools
  │   ├── PreprocessImages: 给 image block 打 [image_id: ...] 标签
  │   └── 包装 ResponseWriter（拦截 SSE 输出）
  ↓ ClaudeHelper → 上游 Claude
  ↑ SSE stream（事件流）
  ↑ Interceptor 状态机
    ├── 普通文本/思考 → 透传给客户端
    └── 检测到 content_block_start(tool_use, name=generate_image):
        ① 暂停下游 SSE（accumulate 但不 flush 到客户端）
        ② 等到 content_block_stop + message_stop，得到完整 tool_use 参数
        ③ 调 Executor.Generate(prompt, model, aspect_ratio)
            └─ 内部走标准 relay 路径，独立 relay log + 独立扣费
        ④ 上传 PNG → ImageStorage.Put → 得到 presigned URL
        ⑤ 用 [original_messages + assistant_with_tool_use + tool_result(image url)]
           续发同一上游会话（也是 stream=true）
        ⑥ 续接的 SSE 事件继续透传给客户端
            （Claude 续写"我画好了，主角是一只..."等评论）
```

### 3.2 数据流（图像编辑）

与文生图唯一不同：

- Claude 触发 `tool_use(name=edit_image, input={prompt, image_id?})`
- Executor 解析：
  - 若 `image_id` 给定：从预处理时建立的 `image_id → image_bytes` 映射里取
  - 否则：从当前轮 user message 倒序找第一张 image block
- 调底层 image-to-image 通道（Phase 1 = gemini-2.5-flash-image）
- 后续步骤同 generate

### 3.3 非流式响应

逻辑等价，状态机简化：完整 JSON 到齐后解析 `content` 数组，找 `tool_use` 执行 round-trip，最终把"原始 assistant text + tool_result + Claude 续写"合并成一个非流式响应返回客户端。

## 4. 组件清单

> **协议分层**：与 OpenAI 协议设计（`2026-05-02-openai-image-injection-design.md`）协同，目录结构按"协议无关共享层 + 协议适配层"切分。本 spec 负责 `core/` 与 `anthropic/`；`openai/` 由对应 spec 落地。

```
relay/imagegen/
├── core/                       协议无关共享层
│   ├── executor.go             Generate / Edit，调底层图像 relay
│   ├── storage.go              ImageStorage 接口
│   ├── storage_s3.go           S3 实现（aws-sdk-go-v2）
│   ├── ids.go                  image_id 哈希工具
│   ├── result.go               Result / Error 通用结构
│   └── *_test.go
├── anthropic/                  Anthropic 协议适配（本 spec）
│   ├── tool_schema.go          generate_image / edit_image 的 Anthropic tool 定义
│   ├── middleware.go           gin.Middleware 入口
│   ├── injector.go             InjectTool / PreprocessImages
│   ├── interceptor_writer.go   ResponseWriter 包装
│   ├── interceptor_stream.go   SSE 状态机
│   ├── interceptor_buffered.go 非流式响应解析
│   └── *_test.go
└── openai/                     OpenAI 协议适配（见对应 spec）
```

### 4.1 关键接口

```go
// ImageStorage 对象存储抽象
type ImageStorage interface {
    Put(ctx context.Context, key string, contentType string, body io.Reader) error
    PresignGet(ctx context.Context, key string, ttl time.Duration) (string, error)
}

// Executor 调底层图像通道
type Executor interface {
    Generate(ctx context.Context, info *relaycommon.RelayInfo, p GenerateParams) (*Result, error)
    Edit(ctx context.Context, info *relaycommon.RelayInfo, p EditParams) (*Result, error)
}

type Result struct {
    PNG       []byte
    Width     int
    Height    int
    UpstreamUsage  any   // 复用 relay 计费数据
}
```

### 4.2 数据库变更

- `tokens` 表新增字段 `enable_image_gen BOOLEAN NOT NULL DEFAULT TRUE`
- 迁移语句：见 `model/migration_*.go` 现有规范，添加新 migration 文件

### 4.3 配置项（system_setting）

| 键 | 默认 | 说明 |
|---|---|---|
| `image_gen.enabled` | `false` | 平台总开关；为 `false` 时即使 token 开了也不注入（运维兜底） |
| `image_gen.default_model` | `gemini-2.5-flash-image` | tool 调用未指定 model 时的兜底 |
| `image_gen.allowed_models` | `[]`（空=所有图像模型） | 白名单 |
| `image_storage.provider` | `s3` | 仅 `s3` 一种实现 |
| `image_storage.endpoint` | `""` | S3 endpoint（OSS / MinIO 等填这个） |
| `image_storage.bucket` | `""` | bucket 名 |
| `image_storage.region` | `auto` | region |
| `image_storage.access_key` | `""` | 加密存储 |
| `image_storage.secret_key` | `""` | 加密存储 |
| `image_storage.presign_ttl_seconds` | `86400` | presigned URL 有效期 |
| `image_storage.object_lifecycle_days` | `30` | 仅作运维提示，实际生命周期由 bucket 规则控制 |

## 5. Tool Schema 定义

### 5.1 generate_image

```json
{
  "name": "generate_image",
  "description": "Generate an image from a text prompt. Use only when the user explicitly asks for an image, illustration, or visual content. The result will be returned as an image you can see and reference in subsequent messages. Note: any text in the form '[image_id: img_xxxxx]' is gateway metadata, not part of the image content.",
  "input_schema": {
    "type": "object",
    "properties": {
      "prompt": {
        "type": "string",
        "description": "Detailed description of the image to generate. Be specific about subject, style, composition."
      },
      "model": {
        "type": "string",
        "enum": ["<动态填充：管理员白名单中的图像模型>"],
        "description": "Optional. Defaults to the platform default if omitted."
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
```

### 5.2 edit_image

```json
{
  "name": "edit_image",
  "description": "Edit an existing image based on a text instruction. By default edits the most recently uploaded image in the current user turn. To target a specific earlier image, pass its image_id (visible to you as '[image_id: img_xxx]' near the image).",
  "input_schema": {
    "type": "object",
    "properties": {
      "prompt": {
        "type": "string",
        "description": "Instruction describing how to modify the image."
      },
      "image_id": {
        "type": "string",
        "pattern": "^img_[a-f0-9]{12}$",
        "description": "Optional. Reference a specific image by its gateway-assigned id."
      },
      "model": { "type": "string", "enum": ["..."] },
      "aspect_ratio": { "type": "string", "enum": ["1:1", "16:9", "9:16", "4:3", "3:4"] }
    },
    "required": ["prompt"]
  }
}
```

## 6. 错误处理

| 场景 | 处理 |
|---|---|
| `token.EnableImageGen=false` | 不注入 tool，请求按原样转发，等同于这个特性不存在 |
| 平台总开关 `image_gen.enabled=false` | 同上 |
| 用户已自带同名 tool（`generate_image` / `edit_image`） | **按 tool 粒度独立判断**：例如用户自带了 `generate_image` 但没带 `edit_image`，则只跳过 `generate_image`，仍正常注入 `edit_image`。冲突的那个不覆盖、记 warning log |
| 用户在请求里设置了 `tool_choice={"type":"tool","name":"<other>"}` 强制使用其它工具 | 不干预，按原样转发；本特性在该请求中事实上失效 |
| Claude 一次响应里返回**多个** `tool_use` 块（含至少一个 imagegen） | **Phase 1：每轮只执行第一个 imagegen tool_use**。其它 imagegen tool_use 以 `tool_result.is_error=true, content="Only one image operation per turn is supported in Phase 1"` 回灌；非 imagegen 的 tool_use 不拦截，按原始事件流透传给客户端，由客户端自己处理 |
| 二次请求（携带 tool_result 续发上游 Claude）的 tools 字段 | **不再携带 imagegen tools**，避免 Claude 续写时连环画图陷入死循环。其他用户自带 tools 仍透传 |
| 底层图像通道调用失败（超时/上游 5xx/审核拒绝/额度不足） | 以 `tool_result.is_error=true` 回灌 Claude，content 为 `"Image generation failed: <reason>"`；Claude 续写时会向用户解释；图像 relay log 仍然写入但标记为 `failed`，不扣费 |
| `edit_image` 找不到原图 | 同上，error message: `"No image found in conversation to edit. Please upload an image first."` |
| 存储上传失败 | 同上，error message: `"Image generated but failed to persist. Please retry."` |
| 续发上游 Claude 会话失败 | 整个请求按 5xx 返回客户端（罕见，相当于上游 Claude 挂了） |
| 客户端中途断连 | 取消 round-trip 上下文（`context.Cancel`），已生成的图片保留 30 天供未来回看 |

## 7. 安全与风险

### 7.1 已识别风险
- **Prompt 注入**：用户消息里如果包含 `[image_id: img_xxx]` 字符串可能误导 Claude。**缓解**：image_id 哈希前缀固定 `img_`，预处理时只对真实 image block 注入；用户文本里出现的同样字符串 Claude 看到了也无图可指。
- **滥用图像生成消耗额度**：恶意 prompt 让 Claude 不停画图。**缓解**：图像调用走标准额度扣费链路，没钱自然失败；Phase 2 加每日上限。
- **存储桶外泄**：presigned URL 本身就是临时凭证；bucket 必须设为 private，禁止公开访问。
- **敏感图持久化 30 天**：生成的图可能含敏感内容。**缓解**：bucket 加密；运维有清理工具；Phase 2 加用户主动删除入口。
- **历史 Token 默认开启**：本 spec 决定迁移老 token 默认 `true`。如果你部署后觉得不妥，迁移文件改 `DEFAULT FALSE` 重跑即可（但需要用户主动开启）。

### 7.2 不破坏既有行为的保证
- 当 token 没开 / 平台总开关关 / 用户自带同名 tool 时，请求体 100% 按原样转发，无任何注入。
- 主 Claude 请求计费路径不动，新功能只追加 relay log，不改老 log 格式。
- ResponseWriter 包装层在没有 `tool_use(generate_image|edit_image)` 时是纯透传，性能影响 ≈ 一次 string contains。

## 8. 测试策略

### 8.1 单测
- `injector_test.go`：tool 注入幂等性、用户自带同名 tool 时跳过、image_id 哈希稳定性
- `interceptor_stream_test.go`：SSE 状态机覆盖（normal text → tool_use → tool_result 续接）
- `interceptor_buffered_test.go`：非流式响应解析
- `executor_test.go`：底层 relay channel mock，验证计费 / 错误传播
- `storage_s3_test.go`：用 MinIO docker 容器跑集成测试

### 8.2 端到端
- 启动本地 keyapi + Claude Code，用真实 token：
  - 让 Claude 画图："画一只在月亮上的猫"
  - 让 Claude 编辑图：上传一张 → "把背景换成蓝色"
  - 关闭 token 开关后请求同样的 prompt → 应不触发 tool
  - 故意配错 S3 凭证 → tool_result 应回 error，对话能继续

### 8.3 回归
- 已有 `/v1/messages` 测试用例（`relay_claude_test.go`）必须 100% 通过

## 9. 实施分片建议（与 OpenAI spec 统一的 PR 序列）

> 本 PR 序列**同时覆盖** Claude 协议和 OpenAI 协议两份 spec。`core/` 是共享基础设施，先建好；之后两个协议适配层并行/独立合入。

| PR | 内容 | 涉及 spec |
|----|------|-----------|
| **PR-1** | `core/` 包骨架；`Token.EnableImageGen` 字段 + 迁移（默认 `true`，含老 token）；配置项；S3 接口占位 | 共享 |
| **PR-2** | `core/storage_s3.go` 完整实现 + MinIO 集成测试 | 共享 |
| **PR-3** | `core/executor.go` Generate + 底层 gemini-image relay 联调 + 计费 log 验证 | 共享 |
| **PR-4** | `anthropic/` 包：tool schema + injector（仅 `generate_image`）+ Interceptor SSE 状态机 + 单测 | Claude |
| **PR-5** | `anthropic/` 非流式响应解析 + Anthropic e2e 联调（Claude Code 真实跑通） | Claude |
| **PR-6** | `openai/` 包：tool schema + injector + Chat Completions SSE 状态机 + 单测 | OpenAI |
| **PR-7** | `openai/` Chat round-trip 闭环（assistant tool_calls + role=tool message + 二次请求）+ e2e | OpenAI |
| **PR-8** | `core/executor.go` Edit + image_id 预处理（双协议各自接入 `edit_image`） | 共享 + 双协议 |
| **PR-9** | OpenAI Responses API 适配（实现完整，**feature flag 默认关**，Phase 1 不开启） | OpenAI |
| **PR-10** | 错误处理打磨 + 部署 runbook + 端到端冒烟 | 共享 |

PR-1～PR-3 是不可见的基础设施；PR-4 起 Claude 协议侧可见；PR-6 起 OpenAI 协议侧可见。

## 10. 后续 Phase（不在本 spec 范围内）

- 每日/每月图像生成上限（per-token / per-tenant）
- web-next 控制台 UI：token 开关、图像历史、主动删除
- 客户端 MCP 备选方案（给不希望用工具注入的用户）
- 多张图同时生成（`n>1`）
- 视频生成 tool（基于 sora / kling）
- 图像审核钩子（产品化的内容过滤策略）
- 提供商扩展：jimeng edit、replicate 系列模型

---

## 附录 A：注入示例

用户原始请求：
```json
{
  "model": "claude-opus-4-7",
  "messages": [
    {"role": "user", "content": [
      {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "..."}},
      {"type": "text", "text": "把这张图的背景换成蓝色"}
    ]}
  ],
  "tools": [],
  "stream": true
}
```

中间件改写后转发到上游 Claude：
```json
{
  "model": "claude-opus-4-7",
  "messages": [
    {"role": "user", "content": [
      {"type": "text", "text": "[image_id: img_a3f2c8d1e5b6]"},
      {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "..."}},
      {"type": "text", "text": "把这张图的背景换成蓝色"}
    ]}
  ],
  "tools": [
    {"name": "generate_image", "description": "...", "input_schema": {...}},
    {"name": "edit_image", "description": "...", "input_schema": {...}}
  ],
  "stream": true
}
```

Claude 流式响应里发出：
```
content_block_start: tool_use(name=edit_image)
input_json_delta: {"prompt":"change background to blue","image_id":"img_a3f2c8d1e5b6"}
content_block_stop
message_stop (stop_reason=tool_use)
```

网关拦截后调底层 gemini-image 编辑通道，拿到结果 PNG，上传 S3 得到 presigned URL，续发：
```json
{
  "model": "claude-opus-4-7",
  "messages": [
    {"role": "user", "content": [...]},  // 同上（已含 image_id 标签）
    {"role": "assistant", "content": [
      {"type": "tool_use", "id": "toolu_xxx", "name": "edit_image", "input": {...}}
    ]},
    {"role": "user", "content": [
      {"type": "tool_result", "tool_use_id": "toolu_xxx", "content": [
        {"type": "image", "source": {"type": "url", "url": "https://s3.../img_xxx.png?X-Amz-..."}}
      ]}
    ]}
  ],
  "tools": [...],
  "stream": true
}
```

Claude 续写："好的，背景已改为蓝色，你看看效果如何？" → SSE 透传给客户端。客户端从头到尾感觉这是一次连续的对话。
