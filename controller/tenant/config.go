package tenant

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

// configItem represents a single config entry in the response.
type configItem struct {
	Key        string `json:"key"`
	Value      string `json:"value"`
	Overridden bool   `json:"overridden"`
}

func redactedConfigValue(key, value string) string {
	if value == "" {
		return ""
	}
	if service.IsSensitiveConfigKey(key) {
		return "***"
	}
	return value
}

// GetTenantConfig returns all overridable keys with their resolved values for the current tenant.
// For each key in TenantOverridableKeys, indicates whether it's a tenant override or platform default.
func GetTenantConfig(c *gin.Context) {
	tenantId := middleware.GetTenantId(c)

	// Batch-fetch all tenant overrides for this tenant
	overrides, err := model.GetAllTenantOptions(tenantId)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	items := make([]configItem, 0, len(service.TenantOverridableKeys))
	for key := range service.TenantOverridableKeys {
		resolved := service.GetConfig(tenantId, key, "")
		_, isOverridden := overrides[key]
		items = append(items, configItem{
			Key:        key,
			Value:      redactedConfigValue(key, resolved),
			Overridden: isOverridden,
		})
	}

	common.ApiSuccess(c, items)
}

type updateConfigRequest struct {
	Key   string `json:"key" binding:"required"`
	Value string `json:"value"`
}

// UpdateTenantConfig sets a tenant-specific config override.
func UpdateTenantConfig(c *gin.Context) {
	tenantId := middleware.GetTenantId(c)

	var req updateConfigRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "无效的请求参数")
		return
	}

	if !service.IsTenantOverridableKey(req.Key) {
		common.ApiErrorMsg(c, "该配置项不允许租户级覆盖")
		return
	}

	if err := model.SetTenantOption(tenantId, req.Key, req.Value); err != nil {
		common.ApiError(c, err)
		return
	}

	service.InvalidateTenantOptionCacheKey(tenantId, req.Key)

	// Audit: redact value if key looks sensitive (password/secret/token/api_key).
	loggedValue := req.Value
	if service.IsSensitiveConfigKey(req.Key) {
		loggedValue = "(redacted)"
	} else if len(loggedValue) > 100 {
		loggedValue = loggedValue[:100] + "...(truncated)"
	}
	service.RecordAudit(c, "config.set", "option", 0, gin.H{
		"key":   req.Key,
		"value": loggedValue,
	})

	common.ApiSuccess(c, gin.H{
		"key":   req.Key,
		"value": req.Value,
	})
}

type deleteConfigRequest struct {
	Key string `json:"key" binding:"required"`
}

// DeleteTenantConfig removes a tenant-specific config override, reverting to the platform default.
func DeleteTenantConfig(c *gin.Context) {
	tenantId := middleware.GetTenantId(c)

	var req deleteConfigRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "无效的请求参数")
		return
	}

	if !service.IsTenantOverridableKey(req.Key) {
		common.ApiErrorMsg(c, "该配置项不允许租户级覆盖")
		return
	}

	if err := model.DeleteTenantOption(tenantId, req.Key); err != nil {
		common.ApiError(c, err)
		return
	}

	service.InvalidateTenantOptionCacheKey(tenantId, req.Key)

	service.RecordAudit(c, "config.delete", "option", 0, gin.H{
		"key": req.Key,
	})

	common.ApiSuccess(c, gin.H{
		"key": req.Key,
	})
}
