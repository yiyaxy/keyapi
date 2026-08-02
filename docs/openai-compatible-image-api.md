# OpenAI 兼容图像接口

本文档描述 keyapi 提供的 OpenAI 风格图像接口（不包含 Midjourney、Suno、Playground 等私有接口）。

接口源码入口：`router/relay-router.go`（`relayV1Router` 组）。

---

## 1. 接口概览

| 方法 | 路径 | 用途 | 实现 |
|------|------|------|------|
| POST | `/v1/images/generations` | 同步文生图 | `controller.Relay` → `RelayFormatOpenAIImage` |
| POST | `/v1/images/edits` | 同步图像编辑（multipart 或 JSON） | 同上 |
| POST | `/v1/edits` | 同 `/v1/images/edits`（兼容别名） | 同上 |
| POST | `/v1/images/async` | 异步提交生图任务 | `controller.RelayTask` |
| GET | `/v1/images/async/:task_id` | 查询异步任务 | `controller.RelayTaskFetch` |
| GET | `/v1/images/async/:task_id/content/:index` | 反代上游图片字节流（鉴权） | `media.ImageProxy` |
| GET | `/public/images/async/:task_id` | 异步任务分享页（免鉴权） | `relay.PublicImageAsyncTaskPage` |
| GET | `/public/images/async/:task_id/content/:index` | 分享页图片代理（免鉴权） | `media.PublicImageProxy` |
| POST | `/v1/images/variations` | 未实现，固定 501 | `controller.RelayNotImplemented` |

## 2. 鉴权与中间件

所有 `/v1/...` 接口经过以下中间件链（声明见 `router/relay-router.go:89-95`）：

1. `RelayPrometheusMiddleware` — 指标采集
2. `RouteTag("relay")` — 路由打标
3. `SystemPerformanceCheck` — 系统负载保护
4. `TokenAuth` — 校验 `Authorization: Bearer sk-xxx`（项目颁发的 token）
5. `ModelRequestRateLimit` — 按模型限流
6. `ChatHistoryRecorder` — 历史记录
7. `Distribute` — 选择上游渠道（按模型、租户、token 配置）

`/public/images/async/...` 走 `publicImageTaskRouter`（`router/relay-router.go:68-74`），仅有 `GlobalWebRateLimit` 限流，**不需要 token**，凭 task_id 自身即可访问（task_id 长且随机）。

---

## 3. 同步生图：`POST /v1/images/generations`

### 3.1 请求体

完全兼容 OpenAI `images/generations`，结构定义见 `dto/openai_image.go:14 ImageRequest`：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `model` | string | 是 | 模型名（`dall-e-3` / `gpt-image-1` / `gpt-image-2` / `flux-...` / 渠道自定义模型等） |
| `prompt` | string | 是 | 提示词 |
| `n` | uint | 否 | 张数，默认 1 |
| `size` | string | 否 | 尺寸或比例，例 `1024x1024` / `1792x1024`；新模型用比例如 `16:9` |
| `quality` | string | 否 | `standard` / `hd`（仅 dall-e-3 等支持） |
| `response_format` | string | 否 | `url` 或 `b64_json`，默认 `url` |
| `style` | any | 否 | 透传上游 |
| `resolution` | string | 否 | `1k` / `2k` / `4k`，gpt-image-2 等新模型用 |
| `background`, `moderation`, `output_format`, `output_compression`, `partial_images` | any | 否 | 透传 OpenAI 新字段 |
| `watermark` | bool | 否 | 部分渠道使用 |
| `watermark_enabled`, `user_id`, `image` | any | 否 | 智谱 4v 等渠道扩展 |
| `extra_fields`, `user` | any | 否 | 透传 |
| 其他字段 | any | 否 | 未识别字段自动收集到 `Extra` 并按渠道适配透传 |

### 3.2 请求示例

```bash
curl https://your-host/v1/images/generations \
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

### 3.3 响应

成功响应是标准 OpenAI 结构（`dto.ImageResponse`）：

```json
{
  "created": 1761234589,
  "data": [
    { "url": "https://upstream/.../image_0.png" },
    { "url": "https://upstream/.../image_1.png" }
  ]
}
```

`response_format=b64_json` 时：

```json
{
  "created": 1761234589,
  "data": [
    { "b64_json": "iVBORw0KGgo..." }
  ]
}
```

`data[i]` 可能附带 `revised_prompt`（OpenAI 改写后的实际 prompt）。

### 3.4 错误

错误返回标准 OpenAI 错误结构，HTTP 状态码由上游或预检阶段决定。常见：

- 400 `invalid_request_error` — prompt/model 缺失等
- 402 — 余额不足（预扣失败）
- 429 — 限流
- 5xx — 上游失败（已退还预扣额度）

### 3.5 行为细节

源码：`relay/image_handler.go:23 ImageHelper`。

- 请求体先 `DeepCopy`，再走 `ModelMappedHelper`（模型映射）和 `applyImagePerCallBillingIfNeeded`（per-call 计费）
- 走 `PassThroughBody` 时直接透传原始 body（适合上游格式完全一致的渠道）；否则走 `adaptor.ConvertImageRequest` 做渠道差异化处理
- `info.ParamOverride` 支持渠道侧字段覆盖（admin 配置）
- 计费按 `n × sizeRatio × qualityRatio × model_ratio`，`n` 通过 `OtherRatios["n"]` 注入避免重复计算
- `replicate` 渠道返回 201 时按 200 处理

---

## 4. 同步图像编辑：`POST /v1/images/edits`、`POST /v1/edits`

走和 `/v1/images/generations` 同一套 `RelayFormatOpenAIImage` 处理路径。

- multipart/form-data 上传：`image[]`、`mask`、`prompt` 等字段，OpenAI 兼容
- JSON 形式（gpt-image-2 / Gemini Imagen / 即梦 / 万相等）：把图片以 base64 或 URL 放在 body 内，结构由具体模型决定（项目透传到上游适配器）

`POST /v1/edits` 是历史别名，行为等同 `/v1/images/edits`。

---

## 5. 异步接口

### 5.1 设计背景

`/v1/images/generations` 全程阻塞 HTTP 连接等上游返回。对接 apimart 等**上游本身就是异步**的渠道时，上游会立即返回 `task_id`，但 keyapi 同步路径无法兜住，客户端拿到 `task_id` 也无处可查。

异步端点统一了客户端体验：无论上游是同步还是异步，客户端都拿一致的 `task_id` + 轮询模式。

详细设计：`docs/superpowers/specs/2026-04-29-async-image-generations-design.md`。

### 5.2 提交：`POST /v1/images/async`

**请求体**：与 `/v1/images/generations` 完全一致（`dto.ImageRequest`），客户端可原样复制同步请求。

```bash
curl https://your-host/v1/images/async \
  -H "Authorization: Bearer sk-xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-image-2",
    "prompt": "一只机甲猫",
    "size": "1024x1024",
    "n": 2
  }'
```

**响应**（HTTP 200，提交成功）：

```json
{
  "task_id": "task_abc123Def456...",
  "status": "queued",
  "created": 1761234567
}
```

**失败响应**（HTTP 4xx/5xx）：与现有 task 端点一致的 `dto.TaskError`：

```json
{
  "code": "invalid_request",
  "message": "...",
  "type": "...",
  "request_id": "..."
}
```

提交失败（含余额不足）已退还预扣额度。

### 5.3 查询：`GET /v1/images/async/:task_id`

**进行中**：

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

**成功**：

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

> `result` 是完整的 OpenAI `images/generations` 响应——客户端可以直接把这个字段喂给 OpenAI SDK 解析。返回的 `url` 是 keyapi 自家域，**不是上游 URL**。

**失败**：

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

**状态枚举**：

| `status` | 含义 |
|----------|------|
| `queued` | 已提交，未开始处理 |
| `processing` | 处理中（同步上游调用中 / 异步上游轮询中） |
| `succeeded` | 完成，`result` 可用 |
| `failed` | 失败，`error` 可读 |

### 5.4 内容代理：`GET /v1/images/async/:task_id/content/:index`

按图片索引（0 起）反代上游图片字节流。

- 透传上游 `Content-Type`（`image/png` / `image/jpeg` / `image/webp` 等）
- 流式回传，无大小限制
- 经过 SSRF 校验（参考 `controller/media/video_proxy.go` 同款防护）
- 走渠道侧代理设置（若有）

错误：

| 状态码 | 场景 |
|--------|------|
| 404 | task 不存在 / 不属于当前用户 / 索引越界 / 该项为 `b64_json`（base64 不走代理，直接取查询接口拿） |
| 400 | task 未完成 |
| 403 | 命中 SSRF / 域名黑名单 |
| 410 | 上游 URL 已过期 |
| 503 | 上游连接失败 |

> ⚠️ keyapi **不缓存图片字节**，仅做反代。上游 URL（如 apimart）有过期时间，过期后此接口也会 410，需要重新生成。后续若引入对象存储，可解决持久化。

### 5.5 公开分享：`/public/images/async/:task_id` 及 content

- `GET /public/images/async/:task_id` — 浏览器分享页（HTML），免鉴权
- `GET /public/images/async/:task_id/content/:index` — 配套图片代理，免鉴权

适用于把生成结果以链接形式分享给第三方查看。task_id 长度足够（`PublicTaskID`），不可枚举。代码：`relay/image_async_public.go`、`relay/imagegen/public_link.go`。

### 5.6 计费时序（异步）

完全沿用现有 task 框架：

1. **提交时（`/v1/images/async`）**：`PreConsumeBilling` 预扣 → `SettleBilling` 实际记账
2. **完成（成功）**：金额不变（图片任务在提交时参数已完整，不做差额结算）
3. **完成（失败）**：`service.RefundTaskQuota` 退还全额

---

## 6. 不支持的接口

| 路径 | 状态 |
|------|------|
| `POST /v1/images/variations` | 固定返回 501，未实现（`controller.RelayNotImplemented`） |
| `/v1/images/edits` 的异步版本 | v1 未覆盖（multipart 暂存方案未定） |

---

## 7. 调试与排查

- 调试日志：渠道配置开启 `DebugLog`，或全局 `DEBUG=true`，日志里能看到 `image request body: ...`
- 任务表：`tasks` 表，`PublicTaskID` 即对外 `task_id`，`PrivateData.ImageData` 存上游返回的图片数据（URL 列表或 b64）
- 同步路径出错：直接看 keyapi 日志中相应 `request_id`
- 异步路径出错：查任务行 `FailReason`、`Progress`、`Status`；上游异步类型还可看 `UpstreamTaskID` 对照上游侧
- 反代失败：通常是 SSRF 拦截或上游 URL 过期，看日志 `image proxy ...`

---

## 8. 关联文档

- 异步生图设计：`docs/superpowers/specs/2026-04-29-async-image-generations-design.md`
- 多租户/渠道分发：`docs/multi-tenant-completion-status.md`
- 关键源码：
  - 路由：`router/relay-router.go`
  - 同步处理：`relay/image_handler.go`
  - 请求/响应 DTO：`dto/openai_image.go`
  - 异步派发：`relay/relay_task.go`、`relay/imagegen_executor.go`
  - 内容代理：`controller/media/image_proxy.go`、`controller/media/video_proxy.go`
  - 公开分享：`relay/image_async_public.go`、`relay/imagegen/public_link.go`
