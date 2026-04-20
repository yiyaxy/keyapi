package middleware

import (
	"fmt"
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
)

// Tenant-level rate limit defaults (configurable via env).
var (
	TenantApiRateLimitNum      = common.GetEnvOrDefault("TENANT_API_RATE_LIMIT_NUM", 600)
	TenantApiRateLimitDuration = int64(common.GetEnvOrDefault("TENANT_API_RATE_LIMIT_DURATION", 60))
)

// tenantRateLimitFactory creates a rate limiter keyed by tenant ID.
// It mirrors rateLimitFactory but substitutes the tenant ID for client IP.
func tenantRateLimitFactory(maxRequestNum int, duration int64, mark string) func(c *gin.Context) {
	if common.RedisEnabled {
		return func(c *gin.Context) {
			tenantId := GetTenantId(c)
			if tenantId <= 0 {
				c.Next()
				return
			}
			key := fmt.Sprintf("rateLimit:%s:%d", mark, tenantId)
			userRedisRateLimiter(c, maxRequestNum, duration, key)
		}
	}
	// In-memory fallback
	inMemoryRateLimiter.Init(common.RateLimitKeyExpirationDuration)
	return func(c *gin.Context) {
		tenantId := GetTenantId(c)
		if tenantId <= 0 {
			c.Next()
			return
		}
		key := fmt.Sprintf("%s:%d", mark, tenantId)
		if !inMemoryRateLimiter.Request(key, maxRequestNum, duration) {
			c.Status(http.StatusTooManyRequests)
			c.Abort()
			return
		}
	}
}

// tenantUserRateLimitFactory creates a rate limiter keyed by the combination
// of tenant ID and user ID, preventing a single user from consuming an
// entire tenant's request budget.
func tenantUserRateLimitFactory(maxRequestNum int, duration int64, mark string) func(c *gin.Context) {
	if common.RedisEnabled {
		return func(c *gin.Context) {
			tenantId := GetTenantId(c)
			if tenantId <= 0 {
				c.Next()
				return
			}
			userId := c.GetInt("id")
			if userId == 0 {
				c.Status(http.StatusUnauthorized)
				c.Abort()
				return
			}
			key := fmt.Sprintf("rateLimit:%s:%d:%d", mark, tenantId, userId)
			userRedisRateLimiter(c, maxRequestNum, duration, key)
		}
	}
	// In-memory fallback
	inMemoryRateLimiter.Init(common.RateLimitKeyExpirationDuration)
	return func(c *gin.Context) {
		tenantId := GetTenantId(c)
		if tenantId <= 0 {
			c.Next()
			return
		}
		userId := c.GetInt("id")
		if userId == 0 {
			c.Status(http.StatusUnauthorized)
			c.Abort()
			return
		}
		key := fmt.Sprintf("%s:%d:%d", mark, tenantId, userId)
		if !inMemoryRateLimiter.Request(key, maxRequestNum, duration) {
			c.Status(http.StatusTooManyRequests)
			c.Abort()
			return
		}
	}
}

// TenantAPIRateLimit creates a per-tenant API rate limiter.
// Each tenant gets its own request budget separate from other tenants.
// Must be placed AFTER TenantResolve middleware.
func TenantAPIRateLimit() func(c *gin.Context) {
	return tenantRateLimitFactory(TenantApiRateLimitNum, TenantApiRateLimitDuration, "T")
}

// TenantUserRateLimit creates a combined tenant+user rate limiter.
// Ensures a single user within a tenant can't consume the entire tenant budget.
// Must be placed AFTER TenantResolve and UserAuth middleware.
func TenantUserRateLimit(maxReq int, duration int64) func(c *gin.Context) {
	return tenantUserRateLimitFactory(maxReq, duration, "TU")
}
