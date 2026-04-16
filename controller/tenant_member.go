package controller

import (
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

type UpdateTenantMemberRequest struct {
	UserId int `json:"user_id"`
	Role   int `json:"role"`
	Status int `json:"status"`
}

func ListTenantMembers(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	keyword := c.Query("keyword")
	status, _ := strconv.Atoi(c.Query("status"))
	items, total, err := model.ListTenantMembers(middleware.GetTenantId(c), pageInfo, keyword, status)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(items)
	common.ApiSuccess(c, pageInfo)
}

func UpdateTenantMember(c *gin.Context) {
	var req UpdateTenantMemberRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.UserId <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	tenantId := middleware.GetTenantId(c)
	operatorId := c.GetInt("id")
	if req.UserId == operatorId {
		common.ApiErrorMsg(c, "不能修改自己的租户成员身份")
		return
	}
	if req.Role != 0 {
		if !model.IsValidTenantRole(req.Role) {
			common.ApiErrorMsg(c, "无效的租户角色")
			return
		}
		if err := model.UpdateTenantMembershipRole(tenantId, req.UserId, req.Role); err != nil {
			common.ApiError(c, err)
			return
		}
	}
	if req.Status != 0 {
		if !model.IsValidTenantMembershipStatus(req.Status) {
			common.ApiErrorMsg(c, "无效的成员状态")
			return
		}
		if err := model.UpdateTenantMembershipStatus(tenantId, req.UserId, req.Status); err != nil {
			common.ApiError(c, err)
			return
		}
	}
	membership, err := model.GetTenantMembershipUnscoped(tenantId, req.UserId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{
		"user_id":           membership.UserId,
		"tenant_role":       membership.Role,
		"membership_status": membership.Status,
	})
}
