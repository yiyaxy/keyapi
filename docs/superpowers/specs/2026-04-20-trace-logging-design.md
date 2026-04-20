# 日志链路追踪(Goroutine-Local TraceId)— 设计文档

> 日期:2026-04-20
> 基于分支:`dev`(commit `b66b0fd`)
> 关联背景:现有 `model/gorm_logger.go`、`common/sys_log.go`、`logger/logger.go`、`middleware/logger.go` 各自独立打日志,格式不一致,后台任务产生的 SQL 日志无法与业务/系统日志关联。
>
> **v1 Scope**:在不改动 353+ 处 `DB.XXX` 调用的前提下,给 SQL / SYS / 业务 / Gin HTTP 四类日志加上统一的 TraceId 与毫秒时间戳,实现"`grep <traceId>` 串起一次请求或一次任务的全链路"。
> **v1 不做**:结构化日志(zap/zerolog)、span 嵌套、请求结束汇总行、日志查看 UI。

---

## 1. 背景与目标

### 1.1 现状

- `logger/logger.go` 业务日志带 `RequestId`(从 `ctx.Value(common.RequestIdKey)` 读),时间格式 `2006/01/02 - 15:04:05`(秒级)。
- `model/gorm_logger.go` SQL 日志带耗时 / 行数 / 调用位置,但**没有 TraceId**,**没有绝对时间戳**(只有 elapsed)。`Trace(ctx, ...)` 的 `ctx` 参数被丢弃(`_`)。
- `common/sys_log.go` SYS 日志只有时间戳,**没有 TraceId**。
- `middleware/logger.go` Gin HTTP 日志带 RequestId、tag、耗时、IP、method、path,时间秒级。
- `middleware/request-id.go` 为每个 HTTP 请求生成 RequestId,写入 `gin.Context` 和 `http.Request.Context()`。
- 项目有 353 处直接使用全局 `model.DB` 的调用,只有 2 处用 `db.WithContext(c)`。后台任务(定时器调度的 gopool.Go)完全没有 context 链路。
- 45 处 `gopool.Go(...)`、27 处 `go func()` 为潜在的 goroutine 入口。

### 1.2 本次目标(v1)

- **日志统一写入口**:SQL / SYS / 业务 / Gin HTTP 四类日志全部走 `gin.DefaultWriter` / `gin.DefaultErrorWriter`,受 `LogWriterMu` 保护,**同一份日志文件里可 `grep`**
- **明确覆盖范围**:
  - **完全覆盖**:HTTP 主链路(RequestId middleware 之后的所有同步调用)、`main.go` 内所有长驻后台任务入口(见 3.4 清单)、启动阶段
  - **部分覆盖**:HTTP 请求内部通过 `gopool.Go` / `go func()` 起的异步 goroutine(如 relay 流处理),仅当调用方显式改用 `trace.GoInherit(...)` 包装时才带 trace,否则显示 `"-"`。v1 不强制迁移这些点
- **统一时间戳**:所有日志使用 `2006/01/02 15:04:05.000`(毫秒精度)
- **无侵入获取 TraceId**:基于 goroutine-local 存储,不改 DB 调用点,不改现有业务代码签名
- **三类 TraceId 前缀**:`HTTP-*`(请求)、`JOB-<name>-*`(后台任务)、`SYS-*`(启动 / 未命名任务兜底)
- **降级安全**:`trace.Get()` 任何情况返回 `"-"`;`logger.Log*` 面对 `nil` context 也必须安全降级,不 panic

### 1.3 v1 明确不做

- 切换到 zap / zerolog 等结构化日志库
- TraceId 的父子 span 嵌套 / 分布式传播(跨进程)
- 请求 / 任务结束时输出汇总行(SQL 次数、总耗时等)
- 日志查看 / 聚合 UI
- 改动现有 353+ 处 `DB.XXX` 为 `DB.WithContext(ctx)`
- 包装所有 72 处 `gopool.Go` / `go func()`(只包装明确的后台任务入口)

---

## 2. 关键决策记录

| 决策项 | 选择 | 理由 |
|--------|------|------|
| **TraceId 传递机制** | Goroutine-Local(通过 `github.com/timandy/routine`) | 项目 353 处 `DB.XXX` 不用 `WithContext`,Context 传递要改动巨大;goroutine-local 是零改动最优解 |
| **库选择** | `github.com/timandy/routine` | 专为 Java 风格 ThreadLocal 设计,支持 `InheritableThreadLocal`,国内 Go 项目使用广泛,久经验证 |
| **继承边界(重要)** | **只有 `routine.Go(fn)` / `routine.WrapTask(fn).Run()` / `trace.GoJob` / `trace.GoInherit` 这四种包装启动的子 goroutine 才继承父 trace。** 原生 `go func() { ... }` 和 `gopool.Go(...)` **一律不继承**,子 goroutine 中 `trace.Get()` 返回 `"-"` | `timandy/routine` 的 `InheritableThreadLocal` 只在自己的 `routine.Go` 里 snapshot + restore,Go 本身不提供 goroutine 继承 hook。spec 所有假设都建立在这个边界上 |
| **TraceId 格式** | `<前缀>-<8位hex>`,最长 `JOB-<name>-<hex>`(name ≤ 10) | 可读、定宽、`grep` 友好;8 位 hex ≈ 40 亿空间,运行时段内足够唯一 |
| **TraceId 列宽** | 22 字符左对齐 | 视觉扫齐,长于 22 的名字会打破对齐但仍能读 |
| **时间戳格式** | `2006/01/02 15:04:05.000`(本地时区) | 保留现有格式风格,只是加毫秒;本地时区对单机运维友好 |
| **GORM Trace() ctx 参数** | 继续忽略(`_ ctx`) | 业务代码不传 ctx,读 ctx 拿不到;统一走 goroutine-local |
| **未 Set 时的返回值** | `"-"`(左对齐填空格到 22) | 视觉占位,不影响对齐 |
| **业务日志 fallback** | `logger.LogInfo(ctx, ...)` 优先从 ctx 取,ctx 里没有再读 goroutine-local | 保留现有 API;兼容旧调用 |
| **随机源** | `crypto/rand`,失败回退 `math/rand` | TraceId 不是安全敏感字段,但 crypto 质量更好;回退保证不阻塞 |
| **颜色** | 保留现有 GORM 的灰/黄/红 ANSI 配色 | 终端可读性好,Windows 终端 / 写入文件时少量乱码可接受 |

---

## 3. 架构设计

### 3.1 新增包 `common/trace/`

```go
// common/trace/trace.go
package trace

import (
    "crypto/rand"
    "encoding/hex"
    mrand "math/rand"
    "sync/atomic"

    "github.com/timandy/routine"
)

const (
    prefixHTTP = "HTTP"
    prefixJob  = "JOB"
    prefixSys  = "SYS"

    // 未 Set 时的兜底值;选用单个短横线,定宽对齐后变成 "- " * N
    unsetMarker = "-"
)

var traceLocal = routine.NewInheritableThreadLocal[string]()

// Get 返回当前 goroutine 的 TraceId;未 Set 时返回 "-"
func Get() string {
    v := traceLocal.Get()
    if v == "" {
        return unsetMarker
    }
    return v
}

// Set 写入当前 goroutine 的 TraceId
func Set(id string) {
    traceLocal.Set(id)
}

// Clear 清空当前 goroutine 的 TraceId(长生命周期 goroutine 循环中使用)
func Clear() {
    traceLocal.Remove()
}

// NewHTTP 生成 HTTP 请求 TraceId,如 "HTTP-a3f2c1b8"
func NewHTTP() string {
    return prefixHTTP + "-" + randHex8()
}

// NewJob 生成后台任务 TraceId,如 "JOB-subreset-b9e8d2c1"
// name 建议 ≤ 10 字符,长度更长也能用,只是视觉对齐会错位
func NewJob(name string) string {
    return prefixJob + "-" + name + "-" + randHex8()
}

// NewSys 生成系统任务 TraceId(启动、未命名 goroutine 兜底)
func NewSys(name string) string {
    return prefixSys + "-" + name + "-" + randHex8()
}

// GoJob 在新 goroutine 中为这次执行启动一条全新的 JOB-<name>-<hex> trace。
// 语义明确:无论父 goroutine 是否已有 trace,都生成新的 JOB trace,不继承。
// 场景:长驻后台任务、定时调度入口(main.go 里的 loop 启动点)。
// 执行完成后自动 Clear,不污染 gopool worker 池。
// 实现:内部用 routine.Go(...) 启动;进入后第一件事就是 Set(新 JOB id),把可能继承来的值覆盖掉。
func GoJob(name string, fn func())

// GoInherit 在新 goroutine 中继承父 goroutine 的 TraceId 执行 fn。
// 父 goroutine 未设置时,子 goroutine 也是未设置状态(Get 返回 "-")。
// 场景:HTTP 请求内部起的辅助 goroutine,希望日志继续带 HTTP-xxx 前缀(如 relay 流处理)。
// 实现:用 routine.Go(...) 启动,靠 InheritableThreadLocal 自动继承。
// 执行完成后自动 Clear(显式写,不依赖父值)。
func GoInherit(fn func())
```

**`randHex8` 实现**:crypto/rand 读 4 字节 → hex.EncodeToString;crypto 失败时用 `mrand.Uint32` 兜底。

### 3.2 抽取统一格式化 helper

新增 `common/log_format.go`:

```go
package common

import (
    "fmt"
    "time"

    "github.com/QuantumNous/new-api/common/trace"
)

const TraceColumnWidth = 22

// FmtLogTime 返回毫秒精度时间戳,如 "2026/04/20 15:13:09.123"
func FmtLogTime(t time.Time) string {
    return t.Format("2006/01/02 15:04:05.000")
}

// FmtTrace 返回定宽左对齐的 TraceId 字符串(22 字符)
func FmtTrace() string {
    return fmt.Sprintf("%-*s", TraceColumnWidth, trace.Get())
}
```

放在 `common/` 而非 `common/trace/`,避免 `logger` / `middleware` / `model` 包对 `common/trace` 产生循环依赖(trace 包保持零依赖)。

### 3.3 各日志器改动

#### `model/gorm_logger.go`

**两处关键修改**:

1. **接入统一 writer**:当前实现用 `fmt.Printf` 直接写 stdout,绕过了 `gin.DefaultWriter` / `gin.DefaultErrorWriter` 和 `LogWriterMu`,导致 SQL 日志不进入日志轮转文件,也不与其他日志互斥写。改为通过 `LogWriterMu.RLock()` 向 `gin.DefaultWriter`(正常 / 慢查询)和 `gin.DefaultErrorWriter`(错误)写入。这是 v1 "`grep <traceId>` 串起完整链路"能成立的必要前提。
2. **加时间 + trace 列**:`Trace()` 三个 case(正常 / 慢查询 / 错误)的输出都加 `FmtLogTime(time.Now())` 和 `FmtTrace()` 两列。

示例(正常 SQL,Info 级别):

```go
common.LogWriterMu.RLock()
_, _ = fmt.Fprintf(gin.DefaultWriter,
    "%s[SQL]%s %s | %s | %s | %s%s%s | %s\n",
    cGray, cReset,
    common.FmtLogTime(time.Now()),
    common.FmtTrace(),
    formatTimeAndRows(elapsed, rows),
    cGray, caller, cReset,
    sql,
)
common.LogWriterMu.RUnlock()
```

错误行走 `gin.DefaultErrorWriter`,保持与 `logger.LogError` 一致。

#### `common/sys_log.go`

`SysLog` / `SysError` / `FatalLog` 改为:

```go
fmt.Fprintf(w, "[SYS] %s | %s | %s\n", FmtLogTime(t), FmtTrace(), s)
```

#### `logger/logger.go`

`logHelper` 改:

```go
func logHelper(ctx context.Context, level string, msg string) {
    var id string
    if ctx != nil {
        if v, ok := ctx.Value(common.RequestIdKey).(string); ok {
            id = v
        }
    }
    if id == "" {
        id = trace.Get()  // fallback 到 goroutine-local;未设置时内部返回 "-"
    }
    now := time.Now()
    // ... writer 选择逻辑不变 ...
    _, _ = fmt.Fprintf(writer, "[%s] %s | %-*s | %s\n",
        level, common.FmtLogTime(now), common.TraceColumnWidth, id, msg)
}
```

**关键防御性检查**:`ctx != nil` 判断必须加——仓库里已有 `logger.LogError(nil, ...)` 调用点(至少 `dto/gemini.go:131/138/155`),伪码里直接 `ctx.Value(...)` 会 panic,违背 "降级安全" 目标。这是本次改造 **不能缺** 的一步。

注意:这里直接用 `id`(可能是 `HTTP-xxx` 或 fallback 的 `-`),不调用 `FmtTrace()`,因为 `FmtTrace()` 只读 goroutine-local,而这里 ctx 的 RequestId 是主源。

#### `middleware/logger.go`

`SetUpLogger` 的 format 字符串加 TraceId 列和毫秒时间:

```go
return fmt.Sprintf("[GIN] %s | %-*s | %s | %3d | %13v | %15s | %7s %s\n",
    common.FmtLogTime(param.TimeStamp),
    common.TraceColumnWidth, requestID,
    tag,
    param.StatusCode,
    param.Latency,
    param.ClientIP,
    param.Method,
    param.Path,
)
```

#### `middleware/request-id.go`

请求进入时,除了 `c.Set` 和 `ctx.WithValue`,额外调用 `trace.Set(id)`:

```go
func RequestId() func(c *gin.Context) {
    return func(c *gin.Context) {
        id := "HTTP-" + randHex8()  // 用 trace 包的格式,替换原 GetTimeString + _bp + random 拼接
        c.Set(common.RequestIdKey, id)
        ctx := context.WithValue(c.Request.Context(), common.RequestIdKey, id)
        c.Request = c.Request.WithContext(ctx)
        c.Header(common.RequestIdKey, id)
        trace.Set(id)
        defer trace.Clear()
        c.Next()
    }
}
```

**注意**:原先的 RequestId 格式是 `GetTimeString + 4字节hash + 8字节随机`,约 20+ 字符;新格式 `HTTP-<8hex>` 更短更可读,但**改变了 Header `X-Request-Id` 返回给客户端的格式**。如果有外部系统依赖旧格式,需要保留原格式,这里取舍选新格式(理由:客户端一般不解析 RequestId 内容,只做透传)。

### 3.4 后台任务入口改造

**改造原则**:v1 **完全覆盖 `main.go` 启动的所有长驻 goroutine**,每个入口用以下两种方式之一:

- 方式 A(推荐,新代码):把 `go fn()` / `gopool.Go(fn)` 替换为 `trace.GoJob("<name>", fn)`
- 方式 B(已有函数,不想改调用点):在被调用函数开头加 `trace.Set(trace.NewJob("<name>")); defer trace.Clear()`

**`main.go` 长驻 goroutine 完整清单**(来自 `main.go:80–180`):

| # | 启动点(main.go) | 任务函数 | 任务名 (name) |
|---|-------------------|----------|----------------|
| 1 | L88(`go func` 包含 `go func` 嵌套) | `model.InitChannelCache` | `chcacheinit` |
| 2 | L98 | `model.SyncChannelCache` | `chcachesync` |
| 3 | L102 | `model.SyncOptions` | `optsync` |
| 4 | L105 | `model.UpdateQuotaData` | `quotaupdate` |
| 5 | L112 | `channel.AutomaticallyUpdateChannels` | `chupdate` |
| 6 | L115 | `channel.AutomaticallyTestChannels` | `chtest` |
| 7 | L118 | `service.StartCodexCredentialAutoRefreshTask` | `codexref` |
| 8 | L121 | `service.StartSubscriptionQuotaResetTask` | `subreset` |
| 9 | L125 | `model.StartSiteRPMSnapshotWriter` | `rpmsnap` |
| 10 | L130 | `service.InvoiceQueryWorker` | `invquery` |
| 11 | L143 | `channel.StartChannelUpstreamModelUpdateTask` | `chupstream` |
| 12 | L147 | `service.StartTenantAlertSweepLoop` | `tenalert` |
| 13 | L151 | `service.StartTenantBillingAndPlanLoop` | `tenbill` |
| 14 | L155 | `payment.StartPaymentReconcileLoop` | `payrecon` |
| 15 | L161 | `media.UpdateMidjourneyTaskBulk` | `mjpoll` |
| 16 | L164 | `media.UpdateTaskBulk` | `taskpoll` |
| 17 | L175 | pprof http server | `pprof` |
| 18 | L178 | `common.Monitor` | `monitor` |
| 19 | `model.InitBatchUpdater`(L171)内部起的 goroutine | 按实际函数名 | `batchupdate` |

**实现要点**:
- #11 `StartChannelUpstreamModelUpdateTask` 和 #7 `StartCodexCredentialAutoRefreshTask` / #8 `StartSubscriptionQuotaResetTask` 等是**函数内部**起 goroutine(不在 main.go 里直接 go),走方式 B,改对应函数
- main.go 里直接 `go ...` / `gopool.Go(...)` 的点(#1–#6、#9、#10、#12–#18)走方式 A,改 main.go
- **上线前 checklist**:静态扫一遍 `main.go` 里所有 `go ` 和 `gopool.Go`,每一处必须对应到上表某行,否则漏了

**启动阶段**:
- `main.go` 进入 `main()` 时调用 `trace.Set(trace.NewSys("bootstrap"))`,覆盖所有初始化期间的同步 SQL / SYS 日志
- 在 HTTP server 启动前 `trace.Clear()`,避免 bootstrap trace 污染主 goroutine 后续行为

**v1 不包装的 goroutine(显式声明为"部分覆盖")**:
- HTTP 请求 handler 内部起的辅助 goroutine(relay 流处理、异步扣费、日志投递等),涉及 `controller/relay.go`、`relay/channel/api_request.go`、`relay/helper/stream_scanner.go` 等至少 **20+ 处**
- 这些点的子 goroutine 中 `trace.Get()` 返回 `"-"`,日志链路在异步边界处中断
- **后续专题迁移**:按使用频率排序,每个迁移点改 `gopool.Go(fn)` → `trace.GoInherit(fn)`,一次改一个包,纳入独立 PR。v1 不做,但在文档里留言让后续工程师知道这里是已知缺口

### 3.5 依赖

`go.mod` 新增:

```
require github.com/timandy/routine v1.1.5
```

(实际版本取最新 stable)

---

## 4. 数据流 / 序列图

```
HTTP 请求链路(同步部分完全覆盖):
  Client ──→ Gin
             └→ RequestId middleware: trace.Set("HTTP-a3f2c1b8")  + defer trace.Clear()
                └→ Handler(同步)
                   └→ DB.Find(...) → GORM Trace 回调读 trace.Get() → "HTTP-a3f2c1b8"
                   └→ logger.LogInfo(ctx, ...) → 读 ctx RequestId → "HTTP-a3f2c1b8"
                   └→ common.SysLog(...) → 读 trace.Get() → "HTTP-a3f2c1b8"
                └→ Handler 内部 gopool.Go(...) / go func():
                   └→ 子 goroutine 中 trace.Get() → "-"   (⚠ v1 不覆盖)
                   (要带 trace 必须显式改成 trace.GoInherit(...))

后台任务链路(main.go 启动点完全覆盖):
  main → trace.GoJob("subreset", service.StartSubscriptionQuotaResetTask)
         └→ routine.Go:
            ├→ trace.Set("JOB-subreset-b9e8d2c1")
            ├→ fn() 执行期间:
            │   └→ DB.Find(...) → GORM 日志 "JOB-subreset-b9e8d2c1"
            │   └→ common.SysLog(...) → "JOB-subreset-b9e8d2c1"
            └→ defer trace.Clear()

启动阶段:
  main() 入口 → trace.Set(trace.NewSys("bootstrap"))
         ├→ model.InitDB() → SQL 日志 "SYS-bootstrap-c1d3e5f7"
         ├→ model.InitOptions() → 同上
         └→ HTTP server Run 前 → trace.Clear()
            (避免 main goroutine 后续行为继续带 bootstrap 标签)
```

---

## 5. 错误处理与降级

| 场景 | 行为 |
|------|------|
| `trace.Get()` 在未 Set 的 goroutine 调用 | 返回 `"-"`,不 panic |
| `timandy/routine` 内部 panic(Go 版本不兼容的极端情况) | `Get()` 加 `defer recover`,回退返回 `"-"` |
| `crypto/rand` 失败 | `randHex8` 回退 `mrand.Uint32`,继续生成 |
| 后台任务忘记 `trace.NewJob` | 日志显示 `"-"`,可定位但不好读;3.4 的 checklist 要求逐个核对 main.go,plan 阶段兜底 |
| HTTP 请求内异步(`gopool.Go` / 裸 `go func`)的子 goroutine | 日志显示 `"-"`,**v1 明确不覆盖**,属已知缺口,后续专项迁移到 `trace.GoInherit` |
| `logger.Log*` 传入 `nil` ctx(例如 `dto/gemini.go`) | `logHelper` 走 `ctx == nil` 分支 → fallback 到 `trace.Get()` → `"-"`;不 panic |
| 日志输出并发安全 | 沿用现有 `LogWriterMu` 读写锁;GORM logger 从 `fmt.Printf` 改为 `gin.DefaultWriter` 后也受该锁保护 |

---

## 6. 测试策略

### 6.1 单元测试

**`common/trace/trace_test.go`**:
- `Set` / `Get` / `Clear` 往返正确
- 未 Set 时 `Get` 返回 `"-"`
- `NewHTTP` / `NewJob` / `NewSys` 返回值前缀正确,hex 部分长度 8
- `NewJob("subreset")` 返回符合 `^JOB-subreset-[0-9a-f]{8}$`
- **继承测试**:父 goroutine Set,用 `routine.Go` 起子 goroutine,子读到父值
- **隔离测试**:两个并发 goroutine 用 `sync.WaitGroup` 同步,各自 Set 不同值,互不污染

**`common/log_format_test.go`**:
- `FmtLogTime` 对固定 `time.Time` 输出 `2006/01/02 15:04:05.000` 格式
- `FmtTrace` 在 goroutine-local 未 Set 时返回 `"- " * N`(22 字符),Set 后返回左对齐到 22 的字符串

**`logger/logger_test.go`**(新增或扩充):
- `LogError(nil, "...")` 不 panic,输出里 trace 列是 `"-"`
- `LogInfo(ctx_with_requestid, "...")` 输出包含该 RequestId
- `LogInfo(context.Background(), "...")` 且 goroutine-local 有 trace → 输出包含 `trace.Get()` 的值

### 6.2 集成测试

**`model/gorm_logger_test.go`**(新增):
- 打开 sqlite in-memory DB,替换 GORM logger 为 `prettyGormLogger`
- 重定向 stdout 到 buffer
- Case 1:`trace.Set("TEST-abcd1234")` → `db.Create(...)` → buffer 含 `"TEST-abcd1234"`
- Case 2:不 Set → buffer 含 `"-"` 对齐后的字符串
- Case 3:错误 SQL → 日志含 `[SQL ERR]` + trace + 错误信息

### 6.3 手工验证清单(不自动化)

- [ ] 启动 server,请求 `/api/user/self`,Gin / 业务 / SQL 日志 TraceId 一致
- [ ] 等后台任务触发,SQL / SYS 日志带 `JOB-<name>-*` 前缀
- [ ] `grep HTTP-<id>` 完整拉出一次请求的所有相关日志
- [ ] **日志文件统一性**:查看 `$LOG_DIR/oneapi-*.log`,SQL 行和 SYS 行都在同一份文件里(验证 GORM 已接入 `gin.DefaultWriter`)
- [ ] **nil ctx 不 panic**:触发 `dto/gemini.go` 里 `logger.LogError(nil, ...)` 的路径(发一次带错误 tools 的 Gemini 请求),server 应正常返回 4xx,不应 crash
- [ ] `DEBUG=true` 下打开 Info 级别,所有 SQL 都有 TraceId
- [ ] `DEBUG=false` 下关闭 Info,只有慢查询 / 错误有 TraceId 列(格式仍对齐)
- [ ] 启动阶段所有 bootstrap 期的 SQL / SYS 日志前缀是 `SYS-bootstrap-*`

### 6.4 不测

- `timandy/routine` 自身的 runtime hack 正确性(上游测过)
- 所有 10+ 个后台任务入口的实际触发(挑 2 个代表性的,其他手工确认)
- 时区 / DST 边界

---

## 7. 文件改动清单(落地执行用)

| # | 文件 | 改动类型 | 说明 |
|---|------|---------|------|
| 1 | `go.mod` | 新增依赖 | 加 `github.com/timandy/routine` |
| 2 | `common/trace/trace.go` | 新建 | `Set` / `Get` / `Clear` / `NewHTTP` / `NewJob` / `NewSys` / `GoJob` / `GoInherit` |
| 3 | `common/trace/trace_test.go` | 新建 | 单元测试 |
| 4 | `common/log_format.go` | 新建 | `FmtLogTime` / `FmtTrace` |
| 5 | `common/log_format_test.go` | 新建 | 格式化测试 |
| 6 | `common/sys_log.go` | 修改 | `SysLog` / `SysError` / `FatalLog` 加时间毫秒 + trace 列 |
| 7 | `logger/logger.go` | 修改 | `logHelper` 加毫秒 + ctx fallback trace |
| 8 | `middleware/logger.go` | 修改 | Gin format 加毫秒 + trace 定宽列 |
| 9 | `middleware/request-id.go` | 修改 | `trace.Set` + `defer trace.Clear`;RequestId 格式改 `HTTP-<hex8>` |
| 10 | `model/gorm_logger.go` | 修改 | 三个 case 的 Printf 加时间 + trace 列 |
| 11 | `model/gorm_logger_test.go` | 新建 | 集成测试(含 writer 统一性) |
| 11.5 | `logger/logger_test.go` | 新建或扩充 | 覆盖 nil ctx / ctx-with-id / goroutine-local fallback 三种路径 |
| 12 | `main.go` | 修改 | (a) 启动起点 `trace.Set(trace.NewSys("bootstrap"))`,HTTP server 启动前 `trace.Clear()`;(b) 将 L88–L178 间的 14+ 处 `go ...` / `gopool.Go(...)` 按 3.4 表改为 `trace.GoJob("<name>", ...)` |
| 13 | `service/subscription_reset_task.go` | 修改 | 入口函数开头 `trace.Set(trace.NewJob("subreset")); defer trace.Clear()` |
| 14 | `service/codex_credential_refresh_task.go` | 修改 | 同上,`codexref` |
| 15 | `controller/channel/upstream_update.go`(`StartChannelUpstreamModelUpdateTask`) | 修改 | 同上,`chupstream` |
| 16 | `service/invoice_query_worker.go`(按实际文件)| 修改 | 同上,`invquery` |
| 17 | `model/batch_updater.go`(按实际文件,`InitBatchUpdater` 内部 goroutine)| 修改 | 同上,`batchupdate` |

**实际执行时 #13–#17 文件名 / 函数位置以 plan 阶段核实为准**。plan 阶段必须完成:
- 逐个验证 3.4 清单 19 行对应的真实源码位置
- 扫 `main.go` 所有 `go ` / `gopool.Go`,每一处必须对应表中一行,无漏网
- 识别函数"内部"起 goroutine 的情况(方式 B),补入改动清单

---

## 8. 风险与缓解

| 风险 | 可能性 | 影响 | 缓解 |
|------|--------|------|------|
| `timandy/routine` 在 Go 1.25 上运行异常 | 低 | 中 | CI 跑现有测试套件 + 新增 trace 单元测试;若出问题回退到选项 B(goid + sync.Map) |
| 大量日志 I/O 压测性能下降 | 低 | 低 | 仅新增 1 次 goroutine-local 读 + 1 次 `fmt.Sprintf`,ns 级 |
| `main.go` 长驻 goroutine 漏包装 | 低 | 中 | 3.4 有完整清单 + 上线前 checklist 要求逐个核对;漏一个某类任务 SQL/SYS 显示 `"-"` |
| HTTP 请求内部异步 goroutine 不继承(已知缺口) | 高 | 中 | v1 **显式不覆盖**,日志中异步部分显示 `"-"`;后续独立 PR 按使用频率迁移到 `trace.GoInherit`。文档里明确告知工程师此边界 |
| RequestId 格式变化破坏外部依赖 | 低 | 中 | 若确实有外部系统用旧格式,可保留原生成逻辑,只加 `trace.Set` 调用 |
| `gopool` worker 池复用 goroutine 时继承"幽灵 trace" | 中 | 低 | `trace.GoJob` / `trace.GoInherit` 强制 `defer trace.Clear()`;未包装的裸 `gopool.Go` 不受 TraceLocal 影响(routine 库对它们不起作用) |
| 接入 `gin.DefaultWriter` 后 SQL 日志数量暴增、写入速度瓶颈 | 低 | 中 | `DEBUG=false` 默认只打慢查询 + 错误,量级与现状一致;`DEBUG=true` 是开发态场景,不追求高 QPS |
| Windows 终端 ANSI 颜色码乱码 | 低 | 极低 | 现状就是如此,不改;写入日志文件时颜色码可见但可接受 |

---

## 9. 回滚方案

如果上线后出现问题,可分层回滚:

1. **最小回滚**:revert `middleware/request-id.go` 中的 `trace.Set` 调用 + 后台任务入口的 `trace.NewJob`;其他文件保留(日志里都是 `"-"`,格式变了但功能正常)
2. **中等回滚**:revert `model/gorm_logger.go` / `common/sys_log.go` / `logger/logger.go` / `middleware/logger.go`,保留 `common/trace` 包(未激活状态)
3. **完全回滚**:revert 整个 feature 分支

所有改动在一个 feature 分支内,git revert 友好。
