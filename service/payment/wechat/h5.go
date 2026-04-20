package wechat

import (
	"context"
	"errors"
	"fmt"

	"github.com/QuantumNous/new-api/service/payment"
	"github.com/wechatpay-apiv3/wechatpay-go/core"
	"github.com/wechatpay-apiv3/wechatpay-go/services/payments/h5"
)

// createH5Order calls /v3/pay/transactions/h5. Returns h5_url for the
// mobile browser to redirect to.
//
// Requires the caller's real client IP (req.ClientIp) — WeChat uses it to
// prevent cross-IP brush orders.
func createH5Order(ctx context.Context, cli *core.Client, cc *cachedClient, req payment.CreateOrderRequest) (*payment.CreateOrderResponse, error) {
	if req.ClientIp == "" {
		return nil, errors.New("h5 order requires client ip")
	}
	svc := h5.H5ApiService{Client: cli}
	callCtx, cancel := callWithTimeout(ctx)
	defer cancel()

	resp, _, err := svc.Prepay(callCtx, h5.PrepayRequest{
		Appid:       stringPtr(cc.appid),
		Mchid:       stringPtr(cc.mchid),
		Description: stringPtr(req.Description),
		OutTradeNo:  stringPtr(req.Order.OutTradeNo),
		NotifyUrl:   stringPtr(req.NotifyUrl),
		Amount: &h5.Amount{
			Total:    int64Ptr(req.Order.Amount),
			Currency: stringPtr("CNY"),
		},
		SceneInfo: &h5.SceneInfo{
			PayerClientIp: stringPtr(req.ClientIp),
			H5Info: &h5.H5Info{
				Type: stringPtr("Wap"),
			},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("wechat h5 prepay: %w", err)
	}
	if resp == nil || resp.H5Url == nil || *resp.H5Url == "" {
		return nil, errors.New("wechat h5 prepay returned empty h5_url")
	}
	return &payment.CreateOrderResponse{H5Url: *resp.H5Url}, nil
}
