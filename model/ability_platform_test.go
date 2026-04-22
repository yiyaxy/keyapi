package model

import "testing"

// TestBatchInsertChannelsBypass_PreservesZeroTenantId 覆盖 /admin/platform/channels
// 新建按钮的真实路径：超管 → AddChannel → BatchInsertChannelsBypass。
// Channel 结构体带 `tenant_id default:1` GORM tag，struct-based Create 会把
// 零值 TenantId 改写成 1；必须用 Select("*") 把零值强制写进 INSERT。
func TestBatchInsertChannelsBypass_PreservesZeroTenantId(t *testing.T) {
	if DB == nil {
		t.Skip("no DB")
	}

	ch := Channel{
		Name: "plat-batch-insert-test", Type: 1,
		Scope: ChannelScopePlatform, TenantId: 0,
		Key: "k", Status: 1, Models: "batch-model-xyz",
		Group: "default", CreatedTime: 1,
	}
	if err := BatchInsertChannelsBypass([]Channel{ch}); err != nil {
		t.Fatalf("BatchInsertChannelsBypass: %v", err)
	}

	var got Channel
	if err := WithTenantBypass(DB).Where("name = ?", ch.Name).First(&got).Error; err != nil {
		t.Fatalf("reload channel: %v", err)
	}
	defer WithTenantBypass(DB).Delete(&Channel{}, got.Id)
	defer DB.Exec("DELETE FROM abilities WHERE channel_id = ?", got.Id)

	if got.TenantId != 0 {
		t.Fatalf("channels.tenant_id = %d, want 0 (default:1 tag leaked via zero-value override)", got.TenantId)
	}
	if got.Scope != ChannelScopePlatform {
		t.Fatalf("channels.scope = %q, want %q", got.Scope, ChannelScopePlatform)
	}
}

// TestPlatformChannelDelete 覆盖超管删平台渠道的路径：Channel.Delete 必须
// 对 tenant_id=0 放行（WithTenantBypass + WHERE id），并级联把 abilities 清掉。
// 原先要求 channel.TenantId != 0，导致报 "channel.Id 和 channel.TenantId 不能为空"。
func TestPlatformChannelDelete(t *testing.T) {
	if DB == nil {
		t.Skip("no DB")
	}

	ch := Channel{
		Name: "plat-delete-test", Type: 1,
		Scope: ChannelScopePlatform, TenantId: 0,
		Key: "k", Status: 1, Models: "del-model-xyz",
		Group: "default", CreatedTime: 1,
	}
	createPlatformChannelForTest(t, &ch)
	if err := ch.AddAbilities(nil); err != nil {
		t.Fatal(err)
	}

	var before int64
	WithTenantBypass(DB).Model(&Ability{}).Where("channel_id = ?", ch.Id).Count(&before)
	if before == 0 {
		t.Fatalf("precondition: expected abilities for channel %d, got none", ch.Id)
	}

	if err := ch.Delete(); err != nil {
		t.Fatalf("delete platform channel: %v", err)
	}

	var chanAfter int64
	WithTenantBypass(DB).Model(&Channel{}).Where("id = ?", ch.Id).Count(&chanAfter)
	if chanAfter != 0 {
		t.Fatalf("channel row not deleted, count=%d", chanAfter)
	}
	var abilAfter int64
	WithTenantBypass(DB).Model(&Ability{}).Where("channel_id = ?", ch.Id).Count(&abilAfter)
	if abilAfter != 0 {
		t.Fatalf("ability rows not cascaded, count=%d", abilAfter)
	}
}

// TestPlatformAbilityTenantIdNormalization 保护 createAbilityRows 的归零逻辑：
// 即便调用方传入一个 scope=platform 但 TenantId 非 0 的脏 Channel（历史数据 /
// 绕过 BeforeSave 的写入路径 / 代码误用），abilities 行最终也必须 tenant_id=0。
// 缓存按 tenant_id 列分桶，漏掉这一步其他租户就看不见平台渠道。
func TestPlatformAbilityTenantIdNormalization(t *testing.T) {
	if DB == nil {
		t.Skip("no DB")
	}

	ch := Channel{
		Name: "plat-dirty-tenantid-test", Type: 1,
		Scope: ChannelScopePlatform, TenantId: 0,
		Key: "k", Status: 1, Models: "dirty-model-xyz",
		Group: "default", CreatedTime: 1,
	}
	createPlatformChannelForTest(t, &ch)
	defer WithTenantBypass(DB).Delete(&Channel{}, ch.Id)
	defer DB.Exec("DELETE FROM abilities WHERE channel_id = ?", ch.Id)

	// 模拟脏输入：scope=platform 但 TenantId 被写成 1（即 LO 观察到的线上症状）
	ch.TenantId = 1
	if err := ch.AddAbilities(nil); err != nil {
		t.Fatal(err)
	}

	var abilities []Ability
	if err := WithTenantBypass(DB).Where("channel_id = ?", ch.Id).Find(&abilities).Error; err != nil {
		t.Fatalf("query abilities: %v", err)
	}
	if len(abilities) != 1 {
		t.Fatalf("expected 1 ability, got %d: %#v", len(abilities), abilities)
	}
	if abilities[0].TenantId != 0 {
		t.Fatalf("dirty platform ability tenant_id = %d, want 0 (normalization failed)", abilities[0].TenantId)
	}
	if abilities[0].Scope != ChannelScopePlatform {
		t.Fatalf("dirty platform ability scope = %q, want %q", abilities[0].Scope, ChannelScopePlatform)
	}
}

func TestPlatformChannelAddAbilities_SetsPlatformScope(t *testing.T) {
	if DB == nil {
		t.Skip("no DB")
	}

	ch := Channel{
		Name: "plat-ability-scope-test", Type: 1,
		Scope: ChannelScopePlatform, TenantId: 0,
		Key: "k", Status: 1, Models: "scope-model-xyz",
		Group: "default", CreatedTime: 1,
	}
	createPlatformChannelForTest(t, &ch)
	defer WithTenantBypass(DB).Delete(&Channel{}, ch.Id)
	defer DB.Exec("DELETE FROM abilities WHERE channel_id = ?", ch.Id)

	if err := ch.AddAbilities(nil); err != nil {
		t.Fatal(err)
	}

	var abilities []Ability
	if err := WithTenantBypass(DB).Where("channel_id = ?", ch.Id).Order("model asc").Find(&abilities).Error; err != nil {
		t.Fatalf("query abilities: %v", err)
	}
	if len(abilities) != 1 {
		t.Fatalf("expected 1 ability, got %d: %#v", len(abilities), abilities)
	}
	if abilities[0].TenantId != 0 {
		t.Fatalf("platform ability tenant_id = %d, want 0", abilities[0].TenantId)
	}
	if abilities[0].Scope != ChannelScopePlatform {
		t.Fatalf("platform ability scope = %q, want %q", abilities[0].Scope, ChannelScopePlatform)
	}
}

func TestPlatformChannelUpdateAbilities_RebuildsRows(t *testing.T) {
	if DB == nil {
		t.Skip("no DB")
	}

	ch := Channel{
		Name: "plat-ability-update-test", Type: 1,
		Scope: ChannelScopePlatform, TenantId: 0,
		Key: "k", Status: 1, Models: "old-model-xyz",
		Group: "default", CreatedTime: 1,
	}
	createPlatformChannelForTest(t, &ch)
	defer WithTenantBypass(DB).Delete(&Channel{}, ch.Id)
	defer DB.Exec("DELETE FROM abilities WHERE channel_id = ?", ch.Id)

	if err := ch.AddAbilities(nil); err != nil {
		t.Fatal(err)
	}

	ch.Models = "new-model-xyz"
	if err := ch.UpdateAbilities(nil); err != nil {
		t.Fatalf("update abilities: %v", err)
	}

	var abilities []Ability
	if err := WithTenantBypass(DB).Where("channel_id = ?", ch.Id).Order("model asc").Find(&abilities).Error; err != nil {
		t.Fatalf("query abilities: %v", err)
	}
	if len(abilities) != 1 {
		t.Fatalf("expected 1 rebuilt ability, got %d: %#v", len(abilities), abilities)
	}
	if abilities[0].Model != "new-model-xyz" {
		t.Fatalf("rebuilt ability model = %q, want %q", abilities[0].Model, "new-model-xyz")
	}
	if abilities[0].Scope != ChannelScopePlatform {
		t.Fatalf("rebuilt ability scope = %q, want %q", abilities[0].Scope, ChannelScopePlatform)
	}
}
