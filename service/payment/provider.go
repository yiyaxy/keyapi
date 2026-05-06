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
	JsapiPackage string `json:"package,omitempty"` // "prepay_id=..."
	NonceStr     string `json:"nonce_str,omitempty"`
	Timestamp    string `json:"timestamp,omitempty"`
	SignType     string `json:"sign_type,omitempty"` // "RSA"
	PaySign      string `json:"pay_sign,omitempty"`

	// WeChat mini-program virtual payment 2.0 (wx.requestVirtualPayment).
	Mode      string `json:"mode,omitempty"`
	SignData  string `json:"sign_data,omitempty"`
	PaySig    string `json:"pay_sig,omitempty"`
	Signature string `json:"signature,omitempty"`
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

// RefundRequest is what Provider.Refund consumes. Amount is in CNY cents;
// it MUST equal PaymentRefund.Amount (the row the caller just persisted).
// OriginalAmount is order.Amount — WeChat requires both in CreateRequest.
type RefundRequest struct {
	Order          *model.PaymentOrder
	Refund         *model.PaymentRefund
	OriginalAmount int64  // order.Amount
	NotifyUrl      string // absolute refund callback URL
	Reason         string // shown on user's WeChat UI (optional)
}

// RefundResult captures what the provider returned when CREATING the refund
// (before any async callback). We persist RefundId onto the refund row so
// operators can trace it in the WeChat dashboard.
type RefundResult struct {
	RefundId     string
	RefundStatus string // "SUCCESS" / "PROCESSING" / "CLOSED" / "ABNORMAL"
	SuccessTime  int64  // if the provider already completed the refund synchronously
}

// RefundNotifyResult is the decrypted refund callback payload.
type RefundNotifyResult struct {
	OutTradeNo   string
	OutRefundNo  string
	RefundId     string
	RefundStatus string
	SuccessTime  int64
	// Amount is the refunded CNY cents (for sanity-checking against the
	// PaymentRefund row before we bump order.RefundedAmount).
	Amount int64
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

	// Refund submits a refund against an existing paid order. The caller is
	// expected to have already persisted a PaymentRefund row (so WeChat's
	// out_refund_no idempotency key exists before we call them).
	Refund(ctx context.Context, req RefundRequest) (*RefundResult, error)

	// VerifyAndParseRefundNotify decrypts a refund callback body the same way
	// VerifyAndParseNotify handles payment callbacks.
	VerifyAndParseRefundNotify(ctx context.Context, tenantId int, body []byte, headers map[string]string) (*RefundNotifyResult, error)
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
