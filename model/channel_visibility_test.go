package model

import (
	"testing"
)

func TestGetVisibleChannelForTenant_PlatformVisible(t *testing.T) {
	if DB == nil {
		t.Skip("no DB")
	}
	// Arrange: insert a platform channel (scope='platform', tenant_id=0)
	plat := Channel{Type: 1, Name: "plat-test", Scope: ChannelScopePlatform, TenantId: 0, Key: "k", Status: 1, CreatedTime: 1}
	if err := WithTenantBypass(DB).Create(&plat).Error; err != nil {
		t.Fatalf("insert platform: %v", err)
	}
	defer WithTenantBypass(DB).Delete(&Channel{}, plat.Id)

	ch, err := GetVisibleChannelForTenant(plat.Id, 7, true)
	if err != nil {
		t.Fatalf("expected platform visible to tenant 7: %v", err)
	}
	if ch.Id != plat.Id {
		t.Fatalf("id mismatch")
	}
}

func TestGetVisibleChannelForTenant_OtherTenantHidden(t *testing.T) {
	if DB == nil {
		t.Skip("no DB")
	}
	other := Channel{Type: 1, Name: "other-test", Scope: ChannelScopeTenant, TenantId: 8, Key: "k", Status: 1, CreatedTime: 1}
	if err := WithTenantBypass(DB).Create(&other).Error; err != nil {
		t.Fatalf("insert other: %v", err)
	}
	defer WithTenantBypass(DB).Delete(&Channel{}, other.Id)

	_, err := GetVisibleChannelForTenant(other.Id, 7, true)
	if err == nil {
		t.Fatal("expected not-found when tenant 7 tries to read tenant 8's channel")
	}
}

func TestGetOwnedChannelForTenant_RejectsPlatform(t *testing.T) {
	if DB == nil {
		t.Skip("no DB")
	}
	plat := Channel{Type: 1, Name: "owned-test", Scope: ChannelScopePlatform, TenantId: 0, Key: "k", Status: 1, CreatedTime: 1}
	if err := WithTenantBypass(DB).Create(&plat).Error; err != nil {
		t.Fatalf("insert: %v", err)
	}
	defer WithTenantBypass(DB).Delete(&Channel{}, plat.Id)

	_, err := GetOwnedChannelForTenant(plat.Id, 7, true)
	if err == nil {
		t.Fatal("GetOwnedChannelForTenant must reject platform channel (strict tenant match)")
	}
}
