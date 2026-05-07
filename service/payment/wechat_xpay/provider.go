package wechat_xpay

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/service/payment"
)

const (
	providerName = "wechat_xpay"
	modeGoods    = "short_series_goods"
	notifyEvent  = "xpay_goods_deliver_notify"
	refundEvent  = "xpay_refund_notify"
	xpayBaseURL  = "https://api.weixin.qq.com"
)

type providerImpl struct{}

func (providerImpl) Name() string { return providerName }

func (providerImpl) TestCredentials(ctx context.Context, cfg *model.TenantPaymentConfig) error {
	if cfg == nil {
		return errors.New("nil config")
	}
	if !cfg.XpayEnabled {
		return errors.New("xpay not enabled")
	}
	if cfg.AppId == "" || cfg.XpayOfferId == "" {
		return errors.New("missing xpay app_id or offer_id")
	}
	plain, err := cfg.DecryptSensitive()
	if err != nil {
		return err
	}
	if plain.XpayAppKey == "" {
		return errors.New("missing xpay app key")
	}
	return nil
}

type signData struct {
	OfferId      string `json:"offerId"`
	BuyQuantity  int    `json:"buyQuantity"`
	Env          int    `json:"env"`
	CurrencyType string `json:"currencyType"`
	Platform     string `json:"platform"`
	ProductId    string `json:"productId"`
	GoodsPrice   int64  `json:"goodsPrice"`
	OutTradeNo   string `json:"outTradeNo"`
	Attach       string `json:"attach,omitempty"`
}

func (providerImpl) CreateOrder(ctx context.Context, req payment.CreateOrderRequest) (*payment.CreateOrderResponse, error) {
	if req.Order == nil {
		return nil, errors.New("req.Order nil")
	}
	if req.Order.ProductForm != model.PaymentProductFormXpayGoods {
		return nil, fmt.Errorf("unsupported product form: %s", req.Order.ProductForm)
	}
	cfg, plain, err := loadConfig(req.Order.TenantId)
	if err != nil {
		return nil, err
	}
	if !cfg.XpayEnabled || cfg.PlatformLocked {
		return nil, errors.New("tenant xpay not enabled")
	}
	if cfg.XpayOfferId == "" || plain.XpayAppKey == "" {
		return nil, errors.New("incomplete xpay credentials")
	}
	product, err := productFromOrder(req.Order)
	if err != nil {
		return nil, err
	}
	if !product.Enabled || product.ProductId == "" {
		return nil, errors.New("xpay product is not enabled or missing product_id")
	}
	sessionKey, ok := service.GetWxMiniSessionKey(req.Order.TenantId, req.Openid)
	if !ok {
		return nil, errors.New("wxmini_session_expired")
	}
	env, _ := strconv.Atoi(strings.TrimSpace(cfg.XpayEnv))
	attach := compactAttach(product.TierCode, product.Platform, req.Order.UserId)
	if len(attach) > 128 {
		return nil, errors.New("xpay attach exceeds 128 bytes")
	}
	body, err := json.Marshal(signData{
		OfferId:      cfg.XpayOfferId,
		BuyQuantity:  1,
		Env:          env,
		CurrencyType: req.Order.Currency,
		Platform:     product.Platform,
		ProductId:    product.ProductId,
		GoodsPrice:   product.AmountCents,
		OutTradeNo:   req.Order.OutTradeNo,
		Attach:       attach,
	})
	if err != nil {
		return nil, err
	}
	signData := string(body)
	return &payment.CreateOrderResponse{
		Mode:      modeGoods,
		SignData:  signData,
		PaySig:    calcHMACHex(plain.XpayAppKey, "requestVirtualPayment"+"&"+signData),
		Signature: calcHMACHex(sessionKey, signData),
	}, nil
}

func compactAttach(tierCode string, platform string, userId int) string {
	return fmt.Sprintf("%s|%s|%d", strings.TrimSpace(tierCode), strings.TrimSpace(platform), userId)
}

func productFromOrder(order *model.PaymentOrder) (*model.TenantXpayProduct, error) {
	var meta struct {
		TierCode string `json:"xpay_tier_code"`
		Platform string `json:"xpay_platform"`
	}
	_ = json.Unmarshal([]byte(order.Metadata), &meta)
	if meta.TierCode == "" {
		return nil, errors.New("missing xpay tier_code")
	}
	return model.GetTenantXpayProductByTier(order.TenantId, meta.TierCode, meta.Platform)
}

func loadConfig(tenantId int) (*model.TenantPaymentConfig, model.TenantPaymentPlaintext, error) {
	cfg, err := model.GetTenantPaymentConfig(tenantId, "wechat")
	if err != nil {
		return nil, model.TenantPaymentPlaintext{}, err
	}
	plain, err := cfg.DecryptSensitive()
	if err != nil {
		return nil, model.TenantPaymentPlaintext{}, err
	}
	return cfg, plain, nil
}

func calcHMACHex(key string, data string) string {
	mac := hmac.New(sha256.New, []byte(key))
	_, _ = mac.Write([]byte(data))
	return hex.EncodeToString(mac.Sum(nil))
}

type notifyEnvelope struct {
	EventType   string `json:"EventType"`
	Event       string `json:"Event"`
	Payload     string `json:"Payload"`
	PayEventSig string `json:"PayEventSig"`
}

type notifyPayload struct {
	OutTradeNo    string        `json:"OutTradeNo"`
	PayInfo       xpayPayInfo   `json:"PayInfo"`
	WeChatPayInfo xpayPayInfo   `json:"WeChatPayInfo"`
	GoodsInfo     xpayGoodsInfo `json:"GoodsInfo"`
}

type xpayPayInfo struct {
	MchOrderNo    string      `json:"MchOrderNo"`
	TransactionId string      `json:"TransactionId"`
	PaidTime      json.Number `json:"PaidTime"`
}

type xpayGoodsInfo struct {
	Attach string `json:"Attach"`
}

func (p notifyPayload) payInfo() xpayPayInfo {
	if p.WeChatPayInfo.TransactionId != "" || p.WeChatPayInfo.MchOrderNo != "" || p.WeChatPayInfo.PaidTime != "" {
		return p.WeChatPayInfo
	}
	return p.PayInfo
}

func (providerImpl) VerifyAndParseNotify(ctx context.Context, tenantId int, body []byte, headers map[string]string) (*payment.NotifyResult, error) {
	_, plain, err := loadConfig(tenantId)
	if err != nil {
		return nil, err
	}
	if plain.XpayAppKey == "" {
		return nil, errors.New("missing xpay app key")
	}
	var env notifyEnvelope
	if err := json.Unmarshal(body, &env); err != nil {
		return nil, fmt.Errorf("parse xpay notify envelope: %w", err)
	}
	if env.Event == "" || env.Payload == "" || env.PayEventSig == "" {
		return nil, errors.New("invalid xpay notify envelope")
	}
	expected := calcHMACHex(plain.XpayAppKey, env.Event+"&"+env.Payload)
	if !hmac.Equal([]byte(strings.ToLower(expected)), []byte(strings.ToLower(env.PayEventSig))) {
		return nil, errors.New("invalid xpay pay_event_sig")
	}
	if env.Event != notifyEvent {
		return nil, fmt.Errorf("unsupported xpay event: %s", env.Event)
	}
	var payload notifyPayload
	if err := json.Unmarshal([]byte(env.Payload), &payload); err != nil {
		return nil, fmt.Errorf("parse xpay notify payload: %w", err)
	}
	info := payload.payInfo()
	paidAt := time.Now().Unix()
	if info.PaidTime != "" {
		if v, err := info.PaidTime.Int64(); err == nil && v > 0 {
			paidAt = v
		}
	}
	return &payment.NotifyResult{
		OutTradeNo:    payload.OutTradeNo,
		TransactionId: info.TransactionId,
		PaidAt:        paidAt,
		Success:       env.EventType == "TRANSACTION.SUCCESS",
		RawState:      env.EventType,
	}, nil
}

func (providerImpl) QueryOrder(ctx context.Context, tenantId int, outTradeNo string) (*payment.QueryOrderResult, error) {
	order, err := model.GetPaymentOrderByOutTradeNo(outTradeNo)
	if err != nil {
		return nil, fmt.Errorf("load xpay order: %w", err)
	}
	if order.TenantId != tenantId {
		return nil, errors.New("xpay order tenant mismatch")
	}
	var resp struct {
		Order struct {
			OrderId          string `json:"order_id"`
			Status           int    `json:"status"`
			PaidTime         int64  `json:"paid_time"`
			WxOrderId        string `json:"wx_order_id"`
			WxPayOrderId     string `json:"wxpay_order_id"`
			ChannelOrderId   string `json:"channel_order_id"`
			TransactionId    string `json:"transaction_id"`
			UpdateTime       int64  `json:"update_time"`
			ProvideTime      int64  `json:"provide_time"`
			LeftFee          int64  `json:"left_fee"`
			RefundFee        int64  `json:"refund_fee"`
			PaidFee          int64  `json:"paid_fee"`
			PaymentOrderId   string `json:"payment_order_id"`
			WechatPayOrderId string `json:"wechatpay_order_id"`
		} `json:"order"`
	}
	if err := postXpay(ctx, tenantId, "/xpay/query_order", map[string]any{
		"openid":   order.Openid,
		"order_id": outTradeNo,
	}, &resp); err != nil {
		return nil, err
	}
	return &payment.QueryOrderResult{
		TradeState:    mapXpayOrderState(resp.Order.Status),
		TransactionId: firstNonEmpty(resp.Order.TransactionId, resp.Order.WxPayOrderId, resp.Order.WechatPayOrderId, resp.Order.ChannelOrderId, resp.Order.WxOrderId),
		PaidAt:        resp.Order.PaidTime,
	}, nil
}

func (providerImpl) Refund(ctx context.Context, req payment.RefundRequest) (*payment.RefundResult, error) {
	if req.Order == nil || req.Refund == nil {
		return nil, errors.New("req.Order/req.Refund nil")
	}
	remaining := req.OriginalAmount - req.Order.RefundedAmount
	if remaining <= 0 || req.Refund.Amount <= 0 || req.Refund.Amount > remaining {
		return nil, errors.New("invalid xpay refund amount")
	}
	reason := strings.TrimSpace(req.Reason)
	if reason == "" {
		reason = "user_request"
	}
	var resp struct {
		RefundOrderId   string `json:"refund_order_id"`
		RefundWxOrderId string `json:"refund_wx_order_id"`
		PayOrderId      string `json:"pay_order_id"`
		PayWxOrderId    string `json:"pay_wx_order_id"`
	}
	if err := postXpay(ctx, req.Order.TenantId, "/xpay/refund_order", map[string]any{
		"openid":          req.Order.Openid,
		"refund_order_id": req.Refund.OutRefundNo,
		"left_fee":        remaining,
		"refund_fee":      req.Refund.Amount,
		"refund_reason":   "3",
		"req_from":        "1",
		"order_id":        req.Order.OutTradeNo,
		"biz_meta":        reason,
	}, &resp); err != nil {
		return nil, err
	}
	return &payment.RefundResult{
		RefundId:     firstNonEmpty(resp.RefundWxOrderId, resp.RefundOrderId),
		RefundStatus: "PROCESSING",
	}, nil
}

func (providerImpl) VerifyAndParseRefundNotify(ctx context.Context, tenantId int, body []byte, headers map[string]string) (*payment.RefundNotifyResult, error) {
	_, plain, err := loadConfig(tenantId)
	if err != nil {
		return nil, err
	}
	var env notifyEnvelope
	if err := json.Unmarshal(body, &env); err != nil {
		return nil, fmt.Errorf("parse xpay refund envelope: %w", err)
	}
	expected := calcHMACHex(plain.XpayAppKey, env.Event+"&"+env.Payload)
	if !hmac.Equal([]byte(strings.ToLower(expected)), []byte(strings.ToLower(env.PayEventSig))) {
		return nil, errors.New("invalid xpay refund pay_event_sig")
	}
	if env.Event != refundEvent {
		return nil, fmt.Errorf("unsupported xpay refund event: %s", env.Event)
	}
	var payload struct {
		MchOrderId                 string `json:"MchOrderId"`
		MchRefundId                string `json:"MchRefundId"`
		WxRefundId                 string `json:"WxRefundId"`
		RefundFee                  int64  `json:"RefundFee"`
		RetCode                    int    `json:"RetCode"`
		RefundSuccTimestamp        int64  `json:"RefundSuccTimestamp"`
		WxpayRefundTransactionId   string `json:"WxpayRefundTransactionId"`
		WechatPayRefundTransaction string `json:"WechatPayRefundTransactionId"`
	}
	if err := json.Unmarshal([]byte(env.Payload), &payload); err != nil {
		return nil, fmt.Errorf("parse xpay refund payload: %w", err)
	}
	status := "FAILED"
	if payload.RetCode == 0 {
		status = "SUCCESS"
	}
	return &payment.RefundNotifyResult{
		OutTradeNo:   payload.MchOrderId,
		OutRefundNo:  payload.MchRefundId,
		RefundId:     firstNonEmpty(payload.WxRefundId, payload.WxpayRefundTransactionId, payload.WechatPayRefundTransaction),
		RefundStatus: status,
		SuccessTime:  payload.RefundSuccTimestamp,
		Amount:       payload.RefundFee,
	}, nil
}

func postXpay(ctx context.Context, tenantId int, endpoint string, payload map[string]any, out any) error {
	cfg, plain, err := loadConfig(tenantId)
	if err != nil {
		return err
	}
	if plain.XpayAppKey == "" {
		return errors.New("missing xpay app key")
	}
	env, _ := strconv.Atoi(strings.TrimSpace(cfg.XpayEnv))
	payload["env"] = env

	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	accessToken, err := service.GetWxMiniAccessToken(tenantId)
	if err != nil {
		return fmt.Errorf("load wxmini access_token: %w", err)
	}
	u, err := url.Parse(xpayBaseURL + endpoint)
	if err != nil {
		return err
	}
	q := u.Query()
	q.Set("access_token", accessToken)
	q.Set("pay_sig", calcHMACHex(plain.XpayAppKey, endpoint+"&"+string(body)))
	u.RawQuery = q.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u.String(), bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("xpay %s: %w", endpoint, err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("xpay %s http %d: %s", endpoint, resp.StatusCode, strings.TrimSpace(string(respBody)))
	}
	var envelope struct {
		ErrCode int    `json:"errcode"`
		ErrMsg  string `json:"errmsg"`
	}
	if err := json.Unmarshal(respBody, &envelope); err != nil {
		return fmt.Errorf("parse xpay %s response: %w", endpoint, err)
	}
	if envelope.ErrCode != 0 {
		return fmt.Errorf("xpay %s errcode=%d errmsg=%s", endpoint, envelope.ErrCode, envelope.ErrMsg)
	}
	if out != nil {
		if err := json.Unmarshal(respBody, out); err != nil {
			return fmt.Errorf("decode xpay %s response: %w", endpoint, err)
		}
	}
	return nil
}

func mapXpayOrderState(status int) string {
	switch status {
	case 2, 3:
		return "SUCCESS"
	case 4, 5, 6, 10:
		return "CLOSED"
	case 8, 9:
		return "REFUND"
	case 0, 1:
		return "NOTPAY"
	default:
		return fmt.Sprintf("XPAY_STATUS_%d", status)
	}
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func init() {
	payment.Register(providerImpl{})
}
