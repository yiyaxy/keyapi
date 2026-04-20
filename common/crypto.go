package common

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"io"

	"golang.org/x/crypto/bcrypt"
	"golang.org/x/crypto/hkdf"
)

func GenerateHMACWithKey(key []byte, data string) string {
	h := hmac.New(sha256.New, key)
	h.Write([]byte(data))
	return hex.EncodeToString(h.Sum(nil))
}

func GenerateHMAC(data string) string {
	h := hmac.New(sha256.New, []byte(CryptoSecret))
	h.Write([]byte(data))
	return hex.EncodeToString(h.Sum(nil))
}

func Password2Hash(password string) (string, error) {
	passwordBytes := []byte(password)
	hashedPassword, err := bcrypt.GenerateFromPassword(passwordBytes, bcrypt.DefaultCost)
	return string(hashedPassword), err
}

func ValidatePasswordAndHash(password string, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}

// DeriveKey derives a 32-byte subkey from master via HKDF-SHA256.
// info should be a stable identifier for the usage (e.g. "wechat-pay-keys-v1"),
// enabling key separation across purposes from the same master secret.
func DeriveKey(master []byte, info string) []byte {
	out := make([]byte, 32)
	r := hkdf.New(sha256.New, master, nil, []byte(info))
	_, _ = io.ReadFull(r, out)
	return out
}

// EncryptAESGCM encrypts plaintext with AES-256-GCM.
// Returns base64(nonce(12) || ciphertext || tag(16)).
func EncryptAESGCM(key, plaintext []byte) (string, error) {
	if len(key) != 32 {
		return "", errors.New("key must be 32 bytes for AES-256-GCM")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	sealed := gcm.Seal(nil, nonce, plaintext, nil)
	out := make([]byte, 0, len(nonce)+len(sealed))
	out = append(out, nonce...)
	out = append(out, sealed...)
	return base64.StdEncoding.EncodeToString(out), nil
}

// DecryptAESGCM decrypts the output of EncryptAESGCM.
func DecryptAESGCM(key []byte, b64cipher string) ([]byte, error) {
	if len(key) != 32 {
		return nil, errors.New("key must be 32 bytes for AES-256-GCM")
	}
	raw, err := base64.StdEncoding.DecodeString(b64cipher)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	ns := gcm.NonceSize()
	if len(raw) < ns+16 {
		return nil, errors.New("ciphertext too short")
	}
	nonce, ct := raw[:ns], raw[ns:]
	return gcm.Open(nil, nonce, ct, nil)
}
