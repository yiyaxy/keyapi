package wechat

import (
	"bytes"
	"io"
	"net/http"
	"time"

	"github.com/QuantumNous/new-api/model"
)

// buildHttpRequest constructs a minimal *http.Request that wechatpay-go's
// NotifyHandler can consume. The handler only inspects Header and Body.
func buildHttpRequest(headers map[string]string, body []byte) *http.Request {
	r, _ := http.NewRequest(http.MethodPost, "/notify", bytes.NewReader(body))
	for k, v := range headers {
		r.Header.Set(k, v)
	}
	// Explicitly reset Body after NewRequest in case it drained the reader.
	r.Body = io.NopCloser(bytes.NewReader(body))
	return r
}

// parseRFC3339Unix converts WeChat's ISO 8601 / RFC3339 SuccessTime to Unix
// seconds. On parse failure falls back to time.Now() — paid_at is
// informational; we prefer a rough timestamp to a hard failure.
func parseRFC3339Unix(s string) int64 {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return time.Now().Unix()
	}
	return t.Unix()
}

// loadConfigForNotify is a thin wrapper around model.GetTenantPaymentConfig
// so notify.go has a single well-named call site.
func loadConfigForNotify(tenantId int) (*model.TenantPaymentConfig, error) {
	return model.GetTenantPaymentConfig(tenantId, "wechat")
}
