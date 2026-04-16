package middleware

import (
	"errors"
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

func setRoleContext(c *gin.Context, user *model.User, info *model.MembershipAuthInfo) {
	if user == nil || info == nil {
		return
	}
	c.Set("role", info.EffectiveRole)
	c.Set(string(constant.ContextKeyPlatformRole), info.PlatformRole)
	c.Set(string(constant.ContextKeyTenantRole), info.TenantRole)
	c.Set("platform_role", info.PlatformRole)
	c.Set("tenant_role", info.TenantRole)
	common.SetContextKey(c, constant.ContextKeyPlatformRole, info.PlatformRole)
	common.SetContextKey(c, constant.ContextKeyTenantRole, info.TenantRole)
}

func resolveMembershipAuthInfo(c *gin.Context, user *model.User) (*model.MembershipAuthInfo, error) {
	if user == nil || user.Id <= 0 {
		return nil, errors.New("invalid user")
	}
	tenantId := GetTenantId(c)
	info, err := model.GetTenantMembershipAuthInfo(tenantId, user)
	if err != nil {
		return nil, err
	}
	if user.Status != common.UserStatusEnabled {
		return nil, errors.New("user disabled")
	}
	if info.TenantStatus != model.TenantMembershipStatusActive {
		return nil, errors.New("tenant membership inactive")
	}
	return info, nil
}

func writeTenantAuthFailure(c *gin.Context, message string, statusCode int) {
	c.JSON(statusCode, gin.H{
		"success": false,
		"message": message,
	})
	c.Abort()
}

func TenantAdminAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !authHelper(c, common.RoleCommonUser) {
			return
		}
		user := &model.User{
			Id:     c.GetInt("id"),
			Role:   c.GetInt("role"),
			Status: common.UserStatusEnabled,
		}
		if user.Id <= 0 {
			writeTenantAuthFailure(c, "无权进行此操作，未登录", http.StatusUnauthorized)
			return
		}
		if cached, err := model.GetUserByIdWithContext(c.Request.Context(), user.Id, false); err == nil && cached != nil {
			user.Role = cached.Role
			user.Status = cached.Status
		}
		info, err := resolveMembershipAuthInfo(c, user)
		if err != nil {
			writeTenantAuthFailure(c, "无权进行此操作，当前租户成员状态无效", http.StatusForbidden)
			return
		}
		if info.TenantRole < model.TenantRoleAdmin && info.PlatformRole < common.RoleAdminUser {
			writeTenantAuthFailure(c, "无权进行此操作，权限不足", http.StatusForbidden)
			return
		}
		setRoleContext(c, user, info)
		c.Next()
	}
}

func PlatformAdminAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !authHelper(c, common.RoleAdminUser) {
			return
		}
		user := &model.User{
			Id:     c.GetInt("id"),
			Role:   c.GetInt("role"),
			Status: common.UserStatusEnabled,
		}
		if cached, err := model.GetUserByIdWithContext(c.Request.Context(), user.Id, false); err == nil && cached != nil {
			user.Role = cached.Role
			user.Status = cached.Status
		}
		if user.Role < common.RoleAdminUser {
			writeTenantAuthFailure(c, "无权进行此操作，权限不足", http.StatusForbidden)
			return
		}
		info, err := resolveMembershipAuthInfo(c, user)
		if err != nil {
			if user.Role < common.RoleAdminUser {
				writeTenantAuthFailure(c, "无权进行此操作，当前租户成员状态无效", http.StatusForbidden)
				return
			}
			info = &model.MembershipAuthInfo{
				PlatformRole:  user.Role,
				TenantRole:    model.TenantRoleAdmin,
				TenantStatus:  model.TenantMembershipStatusActive,
				EffectiveRole: user.Role,
			}
		}
		setRoleContext(c, user, info)
		c.Next()
	}
}
