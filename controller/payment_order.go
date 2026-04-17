package controller

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// paymentOrderView is the safe projection for API responses. Does NOT
// include openid (PII) or raw metadata (may contain server-only JSON).
type paymentOrderView struct {
	Id             int    `json:"id"`
	OutTradeNo     string `json:"out_trade_no"`
	TransactionId  string `json:"transaction_id,omitempty"`
	Provider       string `json:"provider"`
	OrderType      string `json:"order_type"`
	ProductForm    string `json:"product_form"`
	Amount         int64  `json:"amount"`
	RefundedAmount int64  `json:"refunded_amount"`
	Currency       string `json:"currency"`
	Status         string `json:"status"`
	PaidAt         int64  `json:"paid_at"`
	ExpiresAt      int64  `json:"expires_at"`
	CreatedAt      int64  `json:"created_at"`
	UpdatedAt      int64  `json:"updated_at"`
}

func toOrderView(o *model.PaymentOrder) paymentOrderView {
	return paymentOrderView{
		Id: o.Id, OutTradeNo: o.OutTradeNo, TransactionId: o.TransactionId,
		Provider: o.Provider, OrderType: o.OrderType, ProductForm: o.ProductForm,
		Amount: o.Amount, RefundedAmount: o.RefundedAmount, Currency: o.Currency,
		Status: o.Status, PaidAt: o.PaidAt, ExpiresAt: o.ExpiresAt,
		CreatedAt: o.CreatedAt, UpdatedAt: o.UpdatedAt,
	}
}

// GetPaymentOrderByOutTradeNoHandler returns a single order. Authz:
//   - session.user_id == order.user_id  (the payer themselves), OR
//   - session.tenant_role >= model.TenantRoleAdmin AND session.tenant_id == order.tenant_id
//
// Any other case returns 404 (not 403) to avoid leaking order existence.
func GetPaymentOrderByOutTradeNoHandler(c *gin.Context) {
	outTradeNo := c.Param("out_trade_no")
	if outTradeNo == "" {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "not found"})
		return
	}
	order, err := model.GetPaymentOrderByOutTradeNo(outTradeNo)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "not found"})
			return
		}
		common.ApiError(c, err)
		return
	}

	sessionUserId := c.GetInt("id")
	sessionTenantId := middleware.GetTenantId(c)
	tenantRole := c.GetInt("tenant_role")

	isPayer := sessionUserId > 0 && sessionUserId == order.UserId
	isTenantAdmin := sessionTenantId > 0 && sessionTenantId == order.TenantId && tenantRole >= model.TenantRoleAdmin
	if !isPayer && !isTenantAdmin {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "not found"})
		return
	}
	common.ApiSuccess(c, toOrderView(order))
}

// ListTenantPaymentOrders returns a paginated list for the current tenant.
// Tenant admin only (route layer enforces).
func ListTenantPaymentOrders(c *gin.Context) {
	tid := middleware.GetTenantId(c)
	if tid <= 0 {
		common.ApiErrorMsg(c, "无法解析当前租户")
		return
	}
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	if page < 1 {
		page = 1
	}
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	orderType := c.Query("order_type")
	status := c.Query("status")

	q := model.WithTenantBypass(model.DB).Model(&model.PaymentOrder{}).
		Where("tenant_id = ?", tid)
	if orderType != "" {
		q = q.Where("order_type = ?", orderType)
	}
	if status != "" {
		q = q.Where("status = ?", status)
	}
	var total int64
	if err := q.Count(&total).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	var rows []model.PaymentOrder
	if err := q.Order("id DESC").
		Offset((page - 1) * pageSize).Limit(pageSize).
		Find(&rows).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	views := make([]paymentOrderView, len(rows))
	for i := range rows {
		views[i] = toOrderView(&rows[i])
	}
	common.ApiSuccess(c, gin.H{
		"items":     views,
		"total":     total,
		"page":      page,
		"page_size": pageSize,
	})
}
