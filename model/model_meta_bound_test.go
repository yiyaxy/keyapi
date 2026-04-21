package model

import "testing"

func TestGetBoundChannelsByModelsMap_IncludesPlatform(t *testing.T) {
	if DB == nil {
		t.Skip("no DB")
	}
	// Insert platform channel + ability via raw SQL (GORM default:1 gotcha).
	if err := DB.Exec("INSERT INTO channels (name, type, scope, tenant_id, `key`, status, models, `group`, created_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
		"plat-bound", 1, ChannelScopePlatform, 0, "k", 1, "bound-model-xyz", "default", 1).Error; err != nil {
		t.Fatalf("insert channel: %v", err)
	}
	var chId int
	DB.Raw("SELECT id FROM channels WHERE name = ?", "plat-bound").Scan(&chId)
	defer DB.Exec("DELETE FROM channels WHERE id = ?", chId)

	if err := DB.Exec("INSERT INTO abilities (`group`, model, channel_id, tenant_id, scope, enabled) VALUES (?, ?, ?, ?, ?, ?)",
		"default", "bound-model-xyz", chId, 0, ChannelScopePlatform, true).Error; err != nil {
		t.Fatalf("insert ability: %v", err)
	}
	defer DB.Exec("DELETE FROM abilities WHERE channel_id = ?", chId)

	m, err := GetBoundChannelsByModelsMap([]string{"bound-model-xyz"}, 77)
	if err != nil {
		t.Fatal(err)
	}
	rows := m["bound-model-xyz"]
	if len(rows) == 0 {
		t.Fatal("expected platform channel in bound channels map")
	}
	found := false
	for _, r := range rows {
		if r.Name == "plat-bound" {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("expected plat-bound in results; got: %+v", rows)
	}
}

func TestGetBoundChannelsByModelsMap_RespectsTenantDisable(t *testing.T) {
	if DB == nil {
		t.Skip("no DB")
	}
	if err := DB.Exec("INSERT INTO channels (name, type, scope, tenant_id, `key`, status, models, `group`, created_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
		"plat-bound-disable", 1, ChannelScopePlatform, 0, "k", 1, "bound-disable-xyz", "default", 1).Error; err != nil {
		t.Fatalf("insert channel: %v", err)
	}
	var chId int
	DB.Raw("SELECT id FROM channels WHERE name = ?", "plat-bound-disable").Scan(&chId)
	defer DB.Exec("DELETE FROM channels WHERE id = ?", chId)

	if err := DB.Exec("INSERT INTO abilities (`group`, model, channel_id, tenant_id, scope, enabled) VALUES (?, ?, ?, ?, ?, ?)",
		"default", "bound-disable-xyz", chId, 0, ChannelScopePlatform, true).Error; err != nil {
		t.Fatalf("insert ability: %v", err)
	}
	defer DB.Exec("DELETE FROM abilities WHERE channel_id = ?", chId)

	tid := 78
	SetTenantChannelDisabled(tid, chId, true)
	defer SetTenantChannelDisabled(tid, chId, false)
	ReloadTenantRoutingCache(tid)

	m, _ := GetBoundChannelsByModelsMap([]string{"bound-disable-xyz"}, tid)
	for _, r := range m["bound-disable-xyz"] {
		if r.Name == "plat-bound-disable" {
			t.Fatal("tenant-disabled platform channel should not appear in BoundChannels")
		}
	}
}

func TestGetBoundChannelsByModelsMap_OnlyPrivateHidesPlatform(t *testing.T) {
	if DB == nil {
		t.Skip("no DB")
	}
	if err := DB.Exec("INSERT INTO channels (name, type, scope, tenant_id, `key`, status, models, `group`, created_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
		"plat-bound-onlypriv", 1, ChannelScopePlatform, 0, "k", 1, "only-priv-hide-model", "default", 1).Error; err != nil {
		t.Fatalf("insert channel: %v", err)
	}
	var chId int
	DB.Raw("SELECT id FROM channels WHERE name = ?", "plat-bound-onlypriv").Scan(&chId)
	defer DB.Exec("DELETE FROM channels WHERE id = ?", chId)

	if err := DB.Exec("INSERT INTO abilities (`group`, model, channel_id, tenant_id, scope, enabled) VALUES (?, ?, ?, ?, ?, ?)",
		"default", "only-priv-hide-model", chId, 0, ChannelScopePlatform, true).Error; err != nil {
		t.Fatalf("insert ability: %v", err)
	}
	defer DB.Exec("DELETE FROM abilities WHERE channel_id = ?", chId)

	tid := 79
	SetTenantPlatformChannelMode(tid, PlatformChannelModeOnlyPrivate)
	defer SetTenantPlatformChannelMode(tid, PlatformChannelModePrivatePriority)
	ReloadTenantRoutingCache(tid)

	m, _ := GetBoundChannelsByModelsMap([]string{"only-priv-hide-model"}, tid)
	for _, r := range m["only-priv-hide-model"] {
		if r.Name == "plat-bound-onlypriv" {
			t.Fatal("only_private mode must hide platform channels")
		}
	}
}
