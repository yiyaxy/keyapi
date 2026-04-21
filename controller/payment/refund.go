package payment

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	paymentsvc "github.com/QuantumNous/new-api/service/payment"
	"github.com/QuantumNous/new-api/setting/system_setting"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// paymentRefundView mirrors paymentOrderView's shape conventions: no PII,
// enough for an admin dashboard + order-detail drawer.
type paymentRefundView struct {
	Id                    int    `json:"id"`
	OutTradeNo            string `json:"out_trade_no"`
	OutRefundNo           string `json:"out_refund_no"`
	RefundId              string `json:"refund_id,omitempty"`
	PaymentOrderId        int    `json:"payment_order_id"`
	Amount                int64  `json:"amount"`
	Currency              string `json:"currency"`
	Reason                string `json:"reason"`
	Status                string `json:"status"`
	LastError             string `json:"last_error,omitempty"`
	InitiatedBy           int    `json:"initiated_by"`
	UserQuotaDelta        int64  `json:"user_quota_delta"`
	UserQuotaDeltaApplied int64  `json:"user_quota_delta_applied"`
	RefundedAt            int64  `json:"refunded_at"`
	CreatedAt             int64  `json:"created_at"`
	UpdatedAt             int64  `json:"updated_at"`
}

func toRefundView(r *model.PaymentRefund) paymentRefundView {
	return paymentRefundView{
		Id:                    r.Id,
		OutTradeNo:            r.OutTradeNo,
		OutRefundNo:           r.OutRefundNo,
		RefundId:              r.RefundId,
		PaymentOrderId:        r.PaymentOrderId,
		Amount:                r.Amount,
		Currency:              r.Currency,
		Reason:                r.Reason,
		Status:                r.Status,
		LastError:             r.LastError,
		InitiatedBy:           r.InitiatedBy,
		UserQuotaDelta:        r.UserQuotaDelta,
		UserQuotaDeltaApplied: r.UserQuotaDeltaApplied,
		RefundedAt:            r.RefundedAt,
		CreatedAt:             r.CreatedAt,
		UpdatedAt:             r.UpdatedAt,
	}
}

type createRefundRequest struct {
	OutTradeNo     string `json:"out_trade_no"`
	AmountCents    int64  `json:"amount_cents"`
	Reason         string `json:"reason"`
	UserQuotaDelta int64  `json:"user_quota_delta"` // 0 = keep user balance; otherwise deduct this many raw quota (clamped to 0)
}

// buildRefundNotifyUrl reuses the same ServerAddress validation as
// buildNotifyUrl; refund callbacks take a tenant id only (no order_type
// bifurcation — the refund callback body carries out_trade_no natively).
func buildRefundNotifyUrl(c *gin.Context) (string, error) {
	base := strings.TrimRight(strings.TrimSpace(system_setting.ServerAddress), "/")
	if base == "" {
		return "", errors.New("system ServerAddress is empty; cannot build notify URL")
	}
	if !strings.HasPrefix(base, "https://") && !strings.HasPrefix(base, "http://") {
		return "", errors.New("ServerAddress must include scheme (http:// or https://)")
	}
	if strings.Contains(base, "localhost") || strings.Contains(base, "127.0.0.1") {
		return "", errors.New("ServerAddress points to localhost/127.0.0.1; WeChat cannot reach it")
	}
	return fmt.Sprintf("%s/api/payment/wechat/refund_notify/%d",
		base, middleware.GetTenantId(c)), nil
}

// CreateWechatRefund handles POST /api/tenant/payment/refunds.
// Tenant admin only (route layer enforces).
func CreateWechatRefund(c *gin.Context) {
	tid := middleware.GetTenantId(c)
	if tid <= 0 {
		common.ApiErrorMsg(c, "无法解析当前租户")
		return
	}
	actorId := c.GetInt("id")

	var req createRefundRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	if req.OutTradeNo == "" || req.AmountCents <= 0 {
		common.ApiErrorMsg(c, "out_trade_no 或 amount_cents 非法")
		return
	}

	notifyUrl, err := buildRefundNotifyUrl(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	refund, err := paymentsvc.CreateRefund(c.Request.Context(), paymentsvc.CreateRefundInput{
		TenantId:       tid,
		InitiatedBy:    actorId,
		OutTradeNo:     req.OutTradeNo,
		AmountCents:    req.AmountCents,
		Reason:         req.Reason,
		NotifyUrl:      notifyUrl,
		UserQuotaDelta: req.UserQuotaDelta,
	})
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "订单不存在"})
			return
		}
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, toRefundView(refund))
}

// ListTenantPaymentRefundsHandler handles GET /api/tenant/payment/refunds.
// Paginated, filterable by status; tenant admin only.
func ListTenantPaymentRefundsHandler(c *gin.Context) {
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
	status := c.Query("status")

	rows, total, err := model.ListTenantPaymentRefunds(tid, status, pageSize, (page-1)*pageSize)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	views := make([]paymentRefundView, len(rows))
	for i := range rows {
		views[i] = toRefundView(&rows[i])
	}
	common.ApiSuccess(c, gin.H{
		"items":     views,
		"total":     total,
		"page":      page,
		"page_size": pageSize,
	})
}

// HandleWechatRefundNotify handles POST /api/payment/wechat/refund_notify/:tenant_id.
//
// Same shape as HandleWechatNotify but terminal transitions are driven by
// paymentsvc.ApplyRefundSuccess (for SUCCESS) or MarkRefundFailed / close
// (for CLOSED/ABNORMAL). PROCESSING is a no-op ack.
func HandleWechatRefundNotify(c *gin.Context) {
	tenantId, err := strconv.Atoi(c.Param("tenant_id"))
	if err != nil || tenantId <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"code": "FAIL", "message": "invalid tenant_id"})
		return
	}

	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		respondNotifyFail(c, "read body: "+err.Error())
		return
	}
	headers := make(map[string]string, len(c.Request.Header))
	for k, vs := range c.Request.Header {
		if len(vs) > 0 {
			headers[k] = vs[0]
		}
	}

	provider, ok := paymentsvc.Get("wechat")
	if !ok {
		respondNotifyFail(c, "wechat provider missing")
		return
	}
	result, err := provider.VerifyAndParseRefundNotify(c.Request.Context(), tenantId, body, headers)
	if err != nil {
		common.SysError("wechat refund notify verify failed tenant=" + strconv.Itoa(tenantId) + ": " + err.Error())
		respondNotifyFail(c, "verify failed")
		return
	}

	// Defense-in-depth: out_refund_no must match tenant in URL.
	if err := model.ValidateOutRefundNoRoute(result.OutRefundNo, tenantId); err != nil {
		common.SysError("wechat refund notify route mismatch: " + err.Error())
		_ = model.CreateTenantAuditLog(&model.TenantAuditLog{
			TenantId: tenantId, Action: "payment.refund.notify.mismatch",
			Detail: `{"out_refund_no":"` + result.OutRefundNo + `"}`,
		})
		respondNotifyFail(c, "route mismatch")
		return
	}

	switch strings.ToUpper(result.RefundStatus) {
	case "SUCCESS":
		if err := paymentsvc.ApplyRefundSuccess(
			c.Request.Context(),
			result.OutRefundNo, result.RefundId, result.SuccessTime, result.Amount,
		); err != nil {
			common.SysError("ApplyRefundSuccess failed: " + err.Error())
			respondNotifyFail(c, "apply failed")
			return
		}
	case "CLOSED", "ABNORMAL":
		if err := model.MarkRefundFailed(result.OutRefundNo, "provider status: "+result.RefundStatus); err != nil {
			common.SysError("MarkRefundFailed failed: " + err.Error())
			respondNotifyFail(c, "mark failed")
			return
		}
	case "PROCESSING":
		// Interim state — nothing to do, just ack so WeChat stops retrying.
	default:
		// Unknown state — log, ack (the SUCCESS/CLOSED callback will come later).
		common.SysLog("unknown refund status " + result.RefundStatus + " out_refund_no=" + result.OutRefundNo)
	}
	respondNotifyOk(c)
}
