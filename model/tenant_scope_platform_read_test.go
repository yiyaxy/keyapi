package model

import "testing"

// Guardrail should allow a read whose WHERE clause constrains scope='platform'
// even when no tenant_id constraint is present.
func TestGuardrailAllowsPlatformScopeRead(t *testing.T) {
	if DB == nil {
		t.Skip("no DB")
	}
	// Activate guardrail callbacks so the tenant isolation checks run.
	RegisterTenantCallbacks(DB)
	var channels []Channel
	// Intentionally no WithTenantBypass and no tenant_id in WHERE.
	err := DB.Where("scope = ?", ChannelScopePlatform).Limit(1).Find(&channels).Error
	if err != nil {
		t.Fatalf("expected guardrail to allow platform read, got: %v", err)
	}
}

// Without scope='platform' in WHERE and without tenant_id and without bypass,
// the read must still be rejected.
func TestGuardrailStillBlocksUnscopedChannelRead(t *testing.T) {
	if DB == nil {
		t.Skip("no DB")
	}
	// Activate guardrail callbacks so the tenant isolation checks run.
	RegisterTenantCallbacks(DB)
	var channels []Channel
	err := DB.Limit(1).Find(&channels).Error
	if err == nil {
		t.Fatal("expected guardrail rejection for unscoped channel read")
	}
}

// TestGuardrailBlocksPlatformScopeUpdate asserts the whitelist is SELECT-only:
// an UPDATE with a scope='platform' WHERE clause must still be rejected by
// the guardrail (requires WithTenantBypass for platform writes).
func TestGuardrailBlocksPlatformScopeUpdate(t *testing.T) {
	if DB == nil {
		t.Skip("no DB")
	}
	RegisterTenantCallbacks(DB)
	err := DB.Model(&Channel{}).Where("scope = ?", ChannelScopePlatform).
		Updates(map[string]any{"name": "hacked"}).Error
	if err == nil {
		t.Fatal("guardrail must reject unscoped UPDATE even when WHERE contains scope='platform'")
	}
}

// TestGuardrailBlocksSplitInjection asserts attackers can't bypass the
// whitelist by scattering "scope" and "[platform]" across unrelated columns.
func TestGuardrailBlocksSplitInjection(t *testing.T) {
	if DB == nil {
		t.Skip("no DB")
	}
	RegisterTenantCallbacks(DB)
	var channels []Channel
	err := DB.Where("name = ? AND base_url = ?", "scope", "[platform]").Find(&channels).Error
	if err == nil {
		t.Fatal("guardrail must reject read where 'scope' and '[platform]' are scattered across non-scope columns")
	}
}
