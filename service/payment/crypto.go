package payment

import (
	"encoding/base64"
	"log"
	"os"

	"github.com/QuantumNous/new-api/common"
)

// paymentMasterKey returns the 32-byte symmetric key used to encrypt/decrypt
// tenant payment credentials stored in tenant_payment_configs.
//
// Priority:
//  1. env PAYMENT_MASTER_KEY (32-byte base64). Invalid value fatals the process.
//  2. HKDF(common.CryptoSecret, "wechat-pay-keys-v1") — default, zero-config.
//
// Keeping the HKDF info string versioned (-v1) leaves room for a future key
// rotation scheme without breaking existing ciphertext.
func paymentMasterKey() []byte {
	if v := os.Getenv("PAYMENT_MASTER_KEY"); v != "" {
		decoded, err := base64.StdEncoding.DecodeString(v)
		if err != nil || len(decoded) != 32 {
			log.Fatal("PAYMENT_MASTER_KEY must be 32-byte base64")
		}
		return decoded
	}
	return common.DeriveKey([]byte(common.CryptoSecret), "wechat-pay-keys-v1")
}

// PaymentMasterKey is the exported wrapper used at startup to install the
// key resolver into the model layer (avoiding a model→service import cycle).
func PaymentMasterKey() []byte {
	return paymentMasterKey()
}
