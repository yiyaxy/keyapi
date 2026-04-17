package service

import (
	"testing"
	"time"

	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// resetTenantBillingTables wipes plan/alert/tenant rows and clears the in-memory
// plan cache so each grace-period scenario starts from a clean slate.
func resetTenantBillingTables(t *testing.T) {
	t.Helper()
	require.NoError(t, model.DB.Exec("DELETE FROM tenant_plans").Error)
	require.NoError(t, model.DB.Exec("DELETE FROM tenant_alert_records").Error)
	require.NoError(t, model.DB.Exec("DELETE FROM tenants").Error)
	model.ClearTenantPlanCache()
	model.ClearTenantCache()
}

func seedTenantWithPlan(t *testing.T, tenantId int, slug string, expiresAt, grace int64) *model.TenantPlan {
	t.Helper()
	now := time.Now().Unix()
	tenant := &model.Tenant{
		Id:        tenantId,
		Name:      slug,
		Slug:      slug,
		Status:    model.TenantStatusActive,
		CreatedAt: now,
		UpdatedAt: now,
	}
	require.NoError(t, model.WithTenantBypass(model.DB).Create(tenant).Error)

	plan := &model.TenantPlan{
		TenantId:           tenantId,
		PlanName:           "test",
		QuotaLimit:         -1,
		RPMLimit:           -1,
		TPMLimit:           -1,
		MaxMembers:         -1,
		MaxTokens:          -1,
		MaxChannels:        -1,
		Status:             model.TenantPlanStatusActive,
		ExpiresAt:          expiresAt,
		GracePeriodSeconds: grace,
		CreatedAt:          now,
		UpdatedAt:          now,
	}
	require.NoError(t, model.WithTenantBypass(model.DB).Create(plan).Error)
	return plan
}

// Test 1: in grace window — status stays active, plan_in_grace_period alert written.
func TestRunTenantPlanStateMachine_GraceWindow_KeepsActiveAndAlerts(t *testing.T) {
	resetTenantBillingTables(t)

	tenantId := 1001
	now := time.Now().Unix()
	expiresAt := now - 3600    // expired 1h ago
	grace := int64(86400)      // 24h grace
	seedTenantWithPlan(t, tenantId, "grace-window", expiresAt, grace)

	RunTenantPlanStateMachine()

	var reloaded model.TenantPlan
	require.NoError(t, model.WithTenantBypass(model.DB).
		Where("tenant_id = ?", tenantId).First(&reloaded).Error)
	assert.Equal(t, model.TenantPlanStatusActive, reloaded.Status,
		"plan should remain active during grace period")

	var alerts []model.TenantAlertRecord
	require.NoError(t, model.WithTenantBypass(model.DB).
		Where("tenant_id = ? AND alert_type = ?", tenantId, "plan_in_grace_period").
		Find(&alerts).Error)
	require.Len(t, alerts, 1, "exactly one plan_in_grace_period alert should be written")
	assert.Equal(t, "warning", alerts[0].Severity)
	assert.Contains(t, alerts[0].Message, "宽限期至")

	// And no plan_expired_disabled alert yet
	var disabledAlerts []model.TenantAlertRecord
	require.NoError(t, model.WithTenantBypass(model.DB).
		Where("tenant_id = ? AND alert_type = ?", tenantId, "plan_expired_disabled").
		Find(&disabledAlerts).Error)
	assert.Len(t, disabledAlerts, 0)
}

// Test 2: grace exhausted — status set to disabled, plan_expired_disabled alert written.
func TestRunTenantPlanStateMachine_GraceExhausted_DisablesAndAlerts(t *testing.T) {
	resetTenantBillingTables(t)

	tenantId := 1002
	now := time.Now().Unix()
	expiresAt := now - 25*3600 // expired 25h ago
	grace := int64(86400)      // 24h grace, already exhausted
	seedTenantWithPlan(t, tenantId, "grace-exhausted", expiresAt, grace)

	RunTenantPlanStateMachine()

	var reloaded model.TenantPlan
	require.NoError(t, model.WithTenantBypass(model.DB).
		Where("tenant_id = ?", tenantId).First(&reloaded).Error)
	assert.Equal(t, model.TenantPlanStatusDisabled, reloaded.Status,
		"plan should be disabled after grace window elapses")

	var alerts []model.TenantAlertRecord
	require.NoError(t, model.WithTenantBypass(model.DB).
		Where("tenant_id = ? AND alert_type = ?", tenantId, "plan_expired_disabled").
		Find(&alerts).Error)
	require.Len(t, alerts, 1, "plan_expired_disabled alert should be written")
	assert.Equal(t, "critical", alerts[0].Severity)
}

// Test 3: grace=0 — old behavior preserved, status flips to disabled immediately on expiry.
func TestRunTenantPlanStateMachine_NoGrace_DisablesImmediately(t *testing.T) {
	resetTenantBillingTables(t)

	tenantId := 1003
	now := time.Now().Unix()
	expiresAt := now - 3600 // expired 1h ago
	grace := int64(0)       // no grace
	seedTenantWithPlan(t, tenantId, "no-grace", expiresAt, grace)

	RunTenantPlanStateMachine()

	var reloaded model.TenantPlan
	require.NoError(t, model.WithTenantBypass(model.DB).
		Where("tenant_id = ?", tenantId).First(&reloaded).Error)
	assert.Equal(t, model.TenantPlanStatusDisabled, reloaded.Status,
		"plan with grace=0 should be disabled immediately on expiry (legacy behavior)")

	// No grace alert should ever be written
	var graceAlerts []model.TenantAlertRecord
	require.NoError(t, model.WithTenantBypass(model.DB).
		Where("tenant_id = ? AND alert_type = ?", tenantId, "plan_in_grace_period").
		Find(&graceAlerts).Error)
	assert.Len(t, graceAlerts, 0, "no grace alert when grace=0")

	// plan_expired_disabled should be present
	var disabledAlerts []model.TenantAlertRecord
	require.NoError(t, model.WithTenantBypass(model.DB).
		Where("tenant_id = ? AND alert_type = ?", tenantId, "plan_expired_disabled").
		Find(&disabledAlerts).Error)
	require.Len(t, disabledAlerts, 1)
	assert.Equal(t, "critical", disabledAlerts[0].Severity)
}
