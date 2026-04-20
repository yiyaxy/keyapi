package wechat

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service/payment"
	"github.com/wechatpay-apiv3/wechatpay-go/core"
	"github.com/wechatpay-apiv3/wechatpay-go/services/payments/jsapi"
	"github.com/wechatpay-apiv3/wechatpay-go/utils"
)

// createJsapiOrder calls /v3/pay/transactions/jsapi and builds the
// wx.requestPayment signature object the mini-program needs.
//
// Requires req.Openid (obtained client-side via wx.login → server-side
// code2session). The signature is computed against prepay_id using the
// tenant's merchant API private key.
func createJsapiOrder(ctx context.Context, cli *core.Client, cc *cachedClient, cfg *model.TenantPaymentConfig, req payment.CreateOrderRequest) (*payment.CreateOrderResponse, error) {
	if req.Openid == "" {
		return nil, errors.New("jsapi order requires openid")
	}
	svc := jsapi.JsapiApiService{Client: cli}
	callCtx, cancel := callWithTimeout(ctx)
	defer cancel()

	resp, _, err := svc.Prepay(callCtx, jsapi.PrepayRequest{
		Appid:       stringPtr(cc.appid),
		Mchid:       stringPtr(cc.mchid),
		Description: stringPtr(req.Description),
		OutTradeNo:  stringPtr(req.Order.OutTradeNo),
		NotifyUrl:   stringPtr(req.NotifyUrl),
		Amount: &jsapi.Amount{
			Total:    int64Ptr(req.Order.Amount),
			Currency: stringPtr("CNY"),
		},
		Payer: &jsapi.Payer{
			Openid: stringPtr(req.Openid),
		},
	})
	if err != nil {
		return nil, fmt.Errorf("wechat jsapi prepay: %w", err)
	}
	if resp == nil || resp.PrepayId == nil || *resp.PrepayId == "" {
		return nil, errors.New("wechat jsapi prepay returned empty prepay_id")
	}

	// Build the wx.requestPayment signature payload.
	prepayId := *resp.PrepayId
	pkg := "prepay_id=" + prepayId
	nonceBytes := make([]byte, 8)
	if _, err := rand.Read(nonceBytes); err != nil {
		return nil, err
	}
	nonceStr := hex.EncodeToString(nonceBytes)
	ts := strconv.FormatInt(time.Now().Unix(), 10)

	// signMessage format per WeChat docs: appId\ntimeStamp\nnonceStr\npackage\n
	signMessage := fmt.Sprintf("%s\n%s\n%s\n%s\n", cc.appid, ts, nonceStr, pkg)

	// Need the raw private key to build the signature. DecryptSensitive to
	// avoid holding plaintext longer than necessary.
	plain, err := cfg.DecryptSensitive()
	if err != nil {
		return nil, fmt.Errorf("decrypt private key for jsapi sign: %w", err)
	}
	privKey, err := utils.LoadPrivateKey(plain.PrivateKey)
	if err != nil {
		return nil, fmt.Errorf("parse private key: %w", err)
	}
	paySign, err := utils.SignSHA256WithRSA(signMessage, privKey)
	if err != nil {
		return nil, fmt.Errorf("sign jsapi payload: %w", err)
	}

	return &payment.CreateOrderResponse{
		PrepayId:     prepayId,
		JsapiPackage: pkg,
		NonceStr:     nonceStr,
		Timestamp:    ts,
		SignType:     "RSA",
		PaySign:      paySign,
	}, nil
}
