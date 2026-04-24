package service

// TenantOverridableKeys lists config keys that tenants can customize.
// Anything NOT in this map is platform-only.
//
// Design notes:
//   - This whitelist only means "tenant can edit + backend can store".
//     A tenant override becomes effective only after the business-side read
//     path switches to GetConfig/GetConfigBool/GetConfigInt with tenantId.
//   - WeChat payment credentials live in TenantPaymentConfig and do not belong
//     in this option-based whitelist.
//   - Model ratio / pricing maps are intentionally kept out for now; they are a
//     better fit for channel-level override rather than tenant-wide override.
//   - Clamp/union sensitive fields need dedicated guardrails before exposure.
var TenantOverridableKeys = map[string]bool{
	// general - branding / content / entry links
	"SystemName":      true,
	"Logo":            true,
	"Footer":          true,
	"Notice":          true,
	"About":           true,
	"HomePageContent": true,
	"TopUpLink":       true,
	"ChatLink":        true,
	"Chats":           true,

	// login - registration & auth
	"PasswordLoginEnabled":          true,
	"PasswordRegisterEnabled":       true,
	"RegisterEnabled":               true,
	"EmailVerificationEnabled":      true,
	"EmailDomainRestrictionEnabled": true,
	"EmailDomainWhitelist":          true,
	"EmailAliasRestrictionEnabled":  true,
	"TurnstileCheckEnabled":         true,
	"TurnstileSiteKey":              true,
	"TurnstileSecretKey":            true,

	// oauth - tenant-managed OAuth apps / bots
	"GitHubOAuthEnabled":          true,
	"GitHubClientId":              true,
	"GitHubClientSecret":          true,
	"WeChatAuthEnabled":           true,
	"WeChatServerAddress":         true,
	"WeChatServerToken":           true,
	"WeChatAccountQRCodeImageURL": true,
	"WxMiniEnvVersion":            true,
	"LinuxDOOAuthEnabled":         true,
	"LinuxDOClientId":             true,
	"LinuxDOClientSecret":         true,
	"LinuxDOMinimumTrustLevel":    true,
	"TelegramOAuthEnabled":        true,
	"TelegramBotName":             true,
	"TelegramBotToken":            true,

	// smtp - tenant-managed outbound email
	"SMTPServer":     true,
	"SMTPPort":       true,
	"SMTPAccount":    true,
	"SMTPFrom":       true,
	"SMTPSSLEnabled": true,
	"SMTPToken":      true,

	// quota - currency / marketing
	"general_setting.quota_display_type":            true,
	"general_setting.custom_currency_symbol":        true,
	"general_setting.custom_currency_exchange_rate": true,
	"USDExchangeRate":                               true,
	"Price":                                         true,
	"QuotaForNewUser":                               true,
	"QuotaForInviter":                               true,
	"QuotaForInvitee":                               true,
	"TopUpRebateCount":                              true,
	"TopUpRebatePercent":                            true,
	"SubscriptionRebateCount":                       true,
	"MinTopUp":                                      true,
	// QuotaPerUnit is intentionally platform-only. Changing it per tenant would
	// break platform-wide accounting and quota math.

	// ratios - group / marketing
	"GroupRatio":          true,
	"UserUsableGroups":    true,
	"TopupGroupRatio":     true,
	"AutoGroups":          true,
	"DefaultUseAutoGroup": true,
	"GroupGroupRatio":     true,

	// monitor - without clamp-dependent fields
	"RetryTimes":                                 true,
	"AutomaticDisableChannelEnabled":             true,
	"AutomaticEnableChannelEnabled":              true,
	"AutomaticDisableKeywords":                   true,
	"AutomaticDisableStatusCodes":                true,
	"AutomaticRetryStatusCodes":                  true,
	"ChannelDisableThreshold":                    true,
	"ChannelStabilityStreamBoundaryEnabled":      true,
	"ChannelStabilityErrorClassificationEnabled": true,
	"ChannelStabilityCooldownEnabled":            true,
	"ChannelStabilityHealthScoreEnabled":         true,
	"ChannelStabilityAffinityGovernanceEnabled":  true,

	// permissions
	"ExposeRatioEnabled":     true,
	"DefaultCollapseSidebar": true,

	// log
	"DataExportDefaultTime": true,
	"DataExportEnabled":     true,

	// sensitive switches
	"CheckSensitiveEnabled":         true,
	"CheckSensitiveOnPromptEnabled": true,
	"StopOnSensitiveEnabled":        true,
	"SensitiveWords":                true,

	// ratelimit
	"ModelRequestRateLimitEnabled":         true,
	"ModelRequestRateLimitCount":           true,
	"ModelRequestRateLimitSuccessCount":    true,
	"ModelRequestRateLimitDurationMinutes": true,
	"ModelRequestRateLimitGroup":           true,

	// integrations
	"TranslationChannelId":    true,
	"TranslationModel":        true,
	"DrawingEnabled":          true,
	"TaskEnabled":             true,
	"DisplayTokenStatEnabled": true,

	// invoice
	"InvoiceProvider":                     true,
	"InvoiceAutoIssueEnabled":             true,
	"MinInvoiceAmount":                    true,
	"InvoiceSellerEnterpriseName":         true,
	"InvoiceSellerTaxpayerNum":            true,
	"InvoiceDefaultAccount":               true,
	"InvoiceDefaultGoodsName":             true,
	"InvoiceDefaultTaxRateValue":          true,
	"InvoiceDefaultIssueKindCode":         true,
	"InvoiceDefaultPaymentCode":           true,
	"InvoiceDefaultSubMchid":              true,
	"InvoiceDefaultTaxClassificationCode": true,
	"InvoicePiaoTongBaseURL":              true,
	"InvoicePiaoTongPlatformAlias":        true,
	"InvoicePiaoTongPlatformCode":         true,
	"InvoicePiaoTong3DESKey":              true,
	"InvoicePiaoTongPrivateKey":           true,
	"InvoicePiaoTongPublicKey":            true,
	"InvoiceQueryMaxAttempts":             true,
	"InvoiceQueryRetryIntervalSeconds":    true,

	// tenant-only notification hooks (rendered via tenant extra group)
	"WebhookURL":    true,
	"WebhookSecret": true,
}

// IsTenantOverridableKey returns whether a given key can be overridden per-tenant.
func IsTenantOverridableKey(key string) bool {
	return TenantOverridableKeys[key]
}
