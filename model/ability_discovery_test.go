package model

import "testing"

func TestGetGroupEnabledModels_IncludesPlatform(t *testing.T) {
	if DB == nil {
		t.Skip("no DB")
	}
	// Platform ability directly — tenant_id=0, scope=platform.
	// Using raw SQL to avoid GORM's default:1 on tenant_id replacing our 0.
	if err := DB.Exec("INSERT INTO abilities (`group`, model, channel_id, tenant_id, scope, enabled) VALUES (?, ?, ?, ?, ?, ?)",
		"default", "plat-model-xyz", 9001, 0, ChannelScopePlatform, true).Error; err != nil {
		t.Fatalf("insert ability: %v", err)
	}
	defer DB.Exec("DELETE FROM abilities WHERE channel_id = ?", 9001)

	models := GetGroupEnabledModels("default", 77)
	found := false
	for _, m := range models {
		if m == "plat-model-xyz" {
			found = true
		}
	}
	if !found {
		t.Fatalf("GetGroupEnabledModels must include platform-scope models; got: %v", models)
	}
}

func TestGetEnabledModels_IncludesPlatform(t *testing.T) {
	if DB == nil {
		t.Skip("no DB")
	}
	if err := DB.Exec("INSERT INTO abilities (`group`, model, channel_id, tenant_id, scope, enabled) VALUES (?, ?, ?, ?, ?, ?)",
		"default", "plat-enabled-xyz", 9002, 0, ChannelScopePlatform, true).Error; err != nil {
		t.Fatalf("insert ability: %v", err)
	}
	defer DB.Exec("DELETE FROM abilities WHERE channel_id = ?", 9002)

	models := GetEnabledModels(77)
	found := false
	for _, m := range models {
		if m == "plat-enabled-xyz" {
			found = true
		}
	}
	if !found {
		t.Fatalf("GetEnabledModels must include platform-scope models; got: %v", models)
	}
}
