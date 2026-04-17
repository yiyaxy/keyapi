package payment

import (
	"context"

	"github.com/QuantumNous/new-api/model"
)

// Provider abstracts a payment gateway adapter (wechat, alipay, etc).
//
// S1 only requires TestCredentials. CreateOrder / VerifyAndParseNotify /
// QueryOrder / Refund will be added in S2 and S3 as their features land.
type Provider interface {
	Name() string
	TestCredentials(ctx context.Context, cfg *model.TenantPaymentConfig) error
}

// Registry of provider implementations keyed by Name().
// Populated by provider-specific init (e.g. wechat.init() in Task 8).
var registry = map[string]Provider{}

// Register installs a provider. Must only be called from package-level
// init() functions so that all registrations complete before any handler
// runs. The registry map is not concurrency-safe for runtime writes.
//
// Panics on a nil provider — this is an init-time programming error
// that should fail loudly rather than be silently recorded as a nil
// entry that would later crash a request path.
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
