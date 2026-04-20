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
