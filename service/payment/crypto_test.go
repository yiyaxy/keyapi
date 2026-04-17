package payment

import (
	"bytes"
	"testing"

	"github.com/QuantumNous/new-api/common"
)

func TestPaymentMasterKey_DerivesFromCryptoSecret(t *testing.T) {
	// t.Setenv with empty string does NOT unset — use Setenv to an empty
	// string only works if caller doesn't check empty. Our impl checks
	// `os.Getenv(...) != ""`, so we can set it to empty to simulate unset.
	// That preserves original env state on return via t.Cleanup.
	t.Setenv("PAYMENT_MASTER_KEY", "")

	original := common.CryptoSecret
	common.CryptoSecret = "test-crypto-secret"
	t.Cleanup(func() { common.CryptoSecret = original })

	k := paymentMasterKey()
	if len(k) != 32 {
		t.Fatalf("want 32 bytes, got %d", len(k))
	}

	// Determinism: same secret derives the same key.
	k2 := paymentMasterKey()
	if !bytes.Equal(k, k2) {
		t.Fatal("derivation should be deterministic")
	}
}

func TestPaymentMasterKey_EnvOverride(t *testing.T) {
	// 32 bytes of 0xAA, base64-encoded.
	override := "qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo="
	t.Setenv("PAYMENT_MASTER_KEY", override)

	k := paymentMasterKey()
	if len(k) != 32 {
		t.Fatalf("want 32 bytes, got %d", len(k))
	}
	for _, b := range k {
		if b != 0xAA {
			t.Fatalf("env override not applied; expect 0xAA bytes, got %x", k)
		}
	}
}
