// Package tenant_ctx 提供 goroutine-local 的 tenant_id 存储。
//
// 作用范围（刻意收窄，改动前请通读）：
//
//  1. 只有 HTTP TenantResolve 中间件会 Set/Clear。后台任务、cron、池化
//     worker 不会设置这里的值，它们必须显式传 tenant_id 或走
//     model.WithTenantBypass。未设置状态对这些路径来说就是正确状态。
//
//  2. 继承仅限通过 routine.Go / trace.GoInherit 启动的 goroutine（两者
//     都基于 routine.InheritableThreadLocal）。其它 async 入口 —— 裸
//     `go func()`、gopool.Go、channel worker、timer 回调 —— 一律不继承
//     父 goroutine 的 tenant，碰到 tenant-scoped 表就直接 fail-closed。
//     仓库里目前还有不少裸 `go` 的请求内 async 入口（例如
//     controller/relay.go 的流式分支、relay/channel/api_request.go），
//     这些要么换成继承包装、要么把 tenant_id 显式作为参数传进去。不要
//     把"请求内 async"自动等同于"带 tenant"。
//
//  3. Set(0) / 未设置绝不能兜底到 DefaultTenantId。一旦兜底，错位的
//     请求就从"明面 fail-closed 报错"变成"悄悄跨租户写数据"。
//
// 为什么用 goroutine-local 而不是沿 ctx 传递：GORM 的 PK-only 写路径
// （DB.Save(&row)、DB.Delete(&row)、DB.Where(&StructWithId{})）WHERE 子句
// 是内部生成的，没法带调用方挂的 context。goroutine-local 可以让
// guardrail 回调在不强制每个调用点传 ctx 的前提下自动补上 tenant_id。
package tenant_ctx

import (
	"log"

	"github.com/timandy/routine"
)

var tenantLocal = routine.NewInheritableThreadLocal[int]()

// Get 返回当前 goroutine 的 tenant_id。0 表示未设置 —— guardrail 把 0
// 当作"没有租户"并直接 fail-closed。这里绝不兜底到 DefaultTenantId，
// 否则未设置 ctx 的 bug 会被悄悄改写成"写到租户 1"的跨租户泄漏。
func Get() (id int) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("tenant_ctx.Get: 从 routine 库的 panic 中恢复: %v", r)
			id = 0
		}
	}()
	return tenantLocal.Get()
}

// Set 把 tenant_id 写到当前 goroutine 上，会覆盖原有值。
func Set(id int) {
	tenantLocal.Set(id)
}

// Clear 清除当前 goroutine 上的 tenant_id。
//
// 必须在 TenantResolve 里紧跟 Set 后 defer 调用：net/http 的 handler
// goroutine 在 keep-alive 下会被复用，不 Clear 的话上一次请求的租户
// 会残留给下一次请求 —— 这种跨租户泄漏比 fail-closed 严重得多。
func Clear() {
	tenantLocal.Remove()
}
