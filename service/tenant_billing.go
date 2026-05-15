package service

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

// GenerateTenantBill 为指定租户生成/刷新当前周期（默认本月）的账单快照。
// 若 periodStart/periodEnd 均 > 0 则使用指定范围；否则默认本月。
// 会 upsert 一条 open 状态账单（若已 closed 则报错，不破坏历史）。
func GenerateTenantBill(tenantId int, periodStart, periodEnd int64) (*model.TenantBill, error) {
	if tenantId <= 0 {
		return nil, fmt.Errorf("invalid tenantId")
	}
	if periodStart <= 0 || periodEnd <= 0 {
		periodStart, periodEnd = model.GetCurrentBillPeriodRange(time.Now())
	}
	if periodEnd <= periodStart {
		return nil, fmt.Errorf("invalid period range")
	}

	plan, err := model.GetTenantPlan(tenantId)
	if err != nil {
		return nil, fmt.Errorf("get tenant plan: %w", err)
	}

	// 聚合本周期内的 quota 消耗和请求数
	var quotaUsed int64
	var requestCount int64
	logDB := model.LOG_DB
	if err := logDB.Table("logs").
		Select("COALESCE(SUM(quota), 0)").
		Where("tenant_id = ? AND type = ? AND created_at >= ? AND created_at < ?",
			tenantId, model.LogTypeConsume, periodStart, periodEnd).
		Scan(&quotaUsed).Error; err != nil {
		return nil, fmt.Errorf("sum quota: %w", err)
	}
	if err := logDB.Table("logs").
		Where("tenant_id = ? AND type = ? AND created_at >= ? AND created_at < ?",
			tenantId, model.LogTypeConsume, periodStart, periodEnd).
		Count(&requestCount).Error; err != nil {
		return nil, fmt.Errorf("count requests: %w", err)
	}

	planJson, _ := json.Marshal(plan)
	bill := &model.TenantBill{
		TenantId:     tenantId,
		PeriodStart:  periodStart,
		PeriodEnd:    periodEnd,
		QuotaUsed:    quotaUsed,
		RequestCount: requestCount,
		PlanName:     plan.PlanName,
		PlanSnapshot: string(planJson),
		Status:       model.TenantBillStatusOpen,
	}
	if err := model.UpsertTenantBill(bill); err != nil {
		return nil, err
	}
	return bill, nil
}

// CloseOverdueTenantBills 把所有 period_end 已到期且仍 open 的账单结转为 closed，
// 并写一条 consume 类型的账本流水（BalanceAfter 取流水前余额 - quotaUsed）。
// 通常由月度定时任务触发；本函数是幂等的。
func CloseOverdueTenantBills() {
	now := time.Now().Unix()
	var openBills []model.TenantBill
	if err := model.WithTenantBypass(model.DB).
		Where("status = ? AND period_end <= ?", model.TenantBillStatusOpen, now).
		Find(&openBills).Error; err != nil {
		common.SysError(fmt.Sprintf("CloseOverdueTenantBills list failed: %s", err.Error()))
		return
	}
	for _, b := range openBills {
		if err := model.CloseTenantBill(b.TenantId, b.Id); err != nil {
			common.SysError(fmt.Sprintf("CloseOverdueTenantBills close failed tenant=%d bill=%d: %s",
				b.TenantId, b.Id, err.Error()))
			continue
		}
		// 写账本流水
		prevBalance, _ := model.SumTenantLedgerBalance(b.TenantId)
		entry := &model.TenantLedger{
			TenantId:     b.TenantId,
			LedgerType:   model.TenantLedgerTypeConsume,
			Amount:       -b.QuotaUsed,
			BalanceAfter: prevBalance - b.QuotaUsed,
			Description:  fmt.Sprintf("账单结转：%s 月度消费", time.Unix(b.PeriodStart, 0).Format("2006-01")),
			RefType:      "bill",
			RefId:        b.Id,
		}
		if err := model.AppendTenantLedger(entry); err != nil {
			common.SysError(fmt.Sprintf("CloseOverdueTenantBills ledger write failed tenant=%d bill=%d: %s",
				b.TenantId, b.Id, err.Error()))
		}
	}
}

// RunTenantPlanStateMachine 对所有租户计划执行状态转换检查：
//
// 含两个 pass：
//   - Pass 1（宽限期预警）：plan.Status=Active 且 expires_at <= now <
//     expires_at + grace_period_seconds → 仍保持 Active，但写入
//     plan_in_grace_period 告警（severity=warning）。
//   - Pass 2（到期停服）：plan.Status=Active 且 expires_at + grace_period_seconds <= now
//     → 设为 Disabled，并写入 plan_expired_disabled 告警。
//
// 当 grace_period_seconds=0 时，pass 1 永远不会命中，行为与旧逻辑等价
// （expires_at <= now 立刻进入 pass 2）。
func RunTenantPlanStateMachine() {
	now := time.Now().Unix()

	// ---------- Pass 1: in grace period (expires_at <= now < expires_at + grace) ----------
	var gracePlans []model.TenantPlan
	if err := model.WithTenantBypass(model.DB).
		Where("status = ? AND expires_at > 0 AND expires_at <= ? AND (expires_at + grace_period_seconds) > ?",
			model.TenantPlanStatusActive, now, now).
		Find(&gracePlans).Error; err != nil {
		common.SysError(fmt.Sprintf("RunTenantPlanStateMachine grace list failed: %s", err.Error()))
	} else {
		for _, p := range gracePlans {
			graceUntil := p.ExpiresAt + p.GracePeriodSeconds
			_, _ = model.UpsertTenantAlert(p.TenantId, "plan_in_grace_period", "warning",
				fmt.Sprintf("租户计划已到期，进入宽限期，宽限期至 %s",
					time.Unix(graceUntil, 0).Format("2006-01-02 15:04:05")), now)
		}
	}

	// ---------- Pass 2: grace exhausted (expires_at + grace <= now) → disable ----------
	var expiredPlans []model.TenantPlan
	if err := model.WithTenantBypass(model.DB).
		Where("status = ? AND expires_at > 0 AND (expires_at + grace_period_seconds) <= ?",
			model.TenantPlanStatusActive, now).
		Find(&expiredPlans).Error; err != nil {
		common.SysError(fmt.Sprintf("RunTenantPlanStateMachine expired list failed: %s", err.Error()))
		return
	}
	for _, p := range expiredPlans {
		updates := map[string]interface{}{"status": model.TenantPlanStatusDisabled, "updated_at": now}
		if err := model.WithTenantBypass(model.DB).
			Model(&model.TenantPlan{}).
			Where("id = ? AND tenant_id = ?", p.Id, p.TenantId).
			Updates(updates).Error; err != nil {
			common.SysError(fmt.Sprintf("RunTenantPlanStateMachine disable failed tenant=%d: %s",
				p.TenantId, err.Error()))
			continue
		}
		model.BroadcastInvalidateTenantPlan(p.TenantId)
		// 写告警（租户计划到期停服会被下次 sweep 产出 plan_disabled 告警，这里主动写
		// 一条历史条目便于前端显示）
		_, _ = model.UpsertTenantAlert(p.TenantId, "plan_expired_disabled", "critical",
			fmt.Sprintf("租户计划已到期并自动停用（到期时间 %s）",
				time.Unix(p.ExpiresAt, 0).Format("2006-01-02 15:04:05")), now)
	}
}

// StartTenantBillingAndPlanLoop 启动账单 & 状态机定时循环（master 节点）。
// 频率：1 小时一次（账单和到期检查都是低频场景）。
func StartTenantBillingAndPlanLoop(interval time.Duration) {
	if interval <= 0 {
		interval = time.Hour
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	// 启动立即执行一次
	runTenantBillingAndPlanTick()
	for range ticker.C {
		runTenantBillingAndPlanTick()
	}
}

func runTenantBillingAndPlanTick() {
	// 1. 状态机：先处理到期
	RunTenantPlanStateMachine()
	RunTenantInactivitySweep()
	// 2. 刷新/生成本月账单（为每个活跃租户）
	tenants, err := model.ListActiveTenantsForSweep()
	if err != nil {
		common.SysError(fmt.Sprintf("runTenantBillingAndPlanTick list tenants: %s", err.Error()))
		return
	}
	for _, t := range tenants {
		if _, err := GenerateTenantBill(t.Id, 0, 0); err != nil {
			common.SysError(fmt.Sprintf("runTenantBillingAndPlanTick generate-bill tenant=%d: %s",
				t.Id, err.Error()))
		}
	}
	// 3. 结转已过期的账单
	CloseOverdueTenantBills()
}
