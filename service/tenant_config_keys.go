package service

// TenantOverridableKeys lists config keys that tenants can customize.
// Anything NOT in this map is platform-only (secrets, payment config, SMTP, etc.)
var TenantOverridableKeys = map[string]bool{
	// Display & branding
	"SystemName":      true,
	"Logo":            true,
	"Footer":          true,
	"Notice":          true,
	"About":           true,
	"HomePageContent": true,

	// Feature toggles
	"DrawingEnabled":           true,
	"TaskEnabled":              true,
	"DataExportEnabled":        true,
	"DisplayInCurrencyEnabled": true,
	"DisplayTokenStatEnabled":  true,

	// Registration & auth (tenant can restrict further)
	"PasswordLoginEnabled":          true,
	"PasswordRegisterEnabled":       true,
	"RegisterEnabled":               true,
	"EmailVerificationEnabled":      true,
	"EmailDomainRestrictionEnabled": true,
	"EmailDomainWhitelist":          true,

	// Quota & pricing
	// QuotaPerUnit 故意不开放：这是 1 USD = ?额度 的换算系数，所有计费数学的根基。
	// 租户改了会让平台维度的成本统计错位、审计/对账无法统一换算。
	"TopUpLink": true,

	// Notification
	"WebhookURL":    true, // tenant alert webhook endpoint
	"WebhookSecret": true, // HMAC signing secret
}

// IsTenantOverridableKey returns whether a given key can be overridden per-tenant.
func IsTenantOverridableKey(key string) bool {
	return TenantOverridableKeys[key]
}
