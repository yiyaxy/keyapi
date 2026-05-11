package model

import "testing"

func TestIsChatHistoryViewEnabled_DefaultsFalse(t *testing.T) {
	if DB == nil {
		t.Skip("no DB")
	}
	tenantId := 44
	// Make sure we start from a clean state.
	_ = WithTenantBypass(DB).
		Where("tenant_id = ? AND "+commonKeyCol+" = ?", tenantId, TenantOptionKeyChatHistoryView).
		Delete(&TenantOption{})

	if IsChatHistoryViewEnabled(tenantId) {
		t.Fatalf("expected false for unset tenant option")
	}
	// invalid id always false
	if IsChatHistoryViewEnabled(0) {
		t.Fatalf("expected false for tenantId=0")
	}
	if IsChatHistoryViewEnabled(-1) {
		t.Fatalf("expected false for negative tenantId")
	}
}

func TestSetChatHistoryViewEnabled_TogglesOnAndOff(t *testing.T) {
	if DB == nil {
		t.Skip("no DB")
	}
	tenantId := 45
	_ = WithTenantBypass(DB).
		Where("tenant_id = ? AND "+commonKeyCol+" = ?", tenantId, TenantOptionKeyChatHistoryView).
		Delete(&TenantOption{})

	if err := SetChatHistoryViewEnabled(tenantId, true); err != nil {
		t.Fatalf("enable: %v", err)
	}
	if !IsChatHistoryViewEnabled(tenantId) {
		t.Fatalf("expected enabled after Set(true)")
	}

	if err := SetChatHistoryViewEnabled(tenantId, false); err != nil {
		t.Fatalf("disable: %v", err)
	}
	if IsChatHistoryViewEnabled(tenantId) {
		t.Fatalf("expected disabled after Set(false)")
	}
	// Disabling should remove the row rather than store "false".
	var rows []TenantOption
	if err := WithTenantBypass(DB).
		Where("tenant_id = ? AND "+commonKeyCol+" = ?", tenantId, TenantOptionKeyChatHistoryView).
		Find(&rows).Error; err != nil {
		t.Fatalf("query rows: %v", err)
	}
	if len(rows) != 0 {
		t.Fatalf("expected 0 rows after disable, got %d", len(rows))
	}
}

func TestIsChatHistoryViewEnabled_TreatsNonTrueAsDisabled(t *testing.T) {
	if DB == nil {
		t.Skip("no DB")
	}
	tenantId := 46
	_ = WithTenantBypass(DB).
		Where("tenant_id = ? AND "+commonKeyCol+" = ?", tenantId, TenantOptionKeyChatHistoryView).
		Delete(&TenantOption{})

	// Defensive: any unrecognized value must collapse to "disabled" rather
	// than silently behaving like "enabled" — protects against config typos.
	for _, v := range []string{"", "True", "1", "yes", "garbage", "false"} {
		if err := SetTenantOption(tenantId, TenantOptionKeyChatHistoryView, v); err != nil {
			t.Fatalf("seed value %q: %v", v, err)
		}
		if IsChatHistoryViewEnabled(tenantId) {
			t.Fatalf("value %q should be treated as disabled", v)
		}
	}
}
