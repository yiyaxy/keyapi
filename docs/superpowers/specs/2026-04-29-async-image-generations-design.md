# 异步图片生成端点（对外 async / 上游 sync 与 async 通吃）— 设计文档

> 日期：2026-04-29
> 基于分支：`dev`
> 关联背景：现有 `/v1/images/generations` 走 `controller.Relay → relay.ImageHelper` 同步透传；项目已有完整异步任务框架（Suno / MJ / Sora / Kling / Vidu 等）走 `controller.RelayTask` + `service/task_polling.go`，但未覆盖图片生成。
>
> **v1 Scope**：新增对外异步图片生成端点 `/v1/images/async` 与查询端点 `/v1/images/async/:task_id`、内容代理 `/v1/images/async/:task_id/content/:index`。客户端无论上游是同步（如标准 OpenAI、Stability）还是异步（如 apimart）都拿到一致的异步体验。
> **v1 不覆盖**：`/v1/images/edits`（multipart 上传）异步、其他 modality（audio/embeddings）异步、客户端 webhook 通知、长期对象存储留档。

---

## 1. 背景与目标

### 1.1 现状

- `POST /v1/images/generations` 只能同步：`router/relay-router.go:122` → `controller.Relay(types.RelayFormatOpenAIImage)` → `controller/relay.go:389 Relay` → `relay/image_handler.go:23 ImageHelper`，HTTP 连接全程阻塞等上游返回。
- 上游若是异步任务模式（apimart 提交后返回 `{code:200, data:[{status:"submitted", task_id:"task_..."}]}`），keyapi 直接把这条响应透传回客户端（`relay/channel/openai/relay-openai.go:692 IOCopyBytesGracefully`），客户端拿到 `task_id` 后**无端点可查**——keyapi 数据库里没有这条任务记录。
- 项目早已为视频/音乐/MJ 等异步上游搭好任务框架：
  - 任务表 `model.Task`（含 `PublicTaskID`、`Status`、`PrivateData{ResultURL, BillingContext}`）
  - 派发入口 `controller.RelayTask` / `controller.RelayTaskFetch`
  - 适配器接口 `relay.channel.TaskAdaptor`（`relay/channel/adapter.go:34`）
  - 后台轮询 `service/task_polling.go:91 TaskPollingLoop`（每 15s）
  - 计费时序 `relay/relay_task.go:153 RelayTaskSubmit`：估价 → 预扣 → 提交 → 完成结算 / 失败退款
  - 视频内容代理范例 `controller/media/video_proxy.go:33 VideoProxy`、路由 `/v1/videos/:task_id/content`

### 1.2 本次目标（v1）

- **对外异步**：客户端 POST `/v1/images/async` 立刻拿到 `task_id`，<100ms 返回；通过 GET `/v1/images/async/:task_id` 轮询拿状态/结果。
- **上游兼容**：
  - 上游异步（apimart 等）：本期落地一个具体适配器 `apimart.TaskAdaptor`。
  - 上游同步（标准 OpenAI、Stability、xAI、Gemini、即梦、阿里万相等所有现有图片渠道）：通过通用 `syncwrap.TaskAdaptor`，提交时立即在后台 goroutine 内调用上游同步接口，结果落任务表。
- **响应格式**：OpenAI 风格 `result` 包装，客户端把 `result` 字段直接喂给现有 OpenAI SDK 即可。
- **结果代理**：返回的图片 URL 是 keyapi 自家域，客户端 GET 时反代上游，避免上游 URL 过期/泄露。
- **计费**：完全沿用现有 task 框架（提交时预扣，完成时结算/退款）。
- **不破坏**：`/v1/images/generations` 同步端点保持原行为不动，所有现有客户端无感。

### 1.3 v1 明确不做

- `/v1/images/edits`（multipart 上传）的异步版本——需要解决"提交后图片字节怎么暂存"，留待二期。
- 其他长耗时同步接口（audio / embedding 等）异步——同模式可后续扩展。
- Webhook 推送结果——客户端继续用轮询。
- 永久对象存储——上游 URL 过期后代理也会 404，可接受。
- 任务并发数限制 / 队列——沿用现有 task 框架的行为，不做额外限流。

---

## 2. 关键决策记录

| 决策项 | 选择 | 理由 |
|--------|------|------|
| **兼容性策略** | B：端点分离，老端点不动，新端点独立 | 零破坏；命名清晰；OpenAI SDK 现有调用零迁移 |
| **上游分类** | D：硬编码已知异步适配器 + 通用 SyncWrap 兜底 | apimart 类响应格式各家不同，硬编码必要；其他全部走 SyncWrap，零配置 |
| **响应格式** | A：OpenAI 风格 `result` 包装 | 客户端拿 `result` 字段直接复用 OpenAI 同步代码 |
| **计费时机** | A：提交时预扣，完成时结算/退款 | 与项目所有现有任务一致；提交时余额不足立刻 402 |
| **结果 URL** | C：keyapi 反代上游 | 客户端 URL 永远是 keyapi 自家域；不引入存储/带宽预付成本 |
| **覆盖端点** | A：仅 `images/generations` | YAGNI；JSON 形式图生图天然支持（gpt-image-2、Gemini Imagen、即梦、万相等模型把图放 body） |
| **架构方案** | A：复用现有 TaskAdaptor 框架 | 计费 / 退款 / 轮询 / tenant 隔离 / 敏感词全部现成 |

---

## 3. 端点定义

### 3.1 提交：`POST /v1/images/async`

**路由声明**（`router/relay-router.go`）：
```go
httpRouter.POST("/images/async", controller.RelayTask)
httpRouter.GET("/images/async/:task_id", controller.RelayTaskFetch)
```

**请求体**：与 `/v1/images/generations` 完全一致（`dto.ImageRequest`），客户端可以原样拷贝原同步请求过来。

```bash
curl https://token.cymoon.cn/v1/images/async \
  -H "Authorization: Bearer XWK5...EfXb" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-image-2",
    "prompt": "一只机甲猫",
    "size": "1024x1024",
    "n": 2,
    "response_format": "url"
  }'
```

**成功响应**（HTTP 200）：

```json
{
  "task_id": "task_abc123Def456...",
  "status": "queued",
  "created": 1761234567
}
```

**错误响应**（HTTP 4xx/5xx）：与现有 task 端点一致（`dto.TaskError` JSON）：
```json
{
  "code": "invalid_request",
  "message": "...",
  "type": "...",
  "request_id": "..."
}
```

### 3.2 查询：`GET /v1/images/async/:task_id`

**响应**（HTTP 200，进行中）：
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

**响应**（HTTP 200，已完成）：
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
      {
        "url": "https://token.cymoon.cn/v1/images/async/task_abc123.../content/0"
      },
      {
        "url": "https://token.cymoon.cn/v1/images/async/task_abc123.../content/1"
      }
    ]
  },
  "error": null
}
```

> `result` 是标准 OpenAI `images/generations` 响应——客户端可以把 `result` 直接喂给现有 OpenAI SDK 解析。`url` 是 keyapi 自家域名而非上游 URL（**第 6 节**详述）。

**响应**（HTTP 200，失败）：
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

**状态枚举**（与现有 task 框架一致）：
| 对外 status | 内部 `model.TaskStatus` | 触发 |
|---|---|---|
| `queued` | `Submitted` / `Queued` | 提交后未开始处理 |
| `processing` | `InProgress` | 上游同步调用中 / 上游异步轮询中 |
| `succeeded` | `Success` | 已写入 `PrivateData.ImageData` |
| `failed` | `Failure` | 上游报错或超时 |

### 3.3 内容代理：`GET /v1/images/async/:task_id/content/:index`

**用途**：按图片索引（0-based）反代上游图片。

**路由声明**：
```go
videoProxyRouter.GET("/images/async/:task_id/content/:index", media.ImageProxy)
```
（用现有 `videoProxyRouter` 路由组的 token 鉴权 + 用户隔离即可，与 `/v1/videos/:task_id/content` 同一组。）

**响应**：流式回传上游图片字节流，`Content-Type` 透传上游头（`image/png` / `image/jpeg` / `image/webp` 等）。

**错误**：
- 404：task 不存在 / 不属于当前用户 / 索引越界
- 410：上游 URL 已过期（fetch 上游报 4xx/5xx 时透传）
- 503：上游连接失败（带重试余地，错误码与 video proxy 对齐）

---

## 4. 数据模型

### 4.1 复用：`model.Task`

完全复用现有任务表，无需新表。提交时由 `relay/relay_task.go:187` 已经在做 `info.PublicTaskID = model.GenerateTaskID()`。

### 4.2 扩展：`model.TaskPrivateData`

在 `model/task.go:100` 现有结构里**新增一个字段**：

```go
type TaskPrivateData struct {
    Key            string `json:"key,omitempty"`
    UpstreamTaskID string `json:"upstream_task_id,omitempty"`
    ResultURL      string `json:"result_url,omitempty"`

    // ── 新增 ──
    // ImageData 存放 OpenAI 标准 images/generations 响应体（不含 created 字段，外层 wrap 时填）。
    // 仅图片任务使用；视频/音乐/MJ 任务此字段为空。
    // 例如：[{"url":"https://upstream..."},{"url":"..."}]
    ImageData json.RawMessage `json:"image_data,omitempty"`

    // 计费上下文等其他字段保持不变
    BillingSource  string              `json:"billing_source,omitempty"`
    BillingContext *TaskBillingContext `json:"billing_context,omitempty"`
    // ...
}
```

**为什么用 `PrivateData` 子字段而不是新表/新列**：
- `private_data` 列已经是 `type:json`（`model/task.go:65`），加新 JSON key 完全向后兼容，零迁移。
- 与 `ResultURL` 设计同源（视频单 URL 用 `ResultURL`，图片多 URL 用 `ImageData`）。
- 不污染其他任务类型——视频/音乐任务此字段恒空。

### 4.3 上游 URL 在 `ImageData` 里的存储格式

存的是**上游原始 URL**（不是 keyapi 自家代理 URL，那是 `/v1/images/async/:task_id` 响应组装时拼出来的）：

```json
[
  {"url": "https://upload.apimart.ai/f/image/.../image_task_xxx_0.png"},
  {"url": "https://upload.apimart.ai/f/image/.../image_task_xxx_1.png"}
]
```

如果上游返回 base64 而非 URL，存储格式：
```json
[
  {"b64_json": "iVBORw0KGgoAAAANS..."}
]
```
（注意：base64 一张 1024x1024 PNG 大约 1.5MB；存进数据库 JSON 列要谨慎，本期**仅在客户端明确请求 `response_format:"b64_json"` 时存**，且**不走代理**——content endpoint 直接返回 404 提示用 `:task_id` 端点拿 b64。详见 6.3。）

### 4.4 常量定义

```go
// constant/channel.go
const ChannelTypeApimart = 91   // 找一个未被占用的整数

// constant/task_platform.go
const TaskPlatformApimart TaskPlatform = "apimart"
const TaskPlatformImageSyncWrap TaskPlatform = "image_sync_wrap" // 通用兜底
```

---

## 5. 派发与适配器

### 5.1 路由层判定 platform

`POST /v1/images/async` 进入 `controller.RelayTask`，需要在中间件 `middleware.Distribute` 之后、调用 `RelayTaskSubmit` 之前确定 `platform`。逻辑：

```go
// router/relay-router.go 注册前用一个中间件设置 task_endpoint
imagesAsyncGroup := httpRouter.Group("/images/async")
imagesAsyncGroup.Use(func(c *gin.Context) {
    c.Set("task_endpoint", "image_generations")
    c.Next()
})
{
    imagesAsyncGroup.POST("", controller.RelayTask)
    imagesAsyncGroup.GET("/:task_id", controller.RelayTaskFetch)
}
```

`relay/relay_adaptor.go:120 GetTaskPlatform` 加分支：

```go
func GetTaskPlatform(c *gin.Context) constant.TaskPlatform {
    if c.GetString("task_endpoint") == "image_generations" {
        channelType := c.GetInt("channel_type")
        switch channelType {
        case constant.ChannelTypeApimart:
            return constant.TaskPlatformApimart
        default:
            return constant.TaskPlatformImageSyncWrap
        }
    }
    // 其余分支保持不变
    ...
}
```

`relay/relay_adaptor.go:135 GetTaskAdaptor` 加分支：

```go
case constant.TaskPlatformApimart:
    return &apimart.TaskAdaptor{}
case constant.TaskPlatformImageSyncWrap:
    return &syncwrap.TaskAdaptor{}
```

### 5.2 `apimart.TaskAdaptor`（上游异步范例）

文件位置：`relay/channel/task/apimart/{adaptor.go, constants.go}`

实现 `relay/channel/adapter.go:34 TaskAdaptor` 接口要点：

| 方法 | 实现 |
|---|---|
| `Init` | 缓存 `baseURL` / `apiKey` |
| `ValidateRequestAndSetAction` | 把 body 解析为 `dto.ImageRequest`，校验 `prompt` 非空、`model` 非空 |
| `EstimateBilling` | 返回 `{"n": float64(n), "size": sizeRatio(size)}` 用于价格计算 |
| `BuildRequestURL` | `baseURL + "/v1/images/generations"` |
| `BuildRequestHeader` | `Authorization: Bearer <apiKey>` + `Content-Type: application/json` |
| `BuildRequestBody` | 透传 `dto.ImageRequest` |
| `DoRequest` | 标准 HTTP POST |
| `DoResponse` | 解析 `{code:200, data:[{status:"submitted", task_id:"..."}]}`，返回 `taskID = data[0].task_id`、`taskData = 完整响应 body`（落 `model.Task.Data`） |
| `FetchTask` | `GET <baseURL>/v1/tasks/<upstream_task_id>?language=zh` |
| `ParseTaskResult` | 解析 `{data:{status, progress, result:{images:[{url:[...], expires_at}]}}}`，映射到 `relaycommon.TaskInfo`：完成时把 `images[].url[0]` 列表写入 `TaskInfo.Urls`（**TaskInfo 多 URL 字段扩展见 5.5**）|
| `AdjustBillingOnSubmit` | 返回 nil（apimart 提交无额外参数差异） |
| `AdjustBillingOnComplete` | 返回 0（保持预扣金额不变） |

`constants.go`：声明 `ChannelName = "apimart"`、`ModelList = ["gpt-image-2", "gpt-image-1.5", ...]`。

### 5.3 `syncwrap.TaskAdaptor`（上游同步通用兜底）

文件位置：`relay/channel/task/syncwrap/{adaptor.go, constants.go}`

**关键差异**：syncwrap 重新定义了 TaskAdaptor 接口里"提交"动作的语义——不向上游真发提交请求，而是直接把"调上游 + 写结果"的工作 fork 到后台 goroutine：

| 接口方法 | 同步上游适配器中的语义 |
|---|---|
| `BuildRequestURL` | 返回空字符串（不会被调用） |
| `BuildRequestHeader` | 返回 nil（不会被调用） |
| `BuildRequestBody` | 返回 `bytes.NewReader(nil)`（不会被调用） |
| `DoRequest` | 不真发 HTTP，返回一个伪 200 `*http.Response`（body 为空），仅为满足 `RelayTaskSubmit` 流程对返回值的检查 |
| `DoResponse` | 1) 返回 `taskID = info.PublicTaskID`、`taskData = nil`、`err = nil`<br>2) 同时 fork 后台 goroutine 走真实上游调用<br>3) 后续 `RelayTaskSubmit` 会按正常流程落库 task 记录（Status=Submitted） |

> 注：之所以保留 `BuildRequestURL/Header/Body` 方法签名而不直接走另一条 controller 路径，是因为复用现有 `RelayTaskSubmit` 流程（预扣 / 落库 / 派发 / 错误处理）成本最低；这些方法相当于"占位"满足接口要求。

goroutine 启动时机：在 `DoResponse` 内部启动，但**捕获本次提交所需的最小上下文**（user_id、tenant_id、channel_id、key、relayInfo 副本、本地 task ID）到 detached struct 后传给 goroutine，避免 goroutine 持有 gin context。

`runSyncUpstream` 内部：
1. 用 detached context（**不继承 gin context** —— 因为客户端 HTTP 已断开）
2. 调用 `relay.GetAdaptor(info.ApiType).DoRequest` + `DoResponse` —— 复用同步图片的整套上游适配（OpenAI / Stability / Gemini / xAI / 即梦 / 万相 / Zhipu / 文心 等所有现有 ChannelType 全免费支持）
3. 解析响应：
   - 成功：把 `{data:[{url}, ...]}` 序列化进 `task.PrivateData.ImageData`，状态置 `Success`，触发结算
   - 失败：`task.FailReason` 写入错误信息，状态置 `Failure`，触发退款
4. **关键**：调用上游同步适配器的 `DoResponse` 时**禁用其内置计费写入**——通过传一个特殊 flag 或抽出 `ImageHelper` 的"调上游"核心步骤为不带计费的版本。

> 实现细节：抽 `relay/image_handler.go` 里 `adaptor.DoRequest → DoResponse` 的核心调用为一个新函数 `relay.ExecImageUpstream(ctx, info) (responseBody []byte, usage *dto.Usage, error)`。原 `ImageHelper` 也调用它，加上前后的预扣/扣费逻辑；`syncwrap.runSyncUpstream` 调用同一个 `ExecImageUpstream`，扣费走 task 框架的 `AdjustBillingOnComplete`。

`FetchTask` / `ParseTaskResult` 实现策略（**选定方案**）：

- 在 `service/task_polling.go` 里加判断，`task.Platform == TaskPlatformImageSyncWrap` 时**跳过远程 fetch**——这类任务没有上游 task ID 可问，状态全靠后台 goroutine 自己写。
- `FetchTask` 与 `ParseTaskResult` 仍要实现以满足接口（返回错误如 `errors.New("not applicable for sync wrap")`），但永远不会被调用。这种"显式不支持"比返回伪响应更安全——一旦未来重构忘了跳过分支，会立刻 panic 而非默默错乱。

### 5.4 修改 `service/task_polling.go`

加一个分支：`platform == TaskPlatformImageSyncWrap` 的任务跳过远程 `FetchTask`，因为没有上游可查。其它逻辑（结算 / 退款 / stuck 检测）照常。

```go
// service/task_polling.go: updateVideoSingleTask 之类的更新前
if task.Platform == constant.TaskPlatformImageSyncWrap {
    // syncwrap 任务的状态由 goroutine 自己写库；轮询只负责 stuck/timeout 兜底
    if isStuck(task) {
        markFailed(task, "syncwrap goroutine timeout")
    }
    return nil
}
```

### 5.5 `TaskInfo` 扩展（多 URL 支持）

现有 `relaycommon.TaskInfo`（视频场景）只有单 `Url string`：

```go
type TaskInfo struct {
    TaskID string
    Status model.TaskStatus
    Url    string   // 单 URL
    Reason string
    // ...
}
```

新增 `Urls []string` 字段（向后兼容，单 URL 视频任务忽略此字段）：

```go
type TaskInfo struct {
    // ...existing...
    Urls []string `json:"urls,omitempty"` // 多 URL 图片任务用
}
```

`relay/relay_task.go` 里图片任务完成时优先用 `Urls` 序列化进 `task.PrivateData.ImageData`。

---

## 6. 数据流详解

### 6.1 上游异步（apimart）成功路径

```
[客户端] POST /v1/images/async {model:gpt-image-2, prompt:..., n:2}
   │
   ▼
[router] /v1/images/async → controller.RelayTask
   │
   ▼
[relay/relay_task.go RelayTaskSubmit]
   1. GetTaskPlatform → TaskPlatformApimart
   2. GetTaskAdaptor → apimart.TaskAdaptor
   3. ValidateRequestAndSetAction
   4. EstimateBilling → {n:2, size:1.0}
   5. ModelPriceHelperPerCall → 算出 quota
   6. PreConsumeBilling → 用户钱包扣 quota
   7. BuildRequestBody → 透传 ImageRequest JSON
   8. DoRequest → POST upstream/v1/images/generations
   9. DoResponse → 解析 {data:[{task_id:"task-xxx"}]}
       upstream_task_id = "task-xxx"
   10. info.PublicTaskID = task_xxx (本地)
   11. 落库 model.Task：
       PublicTaskID="task_xxx", UpstreamTaskID="task-xxx",
       Status=Submitted, Quota=预扣值, ImageData=null
   │
   ▼
[客户端拿到] {task_id:"task_xxx", status:"queued", created:...}

. . . 几秒到几十秒后 . . .

[service/task_polling.go 每 15s]
   1. 找出所有 Status ∈ {Submitted, Queued, InProgress} 的任务
   2. 按 channel 批量调 FetchTask → GET /v1/tasks/task-xxx
   3. ParseTaskResult → status=completed, urls=[url1, url2]
   4. 写 task.PrivateData.ImageData = [{"url":url1},{"url":url2}]
   5. AdjustBillingOnComplete → 0 (无差额)
   6. settleTaskBillingOnComplete → quota 不变,Status=Success
   │
   ▼
[客户端 GET /v1/images/async/:task_id]
   返回 {status:"succeeded", result:{data:[
       {url:"https://token.cymoon.cn/.../content/0"},
       {url:"https://token.cymoon.cn/.../content/1"}
   ]}}
   │
   ▼
[客户端 GET .../content/0]
   media.ImageProxy → 反代上游 url1 → 流式返回 PNG/JPG 字节流
```

### 6.2 上游同步（标准 OpenAI 等）成功路径

```
[客户端] POST /v1/images/async {model:dall-e-3, prompt:..., n:1}
   │
   ▼
[router] /v1/images/async → controller.RelayTask
   │
   ▼
[relay/relay_task.go RelayTaskSubmit]
   1. GetTaskPlatform → TaskPlatformImageSyncWrap (因 channelType 不是 apimart)
   2. GetTaskAdaptor → syncwrap.TaskAdaptor
   3-6. 同上,EstimateBilling/PreConsumeBilling 一致
   7. BuildRequestBody → 返回空 reader (占位)
   8. DoRequest → 返回伪 200 响应 (占位)
   9. DoResponse →
        a. 构造 detached snapshot {userID, tenantID, channelID, apiKey,
           imageRequest, modelName, publicTaskID, baseURL}
        b. go runSyncUpstream(snapshot)  ← 后台启动
        c. 返回 (info.PublicTaskID, nil, nil) — taskData 为空,
           RelayTaskSubmit 会照常落库 model.Task: Status=Submitted
   │
   ▼
[客户端拿到] {task_id:"task_yyy", status:"queued", created:...}

. . . goroutine 在后台 . . .

[runSyncUpstream(snapshot)]
   1. 用 detached context (5 分钟 timeout)
   2. defer recover() 兜底 panic
   3. 通过 ApiType 获取上游 sync adaptor (OpenAI / Stability / ...)
   4. 调用 ExecImageUpstream(ctx, snapshot)
        - adaptor.Init(synthetic relayInfo)
        - adaptor.ConvertImageRequest (复用现有逻辑)
        - adaptor.DoRequest (HTTP 调上游)
        - adaptor.DoResponse → 解出 dto.ImageResponse
   5. 成功:
      - 序列化 dto.ImageResponse.Data 到 task.PrivateData.ImageData
      - task.Status = Success, task.FinishTime = now
      - service.settleTaskBillingOnComplete (统一结算)
   6. 失败:
      - task.FailReason = err.Error()
      - task.Status = Failure
      - service 触发退款
   │
   ▼
[service/task_polling.go]
   - 此 task platform 是 ImageSyncWrap,跳过远程 fetch
   - 仅检查 stuck/timeout (默认 10 分钟)
   │
   ▼
[客户端 GET /v1/images/async/:task_id]
   同 6.1 末尾
```

### 6.3 内容代理详解（`media.ImageProxy`）

文件：`controller/media/image_proxy.go`（新）

逻辑（参考 `controller/media/video_proxy.go:33`）：

1. 鉴权：`c.GetInt("id")` 拿 userID（中间件已填）
2. 查任务：`model.GetByTaskId(userID, taskID)`，404 if 不存在 / 不属于此用户
3. 校验：`task.Status == Success`，否则 400 `task not completed yet`
4. 解析 `task.PrivateData.ImageData`，按 `:index` 取出对应 URL（越界 404）
5. 如果该 entry 是 `b64_json` 而非 `url`：返回 400 `inline base64 not proxyable, fetch full task`
6. 拿 `task.ChannelId` → `model.CacheGetChannel` → 渠道 proxy 设置
7. `service.GetHttpClientWithProxy` → `client.Get(upstreamUrl)`
8. 透传上游 `Content-Type` 头,流式 `io.Copy(c.Writer, resp.Body)`
9. 上游 4xx/5xx 时透传状态码 + 简化错误体

超时设置：60 秒（与 video proxy 一致）。

---

## 7. 错误处理

### 7.1 提交阶段

| 场景 | 行为 |
|---|---|
| 余额不足 | 提交时 `PreConsumeBilling` 直接 402,客户端拿不到 task_id |
| `prompt` 缺失 / `model` 缺失 | `ValidateRequestAndSetAction` 返回 400 |
| 上游异步提交失败（apimart 返非 200） | `DoResponse` 返错,触发预扣退款,客户端拿到 5xx |
| 渠道无可用 key | 同其他任务,500 + 退款 |

### 7.2 异步处理阶段

| 场景 | 行为 |
|---|---|
| 上游异步任务上游报错 | `task_polling.go` 解析到 `status=failed`,标记任务 `Failure`,退款,`task.FailReason` 写错误 |
| 上游异步任务超时（默认 10 分钟） | 现有 `task_polling.go` 的 stuck 检测兜底,标记 `Failure`,退款 |
| 上游同步 goroutine 调用上游 5xx | goroutine 写 `task.FailReason`、置 `Failure`,触发退款 |
| 上游同步 goroutine panic | `defer recover()` 兜底,标记 `Failure`,退款 |
| 上游同步 goroutine 跑超 10 分钟 | 同 stuck 检测,但因为 detached ctx 不会真的 cancel goroutine,要在 goroutine 内部加自己的 timeout(默认 5 分钟,可配置) |
| keyapi 进程重启 | 已落库的 `Submitted/InProgress` 任务在 polling 重新拉起时:apimart 类的会重新 `FetchTask`;syncwrap 类的因为 goroutine 已死,会被 stuck 检测捕获并标记失败 |

### 7.3 内容代理阶段

| 场景 | 行为 |
|---|---|
| task 不存在 / 不属于当前用户 | 404 |
| task 未完成 | 400 |
| 索引越界 | 404 |
| 上游 URL 已过期(apimart `expires_at` 已过) | 透传 410 / 404,客户端建议重新生成 |
| 上游连接失败 | 503 |

---

## 8. 计费时序

完全沿用现有 task 框架,不做新机制。关键检查点:

```
                              ┌────────────────────────┐
[T0 提交]                     │ 用户钱包                │
   PreConsumeBilling   ────▶  │ -quota_estimate        │
                              │                        │
[T1 上游成功(异步)/goroutine成功(同步)]                  │
   AdjustBillingOnComplete    │                        │
   = 0 (本期无 actual_seconds  │ (不变)                 │
   等动态参数差异)              │                        │
                              │                        │
[T1' 失败]                    │                        │
   TaskFailRefund      ────▶  │ +quota_estimate        │
                              └────────────────────────┘
```

> **不做差额结算**(本期):图片任务 quota 与 `n` 和 `size` 直接关联,这两个参数提交时已知,无视频那种"上游返回实际秒数"的差异。AdjustBillingOnComplete 永远返 0。后期若上游开始返回实际生成数量(如 apimart 的 `actual_time` 是耗时不影响价),再按需扩展。

---

## 9. 测试策略

### 9.1 单元测试

| 测试目标 | 文件 |
|---|---|
| `apimart.TaskAdaptor.DoResponse` 解析提交响应 | `relay/channel/task/apimart/adaptor_test.go` |
| `apimart.TaskAdaptor.ParseTaskResult` 状态映射(submitted/processing/completed/failed) | 同上 |
| `syncwrap.TaskAdaptor.runSyncUpstream` 用 mock upstream + memory task store 验证成功/失败/panic 三路径 | `relay/channel/task/syncwrap/adaptor_test.go` |
| `media.ImageProxy` 索引越界 / task 不属当前用户 / 状态未完成 | `controller/media/image_proxy_test.go` |
| `relay/relay_task.go` 图片任务的 `TaskInfo.Urls` 序列化进 `PrivateData.ImageData` | `relay/relay_task_test.go` |
| `controller.RelayTaskFetch` 输出 OpenAI 风格 wrap | `controller/relay_test.go` 或 `relay/relay_task_test.go` |

### 9.2 集成测试(可选,本期不强求)

跑一个 mock OpenAI 服务器:
1. 提交 → 拿 task_id
2. 轮询 GET 直到 succeeded
3. GET content → 拿到正确字节流

### 9.3 手测脚本

```bash
# 同步上游(走 syncwrap)
TASK_ID=$(curl -s ${BASE}/v1/images/async \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"model":"dall-e-3","prompt":"a cat","n":1}' | jq -r .task_id)

# 异步上游(走 apimart) — 模型路由命中 apimart 渠道
TASK_ID=$(curl -s ${BASE}/v1/images/async \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"model":"gpt-image-2","prompt":"a cat","n":2}' | jq -r .task_id)

# 轮询
while true; do
  RESP=$(curl -s ${BASE}/v1/images/async/$TASK_ID -H "Authorization: Bearer $KEY")
  STATUS=$(echo $RESP | jq -r .status)
  echo "status=$STATUS"
  [[ "$STATUS" == "succeeded" || "$STATUS" == "failed" ]] && break
  sleep 2
done

# 下载内容
curl -o image_0.png ${BASE}/v1/images/async/$TASK_ID/content/0 -H "Authorization: Bearer $KEY"
```

---

## 10. 实施步骤(实施计划交给 writing-plans)

骨架:

1. **基础设施**:`TaskPrivateData.ImageData` 字段、`TaskInfo.Urls` 字段、`TaskPlatformApimart` / `TaskPlatformImageSyncWrap` 常量、`ChannelTypeApimart` 常量
2. **抽离 sync 上游核心调用**:从 `ImageHelper` 拆出 `ExecImageUpstream(ctx, info)`,原 ImageHelper 改为它的 caller
3. **`syncwrap.TaskAdaptor`**:实现接口 + 后台 goroutine + detached ctx + panic recover
4. **`apimart.TaskAdaptor`**:实现接口 + 提交/查询/解析
5. **`GetTaskAdaptor` / `GetTaskPlatform` 派发**
6. **路由注册**:POST/GET 到 `/v1/images/async`、内容代理路由
7. **`media.ImageProxy` 实现**
8. **`task_polling.go` 加 SyncWrap 跳过远程 fetch 分支 + stuck 检测兜底**
9. **`RelayTaskFetch` 渲染**:图片任务时 wrap 成 OpenAI `result` 格式(可能要在 `fetchRespBuilders` 里加新 builder)
10. **单元测试**(每步随实现)

---

## 11. 风险与未决项

### 11.1 已识别风险

| 风险 | 缓解 |
|---|---|
| `ImageData` 字段在 `private_data` JSON 列里,大量任务的 N=10 base64 会膨胀 DB | 仅当 `response_format:b64_json` 时存,其他情况只存 URL(约 200 字节/张) |
| syncwrap goroutine 进程重启会丢失 | stuck 检测兜底标记 Failure,前端轮询会看到 failed,触发退款 |
| 与现有 `controller.Relay` 的 `recordRelayErrorForTrace` 风格不同 | 任务路径已有自己的日志体系(`relay_task.go`),按 task 风格走 |
| apimart 后续可能改 URL 路径 | 用 channel 表的 base_url 做基准,不写死 |

### 11.2 未决项(本期不阻塞,后期讨论)

- 是否给 `/v1/images/edits` 加同模式异步(需要 multipart 暂存方案)
- 是否给 `/v1/images/async` 加 webhook 回调字段
- 是否对 syncwrap 的 goroutine 数量做全局上限(避免上游慢挂死时大量 goroutine 堆积)
- 是否考虑把已完成的图片下载到对象存储以避免上游 URL 过期(C 方案的进阶版,变 B 方案)

---

## 12. 与现有功能的集成

| 现有能力 | 集成情况 |
|---|---|
| Tenant 配额 / RPM / TPM 检查 | `RelayTaskSubmit` 已经走全套检查,无需改 |
| 模型映射 | 已走 `helper.ModelMappedHelper`,无需改 |
| 敏感词检查 | 现有 task 路径已对 prompt 做检查(若启用),无需改 |
| Stream / Wss / Realtime | 不相关 |
| Trace logging | 现有 task 路径已走 `addTraceEvent` 子集,可选增强 |
| Playground (`/pg/images/generations`) | 本期 **不动**;playground 仍走同步路径。后续可选加一个 `/pg/images/async`,需求出现再做 |
