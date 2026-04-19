package wechat

import (
	"context"
	"errors"
	"fmt"

	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service/payment"
	"github.com/wechatpay-apiv3/wechatpay-go/services/certificates"
	"github.com/wechatpay-apiv3/wechatpay-go/services/payments/native"
)

// providerImpl is the WeChat implementation of payment.Provider.
type providerImpl struct{}

func (providerImpl) Name() string { return "wechat" }

// TestCredentials verifies a tenant's WeChat credentials by calling
// GET /v3/certificates. A successful call proves:
//   - mchid + serial_no + private key match a real merchant account
//   - apiv3_key is the correct symmetric key for platform cert decryption
//
// On success, the result also warms the wechatpay-go platform cert downloader
// for that tenant.
func (providerImpl) TestCredentials(ctx context.Context, cfg *model.TenantPaymentConfig) error {
	if cfg == nil {
		return fmt.Errorf("nil config")
	}
	// Force a fresh client build regardless of cache — we want to surface
	// credential errors immediately rather than reuse a stale cached client.
	cache.Invalidate(cfg.TenantId)

	cli, err := getClient(ctx, cfg.TenantId)
	if err != nil {
		return err
	}
	callCtx, cancel := callWithTimeout(ctx)
	defer cancel()
	svc := certificates.CertificatesApiService{Client: cli.client}
	resp, _, err := svc.DownloadCertificates(callCtx)
	if err != nil {
		return fmt.Errorf("wechat certificates call failed: %w", err)
	}
	if resp == nil || len(resp.Data) == 0 {
		return fmt.Errorf("wechat returned no platform certificates")
	}
	return nil
}

func (providerImpl) CreateOrder(ctx context.Context, req payment.CreateOrderRequest) (*payment.CreateOrderResponse, error) {
	if req.Order == nil {
		return nil, errors.New("req.Order nil")
	}
	cc, err := getClient(ctx, req.Order.TenantId)
	if err != nil {
		return nil, err
	}
	// Load full config for JSAPI signing (only product form that needs it).
	cfg, err := model.GetTenantPaymentConfig(req.Order.TenantId, "wechat")
	if err != nil {
		return nil, err
	}
	switch req.Order.ProductForm {
	case model.PaymentProductFormNative:
		return createNativeOrder(ctx, cc.client, cc, req)
	case model.PaymentProductFormH5:
		return createH5Order(ctx, cc.client, cc, req)
	case model.PaymentProductFormJsapi:
		return createJsapiOrder(ctx, cc.client, cc, cfg, req)
	default:
		return nil, fmt.Errorf("unsupported product form: %s", req.Order.ProductForm)
	}
}

func (providerImpl) VerifyAndParseNotify(ctx context.Context, tenantId int, body []byte, headers map[string]string) (*payment.NotifyResult, error) {
	return verifyAndParseNotify(ctx, tenantId, body, headers)
}

func (providerImpl) Refund(ctx context.Context, req payment.RefundRequest) (*payment.RefundResult, error) {
	if req.Order == nil {
		return nil, errors.New("req.Order nil")
	}
	return createRefund(ctx, req.Order.TenantId, req)
}

func (providerImpl) VerifyAndParseRefundNotify(ctx context.Context, tenantId int, body []byte, headers map[string]string) (*payment.RefundNotifyResult, error) {
	return verifyAndParseRefundNotify(ctx, tenantId, body, headers)
}

func (providerImpl) QueryOrder(ctx context.Context, tenantId int, outTradeNo string) (*payment.QueryOrderResult, error) {
	cc, err := getClient(ctx, tenantId)
	if err != nil {
		return nil, err
	}
	svc := native.NativeApiService{Client: cc.client}
	callCtx, cancel := callWithTimeout(ctx)
	defer cancel()
	resp, _, err := svc.QueryOrderByOutTradeNo(callCtx, native.QueryOrderByOutTradeNoRequest{
		OutTradeNo: stringPtr(outTradeNo),
		Mchid:      stringPtr(cc.mchid),
	})
	if err != nil {
		return nil, fmt.Errorf("wechat query order: %w", err)
	}
	var state, txnId string
	var paid int64
	if resp != nil {
		if resp.TradeState != nil {
			state = *resp.TradeState
		}
		if resp.TransactionId != nil {
			txnId = *resp.TransactionId
		}
		if resp.SuccessTime != nil && *resp.SuccessTime != "" {
			paid = parseRFC3339Unix(*resp.SuccessTime)
		}
	}
	return &payment.QueryOrderResult{
		TradeState:    state,
		TransactionId: txnId,
		PaidAt:        paid,
	}, nil
}
