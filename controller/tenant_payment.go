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

	// Only (re-)encrypt the fields actually provided. Empty => keep existing.
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
