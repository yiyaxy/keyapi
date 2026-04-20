package middleware

import (
	"context"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common/tenant_ctx"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// TenantResolve 从请求里识别租户。
// 解析顺序：X-Tenant-Id header -> 子域名。
//
// 解析不到时不会再悄悄兜底到 DefaultTenantId：租户识别失败的请求不
// 往 gin.Context / request.Context / goroutine-local 里写任何 tenant，
// 后续只要碰到 tenant-scoped 表就被 guardrail fail-closed 拦下。用一
// 个刺眼的 500 换掉"可能走错租户"的静默泄漏，这在多租户系统里是正确
// 方向。
//
// 合法的无租户路径（引导、健康检查、公共鉴权入口）要么绕过本中间件，
// 要么走 model.WithTenantBypass 明示。
func TenantResolve() gin.HandlerFunc {
	return func(c *gin.Context) {
		tenantId := 0

		// 策略 1：显式 header（API 客户端、测试）
		if h := c.GetHeader("X-Tenant-Id"); h != "" {
			if id, err := strconv.Atoi(h); err == nil && id > 0 {
				tenant := model.GetTenantById(id)
				if tenant != nil {
					tenantId = tenant.Id
				}
			}
		}

		// 策略 2：子域名（xxx.example.com）
		if tenantId == 0 {
			host := c.Request.Host
			if idx := strings.LastIndex(host, ":"); idx != -1 {
				host = host[:idx]
			}
			parts := strings.Split(host, ".")
			if len(parts) >= 3 {
				slug := parts[0]
				if slug != "www" && slug != "api" {
					tenant := model.GetTenantBySlug(slug)
					if tenant != nil {
						tenantId = tenant.Id
					}
				}
			}
		}

		if tenantId > 0 {
			// 写入 gin.Context，供中间件/controller 通过 c.Get 读取
			c.Set(string(constant.ContextKeyTenantId), tenantId)

			// 同时写到 c.Request.Context()，让通过 WithContext(ctx)
			// 接入的 model helper 也能读到 tenant_id
			ctx := context.WithValue(c.Request.Context(), constant.ContextKeyTenantId, tenantId)
			c.Request = c.Request.WithContext(ctx)

			// goroutine-local：让裸 model.DB.xxx() 写法（Save/Delete/
			// struct-Where 这类 PK-only 路径）能被 guardrail 回调自动
			// 补上 tenant，不必每个调用点都 thread ctx。
			// defer Clear 是关键：net/http 在 keep-alive 下会复用
			// handler goroutine，不 Clear 的话会把上一次请求的租户
			// 泄漏给下一次请求 —— 比 fail-closed 严重得多。
			tenant_ctx.Set(tenantId)
			defer tenant_ctx.Clear()
		}

		c.Next()
	}
}

// GetTenantId 从 gin.Context 里取 tenant_id。未设置时返回 0 —— 未解析
// 出租户的请求刻意以 0 向下传递，让后续 DB 访问要么被 guardrail
// fail-closed 拦下，要么走 model.WithTenantBypass 的管理员/跨租户路径。
// 这里绝不兜底到 DefaultTenantId，否则会把错位的请求掩盖掉。
func GetTenantId(c *gin.Context) int {
	if tid, exists := c.Get(string(constant.ContextKeyTenantId)); exists {
		if id, ok := tid.(int); ok && id > 0 {
			return id
		}
	}
	return 0
}
