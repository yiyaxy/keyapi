package model

import (
	"testing"

	"github.com/stretchr/testify/require"
)

// migrateAiAppForTest 在测试 DB 上确保 ai_apps 表存在。
// TestMain（task_cas_test.go）的固定列表里没有 AiApp，所以这里显式 AutoMigrate。
func migrateAiAppForTest(t *testing.T) {
	t.Helper()
	require.NoError(t, DB.AutoMigrate(&AiApp{}))
	t.Cleanup(func() { DB.Exec("DELETE FROM ai_apps") })
}

func insertAiAppForTest(t *testing.T, app *AiApp) {
	t.Helper()
	require.NoError(t, app.Insert())
	require.NotZero(t, app.Id)
}

// 平台 scope 应用：所有租户都看得见
func TestGetAllOnlineAiApps_PlatformVisibleAcrossTenants(t *testing.T) {
	migrateAiAppForTest(t)

	platformApp := &AiApp{
		Scope: AiAppScopePlatform, Name: "platform-app", Slug: "plat-1",
		TargetUrl: "https://plat.example.com", Status: AiAppStatusOnline,
	}
	insertAiAppForTest(t, platformApp)
	require.Equal(t, 0, platformApp.TenantId, "platform scope must persist tenant_id=0")

	tenantAApp := &AiApp{
		Scope: AiAppScopeTenant, TenantId: 10, Name: "a-only", Slug: "a-1",
		TargetUrl: "https://a.example.com", Status: AiAppStatusOnline,
	}
	insertAiAppForTest(t, tenantAApp)

	// 租户 B 视角：只能看到平台应用 + B 自己的应用（这里只有平台的）
	apps, err := GetAllOnlineAiApps(20)
	require.NoError(t, err)
	require.Len(t, apps, 1, "tenant B should only see the platform app")
	require.Equal(t, "plat-1", apps[0].Slug)

	// 租户 A 视角：平台应用 + A 自己的应用
	apps, err = GetAllOnlineAiApps(10)
	require.NoError(t, err)
	require.Len(t, apps, 2)
}

// 租户 scope 应用：只对本租户可见
func TestGetAllOnlineAiApps_TenantScopeIsolated(t *testing.T) {
	migrateAiAppForTest(t)

	insertAiAppForTest(t, &AiApp{
		Scope: AiAppScopeTenant, TenantId: 10, Name: "a-app", Slug: "a-only-1",
		TargetUrl: "https://a.example.com", Status: AiAppStatusOnline,
	})
	insertAiAppForTest(t, &AiApp{
		Scope: AiAppScopeTenant, TenantId: 20, Name: "b-app", Slug: "b-only-1",
		TargetUrl: "https://b.example.com", Status: AiAppStatusOnline,
	})

	apps, err := GetAllOnlineAiApps(10)
	require.NoError(t, err)
	require.Len(t, apps, 1)
	require.Equal(t, "a-only-1", apps[0].Slug)
}

// slug 查找走平台/租户合并视图
func TestGetAiAppBySlug_PlatformReachableFromAnyTenant(t *testing.T) {
	migrateAiAppForTest(t)

	insertAiAppForTest(t, &AiApp{
		Scope: AiAppScopePlatform, Name: "shared", Slug: "shared-app",
		TargetUrl: "https://shared.example.com", Status: AiAppStatusOnline,
	})

	// 任意租户都能查到平台 slug
	app, err := GetAiAppBySlug("shared-app", 999)
	require.NoError(t, err)
	require.Equal(t, AiAppScopePlatform, app.Scope)
}

// slug 查找：其他租户的私有应用不可见
func TestGetAiAppBySlug_TenantPrivateBlocked(t *testing.T) {
	migrateAiAppForTest(t)

	insertAiAppForTest(t, &AiApp{
		Scope: AiAppScopeTenant, TenantId: 10, Name: "private", Slug: "secret-app",
		TargetUrl: "https://secret.example.com", Status: AiAppStatusOnline,
	})

	_, err := GetAiAppBySlug("secret-app", 20)
	require.Error(t, err, "tenant 20 must not see tenant 10's private app")
}

// ListAiAppsForAdmin：租户管理员看到 自己的 + 平台
func TestListAiAppsForAdmin_TenantSeesOwnPlusPlatform(t *testing.T) {
	migrateAiAppForTest(t)

	insertAiAppForTest(t, &AiApp{
		Scope: AiAppScopePlatform, Name: "plat", Slug: "plat-admin",
		TargetUrl: "https://plat.example.com", Status: AiAppStatusDraft, // 草稿也能看见
	})
	insertAiAppForTest(t, &AiApp{
		Scope: AiAppScopeTenant, TenantId: 10, Name: "a-priv", Slug: "a-admin",
		TargetUrl: "https://a.example.com", Status: AiAppStatusOnline,
	})
	insertAiAppForTest(t, &AiApp{
		Scope: AiAppScopeTenant, TenantId: 20, Name: "b-priv", Slug: "b-admin",
		TargetUrl: "https://b.example.com", Status: AiAppStatusOnline,
	})

	apps, total, err := ListAiAppsForAdmin(10, 0, 50)
	require.NoError(t, err)
	require.EqualValues(t, 2, total)
	require.Len(t, apps, 2)
}

// Update 平台 scope：根据 (id, scope=platform) 命中，不需要 tenant_id 匹配
func TestUpdate_PlatformScopeIgnoresTenantId(t *testing.T) {
	migrateAiAppForTest(t)

	app := &AiApp{
		Scope: AiAppScopePlatform, Name: "before", Slug: "upd-1",
		TargetUrl: "https://x.example.com", Status: AiAppStatusOnline,
	}
	insertAiAppForTest(t, app)

	app.Name = "after"
	require.NoError(t, app.Update())

	got, err := GetAiAppById(app.Id)
	require.NoError(t, err)
	require.Equal(t, "after", got.Name)
	require.Equal(t, AiAppScopePlatform, got.Scope)
	require.Equal(t, 0, got.TenantId)
}

func TestUpdateFrom_AllowsTenantToPlatformScopeChange(t *testing.T) {
	migrateAiAppForTest(t)

	existing := &AiApp{
		Scope: AiAppScopeTenant, TenantId: 10, Name: "tenant-app", Slug: "scope-to-platform",
		TargetUrl: "https://x.example.com", Status: AiAppStatusOnline,
	}
	insertAiAppForTest(t, existing)

	next := &AiApp{
		Id: existing.Id, Scope: AiAppScopePlatform, Name: "platform-app", Slug: existing.Slug,
		TargetUrl: existing.TargetUrl, Status: AiAppStatusOnline,
	}
	require.NoError(t, next.UpdateFrom(existing))

	got, err := GetAiAppById(existing.Id)
	require.NoError(t, err)
	require.Equal(t, AiAppScopePlatform, got.Scope)
	require.Equal(t, 0, got.TenantId)
	require.Equal(t, "platform-app", got.Name)
}

func TestUpdateFrom_AllowsPlatformToTenantScopeChange(t *testing.T) {
	migrateAiAppForTest(t)

	existing := &AiApp{
		Scope: AiAppScopePlatform, Name: "platform-app", Slug: "scope-to-tenant",
		TargetUrl: "https://x.example.com", Status: AiAppStatusOnline,
	}
	insertAiAppForTest(t, existing)

	next := &AiApp{
		Id: existing.Id, Scope: AiAppScopeTenant, TenantId: 10, Name: "tenant-app", Slug: existing.Slug,
		TargetUrl: existing.TargetUrl, Status: AiAppStatusOnline,
	}
	require.NoError(t, next.UpdateFrom(existing))

	got, err := GetAiAppById(existing.Id)
	require.NoError(t, err)
	require.Equal(t, AiAppScopeTenant, got.Scope)
	require.Equal(t, 10, got.TenantId)
	require.Equal(t, "tenant-app", got.Name)
}

// Delete 平台 scope：同上
func TestDelete_PlatformScope(t *testing.T) {
	migrateAiAppForTest(t)

	app := &AiApp{
		Scope: AiAppScopePlatform, Name: "doomed", Slug: "del-1",
		TargetUrl: "https://x.example.com", Status: AiAppStatusOnline,
	}
	insertAiAppForTest(t, app)
	require.NoError(t, app.Delete())

	apps, err := GetAllOnlineAiApps(999)
	require.NoError(t, err)
	require.Empty(t, apps)
}

// 租户 scope 不能跨租户改：用错误的 tenant_id 调 Update 应当影响 0 行
func TestUpdate_TenantScopeBlocksCrossTenant(t *testing.T) {
	migrateAiAppForTest(t)

	owned := &AiApp{
		Scope: AiAppScopeTenant, TenantId: 10, Name: "mine", Slug: "tu-1",
		TargetUrl: "https://x.example.com", Status: AiAppStatusOnline,
	}
	insertAiAppForTest(t, owned)

	// 租户 20 试图改租户 10 的 app
	attacker := &AiApp{
		Id: owned.Id, Scope: AiAppScopeTenant, TenantId: 20,
		Name: "hijacked", Slug: owned.Slug, TargetUrl: owned.TargetUrl,
	}
	require.NoError(t, attacker.Update()) // 不报错，但应该没改任何行

	got, err := GetAiAppById(owned.Id)
	require.NoError(t, err)
	require.Equal(t, "mine", got.Name, "cross-tenant update must not modify the row")
}
