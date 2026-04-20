package tenant_ctx

import (
	"testing"

	"github.com/timandy/routine"
)

// 未设置时必须读到 0，绝不能是 DefaultTenantId。一旦在这里兜底就会
// 把未挂 ctx 的查询悄悄改写成"租户 1"，guardrail 防线会被绕过。
func TestGetUnsetReturnsZero(t *testing.T) {
	Clear()
	if got := Get(); got != 0 {
		t.Fatalf("Get() on unset goroutine = %d, want 0", got)
	}
}

func TestSetClearRoundtrip(t *testing.T) {
	Clear()
	Set(42)
	if got := Get(); got != 42 {
		t.Fatalf("Set(42) 后 Get() = %d, 期望 42", got)
	}
	Clear()
	if got := Get(); got != 0 {
		t.Fatalf("Clear() 后 Get() = %d, 期望 0", got)
	}
}

// 裸 go 启动的兄弟 goroutine 不应共享 tenant。否则请求的租户会渗漏
// 到无关的后台 goroutine 里。
func TestGoroutineIsolation(t *testing.T) {
	Clear()
	Set(7)

	done := make(chan int, 1)
	go func() {
		done <- Get() // 裸 go —— 不走 routine.Go 的继承
	}()
	if got := <-done; got != 0 {
		t.Fatalf("兄弟 goroutine Get() = %d, 期望 0（裸 go 不继承）", got)
	}

	if got := Get(); got != 7 {
		t.Fatalf("父 goroutine Get() = %d, 期望 7（父不该被影响）", got)
	}
	Clear()
}

// routine.Go（trace.GoInherit 基于它）会继承父值 —— 这样请求内的
// async 工作能继续保持正确的租户作用域。
func TestRoutineGoInherits(t *testing.T) {
	Clear()
	Set(11)

	done := make(chan int, 1)
	routine.Go(func() {
		done <- Get()
	})
	if got := <-done; got != 11 {
		t.Fatalf("routine.Go 子 goroutine Get() = %d, 期望 11（InheritableThreadLocal 必须传递）", got)
	}
	Clear()
}
