package common

import (
	"bytes"
	"encoding/base64"
	"testing"
)

func TestDeriveKey_Deterministic(t *testing.T) {
	master := []byte("test-master-key-seed")
	k1 := DeriveKey(master, "info-a")
	k2 := DeriveKey(master, "info-a")
	if !bytes.Equal(k1, k2) {
		t.Fatalf("DeriveKey not deterministic")
	}
	if len(k1) != 32 {
		t.Fatalf("DeriveKey length want 32, got %d", len(k1))
	}
}

func TestDeriveKey_InfoIsolates(t *testing.T) {
	master := []byte("test-master-key-seed")
	k1 := DeriveKey(master, "info-a")
	k2 := DeriveKey(master, "info-b")
	if bytes.Equal(k1, k2) {
		t.Fatalf("different info should derive different keys")
	}
}

func TestAESGCM_Roundtrip(t *testing.T) {
	key := DeriveKey([]byte("seed"), "aes-test")
	plaintext := []byte("hello world, this is a secret")
	ciphertext, err := EncryptAESGCM(key, plaintext)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	if ciphertext == "" {
		t.Fatal("cipher empty")
	}
	plain2, err := DecryptAESGCM(key, ciphertext)
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	if !bytes.Equal(plaintext, plain2) {
		t.Fatalf("roundtrip mismatch: got %q want %q", plain2, plaintext)
	}
}

func TestAESGCM_WrongKeyFails(t *testing.T) {
	k1 := DeriveKey([]byte("seed"), "k1")
	k2 := DeriveKey([]byte("seed"), "k2")
	ciphertext, _ := EncryptAESGCM(k1, []byte("secret"))
	if _, err := DecryptAESGCM(k2, ciphertext); err == nil {
		t.Fatal("decrypt with wrong key should fail")
	}
}

func TestAESGCM_TamperedCiphertextFails(t *testing.T) {
	key := DeriveKey([]byte("seed"), "tamper")
	ct, _ := EncryptAESGCM(key, []byte("secret"))
	raw, err := base64.StdEncoding.DecodeString(ct)
	if err != nil {
		t.Fatalf("decode our own ciphertext: %v", err)
	}
	// Flip a byte in the tag region (last 16 bytes), which is past the nonce
	// and past the ciphertext. This guarantees the GCM authentication check
	// is the failure path, not a base64 decode error.
	raw[len(raw)-1] ^= 0xFF
	tampered := base64.StdEncoding.EncodeToString(raw)
	if _, err := DecryptAESGCM(key, tampered); err == nil {
		t.Fatal("tampered ciphertext should fail GCM auth")
	}
}

func TestAESGCM_BadKeyLength(t *testing.T) {
	// Both encrypt and decrypt must reject any key that isn't exactly 32 bytes.
	shortKey := make([]byte, 16)   // AES-128 size, not allowed here
	longKey := make([]byte, 64)    // too long
	plaintext := []byte("secret")

	if _, err := EncryptAESGCM(shortKey, plaintext); err == nil {
		t.Error("EncryptAESGCM should reject 16-byte key")
	}
	if _, err := EncryptAESGCM(longKey, plaintext); err == nil {
		t.Error("EncryptAESGCM should reject 64-byte key")
	}

	// For decrypt we need *some* valid ciphertext to try; produce one with a
	// proper 32-byte key, then attempt to decrypt with wrong-length keys.
	validKey := DeriveKey([]byte("seed"), "badkey")
	ct, err := EncryptAESGCM(validKey, plaintext)
	if err != nil {
		t.Fatalf("setup encrypt: %v", err)
	}
	if _, err := DecryptAESGCM(shortKey, ct); err == nil {
		t.Error("DecryptAESGCM should reject 16-byte key")
	}
	if _, err := DecryptAESGCM(longKey, ct); err == nil {
		t.Error("DecryptAESGCM should reject 64-byte key")
	}
}
