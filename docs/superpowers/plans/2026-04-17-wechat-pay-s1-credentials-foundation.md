# WeChat Pay S1：凭据基础 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地租户级微信支付凭据的存储、加密与测试闭环：后端能安全持久化每租户的商户号凭据，前端能配置并点"测试连接"验证。

**Architecture:** 新增 `tenant_payment_configs` 表（含 AES-256-GCM 加密列）+ `common/crypto.go` 扩展（HKDF 派生子密钥 + AES-GCM）+ `service/payment/` 抽象层（provider 接口 + per-tenant client 缓存）+ `controller/tenant_payment.go`（配置 CRUD + 测试连接）+ `/console/tenant-payment` 前端页（Tab 1 配置）。每租户独立商户号（白标），敏感字段（app_secret / apiv3_key / 商户私钥 PEM）落库前加密，测试连接调微信 `/v3/certificates` 验证有效性。

**Tech Stack:** Go 1.25、GORM、gin、`github.com/wechatpay-apiv3/wechatpay-go`、React 18、Semi UI、Vite。

**关联 spec:** `docs/superpowers/specs/2026-04-17-wechat-pay-multi-tenant-design.md`

---

## Task 1：添加 wechatpay-go 依赖

**Files:**
- Modify: `go.mod`（由 `go get` 自动写入）
- Modify: `go.sum`（由 `go get` 自动写入）

- [ ] **Step 1: 添加依赖**

Run:
```bash
cd D:/top/keyapi
go get github.com/wechatpay-apiv3/wechatpay-go@latest
```

Expected: `go.mod` 多一行 `github.com/wechatpay-apiv3/wechatpay-go vX.Y.Z`；`go.sum` 多若干行

- [ ] **Step 2: 验证可编译**

Run: `go build ./...`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add go.mod go.sum
git commit -m "chore(payment): add wechatpay-apiv3/wechatpay-go dependency"
```

---

## Task 2：在 common/crypto.go 新增 HKDF + AES-GCM 工具函数

**Files:**
- Modify: `common/crypto.go`
- Test: `common/crypto_test.go`

- [ ] **Step 1: 写失败的测试 — HKDF 确定性**

Edit `common/crypto.go`（文件已存在，追加在末尾）— 先在 `common/crypto_test.go` 写测试。如果 `common/crypto_test.go` 不存在，用 Write 新建：

```go
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
	cipher, err := EncryptAESGCM(key, plaintext)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	if cipher == "" {
		t.Fatal("cipher empty")
	}
	plain2, err := DecryptAESGCM(key, cipher)
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
	cipher, _ := EncryptAESGCM(k1, []byte("secret"))
	if _, err := DecryptAESGCM(k2, cipher); err == nil {
		t.Fatal("decrypt with wrong key should fail")
	}
}

func TestAESGCM_TamperedCiphertextFails(t *testing.T) {
	key := DeriveKey([]byte("seed"), "tamper")
	cipher, _ := EncryptAESGCM(key, []byte("secret"))
	// flip one byte in the middle
	tampered := []byte(cipher)
	tampered[len(tampered)/2] ^= 0x01
	if _, err := DecryptAESGCM(key, string(tampered)); err == nil {
		t.Fatal("tampered ciphertext should fail auth")
	}
}
```

- [ ] **Step 2: 运行测试验证失败**

Run: `go test ./common/ -run "TestDeriveKey|TestAESGCM" -v`
Expected: FAIL with "undefined: DeriveKey" / "undefined: EncryptAESGCM" / "undefined: DecryptAESGCM"

- [ ] **Step 3: 实现 DeriveKey / EncryptAESGCM / DecryptAESGCM**

Edit `common/crypto.go`，在文件末尾追加：

```go
import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"io"

	"golang.org/x/crypto/hkdf"
	"crypto/sha256"
)

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
```

注意：如果 `common/crypto.go` 里已有 `import` block，不要重复添加已存在的包；只追加缺的（`crypto/aes`、`crypto/cipher`、`crypto/rand`、`encoding/base64`、`errors`、`io`、`golang.org/x/crypto/hkdf`、`crypto/sha256`）。

- [ ] **Step 4: 补 hkdf 依赖**

Run:
```bash
go get golang.org/x/crypto/hkdf
```

- [ ] **Step 5: 运行测试验证通过**

Run: `go test ./common/ -run "TestDeriveKey|TestAESGCM" -v`
Expected: 全部 PASS

- [ ] **Step 6: Commit**

```bash
git add common/crypto.go common/crypto_test.go go.mod go.sum
git commit -m "feat(crypto): add HKDF and AES-256-GCM helpers for payment credential encryption"
```

---

## Task 3：service/payment/crypto.go — 支付密钥获取

**Files:**
- Create: `service/payment/crypto.go`
- Test: `service/payment/crypto_test.go`

- [ ] **Step 1: 写失败的测试**

Create `service/payment/crypto_test.go`:

```go
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
```

- [ ] **Step 2: 运行测试验证失败**

Run: `go test ./service/payment/ -run TestPaymentMasterKey -v`
Expected: FAIL with "undefined: paymentMasterKey"

- [ ] **Step 3: 实现 paymentMasterKey**

Create `service/payment/crypto.go`:

```go
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
```

- [ ] **Step 4: 运行测试验证通过**

Run: `go test ./service/payment/ -run TestPaymentMasterKey -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add service/payment/crypto.go service/payment/crypto_test.go
git commit -m "feat(payment): add paymentMasterKey with HKDF default and env override"
```

---

## Task 4：model/tenant_payment_config.go — 模型 + 加密 CRUD

**Files:**
- Create: `model/tenant_payment_config.go`
- Test: `model/tenant_payment_config_test.go`
- Modify: `model/main.go`（AutoMigrate）
- Modify: `model/tenant_scope.go`（注册 tenant-scoped 表）

- [ ] **Step 1: 写失败的测试**

Create `model/tenant_payment_config_test.go`:

```go
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
```

- [ ] **Step 2: 运行测试验证失败**

Run: `go test ./model/ -run TestTenantPaymentConfig -v`
Expected: FAIL（类型不存在）

- [ ] **Step 3: 创建 model/tenant_payment_config.go**

```go
package model

import (
	"errors"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

// TenantPaymentConfig stores per-tenant per-provider payment credentials.
// Sensitive fields are stored encrypted with AES-256-GCM (base64-encoded).
//
// Registered as tenant-scoped in tenant_scope.go. All reads and writes must
// either carry an explicit tenant_id filter (request context) or use
// WithTenantBypass + manual .Where("tenant_id = ?", tid) for non-request
// contexts like webhook callbacks or reconcile loops.
type TenantPaymentConfig struct {
	Id             int    `json:"id" gorm:"primaryKey"`
	TenantId       int    `json:"tenant_id" gorm:"uniqueIndex:idx_tenant_provider;not null"`
	Provider       string `json:"provider" gorm:"uniqueIndex:idx_tenant_provider;type:varchar(32);not null"`

	Enabled        bool   `json:"enabled" gorm:"default:false"`
	PlatformLocked bool   `json:"platform_locked" gorm:"default:false"`

	AppId    string `json:"app_id" gorm:"type:varchar(64)"`
	Mchid    string `json:"mchid" gorm:"type:varchar(32)"`
	SerialNo string `json:"serial_no" gorm:"type:varchar(64)"`

	// Encrypted (AES-256-GCM, base64).
	// Exposed in JSON only as boolean "_set" flags in controller layer.
	AppSecretEnc  string `json:"-" gorm:"type:text"`
	Apiv3KeyEnc   string `json:"-" gorm:"type:text"`
	PrivateKeyEnc string `json:"-" gorm:"type:text"`

	LastTestAt    int64  `json:"last_test_at"`
	LastTestOk    bool   `json:"last_test_ok"`
	LastTestError string `json:"last_test_error" gorm:"type:varchar(500)"`

	CreatedAt int64          `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt int64          `json:"updated_at" gorm:"autoUpdateTime"`
	DeletedAt gorm.DeletedAt `json:"-" gorm:"index"`
}

// TenantPaymentPlaintext holds the plaintext form of sensitive fields.
// Callers should never log or persist this struct.
type TenantPaymentPlaintext struct {
	AppSecret  string
	Apiv3Key   string
	PrivateKey string
}

// derivePaymentKey is an injection seam for tests; replaced by a helper
// that calls service/payment.paymentMasterKey() via a small registration.
var derivePaymentKey = func() []byte {
	// Default: HKDF(CryptoSecret, "wechat-pay-keys-v1").
	// Mirrors service/payment.paymentMasterKey default path. The env override
	// lives in the service layer to avoid a model→service import cycle; in
	// production that override is installed at startup (see InitPaymentCrypto).
	return common.DeriveKey([]byte(common.CryptoSecret), "wechat-pay-keys-v1")
}

// InitPaymentCrypto lets service/payment install its master-key resolver,
// enabling the PAYMENT_MASTER_KEY env override without model→service imports.
func InitPaymentCrypto(resolver func() []byte) {
	if resolver != nil {
		derivePaymentKey = resolver
	}
}

func encField(plain string) (string, error) {
	if plain == "" {
		return "", nil
	}
	return common.EncryptAESGCM(derivePaymentKey(), []byte(plain))
}

func decField(cipher string) (string, error) {
	if cipher == "" {
		return "", nil
	}
	out, err := common.DecryptAESGCM(derivePaymentKey(), cipher)
	if err != nil {
		return "", err
	}
	return string(out), nil
}

// EncryptAndSetSensitive encrypts the plaintext fields and writes them onto
// the config. Empty plaintext fields are preserved as empty ciphertext
// (keeps semantics: "unchanged" must be handled explicitly by callers).
func (c *TenantPaymentConfig) EncryptAndSetSensitive(p TenantPaymentPlaintext) error {
	a, err := encField(p.AppSecret)
	if err != nil {
		return err
	}
	k, err := encField(p.Apiv3Key)
	if err != nil {
		return err
	}
	pk, err := encField(p.PrivateKey)
	if err != nil {
		return err
	}
	c.AppSecretEnc = a
	c.Apiv3KeyEnc = k
	c.PrivateKeyEnc = pk
	return nil
}

// DecryptSensitive returns the plaintext form of the three encrypted fields.
// An empty ciphertext yields an empty plaintext (no error).
func (c *TenantPaymentConfig) DecryptSensitive() (TenantPaymentPlaintext, error) {
	var p TenantPaymentPlaintext
	a, err := decField(c.AppSecretEnc)
	if err != nil {
		return p, err
	}
	k, err := decField(c.Apiv3KeyEnc)
	if err != nil {
		return p, err
	}
	pk, err := decField(c.PrivateKeyEnc)
	if err != nil {
		return p, err
	}
	p.AppSecret = a
	p.Apiv3Key = k
	p.PrivateKey = pk
	return p, nil
}

// GetTenantPaymentConfig returns the config row for (tenantId, provider).
// Uses WithTenantBypass + explicit WHERE because callers may invoke this
// from non-request contexts (webhook callback, reconcile loop, clientCache
// lazy load). Request-context callers still pass the tenantId they resolved
// from middleware; the filter in-code doubles as a defense-in-depth check.
func GetTenantPaymentConfig(tenantId int, provider string) (*TenantPaymentConfig, error) {
	if tenantId <= 0 || provider == "" {
		return nil, errors.New("invalid tenantId or provider")
	}
	var cfg TenantPaymentConfig
	err := WithTenantBypass(DB).
		Where("tenant_id = ? AND provider = ?", tenantId, provider).
		First(&cfg).Error
	if err != nil {
		return nil, err
	}
	return &cfg, nil
}

// UpsertTenantPaymentConfig writes/updates the config row. Expects encrypted
// fields already populated by EncryptAndSetSensitive.
func UpsertTenantPaymentConfig(cfg *TenantPaymentConfig) error {
	if cfg.TenantId <= 0 || cfg.Provider == "" {
		return errors.New("invalid tenantId or provider")
	}
	now := time.Now().Unix()
	var existing TenantPaymentConfig
	err := WithTenantBypass(DB).
		Where("tenant_id = ? AND provider = ?", cfg.TenantId, cfg.Provider).
		First(&existing).Error
	if err == gorm.ErrRecordNotFound {
		cfg.CreatedAt = now
		cfg.UpdatedAt = now
		return WithTenantBypass(DB).Create(cfg).Error
	}
	if err != nil {
		return err
	}
	cfg.Id = existing.Id
	cfg.CreatedAt = existing.CreatedAt
	cfg.UpdatedAt = now
	return WithTenantBypass(DB).
		Where("id = ? AND tenant_id = ?", existing.Id, cfg.TenantId).
		Save(cfg).Error
}

// DeleteTenantPaymentConfig clears the row (and therefore disables the provider).
func DeleteTenantPaymentConfig(tenantId int, provider string) error {
	if tenantId <= 0 || provider == "" {
		return errors.New("invalid tenantId or provider")
	}
	return WithTenantBypass(DB).
		Where("tenant_id = ? AND provider = ?", tenantId, provider).
		Delete(&TenantPaymentConfig{}).Error
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `go test ./model/ -run TestTenantPaymentConfig -v`
Expected: PASS

- [ ] **Step 5: 注册 AutoMigrate**

Edit `model/main.go`：找到 `DB.AutoMigrate(` 里的长列表（在 `migrateDB` 函数中，已有 `&Tenant{}, &TenantMembership{}, &TenantInvite{}, &TenantOption{}, ...` 等），**紧跟 `&TenantOption{}` 之后**添加一行：

```go
		&TenantPaymentConfig{},
```

- [ ] **Step 6: 注册 tenant-scoped 表**

Edit `model/tenant_scope.go`：找到 `func RegisterTenantCallbacks(db *gorm.DB)` 里已有的 `RegisterTenantScopedTable("tenant_options")` 或类似行，**在该行下方**追加：

```go
	RegisterTenantScopedTable("tenant_payment_configs")
```

- [ ] **Step 7: 编译 + 运行所有 model 测试验证**

Run: `go build ./... && go test ./model/ -v`
Expected: 全部 PASS

- [ ] **Step 8: Commit**

```bash
git add model/tenant_payment_config.go model/tenant_payment_config_test.go model/main.go model/tenant_scope.go
git commit -m "feat(model): add TenantPaymentConfig with AES-GCM encrypted credentials"
```

---

## Task 5：在 main.go 启动时安装支付密钥 resolver

**Files:**
- Modify: `main.go`

- [ ] **Step 1: 安装 resolver**

Edit `main.go`：找到 `func InitResources()` 中 `model.InitDB()` 成功之后、`model.CheckSetup()` 之前（约 `main.go:288-294` 区间），插入：

```go
	// Install the payment master-key resolver, enabling PAYMENT_MASTER_KEY env override.
	model.InitPaymentCrypto(service.PaymentMasterKey)
```

- [ ] **Step 2: 暴露 service.PaymentMasterKey**

Edit `service/payment/crypto.go`：在文件末尾加一个 **exported** wrapper（保持 `paymentMasterKey` 小写未导出用于测试，新建导出 wrapper 供外部调用）：

```go
// PaymentMasterKey is the exported wrapper used at startup to install the
// key resolver into the model layer (avoiding a model→service import cycle).
func PaymentMasterKey() []byte {
	return paymentMasterKey()
}
```

- [ ] **Step 3: 编译验证**

Run: `go build ./...`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add main.go service/payment/crypto.go
git commit -m "feat(payment): install PAYMENT_MASTER_KEY resolver at startup"
```

---

## Task 6：service/payment/provider.go — PaymentProvider 接口

**Files:**
- Create: `service/payment/provider.go`

- [ ] **Step 1: 创建接口**

```go
package payment

import (
	"context"

	"github.com/QuantumNous/new-api/model"
)

// PaymentProvider abstracts a payment gateway adapter (wechat, alipay, etc).
//
// S1 only requires TestCredentials. CreateOrder / VerifyAndParseNotify /
// QueryOrder / Refund will be added in S2 and S3 as their features land.
type PaymentProvider interface {
	Name() string
	TestCredentials(ctx context.Context, cfg *model.TenantPaymentConfig) error
}

// Registry of provider implementations keyed by Name().
// Populated by provider-specific init (e.g. wechat.Register()).
var registry = map[string]PaymentProvider{}

// Register installs a provider. Call from init() in the provider package.
func Register(p PaymentProvider) {
	registry[p.Name()] = p
}

// Get looks up a provider by name.
func Get(name string) (PaymentProvider, bool) {
	p, ok := registry[name]
	return p, ok
}
```

- [ ] **Step 2: 编译**

Run: `go build ./...`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add service/payment/provider.go
git commit -m "feat(payment): add PaymentProvider interface and registry"
```

---

## Task 7：service/payment/wechat/client.go — per-tenant Client 缓存

**Files:**
- Create: `service/payment/wechat/client.go`
- Test: `service/payment/wechat/client_test.go`

- [ ] **Step 1: 写失败的测试（仅测缓存键与 invalidate）**

Create `service/payment/wechat/client_test.go`:

```go
package wechat

import (
	"testing"
)

func TestCache_InvalidateRemovesEntry(t *testing.T) {
	c := newClientCache()
	// Store a non-nil placeholder to ensure we can observe removal.
	c.store(123, &cachedClient{tenantId: 123})
	if _, ok := c.lookup(123); !ok {
		t.Fatal("expected cached entry")
	}
	c.Invalidate(123)
	if _, ok := c.lookup(123); ok {
		t.Fatal("entry should be gone after invalidate")
	}
}
```

- [ ] **Step 2: 运行测试验证失败**

Run: `go test ./service/payment/wechat/ -v`
Expected: FAIL (undefined types)

- [ ] **Step 3: 实现 client.go**

```go
// Package wechat implements the WeChat Pay v3 PaymentProvider.
//
// Credentials are loaded per-tenant from tenant_payment_configs and cached in
// memory as wechatpay-go core.Client instances. The clientCache key is
// tenantId; invalidation must be triggered whenever config is updated or
// deleted (controller layer calls clientCache.Invalidate).
package wechat

import (
	"context"
	"crypto/rsa"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/model"
	"github.com/wechatpay-apiv3/wechatpay-go/core"
	"github.com/wechatpay-apiv3/wechatpay-go/core/option"
	"github.com/wechatpay-apiv3/wechatpay-go/utils"
)

// cachedClient wraps a wechatpay-go core.Client plus the config snapshot
// used to build it, so we can detect staleness by UpdatedAt.
type cachedClient struct {
	tenantId  int
	updatedAt int64
	client    *core.Client
	mchid     string
	appid     string
}

type clientCache struct {
	mu      sync.RWMutex
	entries map[int]*cachedClient
}

func newClientCache() *clientCache {
	return &clientCache{entries: map[int]*cachedClient{}}
}

func (c *clientCache) lookup(tid int) (*cachedClient, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	e, ok := c.entries[tid]
	return e, ok
}

func (c *clientCache) store(tid int, e *cachedClient) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.entries[tid] = e
}

// Invalidate drops the cached entry for a tenant.
// Call after Upsert / Delete of the config, or on credential test failure.
func (c *clientCache) Invalidate(tid int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.entries, tid)
}

// Global singleton. S1 exposes Get via the package for reuse across handlers.
var cache = newClientCache()

// InvalidateCache removes a tenant's cached client. Exported for controller
// layer use after config mutation.
func InvalidateCache(tid int) {
	cache.Invalidate(tid)
}

// buildClient loads the tenant config and constructs a fresh core.Client.
// Returns an error (not panics) on credential corruption so the caller can
// surface a clear failure to the user and skip further calls.
//
// Uses model.GetTenantPaymentConfig which internally applies WithTenantBypass
// + explicit WHERE tenant_id=? (see §4 of the spec's guardrail rules).
func buildClient(ctx context.Context, tid int) (*cachedClient, error) {
	cfg, err := model.GetTenantPaymentConfig(tid, "wechat")
	if err != nil {
		return nil, fmt.Errorf("load tenant %d wechat config: %w", tid, err)
	}
	if !cfg.Enabled || cfg.PlatformLocked {
		return nil, errors.New("tenant wechat payment not enabled")
	}
	if cfg.Mchid == "" || cfg.AppId == "" || cfg.SerialNo == "" {
		return nil, errors.New("incomplete wechat credentials")
	}
	plain, err := cfg.DecryptSensitive()
	if err != nil {
		return nil, fmt.Errorf("decrypt credentials: %w", err)
	}
	if plain.PrivateKey == "" || plain.Apiv3Key == "" {
		return nil, errors.New("missing private key or apiv3 key")
	}
	privKey, err := utils.LoadPrivateKey(plain.PrivateKey)
	if err != nil {
		return nil, fmt.Errorf("parse private key PEM: %w", err)
	}
	cli, err := core.NewClient(ctx,
		option.WithWechatPayAutoAuthCipher(
			cfg.Mchid, cfg.SerialNo, privKey.(*rsa.PrivateKey), plain.Apiv3Key,
		),
	)
	if err != nil {
		return nil, fmt.Errorf("build wechatpay client: %w", err)
	}
	return &cachedClient{
		tenantId:  tid,
		updatedAt: cfg.UpdatedAt,
		client:    cli,
		mchid:     cfg.Mchid,
		appid:     cfg.AppId,
	}, nil
}

// getClient returns a cached client for the tenant, or builds a fresh one.
// Stale cache (config updated_at moved) is re-loaded.
func getClient(ctx context.Context, tid int) (*cachedClient, error) {
	if e, ok := cache.lookup(tid); ok {
		// Cheap staleness check: compare UpdatedAt against DB. A more scalable
		// alternative is to require callers to Invalidate on change (which the
		// controller layer does). This double check costs a tiny DB roundtrip
		// per payment op but eliminates stale-cache footguns in multi-replica
		// setups; S1 errs on the side of safety.
		cfg, err := model.GetTenantPaymentConfig(tid, "wechat")
		if err == nil && cfg.UpdatedAt == e.updatedAt {
			return e, nil
		}
	}
	fresh, err := buildClient(ctx, tid)
	if err != nil {
		return nil, err
	}
	cache.store(tid, fresh)
	return fresh, nil
}

// callWithTimeout applies a short default timeout to any wechat API call.
func callWithTimeout(parent context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(parent, 10*time.Second)
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `go test ./service/payment/wechat/ -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add service/payment/wechat/client.go service/payment/wechat/client_test.go
git commit -m "feat(payment/wechat): add per-tenant client cache with staleness check"
```

---

## Task 8：service/payment/wechat/test.go — TestCredentials 实现 + 注册

**Files:**
- Create: `service/payment/wechat/test.go`
- Create: `service/payment/wechat/init.go`

- [ ] **Step 1: 创建 test.go**

```go
package wechat

import (
	"context"
	"fmt"

	"github.com/QuantumNous/new-api/model"
	"github.com/wechatpay-apiv3/wechatpay-go/services/certificates"
)

// providerImpl is the WeChat implementation of payment.PaymentProvider.
type providerImpl struct{}

func (providerImpl) Name() string { return "wechat" }

// TestCredentials verifies a tenant's WeChat credentials by calling
// GET /v3/certificates. A successful call proves:
//   - mchid + serial_no + private key match a real merchant account
//   - apiv3_key is the correct symmetric key for platform cert decryption
//
// On success, the result also warms the wechatpay-go platform cert downloader
// for that tenant.
func (providerImpl) TestCredentials(ctx context.Context, cfg *model.TenantPaymentConfig) error {
	if cfg == nil {
		return fmt.Errorf("nil config")
	}
	// Force a fresh client build regardless of cache — we want to surface
	// credential errors immediately rather than reuse a stale cached client.
	cache.Invalidate(cfg.TenantId)

	cli, err := getClient(ctx, cfg.TenantId)
	if err != nil {
		return err
	}
	callCtx, cancel := callWithTimeout(ctx)
	defer cancel()
	svc := certificates.CertificatesApiService{Client: cli.client}
	resp, _, err := svc.DownloadCertificates(callCtx,
		certificates.DownloadCertificatesRequest{},
	)
	if err != nil {
		return fmt.Errorf("wechat certificates call failed: %w", err)
	}
	if resp == nil || len(resp.Data) == 0 {
		return fmt.Errorf("wechat returned no platform certificates")
	}
	return nil
}
```

- [ ] **Step 2: 创建 init.go 注册 provider**

```go
package wechat

import "github.com/QuantumNous/new-api/service/payment"

func init() {
	payment.Register(providerImpl{})
}
```

- [ ] **Step 3: 在 service/payment 的包导入链里引入 wechat**

Edit `main.go`：在 `main.go` 顶部的 `import (` 块里补一行 blank import，确保 wechat.init() 被调用（放在现有 `_ "github.com/QuantumNous/new-api/setting/performance_setting"` 那行附近）：

```go
	_ "github.com/QuantumNous/new-api/service/payment/wechat"
```

- [ ] **Step 4: 编译**

Run: `go build ./...`
Expected: 无错误

- [ ] **Step 5: Commit**

```bash
git add service/payment/wechat/test.go service/payment/wechat/init.go main.go
git commit -m "feat(payment/wechat): implement TestCredentials via /v3/certificates"
```

---

## Task 9：controller/tenant_payment.go — 配置 CRUD + 测试连接

**Files:**
- Create: `controller/tenant_payment.go`

- [ ] **Step 1: 创建 controller**

```go
package controller

import (
	"context"
	"errors"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service/payment"
	"github.com/QuantumNous/new-api/service/payment/wechat"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// tenantPaymentConfigView is the outward-facing JSON representation of a
// TenantPaymentConfig. Sensitive ciphertext is never exposed; for each
// encrypted field we return a boolean "<field>_set" so the UI knows
// whether the user needs to paste the secret again on update.
type tenantPaymentConfigView struct {
	Id             int    `json:"id"`
	Provider       string `json:"provider"`
	Enabled        bool   `json:"enabled"`
	PlatformLocked bool   `json:"platform_locked"`
	AppId          string `json:"app_id"`
	Mchid          string `json:"mchid"`
	SerialNo       string `json:"serial_no"`
	AppSecretSet   bool   `json:"app_secret_set"`
	Apiv3KeySet    bool   `json:"apiv3_key_set"`
	PrivateKeySet  bool   `json:"private_key_set"`
	LastTestAt     int64  `json:"last_test_at"`
	LastTestOk     bool   `json:"last_test_ok"`
	LastTestError  string `json:"last_test_error"`
	CreatedAt      int64  `json:"created_at"`
	UpdatedAt      int64  `json:"updated_at"`
}

func toView(cfg *model.TenantPaymentConfig) tenantPaymentConfigView {
	return tenantPaymentConfigView{
		Id: cfg.Id, Provider: cfg.Provider,
		Enabled: cfg.Enabled, PlatformLocked: cfg.PlatformLocked,
		AppId: cfg.AppId, Mchid: cfg.Mchid, SerialNo: cfg.SerialNo,
		AppSecretSet: cfg.AppSecretEnc != "", Apiv3KeySet: cfg.Apiv3KeyEnc != "",
		PrivateKeySet: cfg.PrivateKeyEnc != "",
		LastTestAt:    cfg.LastTestAt, LastTestOk: cfg.LastTestOk,
		LastTestError: cfg.LastTestError,
		CreatedAt:     cfg.CreatedAt, UpdatedAt: cfg.UpdatedAt,
	}
}

// GetTenantPaymentConfigs returns all providers configured for the current tenant.
// For S1 the list contains at most one entry (wechat).
func GetTenantPaymentConfigs(c *gin.Context) {
	tid := middleware.GetTenantId(c)
	if tid <= 0 {
		common.ApiErrorMsg(c, "无法解析当前租户")
		return
	}
	cfg, err := model.GetTenantPaymentConfig(tid, "wechat")
	if errors.Is(err, gorm.ErrRecordNotFound) {
		common.ApiSuccess(c, []tenantPaymentConfigView{})
		return
	}
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, []tenantPaymentConfigView{toView(cfg)})
}

// UpdateTenantPaymentConfigRequest carries update fields.
// Sensitive strings are optional: empty string means "leave existing
// ciphertext alone" so the UI doesn't need to force re-entry on every save.
type UpdateTenantPaymentConfigRequest struct {
	Enabled    *bool  `json:"enabled"`
	AppId      string `json:"app_id"`
	Mchid      string `json:"mchid"`
	SerialNo   string `json:"serial_no"`
	AppSecret  string `json:"app_secret"`
	Apiv3Key   string `json:"apiv3_key"`
	PrivateKey string `json:"private_key"`
}

// UpdateTenantWechatConfig writes new config values for the current tenant.
// Empty sensitive fields preserve existing ciphertext; non-empty overwrites it.
func UpdateTenantWechatConfig(c *gin.Context) {
	tid := middleware.GetTenantId(c)
	if tid <= 0 {
		common.ApiErrorMsg(c, "无法解析当前租户")
		return
	}
	var req UpdateTenantPaymentConfigRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}

	cfg, err := model.GetTenantPaymentConfig(tid, "wechat")
	if errors.Is(err, gorm.ErrRecordNotFound) {
		cfg = &model.TenantPaymentConfig{TenantId: tid, Provider: "wechat"}
	} else if err != nil {
		common.ApiError(c, err)
		return
	}
	if cfg.PlatformLocked {
		common.ApiErrorMsg(c, "平台已禁用该租户的支付能力，请联系管理员")
		return
	}

	if req.AppId != "" {
		cfg.AppId = req.AppId
	}
	if req.Mchid != "" {
		cfg.Mchid = req.Mchid
	}
	if req.SerialNo != "" {
		cfg.SerialNo = req.SerialNo
	}
	if req.Enabled != nil {
		cfg.Enabled = *req.Enabled
	}

	// Only (re-)encrypt the fields actually provided. Empty ⇒ keep existing.
	if req.AppSecret != "" || req.Apiv3Key != "" || req.PrivateKey != "" {
		existing, _ := cfg.DecryptSensitive()
		plain := model.TenantPaymentPlaintext{
			AppSecret:  ifNonEmpty(req.AppSecret, existing.AppSecret),
			Apiv3Key:   ifNonEmpty(req.Apiv3Key, existing.Apiv3Key),
			PrivateKey: ifNonEmpty(req.PrivateKey, existing.PrivateKey),
		}
		if err := cfg.EncryptAndSetSensitive(plain); err != nil {
			common.ApiError(c, err)
			return
		}
	}

	if err := model.UpsertTenantPaymentConfig(cfg); err != nil {
		common.ApiError(c, err)
		return
	}
	wechat.InvalidateCache(tid)

	// Reload the persisted row to return authoritative values.
	fresh, err := model.GetTenantPaymentConfig(tid, "wechat")
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, toView(fresh))
}

// TestTenantWechatConfig runs TestCredentials and persists the result
// (LastTestAt/Ok/Error) for the UI to display.
func TestTenantWechatConfig(c *gin.Context) {
	tid := middleware.GetTenantId(c)
	if tid <= 0 {
		common.ApiErrorMsg(c, "无法解析当前租户")
		return
	}
	cfg, err := model.GetTenantPaymentConfig(tid, "wechat")
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if cfg.PlatformLocked {
		common.ApiErrorMsg(c, "平台已禁用该租户的支付能力")
		return
	}

	provider, ok := payment.Get("wechat")
	if !ok {
		common.ApiErrorMsg(c, "wechat provider 未注册")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
	defer cancel()

	testErr := provider.TestCredentials(ctx, cfg)
	cfg.LastTestAt = time.Now().Unix()
	cfg.LastTestOk = testErr == nil
	if testErr != nil {
		cfg.LastTestError = testErr.Error()
	} else {
		cfg.LastTestError = ""
	}
	_ = model.UpsertTenantPaymentConfig(cfg)
	wechat.InvalidateCache(tid)

	if testErr != nil {
		c.JSON(200, gin.H{"success": false, "message": testErr.Error()})
		return
	}
	common.ApiSuccess(c, toView(cfg))
}

// DeleteTenantWechatConfig wipes the row, disabling the provider.
func DeleteTenantWechatConfig(c *gin.Context) {
	tid := middleware.GetTenantId(c)
	if tid <= 0 {
		common.ApiErrorMsg(c, "无法解析当前租户")
		return
	}
	if err := model.DeleteTenantPaymentConfig(tid, "wechat"); err != nil {
		common.ApiError(c, err)
		return
	}
	wechat.InvalidateCache(tid)
	common.ApiSuccess(c, gin.H{"deleted": true})
}

func ifNonEmpty(override, existing string) string {
	if override != "" {
		return override
	}
	return existing
}
```

- [ ] **Step 2: 编译**

Run: `go build ./...`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add controller/tenant_payment.go
git commit -m "feat(controller): add tenant payment config CRUD + test endpoint"
```

---

## Task 10：router 注册 /api/tenant/payment/configs 路由

**Files:**
- Modify: `router/api-router.go`

- [ ] **Step 1: 注册路由**

Edit `router/api-router.go`：找到 `tenantAdminRoute` 分组（现有 `/api/tenant/*` 下 `RequireTenantAdmin()` 包住的 group），在该 group 内追加：

```go
		// Payment configuration (see docs/superpowers/specs/2026-04-17-wechat-pay-multi-tenant-design.md §7.1)
		tenantAdminRoute.GET("/payment/configs", controller.GetTenantPaymentConfigs)
		tenantAdminRoute.PUT("/payment/configs/wechat", controller.UpdateTenantWechatConfig)
		tenantAdminRoute.POST("/payment/configs/wechat/test", controller.TestTenantWechatConfig)
		tenantAdminRoute.DELETE("/payment/configs/wechat", controller.DeleteTenantWechatConfig)
```

如果 `router/api-router.go` 里 tenantAdminRoute 的具体变量名不同（例如 `tenantAdminRouter` / `tenantAPI`），grep 一下实际名字并替换。可用命令确认：

Run:
```bash
grep -n "RequireTenantAdmin" router/api-router.go
```

- [ ] **Step 2: 编译**

Run: `go build ./...`
Expected: 无错误

- [ ] **Step 3: 手工测试（需要本地后端已跑 `go run .`）**

Run:
```bash
# 登录获取 session cookie（假设已有 root / wsg666 登录态）
# 然后测 GET 返回空列表：
curl -i "http://localhost:3000/api/tenant/payment/configs" -b cookiejar.txt
```

Expected: `{"success":true,"data":[]}`

- [ ] **Step 4: Commit**

```bash
git add router/api-router.go
git commit -m "feat(router): register /api/tenant/payment/configs routes"
```

---

## Task 11：前端 — TS 类型 + API helper

**Files:**
- Modify: `web/src/types/tenant.ts`（追加类型）
- Create: `web/src/helpers/payment.js`（API 调用封装）

- [ ] **Step 1: 追加 TS 类型**

Edit `web/src/types/tenant.ts`，文件末尾追加：

```ts
// ---------- Payment Configs ----------

export interface TenantPaymentConfigView {
  id: number;
  provider: 'wechat';
  enabled: boolean;
  platform_locked: boolean;
  app_id: string;
  mchid: string;
  serial_no: string;
  app_secret_set: boolean;
  apiv3_key_set: boolean;
  private_key_set: boolean;
  last_test_at: number;
  last_test_ok: boolean;
  last_test_error: string;
  created_at: number;
  updated_at: number;
}

export interface UpdateWechatConfigRequest {
  enabled?: boolean;
  app_id?: string;
  mchid?: string;
  serial_no?: string;
  // Empty string means "leave existing ciphertext alone".
  app_secret?: string;
  apiv3_key?: string;
  private_key?: string;
}
```

- [ ] **Step 2: 创建 API helper**

Create `web/src/helpers/payment.js`:

```js
import { API } from './api';

export async function getTenantPaymentConfigs() {
  const res = await API.get('/api/tenant/payment/configs');
  return res.data;
}

export async function updateWechatConfig(payload) {
  const res = await API.put('/api/tenant/payment/configs/wechat', payload);
  return res.data;
}

export async function testWechatConfig() {
  const res = await API.post('/api/tenant/payment/configs/wechat/test');
  return res.data;
}

export async function deleteWechatConfig() {
  const res = await API.delete('/api/tenant/payment/configs/wechat');
  return res.data;
}
```

注意：如果项目里 `API` 的导入路径和方法名不同（比如用 axios 实例导出为 `api`），grep `from '../helpers/api'` 看一下现有 helper 怎么写的：

Run: `grep -r "from '../helpers/api'" web/src/helpers/ | head -5`

按现有风格匹配。

- [ ] **Step 3: Commit**

```bash
git add web/src/types/tenant.ts web/src/helpers/payment.js
git commit -m "feat(web): add payment config types and API helpers"
```

---

## Task 12：前端 WechatConfig 表单组件

**Files:**
- Create: `web/src/pages/TenantPayment/WechatConfig.jsx`

- [ ] **Step 1: 创建组件**

```jsx
import React, { useEffect, useState } from 'react';
import {
  Card, Form, Button, Banner, Typography, Space, Toast,
  Input, TextArea, Switch,
} from '@douyinfe/semi-ui';
import {
  getTenantPaymentConfigs,
  updateWechatConfig,
  testWechatConfig,
  deleteWechatConfig,
} from '../../helpers/payment';

const { Text, Title } = Typography;

export default function WechatConfig() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [cfg, setCfg] = useState(null);
  const [form, setForm] = useState({
    enabled: false,
    app_id: '',
    mchid: '',
    serial_no: '',
    app_secret: '',
    apiv3_key: '',
    private_key: '',
  });

  const load = async () => {
    setLoading(true);
    try {
      const data = await getTenantPaymentConfigs();
      const list = data?.data || [];
      const wechat = list.find((c) => c.provider === 'wechat') || null;
      setCfg(wechat);
      if (wechat) {
        setForm({
          enabled: wechat.enabled,
          app_id: wechat.app_id,
          mchid: wechat.mchid,
          serial_no: wechat.serial_no,
          // Secrets: always start empty, user fills only if replacing.
          app_secret: '',
          apiv3_key: '',
          private_key: '',
        });
      }
    } catch (e) {
      Toast.error('加载配置失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const onSave = async () => {
    setSaving(true);
    try {
      const res = await updateWechatConfig(form);
      if (res?.success) {
        Toast.success('保存成功');
        await load();
      } else {
        Toast.error(res?.message || '保存失败');
      }
    } catch (e) {
      Toast.error(String(e));
    } finally {
      setSaving(false);
    }
  };

  const onTest = async () => {
    setTesting(true);
    try {
      const res = await testWechatConfig();
      if (res?.success) {
        Toast.success('连接成功');
      } else {
        Toast.error(res?.message || '连接失败');
      }
      await load();
    } catch (e) {
      Toast.error(String(e));
    } finally {
      setTesting(false);
    }
  };

  const onDelete = async () => {
    if (!window.confirm('确认清除微信支付配置？')) return;
    await deleteWechatConfig();
    Toast.success('已清除');
    await load();
  };

  if (loading) return <Card loading />;

  const locked = cfg?.platform_locked;

  return (
    <Card>
      <Title heading={5}>微信支付（WeChat Pay v3）</Title>
      {locked && (
        <Banner type="danger" description="平台管理员已禁用该租户的支付能力" />
      )}
      {cfg?.last_test_at > 0 && !cfg.last_test_ok && (
        <Banner
          type="warning"
          description={`上次凭据测试失败：${cfg.last_test_error || '未知原因'}`}
        />
      )}

      <Form labelPosition="left" labelWidth={160} disabled={locked || saving}>
        <Form.Switch
          field="enabled"
          label="启用"
          checked={form.enabled}
          onChange={(v) => setForm({ ...form, enabled: v })}
        />
        <Form.Input
          field="app_id"
          label="AppID"
          initValue={form.app_id}
          onChange={(v) => setForm({ ...form, app_id: v })}
          placeholder="wx1234567890abcdef"
        />
        <Form.Input
          field="mchid"
          label="商户号 MCHID"
          initValue={form.mchid}
          onChange={(v) => setForm({ ...form, mchid: v })}
          placeholder="1700000000"
        />
        <Form.Input
          field="serial_no"
          label="商户 API 证书序列号"
          initValue={form.serial_no}
          onChange={(v) => setForm({ ...form, serial_no: v })}
        />
        <Form.Input
          field="app_secret"
          label="AppSecret（小程序）"
          mode="password"
          placeholder={cfg?.app_secret_set ? '已设置（留空表示不修改）' : '请输入'}
          onChange={(v) => setForm({ ...form, app_secret: v })}
        />
        <Form.Input
          field="apiv3_key"
          label="APIv3 密钥"
          mode="password"
          placeholder={cfg?.apiv3_key_set ? '已设置（留空表示不修改）' : '请输入（32 字节）'}
          onChange={(v) => setForm({ ...form, apiv3_key: v })}
        />
        <Form.TextArea
          field="private_key"
          label="商户 API 证书私钥 PEM"
          rows={8}
          placeholder={cfg?.private_key_set
            ? '已设置（留空表示不修改）'
            : '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----'}
          onChange={(v) => setForm({ ...form, private_key: v })}
        />
      </Form>

      <Space style={{ marginTop: 24 }}>
        <Button theme="solid" loading={saving} onClick={onSave} disabled={locked}>
          保存
        </Button>
        <Button loading={testing} onClick={onTest} disabled={locked || !cfg}>
          测试连接
        </Button>
        <Button type="danger" onClick={onDelete} disabled={locked || !cfg}>
          清除配置
        </Button>
      </Space>
    </Card>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/pages/TenantPayment/WechatConfig.jsx
git commit -m "feat(web): add WechatConfig form with test connection button"
```

---

## Task 13：前端页面入口 + 路由 + 侧边栏

**Files:**
- Create: `web/src/pages/TenantPayment/index.jsx`
- Modify: `web/src/App.jsx`（路由）
- Modify: `web/src/components/layout/SiderBar.jsx`（侧边栏入口）

- [ ] **Step 1: 创建页面入口**

```jsx
import React from 'react';
import { Tabs, TabPane, Typography } from '@douyinfe/semi-ui';
import WechatConfig from './WechatConfig';

const { Title } = Typography;

export default function TenantPaymentPage() {
  return (
    <div style={{ padding: 24 }}>
      <Title heading={3} style={{ marginBottom: 16 }}>支付配置</Title>
      <Tabs type="line">
        <TabPane tab="配置" itemKey="config">
          <WechatConfig />
        </TabPane>
        <TabPane tab="订单（S2 提供）" itemKey="orders" disabled>
          <div />
        </TabPane>
        <TabPane tab="退款（S3 提供）" itemKey="refunds" disabled>
          <div />
        </TabPane>
      </Tabs>
    </div>
  );
}
```

- [ ] **Step 2: 注册路由**

Edit `web/src/App.jsx`：找到其他 `/console/tenant-*` 路由（例如 `/console/tenant-info` 或 `/console/tenant-members`），参照相同的 `TenantAdminRoute` 写法，追加：

```jsx
import TenantPaymentPage from './pages/TenantPayment';
// ...
<Route path="/console/tenant-payment" element={
  <TenantAdminRoute>
    <TenantPaymentPage />
  </TenantAdminRoute>
} />
```

（用 grep 找到 `TenantAdminRoute` 的具体引入和用法）

Run:
```bash
grep -n "TenantAdminRoute" web/src/App.jsx | head -5
```

按现有写法复制粘贴修改。

- [ ] **Step 3: 加侧边栏入口**

Edit `web/src/components/layout/SiderBar.jsx`：找到 `tenant-info` / `tenant-members` 的菜单项（参考 spec §9.4 所在 sidebar 章节），追加同一层级的 item：

```jsx
{
  itemKey: 'tenant-payment',
  text: '支付配置',  // i18n 化在 Step 4 做
  icon: <CreditCard size={14} />,  // 如果现有项目用 lucide-react
},
```

再在处理点击跳转的 switch/object 里加 `'tenant-payment': '/console/tenant-payment'`。

Run 前先确认现有侧边栏结构：
```bash
grep -n "tenant-info\|tenant-members" web/src/components/layout/SiderBar.jsx
```

- [ ] **Step 4: 加 i18n**

Edit `web/src/i18n/locales/zh-CN.json` 和 `en.json`，在合适的租户菜单段落追加：

zh-CN：
```json
  "支付配置": "支付配置",
  "微信支付（WeChat Pay v3）": "微信支付（WeChat Pay v3）",
  "测试连接": "测试连接",
  "清除配置": "清除配置",
  "已设置（留空表示不修改）": "已设置（留空表示不修改）",
  "请输入（32 字节）": "请输入（32 字节）",
  "平台管理员已禁用该租户的支付能力": "平台管理员已禁用该租户的支付能力",
  "上次凭据测试失败：{{error}}": "上次凭据测试失败：{{error}}"
```

en：
```json
  "支付配置": "Payment",
  "微信支付（WeChat Pay v3）": "WeChat Pay (v3)",
  "测试连接": "Test Connection",
  "清除配置": "Clear",
  "已设置（留空表示不修改）": "Set (leave empty to keep current)",
  "请输入（32 字节）": "Enter (32 bytes)",
  "平台管理员已禁用该租户的支付能力": "Platform admin has disabled payment for this tenant",
  "上次凭据测试失败：{{error}}": "Last credential test failed: {{error}}"
```

- [ ] **Step 5: build 验证**

Run:
```bash
cd D:/top/keyapi/web
npm run build
```

Expected: 成功（`vite v5.x.x building for production...` + 模块数 + build 时间）

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/TenantPayment/index.jsx web/src/App.jsx web/src/components/layout/SiderBar.jsx web/src/i18n/locales/zh-CN.json web/src/i18n/locales/en.json
git commit -m "feat(web): add /console/tenant-payment page + sidebar entry"
```

---

## Task 14：端到端手工验证

**Files:** 无代码改动

- [ ] **Step 1: 启动后端**

Run:
```bash
cd D:/top/keyapi
go run .
```

等待 `New API vX.X.X started`。

- [ ] **Step 2: 前端**

Run:
```bash
cd D:/top/keyapi/web
npm run dev
```

访问 **http://localhost:5173**，登录（root / 123456 或 wsg666）。

- [ ] **Step 3: 进入 /console/tenant-payment**

点击侧边栏"支付配置"，看到 WeChat 配置表单。

- [ ] **Step 4: 填入真实测试商户号**

使用一个**真实的微信商户号**（不能用假数据，否则测试连接会失败）。填入 AppID / Mchid / Serial / Apiv3Key / Private Key PEM。勾选"启用"，点"保存"。

Expected: 页面 Toast "保存成功"；后端日志 200。

- [ ] **Step 5: 点"测试连接"**

Expected:
- 若凭据正确：Toast "连接成功"，Banner 消失，`last_test_ok=true`
- 若凭据错误：Toast 显示具体错误（如"parse private key PEM: ..."）；Banner 出现

- [ ] **Step 6: 再次刷新页面**

Expected: 表单字段（除 3 个敏感字段）都正确回填；敏感字段 placeholder 显示"已设置（留空表示不修改）"。

- [ ] **Step 7: 跨租户防护抽查（可选）**

用 postgres 客户端直连 RDS，执行：

```sql
-- 手动造一条 tenant_id=2 的 config（假设 tenant 2 不存在你当前登录的租户里）
INSERT INTO tenant_payment_configs (tenant_id, provider, enabled, app_id, mchid, serial_no, app_secret_enc, apiv3_key_enc, private_key_enc, created_at, updated_at)
VALUES (2, 'wechat', false, 'test', 'test', 'test', '', '', '', EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint);
```

在前端用租户 1 登录态去 GET `/api/tenant/payment/configs`，**不应该**看到 tenant 2 的这条。确认 guardrail 生效。

然后清理：

```sql
DELETE FROM tenant_payment_configs WHERE tenant_id = 2 AND app_id = 'test';
```

- [ ] **Step 8: Commit 测试产物（如截图）**（可选）

如果 Step 4-6 有截图，放到 `docs/superpowers/artifacts/s1-verification/` 并 commit。没有也行。

---

## Task 15：S1 收尾 — 总 commit + 更新完成状态文档

**Files:**
- Modify: `docs/superpowers/plans/2026-04-16-completion-status.md`（在 Phase 5 章节补一条 S1 交付记录）

- [ ] **Step 1: 更新完成状态**

Edit `docs/superpowers/plans/2026-04-16-completion-status.md`：在 Phase 5 章节"已完成（续）"段落追加：

```markdown
### 已完成（续 — commit `<S1 最后一个 commit sha>`）
- 微信支付 v3 S1 Slice：
  - `common/crypto.go` 新增 HKDF / AES-256-GCM 工具
  - `tenant_payment_configs` 表（含 AES-GCM 加密敏感字段）+ guardrail 注册
  - `service/payment/` 抽象层 + `wechat.providerImpl.TestCredentials` 实现
  - `/api/tenant/payment/configs` CRUD + test 端点
  - `/console/tenant-payment` 前端 Tab 1（配置 + 测试连接 + 清除）
  - 单元测试：crypto / encrypt-decrypt roundtrip / clientCache invalidate
```

- [ ] **Step 2: 最终 Commit**

```bash
git add docs/superpowers/plans/2026-04-16-completion-status.md
git commit -m "docs: mark WeChat Pay S1 (credentials foundation) complete"
```

---

## S1 完成后的下一步

S1 完成后，基于实施反馈出 **S2 plan**（payment_orders / 下单 / 回调 / topup+sub 业务联动 / 续期定价配置 UI）。请告知时再写。
