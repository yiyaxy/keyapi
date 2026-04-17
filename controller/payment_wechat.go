package controller

import (
	"errors"
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service/payment"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/system_setting"

	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
)

// ---------- Topup ----------

type wechatTopupRequest struct {
	Amount      int64  `json:"amount"`
	ProductForm string `json:"product_form"`
	Openid      string `json:"openid"`
}

// resolveTopupPrice calls the SAME pricing helpers epay/stripe topup use
// (controller/topup.go:128 getPayMoney, line 158 getMinTopup, line 225-
// 230 display-units normalization, line 371-373 quota conversion).
// Accepting an independent "WeChat pricing" path would split behavior
// by channel — we refuse that.
//
// Returns (amountCents, amountUnits, err) where:
//   - amountCents = CNY price to charge (WeChat API wants integer cents)
//   - amountUnits = what gets stored in top_ups.Amount; identical to the
//     epay/stripe value. In CNY/USD display mode this equals the raw
//     request amount; in Tokens display mode this equals
//     req.Amount / QuotaPerUnit. The success handler reconstructs quota
//     via `amountUnits * QuotaPerUnit`, so both modes round-trip the
//     user's original request.
func resolveTopupPrice(c *gin.Context, amount int64) (amountCents int64, amountUnits int64, err error) {
	if amount < getMinTopup() {
		return 0, 0, fmt.Errorf("充值数量不能小于 %d", getMinTopup())
	}
	userId := c.GetInt("id")
	if userId <= 0 {
		return 0, 0, errors.New("未登录")
	}
	group, gerr := model.GetUserGroup(userId, true)
	if gerr != nil {
		return 0, 0, fmt.Errorf("获取用户分组失败: %w", gerr)
	}
	payMoney := getPayMoney(amount, group)
	if payMoney < 0.01 {
		return 0, 0, errors.New("充值金额过低")
	}
	amountCents = decimal.NewFromFloat(payMoney).
		Mul(decimal.NewFromInt(100)).Round(0).IntPart()

	// Normalize amount into display-units (controller/topup.go:225-230).
	amountUnits = amount
	if operation_setting.GetQuotaDisplayType() == operation_setting.QuotaDisplayTypeTokens {
		amountUnits = decimal.NewFromInt(amount).
			Div(decimal.NewFromFloat(common.QuotaPerUnit)).IntPart()
		if amountUnits <= 0 {
			return 0, 0, errors.New("充值数量过小")
		}
	}
	return
}

// buildNotifyUrl returns the absolute WeChat callback URL using the
// operator-configured ServerAddress — NEVER the request's Host header
// or X-Forwarded-* values.
//
// Behind a dev proxy, K8s Ingress without X-Forwarded-Host, or a reverse
// proxy that doesn't set X-Forwarded-Proto, request headers can yield
// localhost, an internal svc name, or http:// when WeChat requires
// https://. Other payment paths in this repo already funnel through
// system_setting.ServerAddress (controller/subscription_payment_stripe.go).
func buildNotifyUrl(c *gin.Context, orderType string) (string, error) {
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
	return fmt.Sprintf("%s/api/payment/wechat/notify/%d/%s",
		base, middleware.GetTenantId(c), orderType), nil
}

func createTopupHandler(productForm string) gin.HandlerFunc {
	return func(c *gin.Context) {
		tid := middleware.GetTenantId(c)
		if tid <= 0 {
			common.ApiErrorMsg(c, "无法解析当前租户")
			return
		}
		userId := c.GetInt("id")
		if userId <= 0 {
			common.ApiErrorMsg(c, "未登录")
			return
		}

		var req wechatTopupRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			common.ApiErrorMsg(c, "参数错误")
			return
		}
		amountCents, amountUnits, err := resolveTopupPrice(c, req.Amount)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		notifyUrl, err := buildNotifyUrl(c, "topup")
		if err != nil {
			common.ApiError(c, err)
			return
		}

		resp, order, err := payment.CreateTopupOrder(c.Request.Context(), payment.CreateTopupOrderInput{
			TenantId:    tid,
			UserId:      userId,
			AmountCents: amountCents,
			AmountUnits: amountUnits,
			ProductForm: productForm,
			Openid:      req.Openid,
			ClientIp:    c.ClientIP(),
			Description: "充值",
			NotifyUrl:   notifyUrl,
		})
		if err != nil {
			common.ApiError(c, err)
			return
		}
		common.ApiSuccess(c, gin.H{
			"order":    gin.H{"out_trade_no": order.OutTradeNo, "amount": order.Amount},
			"response": resp,
		})
	}
}

func CreateWechatTopupNative(c *gin.Context) {
	createTopupHandler(model.PaymentProductFormNative)(c)
}
func CreateWechatTopupH5(c *gin.Context) {
	createTopupHandler(model.PaymentProductFormH5)(c)
}
func CreateWechatTopupJsapi(c *gin.Context) {
	createTopupHandler(model.PaymentProductFormJsapi)(c)
}

// ---------- Sub (renewal) ----------

type wechatSubRequest struct {
	Openid string `json:"openid"`
}

func createSubHandler(productForm string) gin.HandlerFunc {
	return func(c *gin.Context) {
		tid := middleware.GetTenantId(c)
		if tid <= 0 {
			common.ApiErrorMsg(c, "无法解析当前租户")
			return
		}
		userId := c.GetInt("id")
		if userId <= 0 {
			common.ApiErrorMsg(c, "未登录")
			return
		}

		plan, err := model.GetTenantPlan(tid)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		if plan.RenewPriceAmount <= 0 {
			common.ApiErrorMsg(c, "计划未配置续期价格，请联系管理员")
			return
		}
		days := plan.RenewPeriodDays
		if days <= 0 {
			days = 30
		}

		var req wechatSubRequest
		_ = c.ShouldBindJSON(&req) // body optional for native

		notifyUrl, err := buildNotifyUrl(c, "sub")
		if err != nil {
			common.ApiError(c, err)
			return
		}

		resp, order, err := payment.CreateSubOrder(c.Request.Context(), payment.CreateSubOrderInput{
			TenantId:        tid,
			UserId:          userId,
			AmountCents:     plan.RenewPriceAmount,
			RenewPeriodDays: days,
			ProductForm:     productForm,
			Openid:          req.Openid,
			ClientIp:        c.ClientIP(),
			Description:     "套餐续期",
			NotifyUrl:       notifyUrl,
		})
		if err != nil {
			common.ApiError(c, err)
			return
		}
		common.ApiSuccess(c, gin.H{
			"order":    gin.H{"out_trade_no": order.OutTradeNo, "amount": order.Amount},
			"response": resp,
		})
	}
}

func CreateWechatSubNative(c *gin.Context) {
	createSubHandler(model.PaymentProductFormNative)(c)
}
func CreateWechatSubJsapi(c *gin.Context) {
	createSubHandler(model.PaymentProductFormJsapi)(c)
}
