package service

import (
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/require"
)

func resetTenantInactivityTables(t *testing.T) {
	t.Helper()
	require.NoError(t, model.DB.Exec("DELETE FROM tenant_audit_logs").Error)
	require.NoError(t, model.DB.Exec("DELETE FROM user_ip_records").Error)
	require.NoError(t, model.DB.Exec("DELETE FROM tenant_memberships").Error)
	require.NoError(t, model.DB.Exec("DELETE FROM users").Error)
	require.NoError(t, model.DB.Exec("DELETE FROM tenants").Error)
	model.ClearTenantCache()
}

func seedTenantForInactivity(t *testing.T, id int, createdAt int64) {
	t.Helper()
	require.NoError(t, model.WithTenantBypass(model.DB).Create(&model.Tenant{
		Id:        id,
		Name:      "tenant",
		Slug:      "tenant-inactivity-test",
		Status:    model.TenantStatusActive,
		CreatedAt: createdAt,
		UpdatedAt: createdAt,
	}).Error)
}

func seedTenantUserForInactivity(t *testing.T, id int, tenantId int, role int, quota int) {
	t.Helper()
	require.NoError(t, model.WithTenantBypass(model.DB).Create(&model.User{
		Id:       id,
		TenantId: tenantId,
		Username: "tenant-user",
		Password: "password",
		Role:     role,
		Status:   common.UserStatusEnabled,
		Quota:    quota,
	}).Error)
}

func TestSuspendInactiveTenants_SuspendsTenantWithoutRecentLogin(t *testing.T) {
	resetTenantInactivityTables(t)

	now := time.Unix(1_700_000_000, 0)
	tenantId := 7001
	seedTenantForInactivity(t, tenantId, now.Add(-8*24*time.Hour).Unix())

	n, err := SuspendInactiveTenants(now)
	require.NoError(t, err)
	require.Equal(t, 1, n)

	var tenant model.Tenant
	require.NoError(t, model.WithTenantBypass(model.DB).Where("id = ?", tenantId).First(&tenant).Error)
	require.Equal(t, model.TenantStatusSuspended, tenant.Status)

	var audit model.TenantAuditLog
	require.NoError(t, model.WithTenantBypass(model.DB).
		Where("tenant_id = ? AND action = ?", tenantId, "tenant.auto_suspend_inactive").
		First(&audit).Error)
	require.Equal(t, "system", audit.ActorRole)
}

func TestSuspendInactiveTenants_KeepsTenantWithRecentLogin(t *testing.T) {
	resetTenantInactivityTables(t)

	now := time.Unix(1_700_000_000, 0)
	tenantId := 7002
	seedTenantForInactivity(t, tenantId, now.Add(-8*24*time.Hour).Unix())
	require.NoError(t, model.WithTenantBypass(model.DB).Create(&model.UserIpRecord{
		TenantId:  tenantId,
		UserId:    42,
		Username:  "active-user",
		Ip:        "127.0.0.1",
		LoginType: "password",
		CreatedAt: now.Add(-2 * 24 * time.Hour).Unix(),
	}).Error)

	n, err := SuspendInactiveTenants(now)
	require.NoError(t, err)
	require.Equal(t, 0, n)

	var tenant model.Tenant
	require.NoError(t, model.WithTenantBypass(model.DB).Where("id = ?", tenantId).First(&tenant).Error)
	require.Equal(t, model.TenantStatusActive, tenant.Status)
}

func TestSuspendInactiveTenants_KeepsTenantWithPositiveCommonUserQuota(t *testing.T) {
	resetTenantInactivityTables(t)

	now := time.Unix(1_700_000_000, 0)
	tenantId := 7004
	seedTenantForInactivity(t, tenantId, now.Add(-8*24*time.Hour).Unix())
	seedTenantUserForInactivity(t, 9001, tenantId, common.RoleCommonUser, 100)

	n, err := SuspendInactiveTenants(now)
	require.NoError(t, err)
	require.Equal(t, 0, n)

	var tenant model.Tenant
	require.NoError(t, model.WithTenantBypass(model.DB).Where("id = ?", tenantId).First(&tenant).Error)
	require.Equal(t, model.TenantStatusActive, tenant.Status)
}

func TestSuspendInactiveTenants_IgnoresAdminUserQuota(t *testing.T) {
	resetTenantInactivityTables(t)

	now := time.Unix(1_700_000_000, 0)
	tenantId := 7005
	seedTenantForInactivity(t, tenantId, now.Add(-8*24*time.Hour).Unix())
	seedTenantUserForInactivity(t, 9002, tenantId, common.RoleAdminUser, 100)

	n, err := SuspendInactiveTenants(now)
	require.NoError(t, err)
	require.Equal(t, 1, n)

	var tenant model.Tenant
	require.NoError(t, model.WithTenantBypass(model.DB).Where("id = ?", tenantId).First(&tenant).Error)
	require.Equal(t, model.TenantStatusSuspended, tenant.Status)
}

func TestSuspendInactiveTenants_IgnoresTenantAdminMemberQuota(t *testing.T) {
	resetTenantInactivityTables(t)

	now := time.Unix(1_700_000_000, 0)
	tenantId := 7006
	userId := 9003
	seedTenantForInactivity(t, tenantId, now.Add(-8*24*time.Hour).Unix())
	seedTenantUserForInactivity(t, userId, tenantId, common.RoleCommonUser, 100)
	require.NoError(t, model.WithTenantBypass(model.DB).Create(&model.TenantMembership{
		TenantId: tenantId,
		UserId:   userId,
		Role:     model.TenantRoleAdmin,
		Status:   model.TenantMembershipStatusActive,
	}).Error)

	n, err := SuspendInactiveTenants(now)
	require.NoError(t, err)
	require.Equal(t, 1, n)

	var tenant model.Tenant
	require.NoError(t, model.WithTenantBypass(model.DB).Where("id = ?", tenantId).First(&tenant).Error)
	require.Equal(t, model.TenantStatusSuspended, tenant.Status)
}

func TestSuspendInactiveTenants_SkipsDefaultTenant(t *testing.T) {
	resetTenantInactivityTables(t)

	now := time.Unix(1_700_000_000, 0)
	seedTenantForInactivity(t, model.DefaultTenantId, now.Add(-30*24*time.Hour).Unix())

	n, err := SuspendInactiveTenants(now)
	require.NoError(t, err)
	require.Equal(t, 0, n)

	var tenant model.Tenant
	require.NoError(t, model.WithTenantBypass(model.DB).Where("id = ?", model.DefaultTenantId).First(&tenant).Error)
	require.Equal(t, model.TenantStatusActive, tenant.Status)
}
