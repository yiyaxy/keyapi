package payment

import (
	"encoding/json"
	"testing"

	"github.com/QuantumNous/new-api/model"
)

func TestCreditedRawQuota_PrefersQuotaDelta(t *testing.T) {
	meta, _ := json.Marshal(map[string]any{
		"amount_units": int64(1),
		"quota_delta":  int64(684_931),
	})
	order := &model.PaymentOrder{
		OrderType: model.PaymentOrderTypeTopup,
		Metadata:  string(meta),
	}

	if got := creditedRawQuota(order); got != 684_931 {
		t.Fatalf("got %d, want 684931", got)
	}
}

func TestCreditedRawQuota_LegacyFallback(t *testing.T) {
	meta, _ := json.Marshal(map[string]any{"amount_units": int64(2)})
	order := &model.PaymentOrder{
		OrderType: model.PaymentOrderTypeTopup,
		Metadata:  string(meta),
	}

	if got := creditedRawQuota(order); got != 1_000_000 {
		t.Fatalf("got %d, want 1000000", got)
	}
}
