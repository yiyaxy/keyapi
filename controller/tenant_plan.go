package controller

import (
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

// GetTenantPlanInfo returns the current tenant's plan.
// GET /api/tenant/plan (TenantAdminAuth)
func GetTenantPlanInfo(c *gin.Context) {
	tenantId := middleware.GetTenantId(c)
	if tenantId <= 0 {
		common.ApiErrorMsg(c, "租户信息无效")
		return
	}

	plan, err := model.GetTenantPlan(tenantId)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	common.ApiSuccess(c, plan)
}

// UpdateTenantPlanRequest holds the fields that can be updated by platform admin.
type UpdateTenantPlanRequest struct {
	PlanName      string `json:"plan_name"`
	QuotaLimit    *int64 `json:"quota_limit"`
	RPMLimit      *int   `json:"rpm_limit"`
	TPMLimit      *int   `json:"tpm_limit"`
	MaxMembers    *int   `json:"max_members"`
	MaxTokens     *int   `json:"max_tokens"`
	MaxChannels   *int   `json:"max_channels"`
	AllowedModels string `json:"allowed_models"`
	Status        *int   `json:"status"`
	ExpiresAt     *int64 `json:"expires_at"`
}

// UpdateTenantPlanHandler updates a tenant's plan.
// PUT /api/platform/tenants/:id/plan (PlatformAdminAuth)
func UpdateTenantPlanHandler(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorMsg(c, "无效的租户 ID")
		return
	}

	// Verify tenant exists
	tenant := model.GetTenantById(id)
	if tenant == nil {
		common.ApiErrorMsg(c, "租户不存在")
		return
	}

	var req UpdateTenantPlanRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}

	// Get existing plan (or create default)
	plan, err := model.GetTenantPlan(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	// Apply updates
	if req.PlanName != "" {
		plan.PlanName = req.PlanName
	}
	if req.QuotaLimit != nil {
		plan.QuotaLimit = *req.QuotaLimit
	}
	if req.RPMLimit != nil {
		plan.RPMLimit = *req.RPMLimit
	}
	if req.TPMLimit != nil {
		plan.TPMLimit = *req.TPMLimit
	}
	if req.MaxMembers != nil {
		plan.MaxMembers = *req.MaxMembers
	}
	if req.MaxTokens != nil {
		plan.MaxTokens = *req.MaxTokens
	}
	if req.MaxChannels != nil {
		plan.MaxChannels = *req.MaxChannels
	}
	// AllowedModels: always update (empty string means allow all)
	plan.AllowedModels = req.AllowedModels
	if req.Status != nil {
		plan.Status = *req.Status
	}
	if req.ExpiresAt != nil {
		plan.ExpiresAt = *req.ExpiresAt
	}

	if err := model.UpsertTenantPlan(plan); err != nil {
		common.ApiError(c, err)
		return
	}

	// Re-fetch to return the latest state
	updated, err := model.GetTenantPlan(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	common.ApiSuccess(c, updated)
}

// ListTenantPlans returns all tenant plans for platform admin.
// GET /api/platform/tenants/plans (PlatformAdminAuth)
func ListTenantPlans(c *gin.Context) {
	plans, err := model.GetAllTenantPlans()
	if err != nil {
		common.ApiError(c, err)
		return
	}

	common.ApiSuccess(c, plans)
}
