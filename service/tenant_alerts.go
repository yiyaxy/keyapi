package service

import (
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

// TenantAlert 是告警运行时快照（不带 DB id / status 等字段）。
type TenantAlert struct {
	TenantId    int    `json:"tenant_id"`
	AlertType   string `json:"alert_type"` // "quota_80", "quota_100", "rpm_high", "member_limit", ...
	Message     string `json:"message"`
	Severity    string `json:"severity"` // "warning", "critical"
	TriggeredAt int64  `json:"triggered_at"`
}

// 告警类型常量。新告警类型应在此登记，便于前端 i18n / 后台过滤同步维护。
const (
	TenantAlertTypePlanDisabled        = "plan_disabled"
	TenantAlertTypePlanExpired         = "plan_expired"
	TenantAlertTypePlanExpiring        = "plan_expiring"
	TenantAlertTypePlanInGracePeriod   = "plan_in_grace_period"   // severity=warning
	TenantAlertTypePlanExpiredDisabled = "plan_expired_disabled" // severity=critical
	TenantAlertTypeQuota80             = "quota_80"
	TenantAlertTypeQuota100            = "quota_100"
	TenantAlertTypeRPMHigh             = "rpm_high"
	TenantAlertTypeMemberLimit         = "member_limit"
	TenantAlertTypeTokenLimit          = "token_limit"
	TenantAlertTypeChannelLimit        = "channel_limit"
)

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

	// Channel limit
	if plan.MaxChannels > 0 && metrics.TotalChannels >= int64(plan.MaxChannels) {
		alerts = append(alerts, TenantAlert{
			TenantId:    tenantId,
			AlertType:   "channel_limit",
			Message:     fmt.Sprintf("渠道数已达上限（当前 %d / 限额 %d）", metrics.TotalChannels, plan.MaxChannels),
			Severity:    "warning",
			TriggeredAt: now,
		})
	}

	return alerts, nil
}

// RefreshTenantAlerts 实时计算告警并同步到持久化表：
//   - 对每条当前产出的告警做 upsert（已存在同类型未解除则刷新，否则新建 active）
//   - 对 DB 里 active/acknowledged 但本次不再触发的类型标记为 resolved
//   - 返回数据库里当前 active/acknowledged 记录（带 id/status/acknowledged_at 等字段）
func RefreshTenantAlerts(tenantId int) ([]model.TenantAlertRecord, error) {
	snapshot, err := CheckTenantAlerts(tenantId)
	if err != nil {
		return nil, err
	}
	currentTypes := make(map[string]bool, len(snapshot))
	for _, a := range snapshot {
		currentTypes[a.AlertType] = true
		if _, err := model.UpsertTenantAlert(a.TenantId, a.AlertType, a.Severity, a.Message, a.TriggeredAt); err != nil {
			common.SysError(fmt.Sprintf("RefreshTenantAlerts upsert failed tenant=%d type=%s: %s",
				tenantId, a.AlertType, err.Error()))
		}
	}
	if err := model.ResolveStaleTenantAlerts(tenantId, currentTypes); err != nil {
		common.SysError(fmt.Sprintf("RefreshTenantAlerts resolve-stale failed tenant=%d: %s",
			tenantId, err.Error()))
	}
	return model.ListActiveTenantAlerts(tenantId)
}

// StartTenantAlertSweepLoop 启动定时巡检循环：每 interval 触发一次全量 sweep。
// 由 main.go 在 master 节点启动；通过 gopool.Go 包裹。
func StartTenantAlertSweepLoop(interval time.Duration) {
	if interval <= 0 {
		interval = 5 * time.Minute
	}
	// 启动时先初始化 sweepStartAt，保证第一次循环能正常推送新告警
	sweepStartAt = time.Now().Unix()
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	// 启动后立即跑一次，不等 interval
	RunTenantAlertSweep()
	for range ticker.C {
		RunTenantAlertSweep()
	}
}

// RunTenantAlertSweep 对所有活跃租户刷新一次告警。用于定时巡检任务（cron）。
// 失败不阻断整体流程；单租户错误只记录日志。
func RunTenantAlertSweep() {
	tenants, err := model.ListActiveTenantsForSweep()
	if err != nil {
		common.SysError(fmt.Sprintf("RunTenantAlertSweep list tenants failed: %s", err.Error()))
		return
	}
	successCount := 0
	for _, t := range tenants {
		if _, err := RefreshTenantAlerts(t.Id); err != nil {
			common.SysError(fmt.Sprintf("RunTenantAlertSweep tenant=%d failed: %s", t.Id, err.Error()))
			continue
		}
		successCount++
	}
	common.SysLog(fmt.Sprintf("RunTenantAlertSweep completed: %d/%d tenants refreshed",
		successCount, len(tenants)))
	// 触发告警推送（对新产生的 active 告警发邮件等）
	notifyPendingAlerts()
}

// sweepStartAt 用于"变化检测"：只推送本次 sweep 过程中新建/刷新的告警。
var sweepStartAt int64

// notifyPendingAlerts 查找自上次 sweep 起新增的 active 告警并推送。
// 推送渠道实现见 tenant_alert_notifier.go。
func notifyPendingAlerts() {
	since := sweepStartAt
	sweepStartAt = time.Now().Unix()
	if since == 0 {
		// 第一次启动不推送历史，避免一次性大量邮件
		return
	}
	records, err := model.ListAlertsCreatedSince(since)
	if err != nil {
		common.SysError(fmt.Sprintf("notifyPendingAlerts list failed: %s", err.Error()))
		return
	}
	for _, r := range records {
		dispatchTenantAlertNotification(r)
	}
}
