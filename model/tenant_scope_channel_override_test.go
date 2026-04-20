package model

import "testing"

func TestTenantChannelOverrideIsTenantScoped(t *testing.T) {
	// RegisterTenantCallbacks populates the tenantScopedTables map.
	// DB is set up by TestMain in task_cas_test.go.
	RegisterTenantCallbacks(DB)
	if !IsTenantScoped("tenant_channel_overrides") {
		t.Fatal("tenant_channel_overrides must be registered as tenant-scoped")
	}
}
