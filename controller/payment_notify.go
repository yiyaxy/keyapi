package controller

import (
	"io"
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service/payment"

	"github.com/gin-gonic/gin"
)

// HandleWechatNotify handles POST /api/payment/wechat/notify/:tenant_id/:order_type
//
// Flow:
//  1. Parse :tenant_id and :order_type from URL (route guarantee, but validate).
//  2. Read raw body (needed twice: for signature verify and decryption).
//  3. Extract relevant headers into a plain map for provider layer.
//  4. provider.VerifyAndParseNotify returns NotifyResult.
//  5. Defense-in-depth: out_trade_no prefix must match :tenant_id and :order_type.
//  6. If Success, call service/payment.ApplyPaymentSuccess (idempotent).
//  7. Respond with HTTP 200 + the WeChat-required {"code":"SUCCESS","message":"OK"}.
//     On any error, respond 200 + {"code":"FAIL","message":...} so WeChat retries.
func HandleWechatNotify(c *gin.Context) {
	tenantId, err := strconv.Atoi(c.Param("tenant_id"))
	if err != nil || tenantId <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"code": "FAIL", "message": "invalid tenant_id"})
		return
	}
	orderType := c.Param("order_type")
	if orderType != "topup" && orderType != "sub" {
		c.JSON(http.StatusBadRequest, gin.H{"code": "FAIL", "message": "invalid order_type"})
		return
	}

	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		respondNotifyFail(c, "read body: "+err.Error())
		return
	}

	// Flatten headers (keep only first value per key; wechatpay-go's handler
	// reads headers via Get(), which returns first).
	headers := make(map[string]string, len(c.Request.Header))
	for k, vs := range c.Request.Header {
		if len(vs) > 0 {
			headers[k] = vs[0]
		}
	}

	provider, ok := payment.Get("wechat")
	if !ok {
		respondNotifyFail(c, "wechat provider missing")
		return
	}
	result, err := provider.VerifyAndParseNotify(c.Request.Context(), tenantId, body, headers)
	if err != nil {
		common.SysError("wechat notify verify failed tenant=" + strconv.Itoa(tenantId) + ": " + err.Error())
		respondNotifyFail(c, "verify failed")
		return
	}

	// Defense-in-depth: out_trade_no must match route.
	if err := model.ValidateOutTradeNoRoute(result.OutTradeNo, tenantId, orderType); err != nil {
		common.SysError("wechat notify route mismatch: " + err.Error())
		_ = model.CreateTenantAuditLog(&model.TenantAuditLog{
			TenantId: tenantId, Action: "payment.notify.mismatch",
			Detail: `{"out_trade_no":"` + result.OutTradeNo + `","order_type":"` + orderType + `"}`,
		})
		respondNotifyFail(c, "route mismatch")
		return
	}

	if !result.Success {
		// Not a success transition (e.g., USERPAYING) — ack and wait.
		respondNotifyOk(c)
		return
	}
	if err := payment.ApplyPaymentSuccess(c.Request.Context(), result.OutTradeNo, result.TransactionId, result.PaidAt); err != nil {
		common.SysError("ApplyPaymentSuccess failed: " + err.Error())
		respondNotifyFail(c, "apply failed")
		return
	}
	respondNotifyOk(c)
}

func respondNotifyOk(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"code": "SUCCESS", "message": "OK"})
}
func respondNotifyFail(c *gin.Context, msg string) {
	c.JSON(http.StatusOK, gin.H{"code": "FAIL", "message": msg})
}
