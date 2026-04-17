package common

import (
	"bytes"
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
	ciphertext, _ := EncryptAESGCM(key, []byte("secret"))
	// flip one byte in the middle
	tampered := []byte(ciphertext)
	tampered[len(tampered)/2] ^= 0x01
	if _, err := DecryptAESGCM(key, string(tampered)); err == nil {
		t.Fatal("tampered ciphertext should fail auth")
	}
}
