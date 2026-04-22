package service

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
)

func setOptionMapValueForTest(t *testing.T, key, value string) {
	t.Helper()
	common.OptionMapRWMutex.Lock()
	if common.OptionMap == nil {
		common.OptionMap = make(map[string]string)
	}
	prev, hadPrev := common.OptionMap[key]
	common.OptionMap[key] = value
	common.OptionMapRWMutex.Unlock()

	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		if hadPrev {
			common.OptionMap[key] = prev
		} else {
			delete(common.OptionMap, key)
		}
		common.OptionMapRWMutex.Unlock()
	})
}

func TestGetInvoiceConfig_FallsBackToPlatformDefaults(t *testing.T) {
	prevProvider := common.InvoiceProvider
	prevAuto := common.InvoiceAutoIssueEnabled
	common.InvoiceProvider = common.InvoiceProviderPiaoTong
	common.InvoiceAutoIssueEnabled = true
	t.Cleanup(func() {
		common.InvoiceProvider = prevProvider
		common.InvoiceAutoIssueEnabled = prevAuto
	})

	setOptionMapValueForTest(t, "MinInvoiceAmount", "100")
	setOptionMapValueForTest(t, "InvoiceDefaultPaymentCode", "PAY-PLATFORM")
	setOptionMapValueForTest(t, "InvoiceDefaultSubMchid", "MCH-PLATFORM")
	setOptionMapValueForTest(t, "InvoiceProvider", common.InvoiceProviderPiaoTong)

	cfg := GetInvoiceConfig(0)
	if cfg.Provider != common.InvoiceProviderPiaoTong {
		t.Fatalf("Provider = %q, want %q", cfg.Provider, common.InvoiceProviderPiaoTong)
	}
	if !cfg.AutoIssueEnabled {
		t.Fatalf("AutoIssueEnabled = false, want true")
	}
	if cfg.MinAmount != 100 {
		t.Fatalf("MinAmount = %d, want 100", cfg.MinAmount)
	}
	if cfg.DefaultPaymentCode != "PAY-PLATFORM" {
		t.Fatalf("DefaultPaymentCode = %q, want PAY-PLATFORM", cfg.DefaultPaymentCode)
	}
	if cfg.DefaultSubMchid != "MCH-PLATFORM" {
		t.Fatalf("DefaultSubMchid = %q, want MCH-PLATFORM", cfg.DefaultSubMchid)
	}
}

func TestGetInvoiceConfig_ProviderUnknownValueFallsBackToManual(t *testing.T) {
	setOptionMapValueForTest(t, "InvoiceProvider", "garbage-value-from-tenant")

	cfg := GetInvoiceConfig(0)
	if cfg.Provider != common.InvoiceProviderManual {
		t.Fatalf("Provider = %q, want %q", cfg.Provider, common.InvoiceProviderManual)
	}
}

func TestGetInvoiceConfig_IncludesPiaoTongTransportSecrets(t *testing.T) {
	setOptionMapValueForTest(t, "InvoicePiaoTongBaseURL", "https://platform.piaotong.example/")
	setOptionMapValueForTest(t, "InvoicePiaoTongPlatformAlias", "PLT")
	setOptionMapValueForTest(t, "InvoicePiaoTongPlatformCode", "PLT-001")
	setOptionMapValueForTest(t, "InvoicePiaoTong3DESKey", "DES-PLATFORM")
	setOptionMapValueForTest(t, "InvoicePiaoTongPrivateKey", "PRIV-PLATFORM")
	setOptionMapValueForTest(t, "InvoicePiaoTongPublicKey", "PUB-PLATFORM")

	cfg := GetInvoiceConfig(0)
	if cfg.PiaoTongBaseURL != "https://platform.piaotong.example/" {
		t.Fatalf("PiaoTongBaseURL = %q", cfg.PiaoTongBaseURL)
	}
	if cfg.PiaoTongPlatformAlias != "PLT" {
		t.Fatalf("PiaoTongPlatformAlias = %q", cfg.PiaoTongPlatformAlias)
	}
	if cfg.PiaoTongPlatformCode != "PLT-001" {
		t.Fatalf("PiaoTongPlatformCode = %q", cfg.PiaoTongPlatformCode)
	}
	if cfg.PiaoTong3DESKey != "DES-PLATFORM" {
		t.Fatalf("PiaoTong3DESKey = %q", cfg.PiaoTong3DESKey)
	}
	if cfg.PiaoTongPrivateKey != "PRIV-PLATFORM" {
		t.Fatalf("PiaoTongPrivateKey = %q", cfg.PiaoTongPrivateKey)
	}
	if cfg.PiaoTongPublicKey != "PUB-PLATFORM" {
		t.Fatalf("PiaoTongPublicKey = %q", cfg.PiaoTongPublicKey)
	}
}

func TestInvoiceConfig_ToPiaoTongClientConfig_Projection(t *testing.T) {
	cfg := InvoiceConfig{
		PiaoTongBaseURL:              "https://x.example/",
		PiaoTongPlatformCode:         "P-CODE",
		PiaoTongPlatformAlias:        "P-ALIAS",
		PiaoTong3DESKey:              "DES-K",
		PiaoTongPrivateKey:           "PRIV",
		PiaoTongPublicKey:            "PUB",
		SellerTaxpayerNum:            "TAX-001",
		SellerEnterpriseName:         "Acme Co",
		DefaultIssueKindCode:         "82",
		DefaultTaxClassificationCode: "TC",
		DefaultGoodsName:             "技术服务费",
		DefaultTaxRateValue:          "0.01",
	}

	projected := cfg.ToPiaoTongClientConfig()
	if projected.BaseURL != "https://x.example/" {
		t.Fatalf("BaseURL = %q", projected.BaseURL)
	}
	if projected.TripleDESKey != "DES-K" {
		t.Fatalf("TripleDESKey = %q", projected.TripleDESKey)
	}
	if projected.SellerTaxpayerNum != "TAX-001" {
		t.Fatalf("SellerTaxpayerNum = %q", projected.SellerTaxpayerNum)
	}
	if projected.DefaultGoodsName != "技术服务费" {
		t.Fatalf("DefaultGoodsName = %q", projected.DefaultGoodsName)
	}
}
