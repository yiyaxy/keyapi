package model

import (
	"errors"
	"sync/atomic"
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

	Enabled        bool `json:"enabled" gorm:"default:false"`
	PlatformLocked bool `json:"platform_locked" gorm:"default:false"`

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

	CreatedAt int64 `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt int64 `json:"updated_at" gorm:"autoUpdateTime"`
	// Note: no DeletedAt. Credentials are hard-deleted by
	// DeleteTenantPaymentConfig to avoid lingering ciphertext on disk.
}

// TenantPaymentPlaintext holds the plaintext form of sensitive fields.
// Callers should never log or persist this struct.
type TenantPaymentPlaintext struct {
	AppSecret  string
	Apiv3Key   string
	PrivateKey string
}

// paymentKeyResolver is swapped in at startup by service/payment via
// InitPaymentCrypto. Stored in an atomic.Value to avoid data races between
// the (startup-time) install and the (request-time) reads in encField/decField.
//
// Default path: HKDF(CryptoSecret, "wechat-pay-keys-v1"), mirroring
// service/payment.paymentMasterKey. The env override (PAYMENT_MASTER_KEY)
// lives in the service layer to avoid a model→service import cycle.
var paymentKeyResolver atomic.Value // holds func() []byte

func init() {
	paymentKeyResolver.Store(func() []byte {
		return common.DeriveKey([]byte(common.CryptoSecret), "wechat-pay-keys-v1")
	})
}

// InitPaymentCrypto lets service/payment install its master-key resolver at
// startup. Invokes the resolver once for eager validation — if the resolver
// fatals (e.g. PAYMENT_MASTER_KEY is set but not valid base64/not 32 bytes),
// the crash happens at startup rather than on the first encrypt/decrypt
// call mid-request.
//
// Safe to call once during init; later writes are permitted but must be
// ordered by the caller (the controller layer does not expect the resolver
// to change after service start).
func InitPaymentCrypto(resolver func() []byte) {
	if resolver == nil {
		return
	}
	// Eager validation — fatal now, not later.
	_ = resolver()
	paymentKeyResolver.Store(resolver)
}

// derivePaymentKey reads the current resolver and invokes it.
func derivePaymentKey() []byte {
	fn := paymentKeyResolver.Load().(func() []byte)
	return fn()
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

// EncryptAndSetSensitive encrypts all three sensitive fields and writes
// their ciphertext onto the config.
//
// CRITICAL — this overwrites AppSecretEnc / Apiv3KeyEnc / PrivateKeyEnc
// UNCONDITIONALLY. An empty plaintext field yields empty ciphertext,
// i.e. passing TenantPaymentPlaintext{AppSecret: "new"} will ERASE the
// existing Apiv3KeyEnc and PrivateKeyEnc columns.
//
// The controller layer MUST call DecryptSensitive first, merge the
// caller-supplied non-empty fields over the existing plaintext, and
// only then pass the merged struct here. See controller/tenant_payment.go
// UpdateTenantWechatConfig for the canonical pattern:
//
//	existing, _ := cfg.DecryptSensitive()
//	plain := TenantPaymentPlaintext{
//	    AppSecret:  ifNonEmpty(req.AppSecret, existing.AppSecret),
//	    Apiv3Key:   ifNonEmpty(req.Apiv3Key, existing.Apiv3Key),
//	    PrivateKey: ifNonEmpty(req.PrivateKey, existing.PrivateKey),
//	}
//	cfg.EncryptAndSetSensitive(plain)
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
	if errors.Is(err, gorm.ErrRecordNotFound) {
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

// DeleteTenantPaymentConfig permanently removes the row. Uses Unscoped()
// for HARD delete so encrypted credential material does not linger on
// disk after a tenant disables the provider. The row has an audit trail
// via tenant_audit_logs written by the controller layer.
func DeleteTenantPaymentConfig(tenantId int, provider string) error {
	if tenantId <= 0 || provider == "" {
		return errors.New("invalid tenantId or provider")
	}
	return WithTenantBypass(DB).
		Unscoped().
		Where("tenant_id = ? AND provider = ?", tenantId, provider).
		Delete(&TenantPaymentConfig{}).Error
}
