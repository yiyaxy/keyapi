package tenant

import (
	"encoding/json"
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

// UpdateTenantMarkupRequest 是"租户自助调整对用户加价倍率"的请求体。
// 刻意不复用 UpdateTenantPlanRequest（那是超管权限），确保租户管理员
// 只能改 platform_markup 一个字段，不能越权改 quota/RPM/限流等。
type UpdateTenantMarkupRequest struct {
	PlatformMarkup *float64 `json:"platform_markup"`
}

// UpdateTenantPlanMarkup 让租户管理员自助调整对自己用户的加价倍率。
//
// 语义说明：
//   - platform_markup = 1.0：把平台给的渠道折扣（channel_ratio）完全传递给用户
//   - platform_markup > 1.0：对用户加价，相对吸收平台折扣（最终用户账单升高）
//   - platform_markup < 1.0：对用户再让利（用户账单低于平台已给的折扣）
//
// 不影响平台渠道额度（cap）消耗速度——那是按租户对平台的真实成本扣的
// （dual-ledger platform cost，见 service/billing.go）。
//
// 范围 [0.1, 10] 防止误输入极端值。channel 级 MarkupRatio 若已被超管设置，
// 会覆盖这里的 plan 级值（EffectiveMarkup 的 channel > plan 优先级）。
//
// PUT /api/tenant/plan/markup (TenantAdminAuth)
func UpdateTenantPlanMarkup(c *gin.Context) {
	tenantId := middleware.GetTenantId(c)
	if tenantId <= 0 {
		common.ApiErrorMsg(c, "租户信息无效")
		return
	}

	var req UpdateTenantMarkupRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.PlatformMarkup == nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	mk := *req.PlatformMarkup
	if mk < 0.1 || mk > 10 {
		common.ApiErrorMsg(c, "对用户加价倍率需在 0.1 到 10 之间")
		return
	}

	plan, err := model.GetTenantPlan(tenantId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	beforeMk := plan.PlatformMarkup
	plan.PlatformMarkup = mk
	if err := model.UpsertTenantPlan(plan); err != nil {
		common.ApiError(c, err)
		return
	}

	updated, err := model.GetTenantPlan(tenantId)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	_ = model.CreateTenantAuditLog(&model.TenantAuditLog{
		TenantId:    tenantId,
		ActorUserId: c.GetInt("id"),
		ActorRole:   "tenant_admin",
		Action:      "plan.markup.update",
		Target:      "plan",
		TargetId:    updated.Id,
		Detail: func() string {
			b, _ := json.Marshal(gin.H{"before": beforeMk, "after": mk})
			return string(b)
		}(),
		ClientIP: c.ClientIP(),
	})

	common.ApiSuccess(c, updated)
}

// UpdateTenantPlanRequest holds the fields that can be updated by platform admin.
type UpdateTenantPlanRequest struct {
	PlanName           string `json:"plan_name"`
	QuotaLimit         *int64 `json:"quota_limit"`
	RPMLimit           *int   `json:"rpm_limit"`
	TPMLimit           *int   `json:"tpm_limit"`
	MaxMembers         *int   `json:"max_members"`
	MaxTokens          *int   `json:"max_tokens"`
	MaxChannels        *int   `json:"max_channels"`
	AllowedModels      string `json:"allowed_models"`
	Status             *int   `json:"status"`
	ExpiresAt          *int64 `json:"expires_at"`
	GracePeriodSeconds *int64 `json:"grace_period_seconds"`
	// Renewal pricing (S2). Setting RenewPriceAmount > 0 is the signal that
	// a tenant admin can self-serve renew via WeChat Pay; <=0 disables the
	// renewal flow entirely.
	RenewPeriodDays     *int    `json:"renew_period_days"`
	RenewPriceAmount    *int64  `json:"renew_price_amount"`
	RenewCurrency       *string `json:"renew_currency"`
	PlatformQuotaCap    *int64  `json:"platform_quota_cap"`
	PlatformQuotaPeriod *string `json:"platform_quota_period"`
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
	// Capture before-state for audit diff (best-effort).
	planBeforeJSON := ""
	if b, err := json.Marshal(plan); err == nil {
		planBeforeJSON = string(b)
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
	if req.GracePeriodSeconds != nil {
		gp := *req.GracePeriodSeconds
		if gp < 0 {
			gp = 0
		}
		plan.GracePeriodSeconds = gp
	}
	if req.RenewPeriodDays != nil {
		d := *req.RenewPeriodDays
		if d < 0 {
			d = 0
		}
		plan.RenewPeriodDays = d
	}
	if req.RenewPriceAmount != nil {
		a := *req.RenewPriceAmount
		if a < 0 {
			a = 0
		}
		plan.RenewPriceAmount = a
	}
	if req.RenewCurrency != nil {
		plan.RenewCurrency = *req.RenewCurrency
	}
	if req.PlatformQuotaCap != nil {
		v := *req.PlatformQuotaCap
		if v < -1 {
			v = -1
		}
		plan.PlatformQuotaCap = v
	}
	if req.PlatformQuotaPeriod != nil {
		switch *req.PlatformQuotaPeriod {
		case model.PlatformQuotaPeriodNone, model.PlatformQuotaPeriodDaily, model.PlatformQuotaPeriodMonthly:
			plan.PlatformQuotaPeriod = *req.PlatformQuotaPeriod
		default:
			common.ApiErrorMsg(c, "无效的周期类型，必须是 none/daily/monthly")
			return
		}
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

	// Audit: platform admin updated a tenant plan. Write under the *target* tenant id
	// (not the operator's current tenant), so the audit lives with the affected tenant.
	planAfterJSON := ""
	if b, err := json.Marshal(updated); err == nil {
		planAfterJSON = string(b)
	}
	actorRole := "platform_admin"
	_ = model.CreateTenantAuditLog(&model.TenantAuditLog{
		TenantId:    id,
		ActorUserId: c.GetInt("id"),
		ActorRole:   actorRole,
		Action:      "plan.update",
		Target:      "plan",
		TargetId:    updated.Id,
		Detail: func() string {
			b, _ := json.Marshal(gin.H{
				"before": json.RawMessage(planBeforeJSON),
				"after":  json.RawMessage(planAfterJSON),
			})
			return string(b)
		}(),
		ClientIP: c.ClientIP(),
	})

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
