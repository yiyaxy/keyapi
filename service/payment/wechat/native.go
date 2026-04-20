package wechat

import (
	"context"
	"errors"
	"fmt"

	"github.com/QuantumNous/new-api/service/payment"
	"github.com/wechatpay-apiv3/wechatpay-go/core"
	"github.com/wechatpay-apiv3/wechatpay-go/services/payments/native"
)

// createNativeOrder calls /v3/pay/transactions/native. Returns code_url to
// be rendered as a QR code by the desktop frontend.
func createNativeOrder(ctx context.Context, cli *core.Client, cc *cachedClient, req payment.CreateOrderRequest) (*payment.CreateOrderResponse, error) {
	svc := native.NativeApiService{Client: cli}
	callCtx, cancel := callWithTimeout(ctx)
	defer cancel()

	resp, _, err := svc.Prepay(callCtx, native.PrepayRequest{
		Appid:       stringPtr(cc.appid),
		Mchid:       stringPtr(cc.mchid),
		Description: stringPtr(req.Description),
		OutTradeNo:  stringPtr(req.Order.OutTradeNo),
		NotifyUrl:   stringPtr(req.NotifyUrl),
		Amount: &native.Amount{
			Total:    int64Ptr(req.Order.Amount),
			Currency: stringPtr("CNY"),
		},
	})
	if err != nil {
		return nil, fmt.Errorf("wechat native prepay: %w", err)
	}
	if resp == nil || resp.CodeUrl == nil || *resp.CodeUrl == "" {
		return nil, errors.New("wechat native prepay returned empty code_url")
	}
	return &payment.CreateOrderResponse{CodeUrl: *resp.CodeUrl}, nil
}

func stringPtr(s string) *string { return &s }
func int64Ptr(i int64) *int64    { return &i }
