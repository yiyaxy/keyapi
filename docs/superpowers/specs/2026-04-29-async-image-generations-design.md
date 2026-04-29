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
- **结果代理**：返回的图片 URL 是 keyapi 自家域，客户端 GET 时反代上游——**用途是隐藏上游 URL、集中访问控制（鉴权/SSRF/限流/日志）、隔离上游凭据**。注意：本期不解决上游 URL 过期问题（上游 URL 过期后 keyapi 反代也会拿到 410/404，照常透传给客户端）；后期若需要永久持有，再升级到对象存储方案。
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
| **结果 URL** | C：keyapi 反代上游 | 隐藏上游 URL；集中鉴权/SSRF/限流/日志；隔离上游凭据。**不**用来解决过期(过期问题留待对象存储方案) |
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
| `queued` | `NotStart` / `Submitted` / `Queued` | 提交后未开始处理(syncwrap 任务因为 goroutine 完成前 task.Status 不会跳出 NotStart,fetch builder 必须把 NotStart 也映射成 queued) |
| `processing` | `InProgress` | 上游同步调用中 / 上游异步轮询中 |
| `succeeded` | `Success` | 已写入 `PrivateData.ImageData` |
| `failed` | `Failure` | 上游报错 / 超时 / panic |

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

### 5.1 路由层 / Distributor / Fetch Builder 注册

新端点的请求要在 distributor、relay_mode、fetch builder 三处都做注册才能 work。**不能只声明路由就完事**——现有 `httpRouter.Use(middleware.Distribute())` 会对所有 httpRouter 子路由生效,distributor 内部按 path 分发到不同处理逻辑,如果不加分支,GET fetch 会走通用 body/model 解析路径报错。

#### 5.1.1 路由声明（`router/relay-router.go`）

```go
// /v1/images/async 走 controller.RelayTask；fetch 走 controller.RelayTaskFetch
httpRouter.POST("/images/async", controller.RelayTask)
httpRouter.GET("/images/async/:task_id", controller.RelayTaskFetch)
```

> 注意:不加额外 group 或中间件——distributor 已挂在 httpRouter 上,需要 distributor 内部识别这个 path。

#### 5.1.2 新增 relay_mode 常量（`relay/constant/relay_mode.go`）

```go
const (
    RelayModeImagesAsyncSubmit     = 56xx  // 找一个未占用的整数
    RelayModeImagesAsyncFetchByID  = 56xx  // 找一个未占用的整数
)
```

#### 5.1.3 Distributor 加分支（`middleware/distributor.go: getModelRequest`）

仿照现有 `/v1/videos`、`/v1/video/generations` 的写法（参见同文件 line 264-300）:

```go
} else if strings.HasPrefix(c.Request.URL.Path, "/v1/images/async") {
    var relayMode int
    if c.Request.Method == http.MethodPost {
        relayMode = relayconstant.RelayModeImagesAsyncSubmit
        req, err := getModelFromRequest(c)
        if err != nil {
            return nil, false, err
        }
        if req != nil {
            modelRequest.Model = req.Model
        }
    } else if c.Request.Method == http.MethodGet {
        relayMode = relayconstant.RelayModeImagesAsyncFetchByID
        shouldSelectChannel = false  // ← 关键:fetch 不需要重选渠道
    }
    c.Set("relay_mode", relayMode)
}
```

#### 5.1.4 GetTaskPlatform / GetTaskAdaptor 派发（`relay/relay_adaptor.go`）

`GetTaskPlatform`(`relay/relay_adaptor.go:120`)加分支,**按 relay_mode 而非自定义 task_endpoint**(后者更易出错):

```go
func GetTaskPlatform(c *gin.Context) constant.TaskPlatform {
    relayMode := c.GetInt("relay_mode")
    if relayMode == relayconstant.RelayModeImagesAsyncSubmit ||
       relayMode == relayconstant.RelayModeImagesAsyncFetchByID {
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

`GetTaskAdaptor`(`relay/relay_adaptor.go:135`)加分支:

```go
case constant.TaskPlatformApimart:
    return &apimart.TaskAdaptor{}
case constant.TaskPlatformImageSyncWrap:
    return &syncwrap.TaskAdaptor{}
```

#### 5.1.5 注册 Fetch Response Builder（`relay/relay_task.go:303 fetchRespBuilders`）

现有 map 只有 3 个 entry:

```go
var fetchRespBuilders = map[int]func(c *gin.Context) (respBody []byte, taskResp *dto.TaskError){
    relayconstant.RelayModeSunoFetchByID:    sunoFetchByIDRespBodyBuilder,
    relayconstant.RelayModeSunoFetch:        sunoFetchRespBodyBuilder,
    relayconstant.RelayModeVideoFetchByID:   videoFetchByIDRespBodyBuilder,
}
```

新增图片任务的 builder:

```go
relayconstant.RelayModeImagesAsyncFetchByID: imageAsyncFetchByIDRespBodyBuilder,
```

`imageAsyncFetchByIDRespBodyBuilder` 实现:
1. 从 `c.Param("task_id")` 取出 PublicTaskID
2. 校验 user 拥有 task,查 `model.GetByTaskId(userID, taskID)`
3. 按 task.Status 渲染 OpenAI 风格响应(详见 3.2):
   - `NotStart/Submitted/Queued/InProgress` → `{status, progress, result:null, error:null}`(注意:syncwrap 任务在 goroutine 完成前一直处于 NotStart,需要映射为对外 `queued`/`processing`)
   - `Success` → 反序列化 `task.PrivateData.ImageData` 为 `[]map[string]any`,**按 entry 类型分别处理**:
     - 含 `"url"` 字段 → 替换为 keyapi 代理 URL(`/v1/images/async/<task_id>/content/<index>`)
     - 含 `"b64_json"` 字段 → **原样保留**,客户端通过本端点直接拿到 base64(因为 base64 本身不需要再代理一次,且 4.3 节明确 content endpoint 不代理 b64)
     - 同时含 `"revised_prompt"` 等 OpenAI 标准字段也透传
     - wrap 进 `{result:{created,data:[...]}}`
   - `Failure` → `{status:"failed", error:{message,code}, result:null}`

> **状态映射对外**:复用第 3.2 节状态枚举表的映射规则:`NotStart/Submitted/Queued` → `queued`、`InProgress` → `processing`、`Success` → `succeeded`、`Failure` → `failed`。具体在 builder 内实现一个简单 switch。

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

#### 5.3.1 任务持久化前不能启动 goroutine（race 防护）

**反模式**:在 `DoResponse` 内 `go runSyncUpstream(...)` 直接启动 goroutine。

**问题**:`controller/relay.go:1175 RelayTaskSubmit` 返回后到 `1230 task.Insert()` 之间还有结算、日志等步骤,且 1175 之后任何路径出错都会跳过 1230。如果 DoResponse 已经 spawn 了 goroutine:
- 快速成功:goroutine 可能在 `task.Insert()` 之前就尝试 update task 行 → 找不到行
- 提交后路径出错:task 永远不会 Insert,但 goroutine 还在跑 → 后续 update 永远找不到行 + 没有任务记录可被客户端查询

**选定方案**:引入可选的 `TaskPostInsert` 接口,controller 在 **`task.Insert()` 成功之后**才调用 hook,hook 内部启动 goroutine。

新接口(`relay/channel/adapter.go`):
```go
// TaskPostInsert is an optional hook for adaptors that need to perform
// background work AFTER the task row is persisted.
// Implementations MUST NOT block — they should fork a goroutine and return.
type TaskPostInsert interface {
    OnTaskInserted(ctx context.Context, task *model.Task, info *relaycommon.RelayInfo)
}
```

`controller/relay.go` 在 `task.Insert()` 成功后(line 1230 附近)加。**注意**:`adaptor` 变量在 controller 作用域里**不存在**(它是 `relay.RelayTaskSubmit` 内部局部变量),不能直接断言。两个可行做法:

**方案 A(推荐):用 `result.Platform` 重新查 adaptor**
```go
if insertErr := task.Insert(); insertErr != nil {
    common.SysError("insert task error: " + insertErr.Error())
} else if postInsertAdaptor := relay.GetTaskAdaptor(result.Platform); postInsertAdaptor != nil {
    if hook, ok := postInsertAdaptor.(channel.TaskPostInsert); ok {
        hook.OnTaskInserted(context.Background(), task, relayInfo)
    }
}
```
代价是再 new 一个 adaptor 实例,但 `GetTaskAdaptor` 的实现就是 `return &xxx.TaskAdaptor{}`,零成本。

**方案 B:`TaskSubmitResult` 加 `PostInsertHook channel.TaskPostInsert` 字段**
`RelayTaskSubmit` 在 detect 到 adaptor 实现接口时把它放进 result。Controller 直接用 `result.PostInsertHook`。多一行 result 字段,但避免类型断言重复。

**选定方案 A** —— 减少接口表面,且与现有 `relay.GetTaskAdaptor(platform)` 已被多处复用一致。

#### 5.3.2 syncwrap 各方法的语义

> **关键**:现有所有 `TaskAdaptor.DoResponse` 实现都自己调 `c.JSON(http.StatusOK, ...)` 写提交成功响应给客户端(参考 `relay/channel/task/sora/adaptor.go:255`),controller 不统一写。所以 syncwrap 的 `DoResponse` 也**必须自己写出**第 3.1 节定义的 `{task_id, status, created}` 响应,否则客户端拿到空 200 body。

| 接口方法 | 语义 |
|---|---|
| `BuildRequestURL` | 返回空字符串(不会真发请求) |
| `BuildRequestHeader` | 返回 nil |
| `BuildRequestBody` | 返回 `bytes.NewReader(nil)` |
| `DoRequest` | 返回伪 200 `*http.Response`(body 空),satisfy `RelayTaskSubmit` 对返回值的检查 |
| `DoResponse` | 1) **写客户端响应**:`c.JSON(200, gin.H{"task_id": info.PublicTaskID, "status": "queued", "created": time.Now().Unix()})`<br>2) 返回 `(taskID = info.PublicTaskID, taskData = nil, err = nil)`<br>3) **不**启动 goroutine(留给 OnTaskInserted) |
| `OnTaskInserted` *(新接口)* | 构造 detached snapshot,`go runSyncUpstream(snapshot)` |

> apimart 的 `DoResponse` 同样要自己写 `{task_id: info.PublicTaskID, status:"queued", created:...}` 给客户端(用本地 PublicTaskID 而非上游 task_id,客户端不应看到上游 ID)。可以抽个公共 helper `writeImageAsyncSubmitResponse(c, info)` 给两边用。

#### 5.3.3 goroutine 内部:`runSyncUpstream(snapshot)`

`snapshot` 至少包含:`taskPublicID`、`channelID`、`apiKey`、`baseURL`、`channelType`、`apiType`、`originModelName`、`upstreamModelName`、`imageRequestJSON`(序列化的 `dto.ImageRequest`)、`tenantID`、`userID`、`tokenID`、`priceData`(用于 settle)。

执行步骤:
1. `ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)`
2. `defer recover()` 兜底 panic,标记 task `Failure`
3. 构造合成的 `relayInfo`(从 snapshot 字段重建)
4. 重新 load task: `task, _, _ := model.GetByOnlyTaskId(snapshot.taskPublicID)` —— 因为 hook 拿到的 `task` 指针的 `Status` 字段在 controller 那一刻还是 NOT_START,goroutine 中要用最新的快照做 CAS
5. 调 `relay.ExecImageUpstream(ctx, syntheticInfo, imageRequest) → (*dto.ImageResponse, *dto.Usage, error)`
6. 成功:
   - 保存旧状态:`oldStatus := task.Status`(应该是 `NOT_START`,polling 还没动它)
   - 序列化 `dto.ImageResponse.Data` 到 `task.PrivateData.ImageData`
   - `task.Status = Success`、`task.FinishTime = now`、`task.Progress = "100%"`
   - `ok, err := task.UpdateWithStatus(oldStatus)` ← **关键:CAS 必须用 oldStatus 而非 Success,否则 0 row affected**
   - 若 `!ok`(被并发更新过,例如 polling stuck 检测把它改成 Failure 了),记日志放弃,不重复 settle
   - 否则 `service.SettleTaskBilling(taskID, actualUsage)` — 走 task 框架的统一结算
7. 失败:
   - `oldStatus := task.Status`
   - `task.FailReason = err.Error()`、`task.Status = Failure`、`task.Progress = "100%"`
   - `task.UpdateWithStatus(oldStatus)` ← 同样的 CAS 模式
   - 走 task 框架的统一退款

> **CAS 模式说明**:`Task.UpdateWithStatus(fromStatus)` 内部生成 `WHERE status = fromStatus` 条件更新(`model/task.go:415-421`)。`InitTask` 默认 status = `TaskStatusNotStart`(`model/task.go:205`)。所以 syncwrap 整个生命周期里 task 状态从 `NotStart` 直接跳到 `Success/Failure`,中间没有 `Submitted/InProgress` 中间态(因为没有上游可"提交")。

#### 5.3.4 引入 `ImageResponseExtractor`(P2 #3 修法)

**问题**:现有图片 adaptor 的 `DoResponse`(如 `relay/channel/openai/relay-openai.go:677 OpenaiHandlerWithUsage`)在解析的同时**直接写 gin Writer**(line 692 `IOCopyBytesGracefully(c, resp, responseBody)`)。后台 goroutine 没有 client 可写,也不应该假装写一个虚假的 Writer。

**方案**:引入新接口,所有支持图片生成的 adaptor 实现"只解析不写"版本:

```go
// relay/channel/adapter.go
type ImageResponseExtractor interface {
    ExtractImageResponse(resp *http.Response, info *relaycommon.RelayInfo) (
        imageResp *dto.ImageResponse,
        usage *dto.Usage,
        err *types.NewAPIError,
    )
}
```

各图片 adaptor(OpenAI / Ali / Jimeng / Zhipu / Wenxin / xAI / Gemini 等)实现 `ExtractImageResponse`,内部只读 body + 解析,**不**触碰 gin context。

`relay/image_handler.go ImageHelper` 改为:
1. 调 `adaptor.DoRequest` 拿 raw `*http.Response`
2. 调 `adaptor.ExtractImageResponse(resp, info)` 拿 `(*dto.ImageResponse, *dto.Usage, error)`
3. **由 ImageHelper 自己**把 imageResp 序列化后写 gin Writer + 触发计费

`syncwrap.runSyncUpstream` 调:
1. `adaptor.DoRequest`
2. `adaptor.ExtractImageResponse` —— **不写 gin**,直接拿 `*dto.ImageResponse` 写到 `task.PrivateData.ImageData`

新增 `relay.ExecImageUpstream(ctx, info, request) → (*dto.ImageResponse, *dto.Usage, error)` 封装步骤 1+2,两边复用。

> 迁移成本:每家现有图片渠道 adaptor 都要新增 `ExtractImageResponse` 方法。可以渐进迁移:第一期只覆盖 OpenAI / Ali / Jimeng / Wenxin 等用得上的;未实现的 adaptor `relay.ExecImageUpstream` 返 `errors.New("image extractor not implemented")`,syncwrap 失败标记任务,客户端查询会看到 failed,触发退款,不会数据错乱。

#### 5.3.5 `FetchTask` / `ParseTaskResult` 实现策略

- 在 `service/task_polling.go` 里加判断,`task.Platform == TaskPlatformImageSyncWrap` 时**跳过远程 fetch**——这类任务没有上游 task ID 可问,状态全靠后台 goroutine 自己写。
- `FetchTask` 与 `ParseTaskResult` 仍要实现以满足接口(返回错误如 `errors.New("not applicable for sync wrap")`),但永远不会被调用。这种"显式不支持"比返回伪响应更安全——一旦未来重构忘了跳过分支,会立刻 panic 而非默默错乱。

### 5.4 修改 `service/task_polling.go`

syncwrap 任务**没有上游 task ID**(UpstreamTaskID 永远为空),需要在 polling loop 中**提前跳过**。否则会撞上现有的"`UpstreamTaskID == ""` 时 bulk-mark FAILURE"逻辑(`service/task_polling.go:111-128`),syncwrap 任务在第一次轮询(15s 内)就被标记为失败。

#### 5.4.1 主轮询循环(`TaskPollingLoop`)

```go
// 在 task_polling.go:99 的 for 循环里,组装 platformTask 之前先过滤
for _, t := range allTasks {
    // syncwrap 任务由 goroutine 自己写状态,polling 不参与提交查询;
    // 仅在 stuck/timeout 时由 sweepTimedOutTasks 兜底
    if t.Platform == constant.TaskPlatformImageSyncWrap {
        continue
    }
    platformTask[t.Platform] = append(platformTask[t.Platform], t)
}
```

#### 5.4.2 stuck 检测兜底(`sweepTimedOutTasks`)

不动它 —— 现有 `sweepTimedOutTasks` 已经按 `submit_time` 与超时阈值标记 stuck 任务为 FAILURE,对所有 platform 通用。syncwrap 的 5 分钟 goroutine 内部 timeout 与外部 stuck 时长(应配置成 ≥6 分钟,留余量)双保险:
- 如果 goroutine 正常完成或超时:自己写 SUCCESS/FAILURE
- 如果 goroutine 整个挂掉(panic 未 recover、进程重启):被 sweepTimedOutTasks 兜底

#### 5.4.3 DispatchPlatformUpdate 不需要 syncwrap 分支

因为 5.4.1 已经在 platformTask 组装阶段过滤掉了 syncwrap 任务,DispatchPlatformUpdate 永远不会收到这个 platform。`syncwrap.TaskAdaptor.FetchTask` 与 `ParseTaskResult` 永不被调用,实现里 `return errors.New("not applicable for sync wrap")` 仅作为接口契约的"显式不支持"。

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
   9. DoResponse → 仅返回 (info.PublicTaskID, nil, nil)
       ← 此时不启动 goroutine!
   │
   ▼
[controller/relay.go RelayTask 主流程]
   - SettleBilling
   - LogTaskConsumption
   - task.Insert() ← 关键持久化点 (line 1230)
     初始 task.Status = NotStart (model/task.go:205 InitTask 默认值)
   - postInsertAdaptor := relay.GetTaskAdaptor(result.Platform)
     ← 重新创建一个 adaptor 实例(GetTaskAdaptor 内部 zero-cost)
   - 类型断言 channel.TaskPostInsert
   - hook.OnTaskInserted(ctx, task, info) (同步,内部只 spawn goroutine)
        └── go runSyncUpstream(snapshot)  ← 此时才启动 goroutine
   │
   ▼
[客户端拿到] {task_id:"task_yyy", status:"queued", created:...}

. . . goroutine 在后台 . . .

[runSyncUpstream(snapshot)]
   1. 用 detached context (5 分钟 timeout)
   2. defer recover() 兜底 panic
   3. 重新 load task: model.GetByOnlyTaskId(snapshot.taskPublicID)
   4. oldStatus := task.Status (= NotStart)
   5. 通过 ApiType 获取上游 sync adaptor (OpenAI / Stability / ...)
   6. 调用 relay.ExecImageUpstream(ctx, syntheticInfo, imageRequest)
      内部:
        - adaptor.Init(syntheticInfo)
        - adaptor.ConvertImageRequest (复用现有逻辑)
        - adaptor.DoRequest (HTTP 调上游)
        - adaptor.ExtractImageResponse(resp, info)  ← 不写 gin
        返回 (*dto.ImageResponse, *dto.Usage, error)
   7. 成功:
      - 序列化 dto.ImageResponse.Data 到 task.PrivateData.ImageData
      - task.Status = Success, task.FinishTime = now, task.Progress = "100%"
      - task.UpdateWithStatus(oldStatus)  ← CAS 用 oldStatus(NotStart)
      - service.SettleTaskBilling(taskID, actualUsage)
   8. 失败:
      - task.FailReason = err.Error()
      - task.Status = Failure, task.Progress = "100%"
      - task.UpdateWithStatus(oldStatus)  ← CAS 用 oldStatus(NotStart)
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

逻辑（**严格参考 `controller/media/video_proxy.go:33`,特别是它的 SSRF 校验顺序**）：

1. 鉴权：`c.GetInt("id")` 拿 userID（中间件已填）
2. 查任务：`model.GetByTaskId(userID, taskID)`,404 if 不存在 / 不属于此用户(防 IDOR)
3. 校验:`task.Status == Success`,否则 400 `task not completed yet`
4. 解析 `task.PrivateData.ImageData`,按 `:index` 取出对应 entry(越界 404)
5. 如果该 entry 是 `b64_json` 而非 `url`:返回 400 `inline base64 not proxyable, fetch full task`
6. 拿 `task.ChannelId` → `model.CacheGetChannel` → 渠道 proxy 设置
7. **SSRF 校验**(必须,与 video_proxy.go:132-137 一致):
   ```go
   fetchSetting := system_setting.GetFetchSetting()
   if err := common.ValidateURLWithFetchSetting(
       upstreamURL,
       fetchSetting.EnableSSRFProtection,
       fetchSetting.AllowPrivateIp,
       fetchSetting.DomainFilterMode,
       fetchSetting.IpFilterMode,
       fetchSetting.DomainList,
       fetchSetting.IpList,
       fetchSetting.AllowedPorts,
       fetchSetting.ApplyIPFilterForDomain,
   ); err != nil {
       imageProxyError(c, http.StatusForbidden, "server_error",
           fmt.Sprintf("request blocked: %v", err))
       return
   }
   ```
   理由:`task.PrivateData.ImageData` 里存的 URL 来自上游 / channel admin,虽然源头可信,但若 channel 被攻击者控制可写入 internal IP / 文件协议 URL,经此 endpoint 转发就成 SSRF 跳板。视频代理已经有这层防护,图片必须对齐。
8. `service.GetHttpClientWithProxy(channel.GetSetting().Proxy)` → `client.Do(req)`,超时 60s(与 video proxy 一致)
9. 透传上游 `Content-Type` 头,流式 `io.Copy(c.Writer, resp.Body)`
10. 上游 4xx/5xx 时透传状态码 + 简化错误体(走 `imageProxyError`)

> **注意:不解决上游 URL 过期问题。** apimart `expires_at` 过期后,这一步 `client.Do` 会拿到 404/410,我们透传给客户端。客户端拿到 410 后应当重新生成。本期接受这一行为。

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
| `syncwrap.TaskAdaptor.runSyncUpstream` 用 mock upstream + memory task store 验证成功/失败/panic/timeout 4 路径 | `relay/channel/task/syncwrap/adaptor_test.go` |
| `syncwrap.OnTaskInserted` 只在 `task.Insert()` 成功之后触发 goroutine(用 mock controller / hook 调用顺序断言) | 同上 |
| `syncwrap.DoResponse` 写出标准 `{task_id, status:"queued", created}` body | 同上 |
| `syncwrap.runSyncUpstream` 用 oldStatus 做 CAS — 验证 `UpdateWithStatus(NotStart)` 实际命中 1 行;若 polling 已抢先把 task 改成 Failure,verify CAS 返 false 时不触发 settle 双扣 | 同上 |
| `media.ImageProxy` 索引越界 / task 不属当前用户 / 状态未完成 / **SSRF URL 命中过滤被 403** | `controller/media/image_proxy_test.go` |
| `imageAsyncFetchByIDRespBodyBuilder` 各状态(NotStart/Submitted/Queued → queued、InProgress → processing、Success → succeeded、Failure → failed)输出 OpenAI 风格 wrap;url entry 替换代理域;**b64_json entry 原样保留** | `relay/relay_task_test.go` |
| `controller.RelayTask` 在 task.Insert 成功后用 `relay.GetTaskAdaptor(result.Platform)` 重新拿 adaptor 并触发 hook | `controller/relay_test.go` |
| `service/task_polling.go` TaskPollingLoop 跳过 `Platform == TaskPlatformImageSyncWrap` 的任务,验证不会进 bulk-FAILURE 路径 | `service/task_polling_test.go` |
| apimart.DoResponse 写客户端用 `info.PublicTaskID`,**不**透传上游 task_id | `relay/channel/task/apimart/adaptor_test.go` |
| `middleware/distributor.go` 对 `/v1/images/async` POST/GET 分别设置正确 relay_mode + `shouldSelectChannel` 行为 | `middleware/distributor_test.go` |
| `relay.ExecImageUpstream` 不写 gin context,纯返回值 | `relay/image_handler_test.go` |
| 各家图片 adaptor 的 `ExtractImageResponse` 解析正确性(OpenAI/Ali/Jimeng/...) | 各 channel 包内 `_test.go` |
| `/v1/images/generations` 同步行为回归(refactor 后行为不变) | `relay/image_handler_test.go` |

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

骨架(按依赖顺序):

1. **基础设施常量与 schema**
   - `TaskPrivateData.ImageData json.RawMessage` 字段
   - `TaskInfo.Urls []string` 字段
   - `TaskPlatformApimart` / `TaskPlatformImageSyncWrap` 常量
   - `ChannelTypeApimart` 常量
   - `RelayModeImagesAsyncSubmit` / `RelayModeImagesAsyncFetchByID` 常量

2. **新接口定义**(在 `relay/channel/adapter.go`)
   - `TaskPostInsert` 接口(P1 #2 race 修法依赖)
   - `ImageResponseExtractor` 接口(P2 #3 修法依赖)

3. **现有图片 adaptor 实现 ExtractImageResponse**(P2 #3)
   - 至少覆盖 OpenAI / Ali / Jimeng / Wenxin / xAI / Gemini
   - 现有 `DoResponse` 中的解析逻辑抽出来,DoResponse 改为 caller(走 ImageHelper 路径)
   - 未实现的 adaptor 不阻塞,运行时 ExecImageUpstream 返 not-implemented 错误

4. **抽 `relay.ExecImageUpstream`**(P2 #3)
   - 在 `relay/image_handler.go` 边上新建函数
   - 内部:`adaptor.Init → ConvertImageRequest → DoRequest → ExtractImageResponse`
   - 不写 gin context

5. **重构 `ImageHelper`**(同步路径,**保持外部行为不变**)
   - 改为调用 `ExecImageUpstream` 拿 `*dto.ImageResponse`
   - 自己负责 marshal + 写 gin Writer + 触发计费
   - 跑回归确认 `/v1/images/generations` 同步行为完全一致

6. **`syncwrap.TaskAdaptor`**(P1 #2)
   - 占位方法(BuildRequestURL/Header/Body 全空,DoRequest 返伪 200)
   - **DoResponse 必须 `c.JSON` 写 `{task_id, status:"queued", created}` 给客户端**(对齐其他 TaskAdaptor 行为,否则空 body)
   - 实现 `TaskPostInsert.OnTaskInserted`:构造 snapshot + `go runSyncUpstream`
   - `runSyncUpstream`:detached ctx + 5min timeout + panic recover + **重新 load task + 保存 oldStatus + CAS UpdateWithStatus(oldStatus)** + 调 `ExecImageUpstream` + 写结果
   - 公共 helper `writeImageAsyncSubmitResponse(c, info)` 给 syncwrap 与 apimart 共用

7. **`apimart.TaskAdaptor`**:实现完整接口
   - **DoResponse 也用 `writeImageAsyncSubmitResponse(c, info)` 写本地 PublicTaskID**(不能透传上游 task_id)

8. **`controller/relay.go RelayTask` 加 hook 调用**(P1 #2)
   - `task.Insert()` 成功后,**用 `relay.GetTaskAdaptor(result.Platform)` 重新拿 adaptor 实例**(controller 作用域无 adaptor 变量)
   - 类型断言 `channel.TaskPostInsert`,有则调 `OnTaskInserted(ctx, task, info)`

9. **派发**:`GetTaskAdaptor` / `GetTaskPlatform` 加分支(按 relay_mode 判断图片任务)

10. **Distributor 加图片 async 分支**(P1 #1)
    - `middleware/distributor.go: getModelRequest` 加 `/v1/images/async` 处理
    - POST 取 model + 设置 RelayModeImagesAsyncSubmit
    - GET 设置 RelayModeImagesAsyncFetchByID + `shouldSelectChannel = false`

11. **Fetch builder 注册**(P1 #1)
    - `relay/relay_task.go: fetchRespBuilders` 注册 `imageAsyncFetchByIDRespBodyBuilder`
    - 实现 builder:按 task.Status 渲染 OpenAI `result` 包装
    - **状态映射** NotStart/Submitted/Queued → queued、InProgress → processing、Success → succeeded、Failure → failed
    - **entry 类型分类处理**:含 `url` 字段替换代理地址、含 `b64_json` 字段原样保留

12. **路由声明**:`router/relay-router.go` 加 POST/GET `/v1/images/async`、内容代理路由

13. **`media.ImageProxy` 实现**(P2 #4)
    - 严格参照 `video_proxy.go`:user 隔离、status 校验、SSRF 校验、proxy client、流式回传

14. **`task_polling.go` 跳过 syncwrap fetch + stuck 兜底**
    - **TaskPollingLoop 主循环里在组装 platformTask 之前过滤掉 `Platform == TaskPlatformImageSyncWrap` 的任务**(否则 UpstreamTaskID 为空会被 bulk-mark FAILURE)
    - sweepTimedOutTasks 不动,自然兜底 stuck 的 syncwrap 任务

15. **单元测试**(每步随实现):
    - extractor 接口的几家 adaptor parse 正确性
    - syncwrap OnTaskInserted hook 在 task.Insert 之前不被调用(用 mock controller)
    - syncwrap goroutine 成功/失败/panic/超时 4 路径
    - apimart adaptor parse 正确性
    - image proxy 各错误路径 + SSRF 命中

---

## 11. 风险与未决项

### 11.1 已识别风险

| 风险 | 缓解 |
|---|---|
| `ImageData` 字段在 `private_data` JSON 列里,大量任务的 N=10 base64 会膨胀 DB | 仅当 `response_format:b64_json` 时存,其他情况只存 URL(约 200 字节/张) |
| syncwrap goroutine 进程重启会丢失 | stuck 检测兜底标记 Failure,前端轮询会看到 failed,触发退款 |
| 与现有 `controller.Relay` 的 `recordRelayErrorForTrace` 风格不同 | 任务路径已有自己的日志体系(`relay_task.go`),按 task 风格走 |
| apimart 后续可能改 URL 路径 | 用 channel 表的 base_url 做基准,不写死 |
| `ImageResponseExtractor` 渐进迁移期间未实现的 adaptor 用 syncwrap 会失败 | `ExecImageUpstream` 返显式 not-implemented 错误;syncwrap 标记任务 Failure + 退款,客户端看到 failed 不会数据错乱;一期先覆盖主要图片 channel(OpenAI / Ali / Jimeng / Wenxin / xAI / Gemini),其余按用量优先级补 |
| 上游 URL 已过期(apimart `expires_at` 过) | 客户端访问 content endpoint 时拿到 410/404 透传,客户端应重新生成。**本期接受**;若不可接受需走对象存储方案(11.2 未决项) |
| `TaskPostInsert` hook 是同步调用,如果实现不慎 block 会拖慢 controller 主流程 | 接口注释明确 `MUST NOT block`;syncwrap 实现里只做 snapshot 构造然后 `go runSyncUpstream`,本身耗时 <1ms |
| syncwrap goroutine 与 sweepTimedOutTasks 可能竞争同一 task | 用 `Task.UpdateWithStatus(oldStatus)` CAS 保护:任一方先改成功,另一方拿到 0 row affected,放弃后续 settle/refund;统一防 双扣/双退 |
| goroutine 用 `model.GetByOnlyTaskId` 重新 load task 而非用 hook 传进来的 `*Task`,因为 hook 拿到的指针 `Status` 字段可能在网络往返中已被 sweepTimedOutTasks 改写 | 设计明确要求 reload;不依赖 hook 传入的 Status |

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
