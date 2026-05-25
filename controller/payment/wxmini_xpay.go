package payment

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	paymentsvc "github.com/QuantumNous/new-api/service/payment"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/shopspring/decimal"

	"github.com/gin-gonic/gin"
)

// xpay event names — kept here (not imported from the provider) because the
// controller needs to peek the envelope to route deliver vs refund callbacks
// before either provider method runs.
const (
	xpayEventGoodsDeliver = "xpay_goods_deliver_notify"
	xpayEventRefund       = "xpay_refund_notify"
)

type wxminiXpayOrderRequest struct {
	TierCode string `json:"tier_code"`
	Platform string `json:"platform"`
}

// wxminiPlatform resolves the caller's platform (android | ios) from either
// the body field or ?platform= query.
//
// Platform is REQUIRED — there is no default. iOS and Android have separate
// product_id rows in tenant_xpay_products (App Store vs Google Play comply
// with different store rules), and silently defaulting to android would
// quietly serve the wrong tier list / fail downstream when the product_id
// doesn't match the device. We intentionally trust the explicit client value
// instead of cross-checking User-Agent: browser testing and WeChat devtools can
// report a UA that does not match uni.getSystemInfoSync().platform.
func wxminiPlatform(c *gin.Context, in string) (string, error) {
	platform := strings.TrimSpace(strings.ToLower(in))
	if platform == "" {
		platform = strings.TrimSpace(strings.ToLower(c.Query("platform")))
	}
	if platform == "" {
		return "", errors.New("platform is required (android | ios)")
	}
	if platform != "android" && platform != "ios" {
		return "", errors.New("invalid platform")
	}
	return platform, nil
}

func wxminiXpayBaseQuota(amountCents int64) int64 {
	if amountCents <= 0 || common.QuotaPerUnit <= 0 || operation_setting.USDExchangeRate <= 0 {
		return 0
	}
	return decimal.NewFromInt(amountCents).
		Div(decimal.NewFromInt(100)).
		Div(decimal.NewFromFloat(operation_setting.USDExchangeRate)).
		Mul(decimal.NewFromFloat(common.QuotaPerUnit)).
		IntPart()
}

func wxminiXpayAmountUnits(amountCents int64) int64 {
	if amountCents <= 0 {
		return 0
	}
	units := amountCents / 100
	if amountCents%100 != 0 {
		units++
	}
	if units <= 0 {
		return 1
	}
	return units
}

func GetWxminiXpayTiers(c *gin.Context) {
	tid := middleware.GetTenantId(c)
	if tid <= 0 {
		common.ApiErrorMsg(c, "invalid tenant")
		return
	}
	cfg, err := model.GetTenantPaymentConfig(tid, "wechat")
	if err != nil || !cfg.XpayEnabled || cfg.PlatformLocked {
		common.ApiSuccess(c, []gin.H{})
		return
	}
	platform, err := wxminiPlatform(c, "")
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	userId := c.GetInt("id")
	rows, err := model.ListEnabledTenantXpayProducts(tid, platform)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	items := make([]gin.H, 0, len(rows))
	for i := range rows {
		baseQuota := wxminiXpayBaseQuota(rows[i].AmountCents)
		quotaPreview := model.GetUserLevelTopUpBonusPreview(userId, tid, baseQuota)
		items = append(items, gin.H{
			"tier_code":     rows[i].TierCode,
			"name":          rows[i].Name,
			"product_id":    rows[i].ProductId,
			"platform":      rows[i].Platform,
			"amount_cents":  rows[i].AmountCents,
			"quota_delta":   baseQuota,
			"quota_preview": quotaPreview,
		})
	}
	common.ApiSuccess(c, items)
}

func CreateWxminiTopupXpay(c *gin.Context) {
	if !requireUserSelfTopUpEnabled(c) {
		return
	}
	tid := middleware.GetTenantId(c)
	userId := c.GetInt("id")
	if tid <= 0 || userId <= 0 {
		common.ApiErrorMsg(c, "invalid session")
		return
	}
	var req wxminiXpayOrderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "invalid request")
		return
	}
	platform, err := wxminiPlatform(c, req.Platform)
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	product, err := model.GetTenantXpayProductByTier(tid, req.TierCode, platform)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if !product.Enabled || product.ProductId == "" || product.AmountCents <= 0 || product.QuotaDelta <= 0 {
		common.ApiErrorMsg(c, "xpay product is not available")
		return
	}
	baseQuota := wxminiXpayBaseQuota(product.AmountCents)
	if baseQuota <= 0 {
		common.ApiErrorMsg(c, "invalid xpay amount")
		return
	}
	quotaPreview := model.GetUserLevelTopUpBonusPreview(userId, tid, baseQuota)
	openid, err := resolveMiniOpenidForUser(c, userId)
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	notifyUrl, err := buildXpayNotifyUrl(tid, "topup")
	if err != nil {
		common.ApiError(c, err)
		return
	}
	amountUnits := wxminiXpayAmountUnits(product.AmountCents)
	resp, order, err := paymentsvc.CreateTopupOrder(c.Request.Context(), paymentsvc.CreateTopupOrderInput{
		TenantId:          tid,
		UserId:            userId,
		AmountCents:       product.AmountCents,
		AmountUnits:       amountUnits,
		QuotaDelta:        quotaPreview.TotalQuota,
		BaseQuotaDelta:    quotaPreview.BaseQuota,
		BonusQuotaDelta:   quotaPreview.BonusQuota,
		TopUpBonusPercent: quotaPreview.BonusPercent,
		UserLevelId:       quotaPreview.LevelId,
		UserLevelName:     quotaPreview.LevelName,
		ProductForm:       model.PaymentProductFormXpayGoods,
		XpayTierCode:      product.TierCode,
		XpayPlatform:      platform,
		Openid:            openid,
		ClientIp:          c.ClientIP(),
		Description:       product.Name,
		NotifyUrl:         notifyUrl,
	})
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{
		"order": gin.H{
			"out_trade_no": order.OutTradeNo,
			"amount":       order.Amount,
		},
		"quota_preview": quotaPreview,
		"response":      resp,
	})
}

func buildXpayNotifyUrl(tenantId int, orderType string) (string, error) {
	base := strings.TrimRight(strings.TrimSpace(system_setting.ServerAddress), "/")
	if base == "" {
		return "", errors.New("system ServerAddress is empty; cannot build xpay notify URL")
	}
	if !strings.HasPrefix(base, "https://") && !strings.HasPrefix(base, "http://") {
		return "", errors.New("ServerAddress must include scheme")
	}
	return fmt.Sprintf("%s/api/payment/wechat/xpay_notify/%d/%s", base, tenantId, orderType), nil
}

// HandleWechatXpayNotify is the single async-callback endpoint for WeChat
// mini-program virtual payment 2.0 (`short_series_goods` mode). The same URL
// receives BOTH payment-success deliver notifications and refund-status
// notifications; they are distinguished only by the envelope's `Event`
// field. This handler peeks at Event first, then dispatches to the
// appropriate provider method + downstream service flow.
func HandleWechatXpayNotify(c *gin.Context) {
	tenantId, orderType, ok := parseNotifyRoute(c)
	if !ok {
		c.JSON(http.StatusBadRequest, xpayAck(1, "invalid route", c.GetString("request_id")))
		return
	}
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusOK, xpayAck(1, "read body failed", c.GetString("request_id")))
		return
	}
	headers := make(map[string]string, len(c.Request.Header))
	for k, vs := range c.Request.Header {
		if len(vs) > 0 {
			headers[k] = vs[0]
		}
	}
	provider, ok := paymentsvc.Get("wechat_xpay")
	if !ok {
		c.JSON(http.StatusOK, xpayAck(1, "provider missing", c.GetString("request_id")))
		return
	}

	// Peek envelope to dispatch deliver vs refund. We only inspect the
	// `Event` field here; signature verification still happens inside the
	// provider's VerifyAndParse* method against the original body bytes.
	var peek struct {
		Event string `json:"Event"`
	}
	if err := json.Unmarshal(body, &peek); err != nil {
		common.SysError("xpay notify peek envelope failed: " + err.Error())
		c.JSON(http.StatusOK, xpayAck(1, "invalid envelope", c.GetString("request_id")))
		return
	}

	switch peek.Event {
	case xpayEventRefund:
		handleXpayRefundNotify(c, provider, tenantId, body, headers)
	case xpayEventGoodsDeliver, "":
		// Empty Event falls into deliver path so the provider's strict
		// check produces the same error response as before.
		handleXpayDeliverNotify(c, provider, tenantId, orderType, body, headers)
	default:
		// Unknown event — log + ack with data="OK" so WeChat stops retrying;
		// reconcile sweep + refund reconcile (S3) cover any state we missed.
		common.SysLog("xpay notify unknown event=" + peek.Event)
		c.JSON(http.StatusOK, xpayAck(0, "OK", c.GetString("request_id")))
	}
}

func handleXpayDeliverNotify(c *gin.Context, provider paymentsvc.Provider, tenantId int, orderType string, body []byte, headers map[string]string) {
	result, err := provider.VerifyAndParseNotify(c.Request.Context(), tenantId, body, headers)
	if err != nil {
		common.SysError("xpay notify verify failed: " + err.Error())
		c.JSON(http.StatusOK, xpayAck(1, "verify failed", c.GetString("request_id")))
		return
	}
	if err := model.ValidateOutTradeNoRoute(result.OutTradeNo, tenantId, orderType); err != nil {
		common.SysError("xpay notify route mismatch: " + err.Error())
		c.JSON(http.StatusOK, xpayAck(1, "route mismatch", c.GetString("request_id")))
		return
	}
	if result.Success {
		paidAt := result.PaidAt
		if paidAt == 0 {
			paidAt = time.Now().Unix()
		}
		if err := paymentsvc.ApplyPaymentSuccess(c.Request.Context(), result.OutTradeNo, result.TransactionId, paidAt); err != nil {
			common.SysError("xpay ApplyPaymentSuccess failed: " + err.Error())
			c.JSON(http.StatusOK, xpayAck(1, "apply failed", c.GetString("request_id")))
			return
		}
	} else if result.RawState == "TRANSACTION.PAYERROR" {
		_, _ = model.MarkOrderClosed(result.OutTradeNo, "xpay notify: "+result.RawState)
	}
	c.JSON(http.StatusOK, xpayAck(0, "OK", c.GetString("request_id")))
}

func handleXpayRefundNotify(c *gin.Context, provider paymentsvc.Provider, tenantId int, body []byte, headers map[string]string) {
	result, err := provider.VerifyAndParseRefundNotify(c.Request.Context(), tenantId, body, headers)
	if err != nil {
		common.SysError("xpay refund notify verify failed: " + err.Error())
		c.JSON(http.StatusOK, xpayAck(1, "verify failed", c.GetString("request_id")))
		return
	}
	if err := model.ValidateOutRefundNoRoute(result.OutRefundNo, tenantId); err != nil {
		common.SysError("xpay refund notify route mismatch: " + err.Error())
		_ = model.CreateTenantAuditLog(&model.TenantAuditLog{
			TenantId: tenantId, Action: "payment.refund.notify.mismatch",
			Detail: `{"out_refund_no":"` + result.OutRefundNo + `"}`,
		})
		c.JSON(http.StatusOK, xpayAck(1, "route mismatch", c.GetString("request_id")))
		return
	}
	switch strings.ToUpper(strings.TrimSpace(result.RefundStatus)) {
	case "SUCCESS":
		if err := paymentsvc.ApplyRefundSuccess(
			c.Request.Context(),
			result.OutRefundNo, result.RefundId, result.SuccessTime, result.Amount,
		); err != nil {
			common.SysError("xpay ApplyRefundSuccess failed: " + err.Error())
			c.JSON(http.StatusOK, xpayAck(1, "apply failed", c.GetString("request_id")))
			return
		}
	case "FAILED", "CLOSED", "ABNORMAL":
		if err := model.MarkRefundFailed(result.OutRefundNo, "xpay refund: "+result.RefundStatus); err != nil {
			common.SysError("xpay MarkRefundFailed failed: " + err.Error())
			c.JSON(http.StatusOK, xpayAck(1, "mark failed", c.GetString("request_id")))
			return
		}
	case "PROCESSING", "":
		// Interim state — ack and wait for the next callback.
	default:
		// Unknown status — log + ack so WeChat stops retrying. Operators
		// can investigate via last_error / audit logs.
		common.SysLog("xpay refund notify unknown status=" + result.RefundStatus +
			" out_refund_no=" + result.OutRefundNo)
	}
	c.JSON(http.StatusOK, xpayAck(0, "OK", c.GetString("request_id")))
}

func parseNotifyRoute(c *gin.Context) (int, string, bool) {
	tenantId, err := strconv.Atoi(c.Param("tenant_id"))
	if err != nil || tenantId <= 0 {
		return 0, "", false
	}
	orderType := c.Param("order_type")
	if orderType != model.PaymentOrderTypeTopup && orderType != model.PaymentOrderTypeSub {
		return 0, "", false
	}
	return tenantId, orderType, true
}

// xpayAck returns the ACK envelope WeChat virtual-payment 2.0 expects.
// returnCode is a JSON number (0 = success, non-zero = retry me); `data`
// must be the literal string "OK" for WeChat to consider the callback
// consumed — see spec §6.4. On error we set data=msg so WeChat retries.
func xpayAck(code int, msg string, requestId string) gin.H {
	if requestId == "" {
		requestId = fmt.Sprintf("local-%d", time.Now().UnixNano())
	}
	data := "OK"
	if code != 0 {
		data = msg
	}
	return gin.H{"returnCode": code, "returnMessage": msg, "data": data, "requestId": requestId}
}
