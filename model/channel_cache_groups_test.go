package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
)

// TestGetChannelGroupsCopy_IncludesPlatformGroup verifies that platform groups
// (tenant_id=0 / scope=platform) appear in GetChannelGroupsCopy results for any tenant.
func TestGetChannelGroupsCopy_IncludesPlatformGroup(t *testing.T) {
	if DB == nil {
		t.Skip("no DB")
	}
	if !common.MemoryCacheEnabled {
		common.MemoryCacheEnabled = true
		defer func() { common.MemoryCacheEnabled = false }()
	}

	// Insert a platform channel via raw SQL (GORM default:1 on tenant_id would
	// silently replace zero-value, so we use raw SQL as in other merge tests).
	ch1 := Channel{
		Name: "grp-plat-alpha", Type: 1,
		Scope: ChannelScopePlatform, TenantId: 0,
		Key: "k1", Status: 1, Models: "m-alpha",
		Group: "platform-only-group-alpha", CreatedTime: 1,
	}
	createPlatformChannelForTest(t, &ch1)
	defer WithTenantBypass(DB).Delete(&Channel{}, ch1.Id)
	if err := ch1.AddAbilities(nil); err != nil {
		t.Fatal(err)
	}
	defer ch1.DeleteAbilities()

	ch2 := Channel{
		Name: "grp-plat-beta", Type: 1,
		Scope: ChannelScopePlatform, TenantId: 0,
		Key: "k2", Status: 1, Models: "m-beta",
		Group: "platform-only-group-beta", CreatedTime: 1,
	}
	createPlatformChannelForTest(t, &ch2)
	defer WithTenantBypass(DB).Delete(&Channel{}, ch2.Id)
	if err := ch2.AddAbilities(nil); err != nil {
		t.Fatal(err)
	}
	defer ch2.DeleteAbilities()

	InitChannelCache()

	// Tenant 77 has no own channels; it should still see both platform groups.
	groups := GetChannelGroupsCopy(77)

	if !groups["platform-only-group-alpha"] {
		t.Errorf("GetChannelGroupsCopy(77) missing platform group 'platform-only-group-alpha'; got: %v", groups)
	}
	if !groups["platform-only-group-beta"] {
		t.Errorf("GetChannelGroupsCopy(77) missing platform group 'platform-only-group-beta'; got: %v", groups)
	}
}

// TestGetChannelGroupsCopy_TenantGroupsStillPresent verifies that tenant-owned groups
// are not lost when the platform merge is applied.
func TestGetChannelGroupsCopy_TenantGroupsStillPresent(t *testing.T) {
	if DB == nil {
		t.Skip("no DB")
	}
	if !common.MemoryCacheEnabled {
		common.MemoryCacheEnabled = true
		defer func() { common.MemoryCacheEnabled = false }()
	}

	const testTenantId = 80

	// Insert a tenant-owned channel via raw SQL.
	if err := DB.Exec(
		"INSERT INTO channels (type, key, status, name, created_time, models, `group`, scope, tenant_id, weight, auto_ban, max_retry, priority, base_url, status_code_mapping) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, 0, 0, '', '')",
		1, "tk80", 1, "grp-tenant-80", 1, "m-t80", "tenant-80-only-group", ChannelScopeTenant, testTenantId,
	).Error; err != nil {
		t.Fatalf("insert tenant channel: %v", err)
	}
	var ch Channel
	if err := DB.Where("name = ? AND tenant_id = ?", "grp-tenant-80", testTenantId).First(&ch).Error; err != nil {
		t.Fatalf("reload tenant channel: %v", err)
	}
	defer WithTenantBypass(DB).Delete(&Channel{}, ch.Id)
	if err := DB.Exec(
		"INSERT INTO abilities (`group`, model, channel_id, tenant_id, scope, enabled) VALUES (?, ?, ?, ?, ?, ?)",
		"tenant-80-only-group", "m-t80", ch.Id, testTenantId, ChannelScopeTenant, true,
	).Error; err != nil {
		t.Fatalf("insert ability: %v", err)
	}
	defer DB.Exec("DELETE FROM abilities WHERE channel_id = ?", ch.Id)

	InitChannelCache()

	groups := GetChannelGroupsCopy(testTenantId)
	if !groups["tenant-80-only-group"] {
		t.Errorf("GetChannelGroupsCopy(%d) missing own tenant group 'tenant-80-only-group'; got: %v", testTenantId, groups)
	}
}

// TestGetChannelGroupsCopy_NoDuplicates verifies that a group present in both
// tenant and platform buckets appears exactly once (map key uniqueness).
func TestGetChannelGroupsCopy_NoDuplicates(t *testing.T) {
	if DB == nil {
		t.Skip("no DB")
	}
	if !common.MemoryCacheEnabled {
		common.MemoryCacheEnabled = true
		defer func() { common.MemoryCacheEnabled = false }()
	}

	const testTenantId = 81
	const sharedGroup = "shared-group-dedup-test"

	// Platform channel in the shared group.
	chPlat := Channel{
		Name: "grp-dedup-plat", Type: 1,
		Scope: ChannelScopePlatform, TenantId: 0,
		Key: "kp", Status: 1, Models: "m-dedup",
		Group: sharedGroup, CreatedTime: 1,
	}
	createPlatformChannelForTest(t, &chPlat)
	defer WithTenantBypass(DB).Delete(&Channel{}, chPlat.Id)
	if err := chPlat.AddAbilities(nil); err != nil {
		t.Fatal(err)
	}
	defer chPlat.DeleteAbilities()

	// Tenant-owned channel in the same group.
	if err := DB.Exec(
		"INSERT INTO channels (type, key, status, name, created_time, models, `group`, scope, tenant_id, weight, auto_ban, max_retry, priority, base_url, status_code_mapping) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, 0, 0, '', '')",
		1, "kt81", 1, "grp-dedup-tenant-81", 1, "m-dedup", sharedGroup, ChannelScopeTenant, testTenantId,
	).Error; err != nil {
		t.Fatalf("insert tenant channel: %v", err)
	}
	var chTenant Channel
	if err := DB.Where("name = ? AND tenant_id = ?", "grp-dedup-tenant-81", testTenantId).First(&chTenant).Error; err != nil {
		t.Fatalf("reload tenant channel: %v", err)
	}
	defer WithTenantBypass(DB).Delete(&Channel{}, chTenant.Id)
	if err := DB.Exec(
		"INSERT INTO abilities (`group`, model, channel_id, tenant_id, scope, enabled) VALUES (?, ?, ?, ?, ?, ?)",
		sharedGroup, "m-dedup", chTenant.Id, testTenantId, ChannelScopeTenant, true,
	).Error; err != nil {
		t.Fatalf("insert ability: %v", err)
	}
	defer DB.Exec("DELETE FROM abilities WHERE channel_id = ?", chTenant.Id)

	InitChannelCache()

	groups := GetChannelGroupsCopy(testTenantId)
	if !groups[sharedGroup] {
		t.Errorf("GetChannelGroupsCopy(%d) missing shared group %q; got: %v", testTenantId, sharedGroup, groups)
	}
	// The result is map[string]bool, so key uniqueness is guaranteed by Go maps —
	// just verify the value is true (not duplicate false entry).
	if !groups[sharedGroup] {
		t.Errorf("shared group value should be true, not false")
	}
}
