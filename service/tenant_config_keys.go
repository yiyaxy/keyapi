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
	"PasswordLoginEnabled":            true,
	"PasswordRegisterEnabled":         true,
	"RegisterEnabled":                 true,
	"EmailVerificationEnabled":        true,
	"EmailDomainRestrictionEnabled":   true,
	"EmailDomainWhitelist":            true,

	// Quota & pricing
	"QuotaPerUnit": true,
	"TopUpLink":    true,
}

// IsTenantOverridableKey returns whether a given key can be overridden per-tenant.
func IsTenantOverridableKey(key string) bool {
	return TenantOverridableKeys[key]
}
