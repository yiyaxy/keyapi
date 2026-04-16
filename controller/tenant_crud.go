package controller

import (
	"regexp"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

var slugRegexp = regexp.MustCompile(`^[a-z0-9][a-z0-9\-]{1,62}[a-z0-9]$`)

type CreateTenantRequest struct {
	Name string `json:"name" binding:"required"`
	Slug string `json:"slug" binding:"required"`
}

type UpdateTenantRequest struct {
	Name   string `json:"name"`
	Status int    `json:"status"`
}

func CreateTenant(c *gin.Context) {
	var req CreateTenantRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "参数错误: name 和 slug 为必填项")
		return
	}
	if !slugRegexp.MatchString(req.Slug) {
		common.ApiErrorMsg(c, "slug 格式无效: 仅允许小写字母、数字和连字符，长度3-64")
		return
	}
	if existing := model.GetTenantBySlug(req.Slug); existing != nil {
		common.ApiErrorMsg(c, "slug 已被使用")
		return
	}
	tenant := &model.Tenant{
		Name:   req.Name,
		Slug:   req.Slug,
		Status: model.TenantStatusActive,
	}
	if err := model.CreateTenant(tenant); err != nil {
		common.ApiError(c, err)
		return
	}
	operatorId := c.GetInt("id")
	if err := model.EnsureTenantMembership(operatorId, tenant.Id, model.TenantRoleAdmin, 0); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, tenant)
}

func UpdateTenant(c *gin.Context) {
	var req UpdateTenantRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	tenantId := middleware.GetTenantId(c)
	tenant := model.GetTenantById(tenantId)
	if tenant == nil {
		common.ApiErrorMsg(c, "租户不存在")
		return
	}
	updates := make(map[string]interface{})
	if req.Name != "" {
		updates["name"] = req.Name
	}
	if req.Status != 0 {
		updates["status"] = req.Status
	}
	if len(updates) == 0 {
		common.ApiErrorMsg(c, "没有需要更新的字段")
		return
	}
	if err := model.UpdateTenant(tenantId, updates); err != nil {
		common.ApiError(c, err)
		return
	}
	model.ClearTenantCache()
	updated := model.GetTenantById(tenantId)
	common.ApiSuccess(c, updated)
}

func DeleteTenant(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorMsg(c, "无效的租户 ID")
		return
	}
	if id == model.DefaultTenantId {
		common.ApiErrorMsg(c, "不能删除默认租户")
		return
	}
	if err := model.UpdateTenant(id, map[string]interface{}{
		"status": model.TenantStatusDeleted,
	}); err != nil {
		common.ApiError(c, err)
		return
	}
	model.ClearTenantCache()
	common.ApiSuccess(c, nil)
}

func GetTenant(c *gin.Context) {
	tenantId := middleware.GetTenantId(c)
	tenant := model.GetTenantById(tenantId)
	if tenant == nil {
		common.ApiErrorMsg(c, "租户不存在")
		return
	}
	common.ApiSuccess(c, tenant)
}
