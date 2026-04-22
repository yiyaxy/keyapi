package service

import (
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/service/invoice_provider"
)

// InvoiceConfig is the tenant-aware view of invoice settings used by the
// business layer. Callers should prefer GetInvoiceConfig(tenantId) over
// scattered GetConfig/GetConfigBool/GetConfigInt calls for invoice settings.
type InvoiceConfig struct {
	Provider                     string
	AutoIssueEnabled             bool
	MinAmount                    int
	SellerEnterpriseName         string
	SellerTaxpayerNum            string
	DefaultAccount               string
	DefaultGoodsName             string
	DefaultTaxRateValue          string
	DefaultIssueKindCode         string
	DefaultPaymentCode           string
	DefaultSubMchid              string
	DefaultTaxClassificationCode string
	PiaoTongBaseURL              string
	PiaoTongPlatformAlias        string
	PiaoTongPlatformCode         string
	PiaoTong3DESKey              string
	PiaoTongPrivateKey           string
	PiaoTongPublicKey            string
	QueryMaxAttempts             int
	QueryRetryIntervalSeconds    int
}

func GetInvoiceConfig(tenantId int) InvoiceConfig {
	cfg := InvoiceConfig{
		Provider:                     strings.TrimSpace(GetConfig(tenantId, "InvoiceProvider", common.InvoiceProvider)),
		AutoIssueEnabled:             GetConfigBool(tenantId, "InvoiceAutoIssueEnabled", common.InvoiceAutoIssueEnabled),
		MinAmount:                    GetConfigInt(tenantId, "MinInvoiceAmount", 200),
		SellerEnterpriseName:         strings.TrimSpace(GetConfig(tenantId, "InvoiceSellerEnterpriseName", "")),
		SellerTaxpayerNum:            strings.TrimSpace(GetConfig(tenantId, "InvoiceSellerTaxpayerNum", "")),
		DefaultAccount:               strings.TrimSpace(GetConfig(tenantId, "InvoiceDefaultAccount", "")),
		DefaultGoodsName:             strings.TrimSpace(GetConfig(tenantId, "InvoiceDefaultGoodsName", "")),
		DefaultTaxRateValue:          strings.TrimSpace(GetConfig(tenantId, "InvoiceDefaultTaxRateValue", "")),
		DefaultIssueKindCode:         strings.TrimSpace(GetConfig(tenantId, "InvoiceDefaultIssueKindCode", "82")),
		DefaultPaymentCode:           strings.TrimSpace(GetConfig(tenantId, "InvoiceDefaultPaymentCode", "")),
		DefaultSubMchid:              strings.TrimSpace(GetConfig(tenantId, "InvoiceDefaultSubMchid", "")),
		DefaultTaxClassificationCode: strings.TrimSpace(GetConfig(tenantId, "InvoiceDefaultTaxClassificationCode", "")),
		PiaoTongBaseURL:              strings.TrimSpace(GetConfig(tenantId, "InvoicePiaoTongBaseURL", "")),
		PiaoTongPlatformAlias:        strings.TrimSpace(GetConfig(tenantId, "InvoicePiaoTongPlatformAlias", "")),
		PiaoTongPlatformCode:         strings.TrimSpace(GetConfig(tenantId, "InvoicePiaoTongPlatformCode", "")),
		PiaoTong3DESKey:              strings.TrimSpace(GetConfig(tenantId, "InvoicePiaoTong3DESKey", "")),
		PiaoTongPrivateKey:           strings.TrimSpace(GetConfig(tenantId, "InvoicePiaoTongPrivateKey", "")),
		PiaoTongPublicKey:            strings.TrimSpace(GetConfig(tenantId, "InvoicePiaoTongPublicKey", "")),
		QueryMaxAttempts:             GetConfigInt(tenantId, "InvoiceQueryMaxAttempts", 60),
		QueryRetryIntervalSeconds:    GetConfigInt(tenantId, "InvoiceQueryRetryIntervalSeconds", 60),
	}

	switch cfg.Provider {
	case common.InvoiceProviderPiaoTong, common.InvoiceProviderManual:
	default:
		cfg.Provider = common.InvoiceProviderManual
	}
	if cfg.MinAmount <= 0 {
		cfg.MinAmount = 200
	}
	if cfg.DefaultIssueKindCode == "" {
		cfg.DefaultIssueKindCode = "82"
	}
	if cfg.QueryMaxAttempts <= 0 {
		cfg.QueryMaxAttempts = 60
	}
	if cfg.QueryRetryIntervalSeconds <= 0 {
		cfg.QueryRetryIntervalSeconds = 60
	}

	return cfg
}

func (c InvoiceConfig) ToPiaoTongClientConfig() invoice_provider.PiaoTongClientConfig {
	return invoice_provider.PiaoTongClientConfig{
		BaseURL:                      c.PiaoTongBaseURL,
		PlatformCode:                 c.PiaoTongPlatformCode,
		PlatformAlias:                c.PiaoTongPlatformAlias,
		TripleDESKey:                 c.PiaoTong3DESKey,
		PrivateKey:                   c.PiaoTongPrivateKey,
		PublicKey:                    c.PiaoTongPublicKey,
		SellerTaxpayerNum:            c.SellerTaxpayerNum,
		SellerEnterpriseName:         c.SellerEnterpriseName,
		DefaultIssueKindCode:         c.DefaultIssueKindCode,
		DefaultTaxClassificationCode: c.DefaultTaxClassificationCode,
		DefaultGoodsName:             c.DefaultGoodsName,
		DefaultTaxRateValue:          c.DefaultTaxRateValue,
	}
}
