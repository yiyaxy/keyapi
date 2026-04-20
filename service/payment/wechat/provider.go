package wechat

import (
	"context"
	"errors"
	"fmt"

	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service/payment"
	"github.com/wechatpay-apiv3/wechatpay-go/services/certificates"
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

// --- stubs for S2 Tasks 5-10; real implementations land progressively ---

func (providerImpl) CreateOrder(ctx context.Context, req payment.CreateOrderRequest) (*payment.CreateOrderResponse, error) {
	return nil, errors.New("wechat CreateOrder: not implemented yet")
}

func (providerImpl) VerifyAndParseNotify(ctx context.Context, tenantId int, body []byte, headers map[string]string) (*payment.NotifyResult, error) {
	return nil, errors.New("wechat VerifyAndParseNotify: not implemented yet")
}

func (providerImpl) QueryOrder(ctx context.Context, tenantId int, outTradeNo string) (*payment.QueryOrderResult, error) {
	return nil, errors.New("wechat QueryOrder: not implemented yet")
}
