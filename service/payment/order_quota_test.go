package payment

import (
	"encoding/json"
	"testing"
)

func TestReadQuotaDeltaFromMetadata_PrefersAuthoritativeKey(t *testing.T) {
	meta, _ := json.Marshal(map[string]any{
		"amount_units": int64(1),
		"quota_delta":  int64(684_931),
	})

	got, err := readQuotaDeltaFromMetadata(string(meta), 500_000)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != 684_931 {
		t.Fatalf("got %d, want 684931", got)
	}
}

func TestReadQuotaDeltaFromMetadata_LegacyFallback(t *testing.T) {
	meta, _ := json.Marshal(map[string]any{"amount_units": int64(2)})

	got, err := readQuotaDeltaFromMetadata(string(meta), 500_000)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != 1_000_000 {
		t.Fatalf("got %d, want 1000000", got)
	}
}

func TestReadQuotaDeltaFromMetadata_InvalidMetadata(t *testing.T) {
	if _, err := readQuotaDeltaFromMetadata("not-json", 500_000); err == nil {
		t.Fatal("expected error on invalid JSON")
	}
	if _, err := readQuotaDeltaFromMetadata(`{"amount_units":0}`, 500_000); err == nil {
		t.Fatal("expected error when neither key yields a positive value")
	}
}
