package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
)

// createPlatformChannelForTest inserts a channel with tenant_id=0 (platform scope).
// GORM's default:1 tag on TenantId causes zero-values to be silently replaced,
// so we use raw SQL for the insert then reload the struct.
func createPlatformChannelForTest(t *testing.T, ch *Channel) {
	t.Helper()
	err := DB.Exec(
		"INSERT INTO channels (type, key, status, name, created_time, models, `group`, scope, tenant_id, weight, auto_ban, max_retry, priority, base_url, status_code_mapping) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 1, 0, 0, '', '')",
		ch.Type, ch.Key, ch.Status, ch.Name, ch.CreatedTime, ch.Models, ch.Group, ch.Scope,
	).Error
	if err != nil {
		t.Fatal(err)
	}
	if err := DB.Where("name = ? AND scope = ?", ch.Name, ChannelScopePlatform).First(ch).Error; err != nil {
		t.Fatal(err)
	}
}

// Lightweight shape test — real routing tested in integration (Task 40).
func TestGetRandomSatisfiedChannel_IncludesPlatformBucket(t *testing.T) {
	if DB == nil {
		t.Skip("no DB")
	}
	if !common.MemoryCacheEnabled {
		// Without memory cache, GetRandomSatisfiedChannel goes straight to DB.
		// The DB path is tested via integration; here we require cache enabled.
		common.MemoryCacheEnabled = true
		defer func() { common.MemoryCacheEnabled = false }()
	}

	// Arrange a platform channel + its ability — goes into bucket "0:default".
	ch := Channel{
		Name: "plat-gpt-4o-merge-test", Type: 1,
		Scope: ChannelScopePlatform, TenantId: 0,
		Key: "k", Status: 1, Models: "gpt-4o-merge-test",
		Group: "default", CreatedTime: 1,
	}
	createPlatformChannelForTest(t, &ch)
	defer WithTenantBypass(DB).Delete(&Channel{}, ch.Id)
	if err := ch.AddAbilities(nil); err != nil {
		t.Fatal(err)
	}
	defer ch.DeleteAbilities()

	InitChannelCache()
	// Tenant 77 has no own routing config; the default mode (private_priority)
	// falls back to platform when there are no tenant-owned channels.
	ReloadTenantRoutingCache(77)

	// Tenant 77 has no own channels but should see the platform channel.
	got, err := GetRandomSatisfiedChannel(77, "default", "gpt-4o-merge-test", 0)
	if err != nil {
		t.Fatal(err)
	}
	if got == nil || got.Id != ch.Id {
		t.Fatalf("expected platform channel %d, got %v", ch.Id, got)
	}
}

// When a tenant disables the platform channel, the merged lookup must skip it.
func TestGetRandomSatisfiedChannel_RespectsTenantDisable(t *testing.T) {
	if DB == nil {
		t.Skip("no DB")
	}
	if !common.MemoryCacheEnabled {
		common.MemoryCacheEnabled = true
		defer func() { common.MemoryCacheEnabled = false }()
	}

	ch := Channel{
		Name: "plat-disabled-merge-test", Type: 1,
		Scope: ChannelScopePlatform, TenantId: 0,
		Key: "k", Status: 1, Models: "disabled-merge-test",
		Group: "default", CreatedTime: 1,
	}
	createPlatformChannelForTest(t, &ch)
	defer WithTenantBypass(DB).Delete(&Channel{}, ch.Id)
	if err := ch.AddAbilities(nil); err != nil {
		t.Fatal(err)
	}
	defer ch.DeleteAbilities()

	tid := 78
	if err := SetTenantChannelDisabled(tid, ch.Id, true); err != nil {
		t.Fatal(err)
	}
	defer SetTenantChannelDisabled(tid, ch.Id, false)

	InitChannelCache() // warms the channel+ability cache
	ReloadTenantRoutingCache(tid) // warms the per-tenant routing index

	got, err := GetRandomSatisfiedChannel(tid, "default", "disabled-merge-test", 0)
	if err != nil {
		t.Fatal(err)
	}
	if got != nil {
		t.Fatalf("disabled platform channel should not be returned, got %v", got)
	}
}

// only_private mode hides all platform channels.
func TestGetRandomSatisfiedChannel_OnlyPrivateMode(t *testing.T) {
	if DB == nil {
		t.Skip("no DB")
	}
	if !common.MemoryCacheEnabled {
		common.MemoryCacheEnabled = true
		defer func() { common.MemoryCacheEnabled = false }()
	}

	ch := Channel{
		Name: "plat-only-private-test", Type: 1,
		Scope: ChannelScopePlatform, TenantId: 0,
		Key: "k", Status: 1, Models: "only-private-model",
		Group: "default", CreatedTime: 1,
	}
	createPlatformChannelForTest(t, &ch)
	defer WithTenantBypass(DB).Delete(&Channel{}, ch.Id)
	if err := ch.AddAbilities(nil); err != nil {
		t.Fatal(err)
	}
	defer ch.DeleteAbilities()

	tid := 79
	if err := SetTenantPlatformChannelMode(tid, PlatformChannelModeOnlyPrivate); err != nil {
		t.Fatal(err)
	}
	defer SetTenantPlatformChannelMode(tid, PlatformChannelModePrivatePriority)

	InitChannelCache()
	ReloadTenantRoutingCache(tid) // warms the per-tenant routing index

	got, _ := GetRandomSatisfiedChannel(tid, "default", "only-private-model", 0)
	if got != nil {
		t.Fatalf("only_private mode should exclude platform channels, got %v", got)
	}
}
