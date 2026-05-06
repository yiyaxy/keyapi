package payment

import (
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
	"github.com/QuantumNous/new-api/setting/system_setting"

	"github.com/gin-gonic/gin"
)

type wxminiXpayOrderRequest struct {
	TierCode string `json:"tier_code"`
	Platform string `json:"platform"`
}

func detectWxminiPlatformFromUA(ua string) string {
	ua = strings.ToLower(ua)
	switch {
	case strings.Contains(ua, "iphone"), strings.Contains(ua, "ipad"), strings.Contains(ua, "ios"):
		return "ios"
	case strings.Contains(ua, "android"):
		return "android"
	default:
		return ""
	}
}

func wxminiPlatform(c *gin.Context, in string) (string, error) {
	platform := strings.TrimSpace(strings.ToLower(in))
	if platform == "" {
		platform = strings.TrimSpace(strings.ToLower(c.Query("platform")))
	}
	if platform == "" {
		platform = "android"
	}
	if platform != "android" && platform != "ios" {
		return "", errors.New("invalid platform")
	}
	uaPlatform := detectWxminiPlatformFromUA(c.GetHeader("User-Agent"))
	if uaPlatform != "" && uaPlatform != platform {
		return "", errors.New("platform mismatch")
	}
	return platform, nil
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
		quotaPreview := model.GetUserLevelTopUpBonusPreview(userId, tid, rows[i].QuotaDelta)
		items = append(items, gin.H{
			"tier_code":     rows[i].TierCode,
			"name":          rows[i].Name,
			"product_id":    rows[i].ProductId,
			"platform":      rows[i].Platform,
			"amount_cents":  rows[i].AmountCents,
			"quota_delta":   rows[i].QuotaDelta,
			"quota_preview": quotaPreview,
		})
	}
	common.ApiSuccess(c, items)
}

func CreateWxminiTopupXpay(c *gin.Context) {
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
	quotaPreview := model.GetUserLevelTopUpBonusPreview(userId, tid, product.QuotaDelta)
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
	amountUnits := int64(1)
	if common.QuotaPerUnit > 0 {
		amountUnits = int64(float64(product.QuotaDelta) / common.QuotaPerUnit)
		if amountUnits <= 0 {
			amountUnits = 1
		}
	}
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

func HandleWechatXpayNotify(c *gin.Context) {
	tenantId, orderType, ok := parseNotifyRoute(c)
	if !ok {
		c.JSON(http.StatusBadRequest, xpayAck("1", "invalid route", c.GetString("request_id")))
		return
	}
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusOK, xpayAck("1", "read body failed", c.GetString("request_id")))
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
		c.JSON(http.StatusOK, xpayAck("1", "provider missing", c.GetString("request_id")))
		return
	}
	result, err := provider.VerifyAndParseNotify(c.Request.Context(), tenantId, body, headers)
	if err != nil {
		common.SysError("xpay notify verify failed: " + err.Error())
		c.JSON(http.StatusOK, xpayAck("1", "verify failed", c.GetString("request_id")))
		return
	}
	if err := model.ValidateOutTradeNoRoute(result.OutTradeNo, tenantId, orderType); err != nil {
		common.SysError("xpay notify route mismatch: " + err.Error())
		c.JSON(http.StatusOK, xpayAck("1", "route mismatch", c.GetString("request_id")))
		return
	}
	if result.Success {
		paidAt := result.PaidAt
		if paidAt == 0 {
			paidAt = time.Now().Unix()
		}
		if err := paymentsvc.ApplyPaymentSuccess(c.Request.Context(), result.OutTradeNo, result.TransactionId, paidAt); err != nil {
			common.SysError("xpay ApplyPaymentSuccess failed: " + err.Error())
			c.JSON(http.StatusOK, xpayAck("1", "apply failed", c.GetString("request_id")))
			return
		}
	} else if result.RawState == "TRANSACTION.PAYERROR" {
		_, _ = model.MarkOrderClosed(result.OutTradeNo, "xpay notify: "+result.RawState)
	}
	c.JSON(http.StatusOK, xpayAck("0", "OK", c.GetString("request_id")))
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

func xpayAck(code string, msg string, requestId string) gin.H {
	if requestId == "" {
		requestId = fmt.Sprintf("local-%d", time.Now().UnixNano())
	}
	data := "OK"
	if code != "0" {
		data = msg
	}
	return gin.H{"returnCode": code, "returnMessage": msg, "data": data, "requestId": requestId}
}
