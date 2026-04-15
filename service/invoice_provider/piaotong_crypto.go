package invoice_provider

import (
	"bytes"
	"crypto"
	"crypto/des"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha1"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"fmt"
	"sort"
	"strings"
)

func normalize3DESKey(key string) ([]byte, error) {
	key = strings.TrimSpace(key)
	if key == "" {
		return nil, fmt.Errorf("empty 3des key")
	}
	decoded, err := base64.StdEncoding.DecodeString(key)
	if err == nil {
		if len(decoded) == 24 {
			return decoded, nil
		}
		if len(decoded) > 24 {
			return decoded[:24], nil
		}
	}
	raw := []byte(key)
	if len(raw) < 24 {
		return nil, fmt.Errorf("invalid 3des key length: %d", len(raw))
	}
	if len(raw) > 24 {
		raw = raw[:24]
	}
	return raw, nil
}

func pkcs5Padding(src []byte, blockSize int) []byte {
	padding := blockSize - len(src)%blockSize
	padText := bytes.Repeat([]byte{byte(padding)}, padding)
	return append(src, padText...)
}

func pkcs5Unpadding(src []byte) ([]byte, error) {
	if len(src) == 0 {
		return nil, fmt.Errorf("empty ciphertext")
	}
	unpadding := int(src[len(src)-1])
	if unpadding <= 0 || unpadding > len(src) {
		return nil, fmt.Errorf("invalid padding size")
	}
	for _, b := range src[len(src)-unpadding:] {
		if int(b) != unpadding {
			return nil, fmt.Errorf("invalid padding content")
		}
	}
	return src[:len(src)-unpadding], nil
}

func TripleDESEncryptECBBase64(plainText string, key string) (string, error) {
	normalizedKey, err := normalize3DESKey(key)
	if err != nil {
		return "", err
	}
	block, err := des.NewTripleDESCipher(normalizedKey)
	if err != nil {
		return "", err
	}
	data := pkcs5Padding([]byte(plainText), block.BlockSize())
	encrypted := make([]byte, len(data))
	blockSize := block.BlockSize()
	for start := 0; start < len(data); start += blockSize {
		block.Encrypt(encrypted[start:start+blockSize], data[start:start+blockSize])
	}
	return base64.StdEncoding.EncodeToString(encrypted), nil
}

func TripleDESDecryptECBBase64(cipherTextBase64 string, key string) (string, error) {
	normalizedKey, err := normalize3DESKey(key)
	if err != nil {
		return "", err
	}
	cipherData, err := base64.StdEncoding.DecodeString(strings.TrimSpace(cipherTextBase64))
	if err != nil {
		return "", err
	}
	block, err := des.NewTripleDESCipher(normalizedKey)
	if err != nil {
		return "", err
	}
	blockSize := block.BlockSize()
	if len(cipherData) == 0 || len(cipherData)%blockSize != 0 {
		return "", fmt.Errorf("invalid ciphertext length")
	}
	decrypted := make([]byte, len(cipherData))
	for start := 0; start < len(cipherData); start += blockSize {
		block.Decrypt(decrypted[start:start+blockSize], cipherData[start:start+blockSize])
	}
	decrypted, err = pkcs5Unpadding(decrypted)
	if err != nil {
		return "", err
	}
	return string(decrypted), nil
}

func ensurePEMWrapped(raw, header string) string {
	raw = strings.TrimSpace(raw)
	if strings.HasPrefix(raw, "-----") {
		return raw
	}
	// PEM requires base64 lines of max 64 characters
	var lines []string
	lines = append(lines, "-----BEGIN "+header+"-----")
	for len(raw) > 0 {
		end := 64
		if end > len(raw) {
			end = len(raw)
		}
		lines = append(lines, raw[:end])
		raw = raw[end:]
	}
	lines = append(lines, "-----END "+header+"-----")
	return strings.Join(lines, "\n")
}

func parseRSAPrivateKey(privateKeyPEM string) (*rsa.PrivateKey, error) {
	privateKeyPEM = ensurePEMWrapped(privateKeyPEM, "PRIVATE KEY")
	block, _ := pem.Decode([]byte(privateKeyPEM))
	if block == nil {
		// Also try RSA PRIVATE KEY header for PKCS#1
		privateKeyPEM = ensurePEMWrapped(strings.TrimSpace(privateKeyPEM), "RSA PRIVATE KEY")
		block, _ = pem.Decode([]byte(privateKeyPEM))
	}
	if block == nil {
		return nil, fmt.Errorf("invalid private key pem")
	}
	if key, err := x509.ParsePKCS8PrivateKey(block.Bytes); err == nil {
		rsaKey, ok := key.(*rsa.PrivateKey)
		if !ok {
			return nil, fmt.Errorf("private key is not rsa")
		}
		return rsaKey, nil
	}
	if key, err := x509.ParsePKCS1PrivateKey(block.Bytes); err == nil {
		return key, nil
	}
	return nil, fmt.Errorf("failed to parse rsa private key")
}

func parseRSAPublicKey(publicKeyPEM string) (*rsa.PublicKey, error) {
	publicKeyPEM = ensurePEMWrapped(publicKeyPEM, "PUBLIC KEY")
	block, _ := pem.Decode([]byte(publicKeyPEM))
	if block == nil {
		return nil, fmt.Errorf("invalid public key pem")
	}
	if key, err := x509.ParsePKIXPublicKey(block.Bytes); err == nil {
		rsaKey, ok := key.(*rsa.PublicKey)
		if !ok {
			return nil, fmt.Errorf("public key is not rsa")
		}
		return rsaKey, nil
	}
	if cert, err := x509.ParseCertificate(block.Bytes); err == nil {
		rsaKey, ok := cert.PublicKey.(*rsa.PublicKey)
		if !ok {
			return nil, fmt.Errorf("certificate public key is not rsa")
		}
		return rsaKey, nil
	}
	if key, err := x509.ParsePKCS1PublicKey(block.Bytes); err == nil {
		return key, nil
	}
	return nil, fmt.Errorf("failed to parse rsa public key")
}

func RSASignSHA1Base64(content string, privateKeyPEM string) (string, error) {
	privateKey, err := parseRSAPrivateKey(privateKeyPEM)
	if err != nil {
		return "", err
	}
	h := sha1.New()
	_, _ = h.Write([]byte(content))
	digest := h.Sum(nil)
	signature, err := rsa.SignPKCS1v15(rand.Reader, privateKey, crypto.SHA1, digest)
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(signature), nil
}

func RSAVerifySHA1Base64(content string, signatureBase64 string, publicKeyPEM string) error {
	publicKey, err := parseRSAPublicKey(publicKeyPEM)
	if err != nil {
		return err
	}
	signature, err := base64.StdEncoding.DecodeString(strings.TrimSpace(signatureBase64))
	if err != nil {
		return err
	}
	h := sha1.New()
	_, _ = h.Write([]byte(content))
	digest := h.Sum(nil)
	return rsa.VerifyPKCS1v15(publicKey, crypto.SHA1, digest, signature)
}

func BuildPiaoTongSignString(params map[string]string) string {
	keys := make([]string, 0, len(params))
	for key := range params {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		parts = append(parts, key+"="+params[key])
	}
	return strings.Join(parts, "&")
}
