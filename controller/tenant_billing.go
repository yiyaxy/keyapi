package controller

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

// ListTenantBillsHandler GET /api/tenant/bills
func ListTenantBillsHandler(c *gin.Context) {
	tenantId := middleware.GetTenantId(c)
	if tenantId <= 0 {
		common.ApiErrorMsg(c, "租户信息无效")
		return
	}
	pageInfo := common.GetPageQuery(c)
	status := c.Query("status")
	items, total, err := model.ListTenantBills(tenantId, pageInfo, status)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(items)
	common.ApiSuccess(c, pageInfo)
}

// RefreshCurrentTenantBillHandler POST /api/tenant/bills/current/refresh
// 租户管理员手动刷新当前月度账单快照（通常由定时任务负责，但允许随时拉一次最新数据）。
func RefreshCurrentTenantBillHandler(c *gin.Context) {
	tenantId := middleware.GetTenantId(c)
	if tenantId <= 0 {
		common.ApiErrorMsg(c, "租户信息无效")
		return
	}
	bill, err := service.GenerateTenantBill(tenantId, 0, 0)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, bill)
}

// ListTenantLedgerHandler GET /api/tenant/ledger
func ListTenantLedgerHandler(c *gin.Context) {
	tenantId := middleware.GetTenantId(c)
	if tenantId <= 0 {
		common.ApiErrorMsg(c, "租户信息无效")
		return
	}
	pageInfo := common.GetPageQuery(c)
	ledgerType := c.Query("ledger_type")
	items, total, err := model.ListTenantLedger(tenantId, pageInfo, ledgerType)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(items)
	common.ApiSuccess(c, pageInfo)
}
