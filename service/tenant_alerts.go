package service

import (
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/model"
)

// TenantAlert represents a single active alert for a tenant.
type TenantAlert struct {
	TenantId    int    `json:"tenant_id"`
	AlertType   string `json:"alert_type"`   // "quota_80", "quota_100", "rpm_high", "member_limit"
	Message     string `json:"message"`
	Severity    string `json:"severity"`     // "warning", "critical"
	TriggeredAt int64  `json:"triggered_at"`
}

// CheckTenantAlerts evaluates current usage against thresholds and returns active alerts.
// It relies on GetTenantMetrics for live usage data. Plan-based checks (quota, token,
// member limits) are skipped when model/tenant_plan.go is not present.
func CheckTenantAlerts(tenantId int) ([]TenantAlert, error) {
	metrics, err := GetTenantMetrics(tenantId)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch tenant metrics: %w", err)
	}

	now := time.Now().Unix()
	var alerts []TenantAlert

	// --- Plan-based checks ---
	plan, err := model.GetTenantPlan(tenantId)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch tenant plan: %w", err)
	}

	// Plan status: disabled
	if plan.Status == model.TenantPlanStatusDisabled {
		alerts = append(alerts, TenantAlert{
			TenantId:    tenantId,
			AlertType:   "plan_disabled",
			Message:     "租户套餐已停用",
			Severity:    "critical",
			TriggeredAt: now,
		})
	}

	// Plan expiry
	if plan.ExpiresAt > 0 {
		if model.IsTenantPlanExpired(plan) {
			alerts = append(alerts, TenantAlert{
				TenantId:    tenantId,
				AlertType:   "plan_expired",
				Message:     "租户套餐已过期",
				Severity:    "critical",
				TriggeredAt: now,
			})
		} else {
			sevenDays := int64(7 * 24 * 60 * 60)
			remaining := plan.ExpiresAt - time.Now().Unix()
			if remaining <= sevenDays {
				days := remaining / (24 * 60 * 60)
				alerts = append(alerts, TenantAlert{
					TenantId:    tenantId,
					AlertType:   "plan_expiring",
					Message:     fmt.Sprintf("租户套餐将在 %d 天内过期", days),
					Severity:    "warning",
					TriggeredAt: now,
				})
			}
		}
	}

	// Quota usage
	if plan.QuotaLimit > 0 {
		pct := float64(metrics.TotalQuotaUsed) / float64(plan.QuotaLimit)
		if pct >= 1.0 {
			alerts = append(alerts, TenantAlert{
				TenantId:    tenantId,
				AlertType:   "quota_100",
				Message:     fmt.Sprintf("配额已耗尽（已用 %d / 限额 %d）", metrics.TotalQuotaUsed, plan.QuotaLimit),
				Severity:    "critical",
				TriggeredAt: now,
			})
		} else if pct >= 0.8 {
			alerts = append(alerts, TenantAlert{
				TenantId:    tenantId,
				AlertType:   "quota_80",
				Message:     fmt.Sprintf("配额使用已达 %.0f%%（已用 %d / 限额 %d）", pct*100, metrics.TotalQuotaUsed, plan.QuotaLimit),
				Severity:    "warning",
				TriggeredAt: now,
			})
		}
	}

	// RPM check (plan-based threshold when available, otherwise fallback to defaults)
	var dailyRpmWarning, dailyRpmCritical int64
	if plan.RPMLimit > 0 {
		// Derive daily ceiling from per-minute limit: RPMLimit * 60 * 24 = daily max
		dailyMax := int64(plan.RPMLimit) * 60 * 24
		dailyRpmWarning = int64(float64(dailyMax) * 0.8)
		dailyRpmCritical = dailyMax
	} else {
		dailyRpmWarning = 800_000
		dailyRpmCritical = 1_000_000
	}

	if metrics.TodayRequests >= dailyRpmCritical {
		alerts = append(alerts, TenantAlert{
			TenantId:    tenantId,
			AlertType:   "rpm_high",
			Message:     fmt.Sprintf("今日请求量已达 %d，超过每日安全阈值 %d", metrics.TodayRequests, dailyRpmCritical),
			Severity:    "critical",
			TriggeredAt: now,
		})
	} else if metrics.TodayRequests >= dailyRpmWarning {
		alerts = append(alerts, TenantAlert{
			TenantId:    tenantId,
			AlertType:   "rpm_high",
			Message:     fmt.Sprintf("今日请求量已达 %d，接近每日安全阈值 %d", metrics.TodayRequests, dailyRpmCritical),
			Severity:    "warning",
			TriggeredAt: now,
		})
	}

	// Member limit
	if plan.MaxMembers > 0 && metrics.TotalMembers >= int64(plan.MaxMembers) {
		alerts = append(alerts, TenantAlert{
			TenantId:    tenantId,
			AlertType:   "member_limit",
			Message:     fmt.Sprintf("成员数已达上限（当前 %d / 限额 %d）", metrics.TotalMembers, plan.MaxMembers),
			Severity:    "warning",
			TriggeredAt: now,
		})
	}

	// Token limit
	if plan.MaxTokens > 0 && metrics.TotalTokens >= int64(plan.MaxTokens) {
		alerts = append(alerts, TenantAlert{
			TenantId:    tenantId,
			AlertType:   "token_limit",
			Message:     fmt.Sprintf("令牌数已达上限（当前 %d / 限额 %d）", metrics.TotalTokens, plan.MaxTokens),
			Severity:    "warning",
			TriggeredAt: now,
		})
	}

	return alerts, nil
}
