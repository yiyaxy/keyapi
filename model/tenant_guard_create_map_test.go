package model

import "testing"

// TestTenantGuardCreate_MapSliceDoesNotPanic 覆盖租户渠道添加路径：
// AddAbilities → createAbilityRows → tx.Create(&[]map[string]interface{}{...})。
// 租户 scope 不走 bypass，tenantGuardCreate 必须识别 map slice，而不是在
// schema.Field.ValueOf 里对 map Value 调 Field 触发 "reflect.Value.Field on map Value" 的 panic。
func TestTenantGuardCreate_MapSliceDoesNotPanic(t *testing.T) {
	if DB == nil {
		t.Skip("no DB")
	}

	ch := Channel{
		Name:        "tenant-addab-map-test",
		Type:        1,
		Scope:       ChannelScopeTenant,
		TenantId:    1,
		Key:         "k",
		Status:      1,
		Models:      "tenant-map-model-xyz",
		Group:       "default",
		CreatedTime: 1,
	}
	if err := DB.Create(&ch).Error; err != nil {
		t.Fatalf("create tenant channel: %v", err)
	}
	defer WithTenantBypass(DB).Delete(&Channel{}, ch.Id)
	defer DB.Exec("DELETE FROM abilities WHERE channel_id = ?", ch.Id)

	// 旧实现会 panic；batchInsertChannels 的 recover 把 panic 包成 error。
	// 这里直接不经 batchInsertChannels 调 AddAbilities，panic 会逃逸到测试框架。
	if err := ch.AddAbilities(nil); err != nil {
		t.Fatalf("tenant AddAbilities failed: %v", err)
	}

	var abilities []Ability
	if err := WithTenantBypass(DB).Where("channel_id = ?", ch.Id).Find(&abilities).Error; err != nil {
		t.Fatalf("load abilities: %v", err)
	}
	if len(abilities) != 1 {
		t.Fatalf("expected 1 ability row, got %d: %#v", len(abilities), abilities)
	}
	if abilities[0].TenantId != 1 {
		t.Fatalf("ability.tenant_id = %d, want 1", abilities[0].TenantId)
	}
	if abilities[0].Scope != ChannelScopeTenant {
		t.Fatalf("ability.scope = %q, want %q", abilities[0].Scope, ChannelScopeTenant)
	}
}
