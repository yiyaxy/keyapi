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

- **日志全覆盖 TraceId**:SQL / SYS / 业务 / Gin HTTP 四类日志每一行都有 TraceId 列
- **统一时间戳**:所有日志使用 `2006/01/02 15:04:05.000`(毫秒精度)
- **无侵入获取 TraceId**:基于 goroutine-local 存储,不改 DB 调用点,不改现有业务代码签名
- **三类 TraceId 前缀**:`HTTP-*`(请求)、`JOB-<name>-*`(后台任务)、`SYS-*`(启动 / 未命名任务兜底)
- **降级安全**:任何地方拿不到 TraceId 都返回 `"-"`,不 panic、不阻塞业务

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
| **继承策略** | `InheritableThreadLocal` + 只包装明确的任务入口 | 裸 `go func()` 的子 goroutine 在有父 trace 时自动继承;后台任务入口显式 `trace.NewJob(...)` 开始新 trace |
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

// GoJob 在子 goroutine 中用指定 name 执行 fn;若父 goroutine 已有 TraceId,则子 goroutine 继承父的 TraceId;否则生成新的 JOB trace。
// 执行完成后自动 Clear,不污染 goroutine 池。
func GoJob(name string, fn func())

// GoInherit 仅继承父 goroutine TraceId,不生成新的;父为空时子为空。
// 适合"业务请求内部起 goroutine 做辅助工作"的场景(如流式 relay)。
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

在 `Trace()` 三个 case(正常 / 慢查询 / 错误)的 `Printf` 前加两列 `FmtLogTime(time.Now())` 和 `FmtTrace()`。示例:

```go
// 正常 SQL (Info 级别)
fmt.Printf("%s[SQL]%s %s | %s | %s | %s%s%s | %s\n",
    cGray, cReset,
    common.FmtLogTime(time.Now()),
    common.FmtTrace(),
    formatTimeAndRows(elapsed, rows),
    cGray, caller, cReset,
    sql,
)
```

#### `common/sys_log.go`

`SysLog` / `SysError` / `FatalLog` 改为:

```go
fmt.Fprintf(w, "[SYS] %s | %s | %s\n", FmtLogTime(t), FmtTrace(), s)
```

#### `logger/logger.go`

`logHelper` 改:

```go
func logHelper(ctx context.Context, level string, msg string) {
    id, _ := ctx.Value(common.RequestIdKey).(string)
    if id == "" {
        id = trace.Get()  // fallback 到 goroutine-local
    }
    now := time.Now()
    // ...
    _, _ = fmt.Fprintf(writer, "[%s] %s | %-*s | %s\n",
        level, common.FmtLogTime(now), common.TraceColumnWidth, id, msg)
}
```

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

在每个"定时调度 / 长驻 goroutine"的入口调用 `trace.Set(trace.NewJob("<name>"))` + `defer trace.Clear()`,或用 `trace.GoJob("<name>", fn)` 包装:

| 文件 | 任务名 (name) |
|------|----------------|
| `service/subscription_reset_task.go` | `subreset` |
| `service/task_polling.go` | `taskpoll` |
| `service/codex_credential_refresh_task.go` | `codexref` |
| `service/invoice_issue_service.go` | `invissue` |
| `model/site_rpm_snapshot.go` 的快照写入循环入口 | `rpmsnap` |
| `model/ip_ban.go` 的 ip ban 清理定时器入口 | `ipban` |
| `model/option.go` 的 `syncing options` 定时任务入口 | `optsync` |
| `model/midjourney.go` 的 midjourney 轮询入口 | `mjpoll` |
| 其他 gopool.Go 起的命名后台任务(按实际发现补) | — |

`main.go` 启动阶段一次性调用 `trace.Set(trace.NewSys("bootstrap"))`(仅在 main goroutine 内有效),为启动时的初始化 SQL / SYS 日志加上 `SYS-bootstrap-*` 标记。

**未包装的 goroutine**:业务请求内部起的辅助 goroutine(如 `relay/channel/*` 的流处理)通过 `InheritableThreadLocal` 自动继承父 trace。若发现某些 goroutine 拿不到 trace(日志显示 `-`),按需改为 `routine.Go(...)` 或 `trace.GoInherit(...)`。

### 3.5 依赖

`go.mod` 新增:

```
require github.com/timandy/routine v1.1.5
```

(实际版本取最新 stable)

---

## 4. 数据流 / 序列图

```
HTTP 请求链路:
  Client ──→ Gin
             └→ RequestId middleware: trace.Set("HTTP-a3f2c1b8")
                └→ Handler
                   └→ DB.Find(...) → GORM Trace 回调读 trace.Get() → "HTTP-a3f2c1b8"
                   └→ logger.LogInfo(ctx, ...) → 读 ctx 里的 RequestId → "HTTP-a3f2c1b8"
                   └→ common.SysLog(...) → 读 trace.Get() → "HTTP-a3f2c1b8"
             └→ middleware 结束: defer trace.Clear()

后台任务链路:
  main → gopool.Go(scheduleSubscriptionReset)
         └→ trace.GoJob("subreset", runResetLoop)
            └→ trace.Set("JOB-subreset-b9e8d2c1")
               └→ DB.Find(...) → GORM 日志 "JOB-subreset-b9e8d2c1"
               └→ common.SysLog(...) → "JOB-subreset-b9e8d2c1"
            └→ trace.Clear()

启动阶段:
  main → trace.Set(trace.NewSys("bootstrap"))
         ├→ model.InitDB() → SQL 日志 "SYS-bootstrap-c1d3e5f7"
         └→ 启动完成后 trace.Clear()
```

---

## 5. 错误处理与降级

| 场景 | 行为 |
|------|------|
| `trace.Get()` 在未 Set 的 goroutine 调用 | 返回 `"-"`,不 panic |
| `timandy/routine` 内部 panic(Go 版本不兼容的极端情况) | `Get()` 加 `defer recover`,回退返回 `"-"` |
| `crypto/rand` 失败 | `randHex8` 回退 `mrand.Uint32`,继续生成 |
| 后台任务忘记 `trace.NewJob` | 日志显示 `"-"`,可定位但不好读;通过代码 review 逐步补全 |
| 继承失败(裸 `go func()` 在无父 trace 的 goroutine 中) | 日志显示 `"-"`,同上 |
| 日志输出并发安全 | 沿用现有 `LogWriterMu` 读写锁,不变 |

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
- [ ] `DEBUG=true` 下打开 Info 级别,所有 SQL 都有 TraceId
- [ ] `DEBUG=false` 下关闭 Info,只有慢查询 / 错误有 TraceId 列(格式仍对齐)

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
| 11 | `model/gorm_logger_test.go` | 新建 | 集成测试 |
| 12 | `service/subscription_reset_task.go` | 修改 | 任务入口加 `trace.NewJob("subreset")` |
| 13 | `service/task_polling.go`(按实际文件名) | 修改 | `trace.NewJob("taskpoll")` |
| 14 | `service/codex_credential_refresh_task.go` | 修改 | `trace.NewJob("codexref")` |
| 15 | `service/invoice_issue_service.go` | 修改 | `trace.NewJob("invissue")` |
| 16 | `model/site_rpm_snapshot.go` 调度入口 | 修改 | `trace.NewJob("rpmsnap")` |
| 17 | `model/ip_ban.go` 清理定时器入口 | 修改 | `trace.NewJob("ipban")` |
| 18 | `model/option.go` sync 定时任务入口 | 修改 | `trace.NewJob("optsync")` |
| 19 | `model/midjourney.go` 轮询入口 | 修改 | `trace.NewJob("mjpoll")` |
| 20 | `main.go` | 修改 | 启动阶段 `trace.Set(trace.NewSys("bootstrap"))` |

实际执行时 #12–#19 可能有偏差(文件名 / 调度入口位置),以 plan 阶段真实代码为准。

---

## 8. 风险与缓解

| 风险 | 可能性 | 影响 | 缓解 |
|------|--------|------|------|
| `timandy/routine` 在 Go 1.25 上运行异常 | 低 | 中 | CI 跑现有测试套件 + 新增 trace 单元测试;若出问题回退到选项 B(goid + sync.Map) |
| 大量日志 I/O 压测性能下降 | 低 | 低 | 仅新增 1 次 goroutine-local 读 + 1 次 `fmt.Sprintf`,ns 级 |
| 后台任务入口漏包装 | 中 | 低 | 日志显示 `"-"`,不破坏功能;上线后观察补全 |
| RequestId 格式变化破坏外部依赖 | 低 | 中 | 若确实有外部系统用旧格式,可保留原生成逻辑,只加 `trace.Set` 调用 |
| `InheritableThreadLocal` 在 gopool worker 池复用 goroutine 时继承"幽灵 trace" | 中 | 低 | 所有通过 `trace.GoJob` / `trace.GoInherit` 包装的入口都 `defer trace.Clear()`,避免 pool 复用污染 |
| Windows 终端 ANSI 颜色码乱码 | 低 | 极低 | 现状就是如此,不改;写入日志文件时颜色码可见但可接受 |

---

## 9. 回滚方案

如果上线后出现问题,可分层回滚:

1. **最小回滚**:revert `middleware/request-id.go` 中的 `trace.Set` 调用 + 后台任务入口的 `trace.NewJob`;其他文件保留(日志里都是 `"-"`,格式变了但功能正常)
2. **中等回滚**:revert `model/gorm_logger.go` / `common/sys_log.go` / `logger/logger.go` / `middleware/logger.go`,保留 `common/trace` 包(未激活状态)
3. **完全回滚**:revert 整个 feature 分支

所有改动在一个 feature 分支内,git revert 友好。
