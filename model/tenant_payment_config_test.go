package model

import (
	"testing"
)

func TestTenantPaymentConfig_EncryptDecryptRoundtrip(t *testing.T) {
	cfg := &TenantPaymentConfig{
		TenantId: 1,
		Provider: "wechat",
		AppId:    "wx1234567890",
		Mchid:    "1700000000",
		SerialNo: "ABCDEF1234",
	}
	plaintext := TenantPaymentPlaintext{
		AppSecret:  "secret-app",
		Apiv3Key:   "secret-apiv3-32-bytes-long-padding",
		PrivateKey: "-----BEGIN PRIVATE KEY-----\nMIIB...\n-----END PRIVATE KEY-----\n",
	}
	if err := cfg.EncryptAndSetSensitive(plaintext); err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	if cfg.AppSecretEnc == "" || cfg.Apiv3KeyEnc == "" || cfg.PrivateKeyEnc == "" {
		t.Fatal("enc fields should be set")
	}
	if cfg.AppSecretEnc == plaintext.AppSecret {
		t.Fatal("AppSecretEnc must not be plaintext")
	}

	decoded, err := cfg.DecryptSensitive()
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	if decoded.AppSecret != plaintext.AppSecret ||
		decoded.Apiv3Key != plaintext.Apiv3Key ||
		decoded.PrivateKey != plaintext.PrivateKey {
		t.Fatal("roundtrip mismatch")
	}
}
