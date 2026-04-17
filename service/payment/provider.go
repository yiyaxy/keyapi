package payment

import (
	"context"

	"github.com/QuantumNous/new-api/model"
)

// CreateOrderRequest is the input to Provider.CreateOrder.
// Amount is in CNY cents. Description is the "商品描述" (appears on user's
// WeChat payment sheet). NotifyUrl is the tenant-scoped callback URL.
type CreateOrderRequest struct {
	Order       *model.PaymentOrder // carries TenantId/UserId/OutTradeNo/Amount/ProductForm/OrderType
	Description string              // shown on payer's WeChat UI
	NotifyUrl   string              // /api/payment/wechat/notify/:tid/:order_type
	Openid      string              // required when ProductForm = "jsapi"
	ClientIp    string              // required for h5; use c.ClientIP() upstream
}

// CreateOrderResponse wraps the provider-specific "how to launch payment"
// parameters. Only one of CodeUrl / H5Url / PrepayId will be non-empty.
type CreateOrderResponse struct {
	// Native: code_url to render as QR code
	CodeUrl string `json:"code_url,omitempty"`
	// H5: redirect URL to open on mobile browser
	H5Url string `json:"h5_url,omitempty"`
	// JSAPI: prepay_id that the mini-program wraps into wx.requestPayment
	// params. Signature params are returned separately for small-program
	// convenience.
	PrepayId     string `json:"prepay_id,omitempty"`
	JsapiPackage string `json:"package,omitempty"`   // "prepay_id=..."
	NonceStr     string `json:"nonce_str,omitempty"`
	Timestamp    string `json:"timestamp,omitempty"`
	SignType      string `json:"sign_type,omitempty"` // "RSA"
	PaySign      string `json:"pay_sign,omitempty"`
}

// NotifyResult is what a provider reports after verifying and decrypting a
// callback. The generic fields are what downstream state transitions need;
// provider-specific fields stay inside the provider layer.
type NotifyResult struct {
	OutTradeNo    string
	TransactionId string
	PaidAt        int64 // unix seconds
	Success       bool  // true if TradeState indicates success
	RawState      string
}

// QueryOrderResult is what a provider reports when asked to refresh an
// order's state (S3 reconcile path). S2 defines the shape so S3 can drop
// in directly without churning the interface.
type QueryOrderResult struct {
	TradeState    string // wechat: SUCCESS/NOTPAY/CLOSED/USERPAYING/...
	TransactionId string
	PaidAt        int64
}

// Provider abstracts a payment gateway adapter (wechat, alipay, etc).
//
// S1 only required Name + TestCredentials. S2 adds CreateOrder /
// VerifyAndParseNotify / QueryOrder. S3 will add Refund.
type Provider interface {
	Name() string
	TestCredentials(ctx context.Context, cfg *model.TenantPaymentConfig) error

	// CreateOrder calls the provider's place-order endpoint. Implementation
	// is responsible for choosing the right API per req.Order.ProductForm.
	CreateOrder(ctx context.Context, req CreateOrderRequest) (*CreateOrderResponse, error)

	// VerifyAndParseNotify verifies the callback signature using the tenant's
	// platform cert (managed by wechatpay-go's downloader), decrypts the
	// encrypted resource body, and returns the generic notify result.
	// Caller (controller/payment_notify.go) is responsible for routing by
	// tenantId, enforcing ValidateOutTradeNoRoute, and running business
	// effects via service/payment.ApplyPaymentSuccess.
	VerifyAndParseNotify(ctx context.Context, tenantId int, body []byte, headers map[string]string) (*NotifyResult, error)

	// QueryOrder refreshes an order's state from the provider (for reconcile).
	// S2 defines the method so S3's reconcile loop can use it without a
	// breaking interface change.
	QueryOrder(ctx context.Context, tenantId int, outTradeNo string) (*QueryOrderResult, error)
}

// --- Registry (unchanged from S1) ---

var registry = map[string]Provider{}

// Register installs a provider. Must only be called from package-level
// init() functions so that all registrations complete before any handler
// runs. The registry map is not concurrency-safe for runtime writes.
//
// Panics on a nil provider — this is an init-time programming error.
func Register(p Provider) {
	if p == nil {
		panic("payment.Register called with nil provider")
	}
	registry[p.Name()] = p
}

// Get looks up a provider by name.
func Get(name string) (Provider, bool) {
	p, ok := registry[name]
	return p, ok
}
