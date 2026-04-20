# Trace-Logging (Goroutine-Local TraceId) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give all logs (SQL / SYS / business / Gin HTTP) a unified millisecond timestamp and a shared TraceId column, so `grep <traceId>` pulls out the full chain of a single HTTP request or background job.

**Architecture:** Goroutine-local storage via `github.com/timandy/routine`. No changes to the 353+ existing `DB.XXX` call sites. HTTP middleware sets `HTTP-<16hex>` at request start, long-running background tasks set `JOB-<name>-<16hex>` inside the actual loop goroutine. GORM logger is rewired from `fmt.Printf` to the shared `gin.DefaultWriter` / `gin.DefaultErrorWriter` so all logs share one rotated file.

**Tech Stack:** Go 1.25, Gin, GORM, `github.com/timandy/routine` (new), `github.com/bytedance/gopkg/util/gopool` (existing).

**Spec:** `docs/superpowers/specs/2026-04-20-trace-logging-design.md` (commit `12bf74d`)

---

## File Structure

New files:
- `common/trace/trace.go` — goroutine-local TraceId + Set/Get/Clear + NewHTTP/NewJob/NewSys generators + GoJob/GoInherit wrappers
- `common/trace/trace_test.go` — unit tests
- `common/log_format.go` — shared helpers: `FmtLogTime(t)` (millisecond timestamp) and `FmtTrace()` (fixed-width trace id column), plus `TraceColumnWidth = 30` constant
- `common/log_format_test.go` — unit tests
- `logger/logger_test.go` — new (covers nil ctx, ctx-with-id, goroutine-local fallback)
- `model/gorm_logger_test.go` — new (covers writer routing and trace id emission)

Modified files:
- `go.mod` / `go.sum` — add `github.com/timandy/routine`
- `common/sys_log.go` — SysLog/SysError/FatalLog include millisecond time + trace column
- `logger/logger.go` — `logHelper` adds nil-ctx guard + ms time + trace column, falls back to `trace.Get()` when ctx has no RequestId
- `middleware/logger.go` — Gin format string adds ms time + trace column
- `middleware/request-id.go` — generates id via `trace.NewHTTP()`, calls `trace.Set(id)` + `defer trace.Clear()`
- `middleware/performance_trace.go` — reads trace from `trace.Get()`, drops UnixNano fallback, removes `[%s]` id embedding from all SysLog messages
- `model/gorm_logger.go` — rewired to write through `gin.DefaultWriter` / `gin.DefaultErrorWriter` under `LogWriterMu`, adds ms time + trace column
- `main.go` — bootstrap trace at entry + `trace.Clear()` before HTTP server Run; 12 method-A goroutines wrapped with `trace.GoJob`
- `service/subscription_reset_task.go` — method B inside inner `gopool.Go`
- `service/codex_credential_refresh_task.go` — method B inside inner `gopool.Go`
- `controller/channel/upstream_update.go` — method B inside inner `go func()`
- `model/utils.go` — method B inside `InitBatchUpdater`'s `gopool.Go`

---

## Task 1: Add timandy/routine dependency

**Files:**
- Modify: `go.mod`
- Modify: `go.sum`

- [ ] **Step 1: Add dependency**

Run:
```bash
cd D:/top/keyapi && go get github.com/timandy/routine@latest
```
Expected: `go.mod` and `go.sum` updated with a new entry for `github.com/timandy/routine`.

- [ ] **Step 2: Verify install**

Run:
```bash
go list -m github.com/timandy/routine
```
Expected: prints `github.com/timandy/routine v1.x.x` (exact version not important; check no error).

- [ ] **Step 3: Commit**

```bash
git add go.mod go.sum
git commit -m "chore(deps): add timandy/routine for goroutine-local TraceId"
```

---

## Task 2: common/trace package (TDD)

**Files:**
- Create: `common/trace/trace.go`
- Test: `common/trace/trace_test.go`

- [ ] **Step 1: Write failing tests**

Create `common/trace/trace_test.go`:

```go
package trace

import (
	"regexp"
	"sync"
	"testing"
)

func TestGet_Unset_ReturnsDash(t *testing.T) {
	// Run in a subtest to get a fresh goroutine state via t.Run (same goroutine, but Clear first)
	Clear()
	if got := Get(); got != "-" {
		t.Fatalf("Get() on unset goroutine = %q, want %q", got, "-")
	}
}

func TestSet_Get_Roundtrip(t *testing.T) {
	Set("HTTP-abcdef0123456789")
	defer Clear()
	if got := Get(); got != "HTTP-abcdef0123456789" {
		t.Fatalf("Get() after Set = %q, want %q", got, "HTTP-abcdef0123456789")
	}
}

func TestNewHTTP_Format(t *testing.T) {
	id := NewHTTP()
	if ok, _ := regexp.MatchString(`^HTTP-[0-9a-f]{16}$`, id); !ok {
		t.Fatalf("NewHTTP() = %q, want HTTP-<16 hex>", id)
	}
}

func TestNewJob_Format(t *testing.T) {
	id := NewJob("subreset")
	if ok, _ := regexp.MatchString(`^JOB-subreset-[0-9a-f]{16}$`, id); !ok {
		t.Fatalf("NewJob(subreset) = %q, want JOB-subreset-<16 hex>", id)
	}
}

func TestNewSys_Format(t *testing.T) {
	id := NewSys("bootstrap")
	if ok, _ := regexp.MatchString(`^SYS-bootstrap-[0-9a-f]{16}$`, id); !ok {
		t.Fatalf("NewSys(bootstrap) = %q, want SYS-bootstrap-<16 hex>", id)
	}
}

func TestGoJob_AlwaysGeneratesNewTrace(t *testing.T) {
	// Parent has a trace; GoJob child should NOT inherit it
	Set("HTTP-parent0000000000")
	defer Clear()

	var childTrace string
	var wg sync.WaitGroup
	wg.Add(1)
	GoJob("subreset", func() {
		defer wg.Done()
		childTrace = Get()
	})
	wg.Wait()

	if childTrace == "HTTP-parent0000000000" {
		t.Fatalf("GoJob inherited parent trace %q, want fresh JOB-subreset-*", childTrace)
	}
	if ok, _ := regexp.MatchString(`^JOB-subreset-[0-9a-f]{16}$`, childTrace); !ok {
		t.Fatalf("GoJob child trace = %q, want JOB-subreset-<16 hex>", childTrace)
	}
}

func TestGoInherit_InheritsParentTrace(t *testing.T) {
	Set("HTTP-parent1111111111")
	defer Clear()

	var childTrace string
	var wg sync.WaitGroup
	wg.Add(1)
	GoInherit(func() {
		defer wg.Done()
		childTrace = Get()
	})
	wg.Wait()

	if childTrace != "HTTP-parent1111111111" {
		t.Fatalf("GoInherit child trace = %q, want %q", childTrace, "HTTP-parent1111111111")
	}
}

func TestGoInherit_NoParentMeansDash(t *testing.T) {
	Clear()

	var childTrace string
	var wg sync.WaitGroup
	wg.Add(1)
	GoInherit(func() {
		defer wg.Done()
		childTrace = Get()
	})
	wg.Wait()

	if childTrace != "-" {
		t.Fatalf("GoInherit without parent = %q, want %q", childTrace, "-")
	}
}

func TestGoJob_IsolationBetweenConcurrentGoroutines(t *testing.T) {
	var wg sync.WaitGroup
	results := make([]string, 10)
	for i := 0; i < 10; i++ {
		i := i
		wg.Add(1)
		GoJob("iso", func() {
			defer wg.Done()
			results[i] = Get()
		})
	}
	wg.Wait()

	seen := make(map[string]bool)
	for i, r := range results {
		if ok, _ := regexp.MatchString(`^JOB-iso-[0-9a-f]{16}$`, r); !ok {
			t.Fatalf("goroutine %d got %q, want JOB-iso-<16 hex>", i, r)
		}
		if seen[r] {
			t.Fatalf("duplicate trace id %q across goroutines (should be unique with 64-bit space)", r)
		}
		seen[r] = true
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
go test ./common/trace/ -run . -v
```
Expected: compile error (package `trace` does not exist).

- [ ] **Step 3: Implement common/trace/trace.go**

Create `common/trace/trace.go`:

```go
// Package trace provides goroutine-local TraceId storage for unified log
// chain tracing. See docs/superpowers/specs/2026-04-20-trace-logging-design.md.
package trace

import (
	"crypto/rand"
	"encoding/hex"
	mrand "math/rand"
	"sync"

	"github.com/timandy/routine"
)

const (
	prefixHTTP = "HTTP"
	prefixJob  = "JOB"
	prefixSys  = "SYS"

	unsetMarker = "-"
)

var traceLocal = routine.NewInheritableThreadLocal[string]()

// Get returns the TraceId for the current goroutine, or "-" when unset.
// Never panics — recovers from any internal error and falls back to "-".
func Get() (id string) {
	defer func() {
		if r := recover(); r != nil {
			id = unsetMarker
		}
	}()
	v := traceLocal.Get()
	if v == "" {
		return unsetMarker
	}
	return v
}

// Set writes the TraceId to the current goroutine.
func Set(id string) {
	traceLocal.Set(id)
}

// Clear removes the TraceId from the current goroutine. Callers spawning
// worker pool tasks MUST defer Clear() so pooled goroutines don't retain
// stale TraceId across reuse.
func Clear() {
	traceLocal.Remove()
}

// NewHTTP returns a new HTTP TraceId, e.g. "HTTP-a3f2c1b8d5e7f091".
func NewHTTP() string {
	return prefixHTTP + "-" + randHex16()
}

// NewJob returns a new background-job TraceId, e.g. "JOB-subreset-b9e8d2c1a3f2c1b8".
// name should be <= 10 chars for column alignment; longer names still work.
func NewJob(name string) string {
	return prefixJob + "-" + name + "-" + randHex16()
}

// NewSys returns a new system-task TraceId (bootstrap, unnamed goroutines).
func NewSys(name string) string {
	return prefixSys + "-" + name + "-" + randHex16()
}

// GoJob spawns a goroutine, sets a fresh JOB-<name>-<hex> TraceId, runs fn,
// and clears the TraceId on exit. The child does NOT inherit the parent's
// TraceId — it always gets a new one.
func GoJob(name string, fn func()) {
	routine.Go(func() {
		Set(NewJob(name))
		defer Clear()
		fn()
	})
}

// GoInherit spawns a goroutine that inherits the parent's TraceId. If the
// parent has no TraceId, the child starts unset (Get returns "-").
func GoInherit(fn func()) {
	routine.Go(func() {
		// InheritableThreadLocal already copies parent's value on routine.Go.
		// We intentionally do NOT Set/Clear here — the inherited value is the
		// whole point. But we DO defer Clear to stop the value leaking if the
		// goroutine is recycled by a runtime pool.
		defer Clear()
		fn()
	})
}

var mrandLock sync.Mutex
var mrandSrc = mrand.New(mrand.NewSource(1))

func randHex16() string {
	var b [8]byte
	if _, err := rand.Read(b[:]); err == nil {
		return hex.EncodeToString(b[:])
	}
	// crypto/rand failed; fall back to math/rand so we never block the caller.
	mrandLock.Lock()
	v := mrandSrc.Uint64()
	mrandLock.Unlock()
	for i := 0; i < 8; i++ {
		b[i] = byte(v >> (i * 8))
	}
	return hex.EncodeToString(b[:])
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
go test ./common/trace/ -run . -v
```
Expected: all 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add common/trace/trace.go common/trace/trace_test.go
git commit -m "feat(trace): add goroutine-local TraceId package"
```

---

## Task 3: common/log_format.go (TDD)

**Files:**
- Create: `common/log_format.go`
- Test: `common/log_format_test.go`

- [ ] **Step 1: Write failing tests**

Create `common/log_format_test.go`:

```go
package common

import (
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common/trace"
)

func TestFmtLogTime(t *testing.T) {
	ts := time.Date(2026, 4, 20, 15, 13, 9, 123_000_000, time.UTC)
	got := FmtLogTime(ts)
	want := "2026/04/20 15:13:09.123"
	if got != want {
		t.Fatalf("FmtLogTime(%v) = %q, want %q", ts, got, want)
	}
}

func TestFmtTrace_Unset(t *testing.T) {
	trace.Clear()
	got := FmtTrace()
	if len(got) != TraceColumnWidth {
		t.Fatalf("FmtTrace() unset len = %d, want %d", len(got), TraceColumnWidth)
	}
	if !strings.HasPrefix(got, "-") {
		t.Fatalf("FmtTrace() unset = %q, want to start with '-'", got)
	}
	// Remaining chars should all be spaces (left-align padding).
	if strings.TrimRight(got, " ") != "-" {
		t.Fatalf("FmtTrace() unset = %q, want %q left-padded to %d", got, "-", TraceColumnWidth)
	}
}

func TestFmtTrace_Set(t *testing.T) {
	trace.Set("HTTP-abcdef0123456789")
	defer trace.Clear()
	got := FmtTrace()
	if len(got) != TraceColumnWidth {
		t.Fatalf("FmtTrace() set len = %d, want %d", len(got), TraceColumnWidth)
	}
	if !strings.HasPrefix(got, "HTTP-abcdef0123456789") {
		t.Fatalf("FmtTrace() = %q, want to start with the id", got)
	}
}

func TestTraceColumnWidth_IsThirty(t *testing.T) {
	// Pinned so downstream loggers (sys_log, logger/logger, middleware) can
	// format with a known width without importing trace directly.
	if TraceColumnWidth != 30 {
		t.Fatalf("TraceColumnWidth = %d, want 30", TraceColumnWidth)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
go test ./common/ -run TestFmtLogTime -run TestFmtTrace -run TestTraceColumnWidth -v
```
Expected: compile error (`FmtLogTime`, `FmtTrace`, `TraceColumnWidth` undefined).

- [ ] **Step 3: Implement common/log_format.go**

Create `common/log_format.go`:

```go
package common

import (
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/common/trace"
)

// TraceColumnWidth is the fixed width (in bytes/ASCII chars) of the TraceId
// column used in every log line. Sized so "JOB-<10>-<16hex>" (= 31) fits
// with minimal overflow; shorter ids are left-padded with spaces.
const TraceColumnWidth = 30

// FmtLogTime returns a millisecond-precision log timestamp like
// "2026/04/20 15:13:09.123".
func FmtLogTime(t time.Time) string {
	return t.Format("2006/01/02 15:04:05.000")
}

// FmtTrace returns the current goroutine's TraceId left-aligned and padded
// to TraceColumnWidth. Returns "-<29 spaces>" when unset.
func FmtTrace() string {
	return fmt.Sprintf("%-*s", TraceColumnWidth, trace.Get())
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
go test ./common/ -run TestFmtLogTime -run TestFmtTrace -run TestTraceColumnWidth -v
```
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add common/log_format.go common/log_format_test.go
git commit -m "feat(common): add FmtLogTime/FmtTrace log helpers"
```

---

## Task 4: Update common/sys_log.go

**Files:**
- Modify: `common/sys_log.go`

- [ ] **Step 1: Replace SysLog/SysError/FatalLog formatting**

Current content (for reference) at `common/sys_log.go:17-37`:

```go
func SysLog(s string) {
	t := time.Now()
	LogWriterMu.RLock()
	_, _ = fmt.Fprintf(gin.DefaultWriter, "[SYS] %v | %s \n", t.Format("2006/01/02 - 15:04:05"), s)
	LogWriterMu.RUnlock()
}

func SysError(s string) {
	t := time.Now()
	LogWriterMu.RLock()
	_, _ = fmt.Fprintf(gin.DefaultErrorWriter, "[SYS] %v | %s \n", t.Format("2006/01/02 - 15:04:05"), s)
	LogWriterMu.RUnlock()
}

func FatalLog(v ...any) {
	t := time.Now()
	LogWriterMu.RLock()
	_, _ = fmt.Fprintf(gin.DefaultErrorWriter, "[FATAL] %v | %v \n", t.Format("2006/01/02 - 15:04:05"), v)
	LogWriterMu.RUnlock()
	os.Exit(1)
}
```

Replace with:

```go
func SysLog(s string) {
	t := time.Now()
	LogWriterMu.RLock()
	_, _ = fmt.Fprintf(gin.DefaultWriter, "[SYS] %s | %s | %s\n", FmtLogTime(t), FmtTrace(), s)
	LogWriterMu.RUnlock()
}

func SysError(s string) {
	t := time.Now()
	LogWriterMu.RLock()
	_, _ = fmt.Fprintf(gin.DefaultErrorWriter, "[SYS] %s | %s | %s\n", FmtLogTime(t), FmtTrace(), s)
	LogWriterMu.RUnlock()
}

func FatalLog(v ...any) {
	t := time.Now()
	LogWriterMu.RLock()
	_, _ = fmt.Fprintf(gin.DefaultErrorWriter, "[FATAL] %s | %s | %v\n", FmtLogTime(t), FmtTrace(), v)
	LogWriterMu.RUnlock()
	os.Exit(1)
}
```

- [ ] **Step 2: Build and verify**

Run:
```bash
go build ./...
```
Expected: clean build, no compile errors.

- [ ] **Step 3: Commit**

```bash
git add common/sys_log.go
git commit -m "refactor(common/sys_log): use FmtLogTime and FmtTrace"
```

---

## Task 5: Update logger/logger.go with nil-ctx guard (TDD)

**Files:**
- Modify: `logger/logger.go`
- Create: `logger/logger_test.go`

- [ ] **Step 1: Write failing tests**

Create `logger/logger_test.go`:

```go
package logger

import (
	"bytes"
	"context"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/common/trace"

	"github.com/gin-gonic/gin"
)

// setupLogCapture replaces gin.DefaultWriter / DefaultErrorWriter with two
// buffers under LogWriterMu.Lock() and returns the buffers plus a restore
// func. The lock prevents races with concurrent log writers during the swap.
func setupLogCapture(t *testing.T) (out, errBuf *bytes.Buffer, restore func()) {
	t.Helper()
	common.LogWriterMu.Lock()
	origOut := gin.DefaultWriter
	origErr := gin.DefaultErrorWriter
	out = &bytes.Buffer{}
	errBuf = &bytes.Buffer{}
	gin.DefaultWriter = out
	gin.DefaultErrorWriter = errBuf
	common.LogWriterMu.Unlock()

	return out, errBuf, func() {
		common.LogWriterMu.Lock()
		gin.DefaultWriter = origOut
		gin.DefaultErrorWriter = origErr
		common.LogWriterMu.Unlock()
	}
}

func TestLogError_NilContext_DoesNotPanic(t *testing.T) {
	_, errBuf, restore := setupLogCapture(t)
	defer restore()

	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("LogError(nil, ...) panicked: %v", r)
		}
	}()
	LogError(nil, "test-nil-ctx")

	got := errBuf.String()
	if !strings.Contains(got, "test-nil-ctx") {
		t.Fatalf("LogError output missing message, got %q", got)
	}
	if !strings.Contains(got, "-") {
		t.Fatalf("LogError output missing '-' trace placeholder, got %q", got)
	}
}

func TestLogInfo_CtxRequestId_AppearsInOutput(t *testing.T) {
	out, _, restore := setupLogCapture(t)
	defer restore()

	ctx := context.WithValue(context.Background(), common.RequestIdKey, "HTTP-ctx0000000000abcd")
	LogInfo(ctx, "test-ctx-id")

	got := out.String()
	if !strings.Contains(got, "HTTP-ctx0000000000abcd") {
		t.Fatalf("expected ctx RequestId in output, got %q", got)
	}
	if !strings.Contains(got, "test-ctx-id") {
		t.Fatalf("expected message in output, got %q", got)
	}
}

func TestLogInfo_FallbackToGoroutineLocalTrace(t *testing.T) {
	out, _, restore := setupLogCapture(t)
	defer restore()

	trace.Set("JOB-test-000000000000aabb")
	defer trace.Clear()

	// Pass an empty context so there is no ctx-side RequestId.
	LogInfo(context.Background(), "test-goroutine-local")

	got := out.String()
	if !strings.Contains(got, "JOB-test-000000000000aabb") {
		t.Fatalf("expected goroutine-local trace in output, got %q", got)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
go test ./logger/ -v
```
Expected: `TestLogError_NilContext_DoesNotPanic` panics (current code calls `ctx.Value(...)` on nil); other two tests may also fail due to format mismatch.

- [ ] **Step 3: Update logger/logger.go**

Replace the `logHelper` function (currently at `logger/logger.go:97-118`) with:

```go
func logHelper(ctx context.Context, level string, msg string) {
	var id string
	if ctx != nil {
		if v, ok := ctx.Value(common.RequestIdKey).(string); ok {
			id = v
		}
	}
	if id == "" {
		id = trace.Get()
	}
	now := time.Now()
	common.LogWriterMu.RLock()
	writer := gin.DefaultErrorWriter
	if level == loggerINFO {
		writer = gin.DefaultWriter
	}
	_, _ = fmt.Fprintf(writer, "[%s] %s | %-*s | %s\n",
		level, common.FmtLogTime(now), common.TraceColumnWidth, id, msg)
	common.LogWriterMu.RUnlock()
	logCount++ // we don't need accurate count, so no lock here
	if logCount > maxLogCount && !setupLogWorking {
		logCount = 0
		setupLogWorking = true
		gopool.Go(func() {
			SetupLogger()
		})
	}
}
```

Also add the import for `trace`. Update the import block at `logger/logger.go:3-18` to include:

```go
import (
	"context"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/common/trace"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/bytedance/gopkg/util/gopool"
	"github.com/gin-gonic/gin"
)
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
go test ./logger/ -v
```
Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add logger/logger.go logger/logger_test.go
git commit -m "feat(logger): nil-ctx guard + trace fallback + ms timestamp"
```

---

## Task 6: Update middleware/logger.go

**Files:**
- Modify: `middleware/logger.go`

- [ ] **Step 1: Rewrite the Gin log format**

Replace the entire `SetUpLogger` function body (currently at `middleware/logger.go:19-40`) with:

```go
func SetUpLogger(server *gin.Engine) {
	server.Use(gin.LoggerWithFormatter(func(param gin.LogFormatterParams) string {
		var requestID string
		if param.Keys != nil {
			requestID, _ = param.Keys[common.RequestIdKey].(string)
		}
		if requestID == "" {
			requestID = "-"
		}
		tag, _ := param.Keys[RouteTagKey].(string)
		if tag == "" {
			tag = "web"
		}
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
	}))
}
```

- [ ] **Step 2: Build and verify**

Run:
```bash
go build ./...
```
Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add middleware/logger.go
git commit -m "feat(middleware/logger): add trace column and ms timestamp to Gin logs"
```

---

## Task 7: Update middleware/request-id.go

**Files:**
- Modify: `middleware/request-id.go`

- [ ] **Step 1: Replace RequestId generation**

Replace the entire content of `middleware/request-id.go` with:

```go
package middleware

import (
	"context"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/common/trace"

	"github.com/gin-gonic/gin"
)

func RequestId() func(c *gin.Context) {
	return func(c *gin.Context) {
		id := trace.NewHTTP() // "HTTP-<16hex>"
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

Note: the `_bp` hash constant and the `crypto/sha256` / `encoding/hex` / `runtime/debug` imports are no longer needed — the new id format does not use them.

- [ ] **Step 2: Build and verify**

Run:
```bash
go build ./...
```
Expected: clean build.

- [ ] **Step 3: Manual smoke — ensure server still boots**

Run:
```bash
go build -o /tmp/keyapi-smoke ./
```
Expected: build succeeds (we don't launch; that's Task 15).

- [ ] **Step 4: Commit**

```bash
git add middleware/request-id.go
git commit -m "feat(middleware/request-id): use trace.NewHTTP and set goroutine-local"
```

---

## Task 8: Fix middleware/performance_trace.go

**Files:**
- Modify: `middleware/performance_trace.go`

- [ ] **Step 1: Rewrite to drop the broken header read and inline id**

Replace the entire body of `PerformanceTrace()` function (currently `middleware/performance_trace.go:13-72`) with:

```go
// PerformanceTrace 性能追踪中间件 - 记录请求各阶段耗时
// TraceId 自动由 common.SysLog 从 goroutine-local 带入,不再在消息体嵌 id
func PerformanceTrace() gin.HandlerFunc {
	return func(c *gin.Context) {
		// 只追踪中继请求
		if !isRelayRequest(c) {
			c.Next()
			return
		}

		startTime := time.Now()

		// 记录请求开始
		common.SysLog(fmt.Sprintf("[PERF] === Request Start === Path: %s", c.Request.URL.Path))

		// 记录中间件链开始时间
		c.Set("perf_start", startTime)

		c.Next()

		// 请求处理完成
		totalDuration := time.Since(startTime)

		authTime := getStageTime(c, "perf_auth_done")
		distributeTime := getStageTime(c, "perf_distribute_done")
		relayTime := getStageTime(c, "perf_relay_done")
		firstByteTime := getStageTime(c, "perf_first_byte")

		common.SysLog("[PERF] === Performance Report ===")
		common.SysLog(fmt.Sprintf("[PERF] Total:        %v", totalDuration))
		common.SysLog(fmt.Sprintf("[PERF] Auth:         %v", authTime))
		common.SysLog(fmt.Sprintf("[PERF] Distribute:   %v", distributeTime))
		common.SysLog(fmt.Sprintf("[PERF] Relay:        %v", relayTime))
		common.SysLog(fmt.Sprintf("[PERF] FirstByte:    %v", firstByteTime))

		if totalDuration > 0 {
			authPercent := float64(authTime) / float64(totalDuration) * 100
			distributePercent := float64(distributeTime) / float64(totalDuration) * 100
			relayPercent := float64(relayTime) / float64(totalDuration) * 100

			common.SysLog(fmt.Sprintf("[PERF] Auth%%:        %.2f%%", authPercent))
			common.SysLog(fmt.Sprintf("[PERF] Distribute%%:  %.2f%%", distributePercent))
			common.SysLog(fmt.Sprintf("[PERF] Relay%%:       %.2f%%", relayPercent))
		}

		if firstByteTime > 5*time.Second {
			common.SysLog("[PERF] ⚠️  WARNING: First byte time > 5s!")
		}

		common.SysLog("[PERF] === End ===")
	}
}
```

Also update `MarkStage` (currently `middleware/performance_trace.go:75-88`):

```go
// MarkStage 标记性能追踪阶段
func MarkStage(c *gin.Context, stage string) {
	startTime, exists := c.Get("perf_start")
	if !exists {
		return
	}

	start := startTime.(time.Time)
	elapsed := time.Since(start)
	c.Set(stage, elapsed)

	stageName := getStageName(stage)
	common.SysLog(fmt.Sprintf("[PERF] %s: %v", stageName, elapsed))
}
```

- [ ] **Step 2: Build and verify**

Run:
```bash
go build ./...
```
Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add middleware/performance_trace.go
git commit -m "fix(middleware/perf): drop wrong header read and inline id embedding"
```

---

## Task 9: Rewire model/gorm_logger.go to shared writer (TDD)

**Files:**
- Modify: `model/gorm_logger.go`
- Create: `model/gorm_logger_test.go`

- [ ] **Step 1: Write failing integration tests**

Create `model/gorm_logger_test.go`:

```go
package model

import (
	"bytes"
	"context"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/common/trace"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

type dummyRow struct {
	ID   uint `gorm:"primaryKey"`
	Name string
}

// captureWriters swaps gin.DefaultWriter / DefaultErrorWriter to two distinct
// buffers and returns them plus a restore func.
func captureWriters(t *testing.T) (out, errBuf *bytes.Buffer, restore func()) {
	t.Helper()
	common.LogWriterMu.Lock()
	origOut := gin.DefaultWriter
	origErr := gin.DefaultErrorWriter
	out = &bytes.Buffer{}
	errBuf = &bytes.Buffer{}
	gin.DefaultWriter = out
	gin.DefaultErrorWriter = errBuf
	common.LogWriterMu.Unlock()
	return out, errBuf, func() {
		common.LogWriterMu.Lock()
		gin.DefaultWriter = origOut
		gin.DefaultErrorWriter = origErr
		common.LogWriterMu.Unlock()
	}
}

func openTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	// Force Info level so every SQL is logged (our default is Warn).
	gormLogger := newPrettyGormLogger().LogMode(logger.Info)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: gormLogger})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&dummyRow{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return db
}

func TestGormLogger_WritesTraceIdToDefaultWriter(t *testing.T) {
	out, _, restore := captureWriters(t)
	defer restore()

	trace.Set("TEST-abcd1234ef567890")
	defer trace.Clear()

	db := openTestDB(t)
	if err := db.Create(&dummyRow{Name: "alice"}).Error; err != nil {
		t.Fatalf("insert: %v", err)
	}

	got := out.String()
	if !strings.Contains(got, "TEST-abcd1234ef567890") {
		t.Fatalf("expected trace id in [SQL] line, got:\n%s", got)
	}
	if !strings.Contains(got, "[SQL]") {
		t.Fatalf("expected [SQL] prefix, got:\n%s", got)
	}
}

func TestGormLogger_UnsetTracePrintsDash(t *testing.T) {
	out, _, restore := captureWriters(t)
	defer restore()

	trace.Clear()

	db := openTestDB(t)
	if err := db.Create(&dummyRow{Name: "bob"}).Error; err != nil {
		t.Fatalf("insert: %v", err)
	}

	got := out.String()
	// Column is padded; look for "-" followed by at least 3 spaces (padding).
	if !strings.Contains(got, "- ") {
		t.Fatalf("expected '-' placeholder when trace unset, got:\n%s", got)
	}
}

func TestGormLogger_ErrorGoesToErrorWriterOnly(t *testing.T) {
	out, errBuf, restore := captureWriters(t)
	defer restore()

	trace.Set("TEST-error0000000000")
	defer trace.Clear()

	db := openTestDB(t)

	// Trigger an error: query a table that doesn't exist.
	_ = db.Raw("SELECT * FROM table_that_does_not_exist").Scan(&struct{}{}).Error

	gotErr := errBuf.String()
	gotOut := out.String()

	if !strings.Contains(gotErr, "[SQL ERR]") {
		t.Fatalf("expected [SQL ERR] on errBuf, got errBuf=%q", gotErr)
	}
	if !strings.Contains(gotErr, "TEST-error0000000000") {
		t.Fatalf("expected trace id on error line, got errBuf=%q", gotErr)
	}
	// The error message itself (or [SQL ERR] marker) must NOT appear on the
	// normal writer.
	if strings.Contains(gotOut, "[SQL ERR]") {
		t.Fatalf("[SQL ERR] leaked into DefaultWriter, out=%q", gotOut)
	}
}

func TestGormLogger_NormalSQLDoesNotWriteErrorWriter(t *testing.T) {
	out, errBuf, restore := captureWriters(t)
	defer restore()

	trace.Set("TEST-normal0000000000")
	defer trace.Clear()

	db := openTestDB(t).WithContext(context.Background())
	if err := db.Create(&dummyRow{Name: "carol"}).Error; err != nil {
		t.Fatalf("insert: %v", err)
	}

	if errBuf.Len() != 0 {
		t.Fatalf("normal SQL wrote to ErrorWriter, content=%q", errBuf.String())
	}
	if out.Len() == 0 {
		t.Fatalf("normal SQL did not write to DefaultWriter")
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
go test ./model/ -run TestGormLogger -v
```
Expected: tests fail because current logger uses `fmt.Printf`, bypassing `gin.DefaultWriter`.

- [ ] **Step 3: Rewire the logger**

Edit `model/gorm_logger.go`. Update the import block (currently `model/gorm_logger.go:3-15`):

```go
import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/common/trace"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)
```

Replace the entire `Trace()` function (currently `model/gorm_logger.go:79-120`) with:

```go
func (l *prettyGormLogger) Trace(_ context.Context, begin time.Time, fc func() (string, int64), err error) {
	if l.level <= logger.Silent {
		return
	}

	elapsed := time.Since(begin)
	sql, rows := fc()
	sql = compactSQL(sql)
	caller := shortCaller()
	now := time.Now()
	traceID := trace.Get()

	isNotFound := errors.Is(err, gorm.ErrRecordNotFound)
	hasRealErr := err != nil && !(isNotFound && l.ignoreNotFound)
	isSlow := elapsed > l.slowThreshold && l.slowThreshold != 0

	switch {
	case hasRealErr && l.level >= logger.Error:
		common.LogWriterMu.RLock()
		_, _ = fmt.Fprintf(gin.DefaultErrorWriter,
			"%s[SQL ERR]%s %s | %-*s | %s | %s\n    %s%s%s\n    %s↳ %s%s\n",
			cRed, cReset,
			common.FmtLogTime(now),
			common.TraceColumnWidth, traceID,
			formatTimeAndRows(elapsed, rows),
			caller,
			cRed, sql, cReset,
			cRed, err.Error(), cReset,
		)
		common.LogWriterMu.RUnlock()

	case isSlow && l.level >= logger.Warn:
		common.LogWriterMu.RLock()
		_, _ = fmt.Fprintf(gin.DefaultWriter,
			"%s[SQL SLOW]%s %s | %-*s | %s | %s\n    %s%s%s\n",
			cYellow, cReset,
			common.FmtLogTime(now),
			common.TraceColumnWidth, traceID,
			formatTimeAndRows(elapsed, rows),
			caller,
			cYellow, sql, cReset,
		)
		common.LogWriterMu.RUnlock()

	case l.level >= logger.Info:
		common.LogWriterMu.RLock()
		_, _ = fmt.Fprintf(gin.DefaultWriter,
			"%s[SQL]%s %s | %-*s | %s | %s%s%s | %s\n",
			cGray, cReset,
			common.FmtLogTime(now),
			common.TraceColumnWidth, traceID,
			formatTimeAndRows(elapsed, rows),
			cGray, caller, cReset,
			sql,
		)
		common.LogWriterMu.RUnlock()
	}
}
```

Also update `Info` / `Warn` / `Error` methods (currently `model/gorm_logger.go:61-77`) to go through shared writers for consistency:

```go
func (l *prettyGormLogger) Info(_ context.Context, msg string, data ...interface{}) {
	if l.level >= logger.Info {
		common.LogWriterMu.RLock()
		_, _ = fmt.Fprintf(gin.DefaultWriter, "%s[GORM]%s %s\n", cCyan, cReset, fmt.Sprintf(msg, data...))
		common.LogWriterMu.RUnlock()
	}
}

func (l *prettyGormLogger) Warn(_ context.Context, msg string, data ...interface{}) {
	if l.level >= logger.Warn {
		common.LogWriterMu.RLock()
		_, _ = fmt.Fprintf(gin.DefaultErrorWriter, "%s[GORM WARN]%s %s\n", cYellow, cReset, fmt.Sprintf(msg, data...))
		common.LogWriterMu.RUnlock()
	}
}

func (l *prettyGormLogger) Error(_ context.Context, msg string, data ...interface{}) {
	if l.level >= logger.Error {
		common.LogWriterMu.RLock()
		_, _ = fmt.Fprintf(gin.DefaultErrorWriter, "%s[GORM ERROR]%s %s\n", cRed, cReset, fmt.Sprintf(msg, data...))
		common.LogWriterMu.RUnlock()
	}
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
go test ./model/ -run TestGormLogger -v
```
Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add model/gorm_logger.go model/gorm_logger_test.go
git commit -m "feat(model/gorm_logger): route to shared writer + trace column"
```

---

## Task 10: main.go bootstrap trace + method-A wrapping

**Files:**
- Modify: `main.go`

- [ ] **Step 1: Import trace and bootstrap at main() entry**

Add import for `github.com/QuantumNous/new-api/common/trace` in the import block (`main.go:3-39`).

Find the start of `func main() {` (around `main.go:52`) and insert at the very top of the function body:

```go
	// Bootstrap TraceId for all synchronous init SQL / SYS logs.
	trace.Set(trace.NewSys("bootstrap"))
```

- [ ] **Step 2: Replace method-A goroutine launches**

In `main.go`, replace these 12 goroutine launches with `trace.GoJob` wrappers.

Replace `main.go:98`:
```go
go model.SyncChannelCache(common.SyncFrequency)
```
with:
```go
trace.GoJob("chcachesync", func() {
	model.SyncChannelCache(common.SyncFrequency)
})
```

Replace `main.go:102`:
```go
go model.SyncOptions(common.SyncFrequency)
```
with:
```go
trace.GoJob("optsync", func() {
	model.SyncOptions(common.SyncFrequency)
})
```

Replace `main.go:105`:
```go
go model.UpdateQuotaData()
```
with:
```go
trace.GoJob("quotaupdate", func() {
	model.UpdateQuotaData()
})
```

Replace `main.go:112`:
```go
go channel.AutomaticallyUpdateChannels(frequency)
```
with:
```go
trace.GoJob("chupdate", func() {
	channel.AutomaticallyUpdateChannels(frequency)
})
```

Replace `main.go:115`:
```go
go channel.AutomaticallyTestChannels()
```
with:
```go
trace.GoJob("chtest", func() {
	channel.AutomaticallyTestChannels()
})
```

Replace `main.go:125`:
```go
go model.StartSiteRPMSnapshotWriter()
```
with:
```go
trace.GoJob("rpmsnap", func() {
	model.StartSiteRPMSnapshotWriter()
})
```

Replace `main.go:130`:
```go
go service.InvoiceQueryWorker()
```
with:
```go
trace.GoJob("invquery", func() {
	service.InvoiceQueryWorker()
})
```

Replace `main.go:147`:
```go
gopool.Go(func() {
	service.StartTenantAlertSweepLoop(5 * time.Minute)
})
```
with:
```go
trace.GoJob("tenalert", func() {
	service.StartTenantAlertSweepLoop(5 * time.Minute)
})
```

Replace `main.go:151`:
```go
gopool.Go(func() {
	service.StartTenantBillingAndPlanLoop(time.Hour)
})
```
with:
```go
trace.GoJob("tenbill", func() {
	service.StartTenantBillingAndPlanLoop(time.Hour)
})
```

Replace `main.go:155`:
```go
gopool.Go(func() {
	payment.StartPaymentReconcileLoop(5 * time.Minute)
})
```
with:
```go
trace.GoJob("payrecon", func() {
	payment.StartPaymentReconcileLoop(5 * time.Minute)
})
```

Replace `main.go:161`:
```go
gopool.Go(func() {
	media.UpdateMidjourneyTaskBulk()
})
```
with:
```go
trace.GoJob("mjpoll", func() {
	media.UpdateMidjourneyTaskBulk()
})
```

Replace `main.go:164`:
```go
gopool.Go(func() {
	media.UpdateTaskBulk()
})
```
with:
```go
trace.GoJob("taskpoll", func() {
	media.UpdateTaskBulk()
})
```

Replace `main.go:175`:
```go
gopool.Go(func() {
	log.Println(http.ListenAndServe("0.0.0.0:8005", nil))
})
```
with:
```go
trace.GoJob("pprof", func() {
	log.Println(http.ListenAndServe("0.0.0.0:8005", nil))
})
```

Replace `main.go:178`:
```go
go common.Monitor()
```
with:
```go
trace.GoJob("monitor", func() {
	common.Monitor()
})
```

Note: **do NOT** touch the IIFE at `main.go:84-96` (`func() { ... }()`), which is a synchronous init — NOT a goroutine.

- [ ] **Step 3: Clear bootstrap trace before HTTP server starts**

At `main.go:229` the server starts with `err = server.Run(":" + port)`. Insert two lines immediately before (i.e. between the current L227 `common.LogStartupSuccess(...)` and L229 `err = server.Run(...)`):

```go
	// Clear bootstrap trace; HTTP requests each set their own HTTP-<id>.
	trace.Clear()
```

Result (L228–L231 after the insert):
```go
	common.LogStartupSuccess(startTime, port)

	trace.Clear()

	err = server.Run(":" + port)
```

- [ ] **Step 4: Build and verify**

Run:
```bash
go build ./...
```
Expected: clean build. If `gopool` is no longer used after the replacements and becomes an unused import, remove it from main.go imports.

- [ ] **Step 5: Verify no stray `go `/`gopool.Go` remains in main.go bootstrap section**

Run:
```bash
grep -nE '^\s*(go |gopool\.Go)' D:/top/keyapi/main.go
```
Expected: zero matches inside `main()` between L60 and L185 (the bootstrap region). Remaining matches outside the function (e.g. inside `//go:embed`) are fine.

- [ ] **Step 6: Commit**

```bash
git add main.go
git commit -m "feat(main): bootstrap trace + wrap 14 long-running goroutines with trace.GoJob"
```

---

## Task 11: Method B — service/subscription_reset_task.go

**Files:**
- Modify: `service/subscription_reset_task.go`

- [ ] **Step 1: Add trace Set/Clear inside the inner gopool.Go**

Replace lines 34-44 of `service/subscription_reset_task.go`:

```go
		gopool.Go(func() {
			logger.LogInfo(context.Background(), fmt.Sprintf("subscription quota reset task started: tick=%s", subscriptionResetTickInterval))
			ticker := time.NewTicker(subscriptionResetTickInterval)
			defer ticker.Stop()

			runSubscriptionQuotaResetOnce()
			for range ticker.C {
				runSubscriptionQuotaResetOnce()
			}
		})
```

With:

```go
		gopool.Go(func() {
			trace.Set(trace.NewJob("subreset"))
			defer trace.Clear()

			logger.LogInfo(context.Background(), fmt.Sprintf("subscription quota reset task started: tick=%s", subscriptionResetTickInterval))
			ticker := time.NewTicker(subscriptionResetTickInterval)
			defer ticker.Stop()

			runSubscriptionQuotaResetOnce()
			for range ticker.C {
				runSubscriptionQuotaResetOnce()
			}
		})
```

Add to the import block (`service/subscription_reset_task.go:3-15`):
```go
	"github.com/QuantumNous/new-api/common/trace"
```

- [ ] **Step 2: Build and verify**

Run:
```bash
go build ./service/...
```
Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add service/subscription_reset_task.go
git commit -m "feat(service): tag subscription reset goroutine with JOB-subreset trace"
```

---

## Task 12: Method B — service/codex_credential_refresh_task.go

**Files:**
- Modify: `service/codex_credential_refresh_task.go`

- [ ] **Step 1: Add trace Set/Clear inside the inner gopool.Go**

Replace lines 37-47 of `service/codex_credential_refresh_task.go`:

```go
		gopool.Go(func() {
			logger.LogInfo(context.Background(), fmt.Sprintf("codex credential auto-refresh task started: tick=%s threshold=%s", codexCredentialRefreshTickInterval, codexCredentialRefreshThreshold))

			ticker := time.NewTicker(codexCredentialRefreshTickInterval)
			defer ticker.Stop()

			runCodexCredentialAutoRefreshOnce()
			for range ticker.C {
				runCodexCredentialAutoRefreshOnce()
			}
		})
```

With:

```go
		gopool.Go(func() {
			trace.Set(trace.NewJob("codexref"))
			defer trace.Clear()

			logger.LogInfo(context.Background(), fmt.Sprintf("codex credential auto-refresh task started: tick=%s threshold=%s", codexCredentialRefreshTickInterval, codexCredentialRefreshThreshold))

			ticker := time.NewTicker(codexCredentialRefreshTickInterval)
			defer ticker.Stop()

			runCodexCredentialAutoRefreshOnce()
			for range ticker.C {
				runCodexCredentialAutoRefreshOnce()
			}
		})
```

Add to import block:
```go
	"github.com/QuantumNous/new-api/common/trace"
```

- [ ] **Step 2: Build and verify**

Run:
```bash
go build ./service/...
```
Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add service/codex_credential_refresh_task.go
git commit -m "feat(service): tag codex credential refresh goroutine with JOB-codexref trace"
```

---

## Task 13: Method B — controller/channel/upstream_update.go

**Files:**
- Modify: `controller/channel/upstream_update.go`

- [ ] **Step 1: Locate the inner goroutine**

Run:
```bash
grep -nE 'StartChannelUpstreamModelUpdateTask|go func' D:/top/keyapi/controller/channel/upstream_update.go
```
Expected: prints the function definition and the `go func()` launch (near line 652 based on spec).

- [ ] **Step 2: Add trace Set/Clear inside the go func**

Replace the `go func() { ... }()` block at `controller/channel/upstream_update.go:652–660`:

```go
		go func() {
			common.SysLog(fmt.Sprintf("upstream model update task started: interval=%s", interval))
			runChannelUpstreamModelUpdateTaskOnce()
			ticker := time.NewTicker(interval)
			defer ticker.Stop()
			for range ticker.C {
				runChannelUpstreamModelUpdateTaskOnce()
			}
		}()
```

With:

```go
		go func() {
			trace.Set(trace.NewJob("chupstream"))
			defer trace.Clear()

			common.SysLog(fmt.Sprintf("upstream model update task started: interval=%s", interval))
			runChannelUpstreamModelUpdateTaskOnce()
			ticker := time.NewTicker(interval)
			defer ticker.Stop()
			for range ticker.C {
				runChannelUpstreamModelUpdateTaskOnce()
			}
		}()
```

Add to the file's import block:
```go
	"github.com/QuantumNous/new-api/common/trace"
```

- [ ] **Step 3: Build and verify**

Run:
```bash
go build ./controller/channel/...
```
Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add controller/channel/upstream_update.go
git commit -m "feat(controller/channel): tag upstream update goroutine with JOB-chupstream trace"
```

---

## Task 14: Method B — model/utils.go InitBatchUpdater

**Files:**
- Modify: `model/utils.go`

- [ ] **Step 1: Add trace Set/Clear inside the inner gopool.Go**

Replace lines 36-43 of `model/utils.go`:

```go
func InitBatchUpdater() {
	gopool.Go(func() {
		for {
			time.Sleep(time.Duration(common.BatchUpdateInterval) * time.Second)
			batchUpdate()
		}
	})
}
```

With:

```go
func InitBatchUpdater() {
	gopool.Go(func() {
		trace.Set(trace.NewJob("batchupdate"))
		defer trace.Clear()

		for {
			time.Sleep(time.Duration(common.BatchUpdateInterval) * time.Second)
			batchUpdate()
		}
	})
}
```

Add to import block (`model/utils.go:3-15`):
```go
	"github.com/QuantumNous/new-api/common/trace"
```

- [ ] **Step 2: Build and verify**

Run:
```bash
go build ./model/...
```
Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add model/utils.go
git commit -m "feat(model): tag batch updater goroutine with JOB-batchupdate trace"
```

---

## Task 15: Final verification

**Files:**
- No changes; this is an inspection-only task.

- [ ] **Step 1: Full build**

Run:
```bash
go build ./...
```
Expected: clean build across all packages.

- [ ] **Step 2: Full test suite**

Run:
```bash
go test ./...
```
Expected: all tests pass. If any pre-existing test broke due to log-format changes, inspect and fix — don't skip.

- [ ] **Step 3: Static sweep for missed goroutines in main.go**

Run:
```bash
grep -nE '^\s*(go |gopool\.Go)' D:/top/keyapi/main.go
```
Expected: zero matches inside `main()` bootstrap region (L60–L185). If any found, assign them a name and wrap with `trace.GoJob` before shipping.

- [ ] **Step 4: Static sweep for `[PERF][%s]` residue**

Run:
```bash
grep -nE '\[PERF\]\[%s\]' D:/top/keyapi/middleware/performance_trace.go
```
Expected: zero matches (all were replaced by `[PERF]` without inline id).

- [ ] **Step 5: Static sweep for stale header-key reads**

Run:
```bash
grep -rn 'c.GetString("X-Request-Id")' D:/top/keyapi/
```
Expected: zero matches (only `common.RequestIdKey` should be referenced).

- [ ] **Step 6: Manual smoke — start server and hit an endpoint**

Start server (in a separate terminal):
```bash
go run ./ -c "config file if needed"
```

In another terminal, send one request:
```bash
curl -i http://localhost:3000/api/user/self -H "Authorization: Bearer <dev-token>"
```

Check the server logs. Look for:
- One `[GIN]` line with `HTTP-<16hex>` in the trace column
- Any `[SQL]` / `[INFO]` / `[SYS]` lines triggered by this request showing the **same** `HTTP-<16hex>` id
- Response header `X-Oneapi-Request-Id: HTTP-<16hex>` matching the logs

Expected: the id appears consistently across all log lines for that single request.

- [ ] **Step 7: Manual smoke — verify PERF id consistency**

Fire a relay request (whatever path triggers `PerformanceTrace` middleware — requires a real upstream or mocked one). Verify `[PERF]` lines carry the same `HTTP-<id>` in the trace column as the rest of that request's logs, and the message body has **no** inline id.

- [ ] **Step 8: Manual smoke — verify background task tagging**

Wait for background task ticks (e.g. 1 min for subreset), or temporarily shorten `subscriptionResetTickInterval` to accelerate. Verify logs show `JOB-subreset-<16hex>` / `JOB-taskpoll-<16hex>` / etc. in the trace column on SQL and SYS lines from those tasks.

- [ ] **Step 9: Manual smoke — log file unification**

Find the rotated log file:
```bash
ls -lt D:/top/keyapi/logs/ | head -3
```

Open the most recent one and confirm it contains **all** of: `[GIN]`, `[SQL]`, `[SYS]`, `[INFO]`, `[PERF]` rows (previously `[SQL]` was only on stdout and never in the file).

- [ ] **Step 10: Final commit marker**

If any manual-smoke step revealed a bug, fix it with its own commit. If all clear:

```bash
git log --oneline -20
```
Verify the feature-branch commits are in order and messages match the intended changes.

---

## Out-of-scope reminders (for future PRs)

Spec section 3.4 explicitly excludes HTTP-request-internal asynchronous goroutines (`gopool.Go` / `go func()` inside `controller/relay.go`, `relay/channel/api_request.go`, `relay/helper/stream_scanner.go`, etc.). In those goroutines, `trace.Get()` will return `"-"` after this plan lands. That is intentional for v1.

When a future PR wants to extend trace coverage into one of those areas, the pattern is: `gopool.Go(fn)` → `trace.GoInherit(fn)`. One package at a time, each with its own PR.
