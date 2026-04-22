package user

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-contrib/sessions"
	"github.com/gin-gonic/gin"
)

// ListCurrentUserTenants GET /api/user/tenants
// 返回当前登录用户有 active 成员身份的所有租户。供前端租户切换器使用。
func ListCurrentUserTenants(c *gin.Context) {
	userId := c.GetInt("id")
	if userId <= 0 {
		common.ApiErrorMsg(c, "未登录")
		return
	}
	items, err := model.ListUserAccessibleTenants(userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, items)
}

type switchTenantRequest struct {
	TenantId int `json:"tenant_id" binding:"required"`
}

// SwitchTenant POST /api/user/tenant/switch
// 切换当前 session 的 tenant_id。用户必须是目标租户的 active 成员。
// 返回最新用户 payload（含新 tenant_id / tenant_role / effective role）。
func SwitchTenant(c *gin.Context) {
	userId := c.GetInt("id")
	if userId <= 0 {
		common.ApiErrorMsg(c, "未登录")
		return
	}
	var req switchTenantRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.TenantId <= 0 {
		common.ApiErrorMsg(c, "参数错误: tenant_id 必填且为正整数")
		return
	}
	tenant := model.GetTenantById(req.TenantId)
	if tenant == nil {
		common.ApiErrorMsg(c, "目标租户不存在或已停用")
		return
	}
	user, err := model.GetUserByIdWithContext(c, userId, false)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	// 平台 admin 可以直接切；非 admin 必须是 active 成员
	if user.Role < common.RoleAdminUser {
		ok, err := model.IsUserTenantMember(userId, req.TenantId)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		if !ok {
			common.ApiErrorMsg(c, "您不是目标租户成员")
			return
		}
	}
	info, err := model.GetTenantMembershipAuthInfo(req.TenantId, user)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	session := sessions.Default(c)
	session.Set("tenant_id", req.TenantId)
	session.Set("tenant_role", info.TenantRole)
	session.Set("role", info.EffectiveRole)
	if err := session.Save(); err != nil {
		common.ApiErrorMsg(c, "session 保存失败")
		return
	}
	common.ApiSuccess(c, gin.H{
		"tenant_id":   req.TenantId,
		"tenant_name": tenant.Name,
		"tenant_slug": tenant.Slug,
		"tenant_role": info.TenantRole,
		"role":        info.EffectiveRole,
	})
}
