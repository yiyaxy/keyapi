package tenant

import (
	"crypto/rand"
	"encoding/hex"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

type InviteMemberRequest struct {
	Email string `json:"email" binding:"required"`
	Role  int    `json:"role"`
}

type RemoveMemberRequest struct {
	UserId int `json:"user_id" binding:"required"`
}

func generateInviteToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func InviteMember(c *gin.Context) {
	var req InviteMemberRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "参数错误: email 为必填项")
		return
	}
	tenantId := middleware.GetTenantId(c)
	operatorId := c.GetInt("id")
	role := req.Role
	if !model.IsValidTenantRole(role) {
		role = model.TenantRoleMember
	}

	// Check member limit from tenant plan
	plan, err := model.GetTenantPlan(tenantId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if plan.MaxMembers > 0 {
		currentCount, err := model.CountActiveTenantMembers(tenantId)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		if currentCount >= int64(plan.MaxMembers) {
			common.ApiErrorMsg(c, "已达到租户计划的成员数量上限")
			return
		}
	}

	// Try to find existing user by email
	user := &model.User{Email: req.Email}
	err = user.FillUserByEmail()
	if err == nil && user.Id > 0 {
		// User exists, directly add membership
		if err := model.EnsureTenantMembership(user.Id, tenantId, role, operatorId); err != nil {
			common.ApiError(c, err)
			return
		}
		service.RecordAudit(c, "membership.invite", "user", user.Id, gin.H{
			"email":  req.Email,
			"role":   role,
			"status": "joined",
		})
		common.ApiSuccess(c, gin.H{
			"status":  "joined",
			"user_id": user.Id,
			"email":   req.Email,
		})
		return
	}

	// User doesn't exist, create invite token
	token, err := generateInviteToken()
	if err != nil {
		common.ApiErrorMsg(c, "生成邀请令牌失败")
		return
	}
	invite := &model.TenantInvite{
		TenantId:  tenantId,
		Email:     req.Email,
		Token:     token,
		Role:      role,
		InvitedBy: operatorId,
		ExpiresAt: time.Now().Add(48 * time.Hour).Unix(),
	}
	if err := model.CreateTenantInvite(invite); err != nil {
		common.ApiError(c, err)
		return
	}
	service.RecordAudit(c, "membership.invite", "user", 0, gin.H{
		"email":  req.Email,
		"role":   role,
		"status": "invited",
	})
	common.ApiSuccess(c, gin.H{
		"status": "invited",
		"email":  req.Email,
		"token":  token,
	})
}

func AcceptInvite(c *gin.Context) {
	token := c.Query("token")
	if token == "" {
		common.ApiErrorMsg(c, "缺少邀请令牌")
		return
	}
	invite, err := model.GetTenantInviteByToken(token)
	if err != nil {
		common.ApiErrorMsg(c, "无效的邀请令牌")
		return
	}
	if invite.Status != model.TenantInviteStatusPending {
		common.ApiErrorMsg(c, "邀请已被使用或已过期")
		return
	}
	if time.Now().Unix() > invite.ExpiresAt {
		common.ApiErrorMsg(c, "邀请已过期")
		return
	}
	userId := c.GetInt("id")
	if userId <= 0 {
		common.ApiErrorMsg(c, "请先登录")
		return
	}
	// Re-check member limit at acceptance time
	plan, planErr := model.GetTenantPlan(invite.TenantId)
	if planErr != nil {
		common.ApiError(c, planErr)
		return
	}
	if plan.MaxMembers > 0 {
		currentCount, countErr := model.CountActiveTenantMembers(invite.TenantId)
		if countErr != nil {
			common.ApiError(c, countErr)
			return
		}
		if currentCount >= int64(plan.MaxMembers) {
			common.ApiErrorMsg(c, "该租户已达到成员数量上限，无法接受邀请")
			return
		}
	}
	if err := model.EnsureTenantMembership(userId, invite.TenantId, invite.Role, invite.InvitedBy); err != nil {
		common.ApiError(c, err)
		return
	}
	if err := model.MarkInviteAccepted(invite.Id); err != nil {
		common.ApiError(c, err)
		return
	}
	service.RecordAudit(c, "membership.accept", "user", userId, gin.H{
		"role":      invite.Role,
		"tenant_id": invite.TenantId,
	})
	common.ApiSuccess(c, gin.H{
		"tenant_id": invite.TenantId,
		"role":      invite.Role,
	})
}

func RemoveMember(c *gin.Context) {
	var req RemoveMemberRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.UserId <= 0 {
		common.ApiErrorMsg(c, "参数错误: user_id 为必填项")
		return
	}
	tenantId := middleware.GetTenantId(c)
	operatorId := c.GetInt("id")
	if req.UserId == operatorId {
		common.ApiErrorMsg(c, "不能移除自己")
		return
	}
	if tenantId == model.DefaultTenantId {
		adminCount, err := model.CountTenantAdmins(tenantId)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		membership, err := model.GetTenantMembership(tenantId, req.UserId)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		if membership.Role == model.TenantRoleAdmin && adminCount <= 1 {
			common.ApiErrorMsg(c, "不能移除默认租户的最后一个管理员")
			return
		}
	}
	if err := model.RemoveTenantMembership(tenantId, req.UserId); err != nil {
		common.ApiError(c, err)
		return
	}
	service.RecordAudit(c, "membership.remove", "user", req.UserId, gin.H{})
	common.ApiSuccess(c, nil)
}
