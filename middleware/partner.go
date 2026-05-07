package middleware

import (
	"context"
	"crypto/subtle"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common/tenant_ctx"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

func PartnerAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		configuredKeys := parsePartnerAPIKeys(os.Getenv("PARTNER_API_KEY"))
		if len(configuredKeys) == 0 {
			c.JSON(http.StatusUnauthorized, gin.H{
				"success": false,
				"message": "PARTNER_API_KEY is not configured",
			})
			c.Abort()
			return
		}

		providedKey := extractPartnerAPIKey(c)
		if !partnerKeyAllowed(providedKey, configuredKeys) {
			c.JSON(http.StatusUnauthorized, gin.H{
				"success": false,
				"message": "invalid partner api key",
			})
			c.Abort()
			return
		}

		tenantId, err := resolvePartnerTenantId(c)
		if err != nil {
			c.JSON(http.StatusForbidden, gin.H{
				"success": false,
				"message": err.Error(),
			})
			c.Abort()
			return
		}

		c.Set(string(constant.ContextKeyTenantId), tenantId)
		ctx := context.WithValue(c.Request.Context(), constant.ContextKeyTenantId, tenantId)
		c.Request = c.Request.WithContext(ctx)
		tenant_ctx.Set(tenantId)
		defer tenant_ctx.Clear()

		c.Next()
	}
}

func parsePartnerAPIKeys(value string) []string {
	parts := strings.FieldsFunc(value, func(r rune) bool {
		return r == ',' || r == '\n' || r == '\r' || r == '\t' || r == ' '
	})
	keys := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			keys = append(keys, part)
		}
	}
	return keys
}

func extractPartnerAPIKey(c *gin.Context) string {
	key := strings.TrimSpace(c.GetHeader("X-Partner-Token"))
	if key != "" {
		return key
	}
	key = strings.TrimSpace(c.GetHeader("Authorization"))
	if strings.HasPrefix(strings.ToLower(key), "bearer ") {
		return strings.TrimSpace(key[7:])
	}
	return key
}

func partnerKeyAllowed(provided string, configured []string) bool {
	if provided == "" {
		return false
	}
	for _, key := range configured {
		if len(provided) == len(key) && subtle.ConstantTimeCompare([]byte(provided), []byte(key)) == 1 {
			return true
		}
	}
	return false
}

func resolvePartnerTenantId(c *gin.Context) (int, error) {
	requestTenantId := GetTenantId(c)
	configuredTenantId := 0
	if raw := strings.TrimSpace(os.Getenv("PARTNER_API_TENANT_ID")); raw != "" {
		tenantId, err := strconv.Atoi(raw)
		if err != nil || tenantId <= 0 {
			return 0, strconv.ErrSyntax
		}
		configuredTenantId = tenantId
	}

	if configuredTenantId > 0 {
		if requestTenantId > 0 && requestTenantId != configuredTenantId {
			return 0, errPartnerTenantMismatch
		}
		if model.GetTenantById(configuredTenantId) == nil {
			return 0, errPartnerTenantNotFound
		}
		return configuredTenantId, nil
	}

	if requestTenantId <= 0 {
		return 0, errPartnerTenantRequired
	}
	return requestTenantId, nil
}

type partnerAuthError string

func (e partnerAuthError) Error() string {
	return string(e)
}

const (
	errPartnerTenantRequired partnerAuthError = "X-Tenant-Id is required when PARTNER_API_TENANT_ID is not configured"
	errPartnerTenantMismatch partnerAuthError = "request tenant does not match PARTNER_API_TENANT_ID"
	errPartnerTenantNotFound partnerAuthError = "PARTNER_API_TENANT_ID does not exist"
)
