package user

import (
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

func UserCreateAffTransfer(c *gin.Context) {
	userId := c.GetInt("id")
	var req struct {
		Quota int `json:"quota"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	if float64(req.Quota) < common.QuotaPerUnit {
		common.ApiErrorMsg(c, "转移额度不足最小额度")
		return
	}

	// Check for pending requests
	pendingQuota, err := model.GetPendingQuotaByUserId(middleware.GetTenantId(c), userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if pendingQuota > 0 {
		common.ApiErrorMsg(c, "您有审核中的提现申请，请等待审核完成后再提交新申请")
		return
	}

	user, err := model.GetUserByIdWithContext(c, userId, true)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if user.AffQuota < req.Quota {
		common.ApiErrorMsg(c, "邀请额度不足")
		return
	}
	transferReq := &model.AffTransferRequest{
		TenantId: middleware.GetTenantId(c),
		UserId:   userId,
		Username: user.Username,
		Quota:    req.Quota,
		Status:   model.AffTransferStatusPending,
	}
	if err := model.CreateAffTransferRequest(transferReq); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, transferReq)
}

func UserGetAffTransferHistory(c *gin.Context) {
	userId := c.GetInt("id")
	page := common.GetPageQuery(c)
	status, _ := strconv.Atoi(c.Query("status"))
	requests, total, err := model.GetAffTransferRequestsByUserId(middleware.GetTenantId(c), userId, page, status)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	page.SetTotal(int(total))
	page.SetItems(requests)
	common.ApiSuccess(c, page)
}

func AdminGetAllAffTransfers(c *gin.Context) {
	page := common.GetPageQuery(c)
	keyword := c.Query("keyword")
	status, _ := strconv.Atoi(c.Query("status"))
	requests, total, err := model.GetAllAffTransferRequests(middleware.GetTenantId(c), page, keyword, status)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	page.SetTotal(int(total))
	page.SetItems(requests)
	common.ApiSuccess(c, page)
}

func AdminProcessAffTransfer(c *gin.Context) {
	var req struct {
		Id     int    `json:"id"`
		Action string `json:"action"`
		Remark string `json:"remark"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	adminId := c.GetInt("id")
	var err error
	switch req.Action {
	case "approve":
		err = model.ApproveAffTransferRequest(middleware.GetTenantId(c), req.Id, adminId, req.Remark)
	case "reject":
		err = model.RejectAffTransferRequest(middleware.GetTenantId(c), req.Id, adminId, req.Remark)
	default:
		common.ApiErrorMsg(c, "无效操作")
		return
	}
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

func AdminGetAffTransferStats(c *gin.Context) {
	stats, err := model.GetAffTransferStats(middleware.GetTenantId(c))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, stats)
}

func UserGetAffRebateLogs(c *gin.Context) {
	userId := c.GetInt("id")
	page := common.GetPageQuery(c)
	rebateType, _ := strconv.Atoi(c.Query("type"))
	logs, total, err := model.GetAffRebateLogsByUserId(middleware.GetTenantId(c), userId, page, rebateType)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	page.SetTotal(int(total))
	page.SetItems(logs)
	common.ApiSuccess(c, page)
}

func AdminBatchApproveAllPending(c *gin.Context) {
	var req struct {
		Remark string `json:"remark"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	adminId := c.GetInt("id")
	count, err := model.BatchApproveAllPendingRequests(middleware.GetTenantId(c), adminId, req.Remark)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, map[string]interface{}{
		"approved_count": count,
		"message":        "批量批准完成",
	})
}

func UserGetPendingQuota(c *gin.Context) {
	userId := c.GetInt("id")
	pendingQuota, err := model.GetPendingQuotaByUserId(middleware.GetTenantId(c), userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, map[string]interface{}{
		"pending_quota": pendingQuota,
	})
}
