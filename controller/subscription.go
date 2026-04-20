package controller

import (
	"errors"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// ---- Shared types ----

type SubscriptionPlanDTO struct {
	Plan model.SubscriptionPlan `json:"plan"`
}

type BillingPreferenceRequest struct {
	BillingPreference       string `json:"billing_preference"`
	PreferredSubscriptionId *int   `json:"preferred_subscription_id,omitempty"`
}

// ---- User APIs ----

func GetSubscriptionPlans(c *gin.Context) {
	var plans []model.SubscriptionPlan
	tenantId := middleware.GetTenantId(c)
	query := model.DB.Where("status IN ?", []string{model.SubscriptionPlanStatusActive, model.SubscriptionPlanStatusSoldOut})
	if tenantId > 0 {
		query = query.Where("tenant_id = ?", tenantId)
	}
	if err := query.Order("sort_order desc, id desc").Find(&plans).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	lang := c.Query("lang")
	result := make([]SubscriptionPlanDTO, 0, len(plans))
	for _, p := range plans {
		if lang != "" && lang != "zh" {
			translated, _ := service.TranslateContent("plan", strconv.Itoa(p.Id), map[string]string{"title": p.Title, "subtitle": p.Subtitle, "promo_highlights": p.PromoHighlights}, lang)
			if t, ok := translated["title"]; ok {
				p.Title = t
			}
			if t, ok := translated["subtitle"]; ok {
				p.Subtitle = t
			}
			if t, ok := translated["promo_highlights"]; ok {
				p.PromoHighlights = t
			}
		}
		result = append(result, SubscriptionPlanDTO{
			Plan: p,
		})
	}
	common.ApiSuccess(c, result)
}

func GetSubscriptionSelf(c *gin.Context) {
	userId := c.GetInt("id")
	tenantId := middleware.GetTenantId(c)
	settingMap, _ := model.GetUserSetting(userId, false)
	pref := common.NormalizeBillingPreference(settingMap.BillingPreference)

	// Get all subscriptions (including expired)
	allSubscriptions, err := model.GetAllUserSubscriptions(tenantId, userId)
	if err != nil {
		allSubscriptions = []model.SubscriptionSummary{}
	}

	// Get active subscriptions for backward compatibility
	activeSubscriptions, err := model.GetAllActiveUserSubscriptions(tenantId, userId)
	if err != nil {
		activeSubscriptions = []model.SubscriptionSummary{}
	}

	common.ApiSuccess(c, gin.H{
		"billing_preference":        pref,
		"preferred_subscription_id": settingMap.PreferredSubscriptionId,
		"subscriptions":             activeSubscriptions, // all active subscriptions
		"all_subscriptions":         allSubscriptions,    // all subscriptions including expired
	})
}

func ActivateSubscription(c *gin.Context) {
	userId := c.GetInt("id")
	tenantId := middleware.GetTenantId(c)
	subId, err := strconv.Atoi(c.Param("id"))
	if err != nil || subId <= 0 {
		common.ApiErrorMsg(c, "无效的订阅ID")
		return
	}
	if err := model.ActivateUserSubscription(tenantId, userId, subId); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

func UpdateSubscriptionPreference(c *gin.Context) {
	userId := c.GetInt("id")
	var req BillingPreferenceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	pref := common.NormalizeBillingPreference(req.BillingPreference)

	user, err := model.GetUserById(userId, true)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	current := user.GetSetting()
	current.BillingPreference = pref
	if req.PreferredSubscriptionId != nil {
		current.PreferredSubscriptionId = *req.PreferredSubscriptionId
	}
	user.SetSetting(current)
	if err := user.Update(false); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{
		"billing_preference":        pref,
		"preferred_subscription_id": current.PreferredSubscriptionId,
	})
}

// ---- Admin APIs ----

func AdminListSubscriptionPlans(c *gin.Context) {
	var plans []model.SubscriptionPlan
	tenantId := middleware.GetTenantId(c)
	query := model.DB.Model(&model.SubscriptionPlan{})
	if tenantId > 0 {
		query = query.Where("tenant_id = ?", tenantId)
	}
	if err := query.Order("sort_order desc, id desc").Find(&plans).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	result := make([]SubscriptionPlanDTO, 0, len(plans))
	for _, p := range plans {
		result = append(result, SubscriptionPlanDTO{
			Plan: p,
		})
	}
	common.ApiSuccess(c, result)
}

type AdminUpsertSubscriptionPlanRequest struct {
	Plan model.SubscriptionPlan `json:"plan"`
}

func normalizeSubscriptionPlanStatusAndEnabled(plan *model.SubscriptionPlan) {
	if plan == nil {
		return
	}
	status := model.NormalizeSubscriptionPlanStatus(plan.Status)
	if !plan.Enabled && strings.TrimSpace(plan.Status) == "" {
		status = model.SubscriptionPlanStatusDisabled
	}
	plan.Status = status
	plan.Enabled = model.SubscriptionPlanStatusAllowsPublicList(status)
}

func AdminCreateSubscriptionPlan(c *gin.Context) {
	var req AdminUpsertSubscriptionPlanRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	req.Plan.Id = 0
	req.Plan.TenantId = middleware.GetTenantId(c) // 强制覆盖，防止客户端伪造
	normalizeSubscriptionPlanStatusAndEnabled(&req.Plan)
	if strings.TrimSpace(req.Plan.Title) == "" {
		common.ApiErrorMsg(c, "套餐标题不能为空")
		return
	}
	if req.Plan.PriceAmount < 0 {
		common.ApiErrorMsg(c, "价格不能为负数")
		return
	}
	if req.Plan.PriceAmount > 9999 {
		common.ApiErrorMsg(c, "价格不能超过9999")
		return
	}
	if req.Plan.Currency == "" {
		req.Plan.Currency = "USD"
	}
	req.Plan.Currency = "USD"
	if req.Plan.DurationUnit == "" {
		req.Plan.DurationUnit = model.SubscriptionDurationMonth
	}
	if req.Plan.DurationValue <= 0 && req.Plan.DurationUnit != model.SubscriptionDurationCustom {
		req.Plan.DurationValue = 1
	}
	if req.Plan.MaxPurchasePerUser < 0 {
		common.ApiErrorMsg(c, "购买上限不能为负数")
		return
	}
	if req.Plan.InviterRewardAmount < 0 {
		common.ApiErrorMsg(c, "邀请人奖励金额不能为负数")
		return
	}
	if req.Plan.TotalAmount < 0 {
		common.ApiErrorMsg(c, "总额度不能为负数")
		return
	}
	req.Plan.UpgradeGroup = strings.TrimSpace(req.Plan.UpgradeGroup)
	if req.Plan.UpgradeGroup != "" {
		if _, ok := ratio_setting.GetGroupRatioCopy()[req.Plan.UpgradeGroup]; !ok {
			common.ApiErrorMsg(c, "升级分组不存在")
			return
		}
	}
	req.Plan.PromoHighlights = strings.TrimSpace(req.Plan.PromoHighlights)
	if req.Plan.PromoHighlights != "" {
		lines := strings.Split(req.Plan.PromoHighlights, "\n")
		nonEmpty := 0
		for _, l := range lines {
			if strings.TrimSpace(l) != "" {
				nonEmpty++
			}
		}
		if nonEmpty > 5 {
			common.ApiErrorMsg(c, "卖点最多支持 5 条")
			return
		}
	}
	req.Plan.QuotaResetPeriod = model.NormalizeResetPeriod(req.Plan.QuotaResetPeriod)
	if req.Plan.QuotaResetPeriod == model.SubscriptionResetCustom && req.Plan.QuotaResetCustomSeconds <= 0 {
		common.ApiErrorMsg(c, "自定义重置周期需大于0秒")
		return
	}
	err := model.DB.Create(&req.Plan).Error
	if err != nil {
		common.ApiError(c, err)
		return
	}
	model.InvalidateSubscriptionPlanCache(req.Plan.Id)
	common.ApiSuccess(c, req.Plan)
}

func AdminUpdateSubscriptionPlan(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	if id <= 0 {
		common.ApiErrorMsg(c, "无效的ID")
		return
	}
	var req AdminUpsertSubscriptionPlanRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	if strings.TrimSpace(req.Plan.Title) == "" {
		common.ApiErrorMsg(c, "套餐标题不能为空")
		return
	}
	if req.Plan.PriceAmount < 0 {
		common.ApiErrorMsg(c, "价格不能为负数")
		return
	}
	if req.Plan.PriceAmount > 9999 {
		common.ApiErrorMsg(c, "价格不能超过9999")
		return
	}
	req.Plan.Id = id
	normalizeSubscriptionPlanStatusAndEnabled(&req.Plan)
	if req.Plan.Currency == "" {
		req.Plan.Currency = "USD"
	}
	req.Plan.Currency = "USD"
	if req.Plan.DurationUnit == "" {
		req.Plan.DurationUnit = model.SubscriptionDurationMonth
	}
	if req.Plan.DurationValue <= 0 && req.Plan.DurationUnit != model.SubscriptionDurationCustom {
		req.Plan.DurationValue = 1
	}
	if req.Plan.MaxPurchasePerUser < 0 {
		common.ApiErrorMsg(c, "购买上限不能为负数")
		return
	}
	if req.Plan.InviterRewardAmount < 0 {
		common.ApiErrorMsg(c, "邀请人奖励金额不能为负数")
		return
	}
	if req.Plan.TotalAmount < 0 {
		common.ApiErrorMsg(c, "总额度不能为负数")
		return
	}
	req.Plan.UpgradeGroup = strings.TrimSpace(req.Plan.UpgradeGroup)
	if req.Plan.UpgradeGroup != "" {
		if _, ok := ratio_setting.GetGroupRatioCopy()[req.Plan.UpgradeGroup]; !ok {
			common.ApiErrorMsg(c, "升级分组不存在")
			return
		}
	}
	req.Plan.PromoHighlights = strings.TrimSpace(req.Plan.PromoHighlights)
	if req.Plan.PromoHighlights != "" {
		lines := strings.Split(req.Plan.PromoHighlights, "\n")
		nonEmpty := 0
		for _, l := range lines {
			if strings.TrimSpace(l) != "" {
				nonEmpty++
			}
		}
		if nonEmpty > 5 {
			common.ApiErrorMsg(c, "卖点最多支持 5 条")
			return
		}
	}
	req.Plan.QuotaResetPeriod = model.NormalizeResetPeriod(req.Plan.QuotaResetPeriod)
	if req.Plan.QuotaResetPeriod == model.SubscriptionResetCustom && req.Plan.QuotaResetCustomSeconds <= 0 {
		common.ApiErrorMsg(c, "自定义重置周期需大于0秒")
		return
	}

	err := model.DB.Transaction(func(tx *gorm.DB) error {
		// update plan (allow zero values updates with map)
		updateMap := map[string]interface{}{
			"title":                      req.Plan.Title,
			"subtitle":                   req.Plan.Subtitle,
			"promo_highlights":           req.Plan.PromoHighlights,
			"price_amount":               req.Plan.PriceAmount,
			"currency":                   req.Plan.Currency,
			"duration_unit":              req.Plan.DurationUnit,
			"duration_value":             req.Plan.DurationValue,
			"custom_seconds":             req.Plan.CustomSeconds,
			"status":                     req.Plan.Status,
			"enabled":                    req.Plan.Enabled,
			"sort_order":                 req.Plan.SortOrder,
			"stripe_price_id":            req.Plan.StripePriceId,
			"creem_product_id":           req.Plan.CreemProductId,
			"max_purchase_per_user":      req.Plan.MaxPurchasePerUser,
			"inviter_reward_amount":      req.Plan.InviterRewardAmount,
			"total_amount":               req.Plan.TotalAmount,
			"upgrade_group":              req.Plan.UpgradeGroup,
			"quota_reset_period":         req.Plan.QuotaResetPeriod,
			"quota_reset_custom_seconds": req.Plan.QuotaResetCustomSeconds,
			"updated_at":                 common.GetTimestamp(),
		}
		tenantQuery := tx.Model(&model.SubscriptionPlan{}).Where("id = ?", id)
		if tid := middleware.GetTenantId(c); tid > 0 {
			tenantQuery = tenantQuery.Where("tenant_id = ?", tid)
		}
		result := tenantQuery.Updates(updateMap)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return errors.New("subscription plan not found")
		}
		return nil
	})
	if err != nil {
		common.ApiError(c, err)
		return
	}
	model.InvalidateSubscriptionPlanCache(id)
	_ = model.DeleteContentTranslationsByTypeAndId("plan", strconv.Itoa(id))
	common.ApiSuccess(c, nil)
}

type AdminUpdateSubscriptionPlanStatusRequest struct {
	Status  *string `json:"status"`
	Enabled *bool   `json:"enabled"`
}

func AdminUpdateSubscriptionPlanStatus(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	if id <= 0 {
		common.ApiErrorMsg(c, "无效的ID")
		return
	}
	var req AdminUpdateSubscriptionPlanStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil || (req.Status == nil && req.Enabled == nil) {
		common.ApiErrorMsg(c, "参数错误")
		return
	}

	status := ""
	if req.Status != nil {
		status = model.NormalizeSubscriptionPlanStatus(*req.Status)
	} else if req.Enabled != nil {
		if *req.Enabled {
			status = model.SubscriptionPlanStatusActive
		} else {
			status = model.SubscriptionPlanStatusDisabled
		}
	}
	enabled := model.SubscriptionPlanStatusAllowsPublicList(status)
	statusQuery := model.DB.Model(&model.SubscriptionPlan{}).Where("id = ?", id)
	if tid := middleware.GetTenantId(c); tid > 0 {
		statusQuery = statusQuery.Where("tenant_id = ?", tid)
	}
	result := statusQuery.Updates(map[string]interface{}{
		"status":  status,
		"enabled": enabled,
	})
	if result.Error != nil {
		common.ApiError(c, result.Error)
		return
	}
	if result.RowsAffected == 0 {
		common.ApiErrorMsg(c, "subscription plan not found")
		return
	}
	model.InvalidateSubscriptionPlanCache(id)
	common.ApiSuccess(c, nil)
}

type AdminBindSubscriptionRequest struct {
	UserId int `json:"user_id"`
	PlanId int `json:"plan_id"`
}

func AdminBindSubscription(c *gin.Context) {
	var req AdminBindSubscriptionRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.UserId <= 0 || req.PlanId <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	tenantId := middleware.GetTenantId(c)
	msg, err := model.AdminBindSubscription(tenantId, req.UserId, req.PlanId, "")
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if msg != "" {
		common.ApiSuccess(c, gin.H{"message": msg})
		return
	}
	common.ApiSuccess(c, nil)
}

// ---- Admin: user subscription management ----

func AdminListUserSubscriptions(c *gin.Context) {
	userId, _ := strconv.Atoi(c.Param("id"))
	if userId <= 0 {
		common.ApiErrorMsg(c, "无效的用户ID")
		return
	}
	tenantId := middleware.GetTenantId(c)
	subs, err := model.GetAllUserSubscriptions(tenantId, userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, subs)
}

type AdminCreateUserSubscriptionRequest struct {
	PlanId int `json:"plan_id"`
}

// AdminCreateUserSubscription creates a new user subscription from a plan (no payment).
func AdminCreateUserSubscription(c *gin.Context) {
	userId, _ := strconv.Atoi(c.Param("id"))
	if userId <= 0 {
		common.ApiErrorMsg(c, "无效的用户ID")
		return
	}
	var req AdminCreateUserSubscriptionRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.PlanId <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	tenantId := middleware.GetTenantId(c)
	msg, err := model.AdminBindSubscription(tenantId, userId, req.PlanId, "")
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if msg != "" {
		common.ApiSuccess(c, gin.H{"message": msg})
		return
	}
	common.ApiSuccess(c, nil)
}

// AdminInvalidateUserSubscription cancels a user subscription immediately.
func AdminInvalidateUserSubscription(c *gin.Context) {
	subId, _ := strconv.Atoi(c.Param("id"))
	if subId <= 0 {
		common.ApiErrorMsg(c, "无效的订阅ID")
		return
	}
	tenantId := middleware.GetTenantId(c)
	msg, err := model.AdminInvalidateUserSubscription(tenantId, subId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if msg != "" {
		common.ApiSuccess(c, gin.H{"message": msg})
		return
	}
	common.ApiSuccess(c, nil)
}

// AdminDeleteUserSubscription hard-deletes a user subscription.
func AdminDeleteUserSubscription(c *gin.Context) {
	subId, _ := strconv.Atoi(c.Param("id"))
	if subId <= 0 {
		common.ApiErrorMsg(c, "无效的订阅ID")
		return
	}
	tenantId := middleware.GetTenantId(c)
	msg, err := model.AdminDeleteUserSubscription(tenantId, subId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if msg != "" {
		common.ApiSuccess(c, gin.H{"message": msg})
		return
	}
	common.ApiSuccess(c, nil)
}

// ---- Admin: subscription order management ----

// AdminListSubscriptionOrders returns paginated subscription orders with optional filters.
func AdminListSubscriptionOrders(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	keyword := c.Query("keyword")
	status := c.Query("status")
	tenantId := middleware.GetTenantId(c)
	orders, total, err := model.GetAllSubscriptionOrders(tenantId, pageInfo, keyword, status)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(orders)
	common.ApiSuccess(c, pageInfo)
}

type AdminCompleteSubscriptionOrderRequest struct {
	TradeNo string `json:"trade_no"`
}

// AdminCompleteSubscriptionOrder manually completes a pending subscription order.
func AdminCompleteSubscriptionOrder(c *gin.Context) {
	var req AdminCompleteSubscriptionOrderRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.TradeNo == "" {
		common.ApiErrorMsg(c, "参数错误")
		return
	}

	LockOrder(req.TradeNo)
	defer UnlockOrder(req.TradeNo)

	if err := model.CompleteSubscriptionOrder(req.TradeNo, ""); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}
