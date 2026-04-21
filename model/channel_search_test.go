package model

import "testing"

func TestSearchChannelsForTenant_DoesNotLeakByKey(t *testing.T) {
	if DB == nil {
		t.Skip("no DB")
	}
	// Insert a platform channel with a unique key.
	plat := Channel{Type: 1, Name: "search-plat", Scope: ChannelScopePlatform, TenantId: 0, Key: "sk-ABC-unique-12345", Status: 1, CreatedTime: 1, Models: "gpt-4o"}
	if err := WithTenantBypass(DB).Create(&plat).Error; err != nil {
		t.Fatalf("insert: %v", err)
	}
	defer WithTenantBypass(DB).Delete(&Channel{}, plat.Id)

	// Tenant 7 searches by the exact key string — must NOT match.
	rows, err := SearchChannelsForTenant(7, "sk-ABC-unique-12345", "", "", false)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	for _, r := range rows {
		if r.Id == plat.Id {
			t.Fatal("tenant search leaked platform channel via key match")
		}
	}
}

func TestSearchChannelsForTenant_FindsByName(t *testing.T) {
	if DB == nil {
		t.Skip("no DB")
	}
	plat := Channel{Type: 1, Name: "findable-platform-xyz", Scope: ChannelScopePlatform, TenantId: 0, Key: "k", Status: 1, CreatedTime: 1, Models: "gpt-4o"}
	if err := WithTenantBypass(DB).Create(&plat).Error; err != nil {
		t.Fatalf("insert: %v", err)
	}
	defer WithTenantBypass(DB).Delete(&Channel{}, plat.Id)

	rows, _ := SearchChannelsForTenant(7, "findable-platform", "", "", false)
	found := false
	for _, r := range rows {
		if r.Id == plat.Id {
			found = true
		}
	}
	if !found {
		t.Fatal("search by name should find platform channel")
	}
}
