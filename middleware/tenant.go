package middleware

import (
	"context"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// TenantResolve identifies the tenant from the request.
// Resolution order: X-Tenant-Id header -> subdomain -> fallback to DefaultTenantId.
func TenantResolve() gin.HandlerFunc {
	return func(c *gin.Context) {
		tenantId := 0

		// Strategy 1: explicit header (API clients, testing)
		if h := c.GetHeader("X-Tenant-Id"); h != "" {
			if id, err := strconv.Atoi(h); err == nil && id > 0 {
				tenant := model.GetTenantById(id)
				if tenant != nil {
					tenantId = tenant.Id
				}
			}
		}

		// Strategy 2: subdomain (xxx.example.com)
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

		// Fallback: default tenant for backward compatibility
		if tenantId == 0 {
			tenantId = model.DefaultTenantId
		}

		// Store in gin.Context (for middleware/controller access via c.Get)
		c.Set(string(constant.ContextKeyTenantId), tenantId)

		// CRITICAL: Also inject into c.Request.Context() so that model helpers
		// receiving c.Request.Context() via WithContext(ctx) can read tenant_id.
		// Without this, TenantIDFromContext(c.Request.Context()) falls back to
		// DefaultTenantId, breaking non-default tenant isolation.
		ctx := context.WithValue(c.Request.Context(), constant.ContextKeyTenantId, tenantId)
		c.Request = c.Request.WithContext(ctx)

		c.Next()
	}
}

// GetTenantId extracts tenant_id from gin.Context. Returns DefaultTenantId if not set.
func GetTenantId(c *gin.Context) int {
	if tid, exists := c.Get(string(constant.ContextKeyTenantId)); exists {
		if id, ok := tid.(int); ok && id > 0 {
			return id
		}
	}
	return model.DefaultTenantId
}
