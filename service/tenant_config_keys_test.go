package service

import "testing"

func TestTenantOverridableKeys_DoesNotIncludeLegacyDeadSettings(t *testing.T) {
	if IsTenantOverridableKey("DisplayInCurrencyEnabled") {
		t.Fatalf("DisplayInCurrencyEnabled is a dead setting and must stay out of tenant overridable keys")
	}
}

func TestTenantOverridableKeys_CoverageNonSecret(t *testing.T) {
	expected := []string{
		// general
		"SystemName", "Logo", "Footer", "Notice", "About", "HomePageContent",
		"TopUpLink", "ChatLink", "Chats",
		// login
		"PasswordLoginEnabled", "PasswordRegisterEnabled", "RegisterEnabled",
		"EmailVerificationEnabled", "EmailDomainRestrictionEnabled", "EmailDomainWhitelist",
		"EmailAliasRestrictionEnabled", "TurnstileCheckEnabled", "TurnstileSiteKey",
		// oauth
		"GitHubOAuthEnabled", "GitHubClientId",
		"WeChatAuthEnabled", "WeChatServerAddress", "WeChatAccountQRCodeImageURL", "WxMiniEnvVersion",
		"LinuxDOOAuthEnabled", "LinuxDOClientId", "LinuxDOMinimumTrustLevel",
		"TelegramOAuthEnabled", "TelegramBotName",
		// smtp
		"SMTPServer", "SMTPPort", "SMTPAccount", "SMTPFrom", "SMTPSSLEnabled",
		// quota
		"general_setting.quota_display_type",
		"general_setting.custom_currency_symbol",
		"general_setting.custom_currency_exchange_rate",
		"USDExchangeRate", "Price",
		"QuotaForNewUser", "QuotaForInviter", "QuotaForInvitee",
		"TopUpRebateCount", "TopUpRebatePercent", "SubscriptionRebateCount",
		"MinTopUp",
		// ratios
		"GroupRatio", "UserUsableGroups", "TopupGroupRatio",
		"AutoGroups", "DefaultUseAutoGroup", "GroupGroupRatio",
		// monitor
		"AutomaticDisableChannelEnabled", "AutomaticEnableChannelEnabled",
		"AutomaticDisableKeywords", "AutomaticDisableStatusCodes",
		"ChannelDisableThreshold",
		// permissions
		"ExposeRatioEnabled", "DefaultCollapseSidebar",
		// log
		"DataExportDefaultTime", "DataExportEnabled",
		// sensitive switches
		"CheckSensitiveEnabled", "CheckSensitiveOnPromptEnabled", "StopOnSensitiveEnabled",
		// integrations
		"TranslationChannelId", "TranslationModel",
		"DrawingEnabled", "TaskEnabled", "DisplayTokenStatEnabled",
		// tenant extra group
		"WebhookURL", "WebhookSecret",
		// invoice
		"InvoiceProvider", "InvoiceAutoIssueEnabled", "MinInvoiceAmount",
		"InvoiceSellerEnterpriseName", "InvoiceSellerTaxpayerNum",
		"InvoiceDefaultAccount", "InvoiceDefaultGoodsName", "InvoiceDefaultTaxRateValue",
		"InvoiceDefaultIssueKindCode", "InvoiceDefaultPaymentCode",
		"InvoiceDefaultSubMchid", "InvoiceDefaultTaxClassificationCode",
		"InvoicePiaoTongBaseURL", "InvoicePiaoTongPlatformAlias", "InvoicePiaoTongPlatformCode",
		"InvoiceQueryMaxAttempts", "InvoiceQueryRetryIntervalSeconds",
	}
	for _, key := range expected {
		if !IsTenantOverridableKey(key) {
			t.Errorf("expected %q to be a tenant overridable key", key)
		}
	}
}

func TestTenantOverridableKeys_CoverageSecret(t *testing.T) {
	expected := []string{
		"SMTPToken",
		"GitHubClientSecret",
		"WeChatServerToken",
		"TelegramBotToken",
		"TurnstileSecretKey",
		"LinuxDOClientSecret",
		"InvoicePiaoTong3DESKey",
		"InvoicePiaoTongPrivateKey",
		"InvoicePiaoTongPublicKey",
	}
	for _, key := range expected {
		if !IsTenantOverridableKey(key) {
			t.Errorf("expected secret %q to be a tenant overridable key", key)
		}
		if !IsSensitiveConfigKey(key) {
			t.Errorf("expected secret %q to match IsSensitiveConfigKey", key)
		}
	}
}
