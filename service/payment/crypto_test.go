package payment

import (
	"bytes"
	"os"
	"testing"

	"github.com/QuantumNous/new-api/common"
)

func TestPaymentMasterKey_DerivesFromCryptoSecret(t *testing.T) {
	os.Unsetenv("PAYMENT_MASTER_KEY")
	original := common.CryptoSecret
	common.CryptoSecret = "test-crypto-secret"
	defer func() { common.CryptoSecret = original }()

	k := paymentMasterKey()
	if len(k) != 32 {
		t.Fatalf("want 32 bytes, got %d", len(k))
	}

	// Determinism: same secret derives the same key
	k2 := paymentMasterKey()
	if !bytes.Equal(k, k2) {
		t.Fatal("derivation should be deterministic")
	}
}

func TestPaymentMasterKey_EnvOverride(t *testing.T) {
	// 32 bytes of 0xAA, base64
	override := "qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo="
	if err := os.Setenv("PAYMENT_MASTER_KEY", override); err != nil {
		t.Fatal(err)
	}
	defer os.Unsetenv("PAYMENT_MASTER_KEY")

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
