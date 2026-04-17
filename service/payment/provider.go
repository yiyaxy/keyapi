package payment

import (
	"context"

	"github.com/QuantumNous/new-api/model"
)

// PaymentProvider abstracts a payment gateway adapter (wechat, alipay, etc).
//
// S1 only requires TestCredentials. CreateOrder / VerifyAndParseNotify /
// QueryOrder / Refund will be added in S2 and S3 as their features land.
type PaymentProvider interface {
	Name() string
	TestCredentials(ctx context.Context, cfg *model.TenantPaymentConfig) error
}

// Registry of provider implementations keyed by Name().
// Populated by provider-specific init (e.g. wechat.Register()).
var registry = map[string]PaymentProvider{}

// Register installs a provider. Must only be called from package-level
// init() functions so that all registrations complete before any handler
// runs. The registry map is not concurrency-safe for runtime writes.
func Register(p PaymentProvider) {
	registry[p.Name()] = p
}

// Get looks up a provider by name.
func Get(name string) (PaymentProvider, bool) {
	p, ok := registry[name]
	return p, ok
}
