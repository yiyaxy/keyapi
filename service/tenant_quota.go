package service

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/go-redis/redis/v8"
	"gorm.io/gorm"
)

// ---------- in-memory RPM counter (fallback when Redis is unavailable) ----------

type rpmEntry struct {
	mu      sync.Mutex
	count   int
	resetAt time.Time
}

var (
	rpmCounters sync.Map // tenantId -> *rpmEntry
)

func getRPMEntry(tenantId int) *rpmEntry {
	val, _ := rpmCounters.LoadOrStore(tenantId, &rpmEntry{})
	entry := val.(*rpmEntry)
	return entry
}

// ---------- in-memory TPM counter ----------
// 选用时机：启动时 Redis 未启用 (!common.RedisEnabled || common.RDB == nil)。
// 注意：不是"运行时 Redis 出错回退"——Redis 已配置但运行时 GET/INCRBY 错误时，
// 只会打 SysError 并 fail-open（check）或丢弃计数（increment），不切到内存。
// 与 CheckTenantRPM / IncrementTenantRPM 当前实现保持一致的取舍。

type tpmEntry struct {
	mu      sync.Mutex
	tokens  int64
	resetAt time.Time
}

var (
	tpmCounters sync.Map // tenantId -> *tpmEntry
)

const platformQuotaIncrementMaxRetries = 3

func getTPMEntry(tenantId int) *tpmEntry {
	val, _ := tpmCounters.LoadOrStore(tenantId, &tpmEntry{})
	entry := val.(*tpmEntry)
	return entry
}

// ---------- public enforcement API ----------

// CheckTenantQuota verifies that a tenant hasn't exceeded their plan's total quota limit.
// Returns nil if OK, error with descriptive message if limit exceeded.
func CheckTenantQuota(tenantId int) error {
	if tenantId <= 0 {
		return nil
	}

	plan, err := model.GetTenantPlan(tenantId)
	if err != nil {
		return fmt.Errorf("获取租户计划失败: %w", err)
	}

	if plan.Status != model.TenantPlanStatusActive {
		return fmt.Errorf("租户计划已禁用")
	}

	if model.IsTenantPlanExpired(plan) {
		return fmt.Errorf("租户计划已过期")
	}

	// QuotaLimit <= 0 means unlimited
	if plan.QuotaLimit <= 0 {
		return nil
	}

	// Query sum of used quota from logs for this tenant
	var usedQuota int64
	logDB := model.LOG_DB
	if err := logDB.Table("logs").
		Select("COALESCE(SUM(quota), 0)").
		Where("tenant_id = ? AND type = ?", tenantId, model.LogTypeConsume).
		Scan(&usedQuota).Error; err != nil {
		return fmt.Errorf("查询租户已用额度失败: %w", err)
	}

	if usedQuota >= plan.QuotaLimit {
		return fmt.Errorf("租户额度已耗尽 (已用: %d, 限额: %d)", usedQuota, plan.QuotaLimit)
	}

	return nil
}

// CheckTenantRPM checks the requests-per-minute limit for a tenant.
// Returns nil if OK, error if RPM limit exceeded.
func CheckTenantRPM(tenantId int) error {
	if tenantId <= 0 {
		return nil
	}

	plan, err := model.GetTenantPlan(tenantId)
	if err != nil {
		return fmt.Errorf("获取租户计划失败: %w", err)
	}

	// RPMLimit <= 0 means unlimited
	if plan.RPMLimit <= 0 {
		return nil
	}

	if common.RedisEnabled && common.RDB != nil {
		return checkTenantRPMRedis(tenantId, plan.RPMLimit)
	}
	return checkTenantRPMMemory(tenantId, plan.RPMLimit)
}

func checkTenantRPMRedis(tenantId int, limit int) error {
	ctx := context.Background()
	key := fmt.Sprintf("tenant_rpm:%d", tenantId)

	count, err := common.RDB.Incr(ctx, key).Result()
	if err != nil {
		// Redis error — fail open (allow request)
		return nil
	}

	// Set TTL on first increment
	if count == 1 {
		common.RDB.Expire(ctx, key, 60*time.Second)
	}

	if count > int64(limit) {
		return fmt.Errorf("租户每分钟请求数已达上限 (%d RPM)", limit)
	}
	return nil
}

func checkTenantRPMMemory(tenantId int, limit int) error {
	entry := getRPMEntry(tenantId)
	entry.mu.Lock()
	defer entry.mu.Unlock()

	now := time.Now()
	if now.After(entry.resetAt) {
		entry.count = 0
		entry.resetAt = now.Add(60 * time.Second)
	}

	if entry.count >= limit {
		return fmt.Errorf("租户每分钟请求数已达上限 (%d RPM)", limit)
	}

	// Don't increment here — IncrementTenantRPM handles that
	return nil
}

// CheckTenantTPM verifies that the tenant's accumulated token-per-minute usage
// hasn't exceeded the plan's TPMLimit. Returns nil if OK or unlimited.
//
// 语义说明：
//   - 反应式检查：仅当计数器已达上限时拒绝。单次突发请求不做预算预留。
//   - 双后端选择是启动时决策（RedisEnabled 为准），不是运行时回退：
//     Redis 配了但 GET 运行时失败时，记录 SysError 然后 fail-open——
//     不会切到 in-memory 计数器（与 CheckTenantRPM 一致）。
//   - redis.Nil（key 缺失，当前分钟首个请求尚未 INCRBY）视为 0 计数，返回 nil。
func CheckTenantTPM(tenantId int) error {
	if tenantId <= 0 {
		return nil
	}

	plan, err := model.GetTenantPlan(tenantId)
	if err != nil {
		return fmt.Errorf("获取租户计划失败: %w", err)
	}

	// TPMLimit <= 0 means unlimited
	if plan.TPMLimit <= 0 {
		return nil
	}

	if common.RedisEnabled && common.RDB != nil {
		return checkTenantTPMRedis(tenantId, plan.TPMLimit)
	}
	return checkTenantTPMMemory(tenantId, plan.TPMLimit)
}

func checkTenantTPMRedis(tenantId int, limit int) error {
	ctx := context.Background()
	key := fmt.Sprintf("tenant_tpm:%d", tenantId)
	count, err := common.RDB.Get(ctx, key).Int64()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			// 当前分钟尚无 INCRBY，视为 0 计数
			return nil
		}
		// 真实 Redis 错误：升级为 SysError 让运维可见，继续 fail-open
		common.SysError(fmt.Sprintf("CheckTenantTPM redis GET error tenant=%d: %s (fail-open)", tenantId, err.Error()))
		return nil
	}
	if count >= int64(limit) {
		return fmt.Errorf("租户每分钟 Token 数已达上限 (%d TPM)", limit)
	}
	return nil
}

func checkTenantTPMMemory(tenantId int, limit int) error {
	entry := getTPMEntry(tenantId)
	entry.mu.Lock()
	defer entry.mu.Unlock()

	now := time.Now()
	if now.After(entry.resetAt) {
		// Window rolled — counter is effectively 0 for this minute
		return nil
	}
	if entry.tokens >= int64(limit) {
		return fmt.Errorf("租户每分钟 Token 数已达上限 (%d TPM)", limit)
	}
	return nil
}

// CheckTenantModelAccess checks if the model is allowed by the tenant plan.
// Returns nil if allowed, error if the model is restricted.
func CheckTenantModelAccess(tenantId int, modelName string) error {
	if tenantId <= 0 || modelName == "" {
		return nil
	}

	plan, err := model.GetTenantPlan(tenantId)
	if err != nil {
		return fmt.Errorf("获取租户计划失败: %w", err)
	}

	allowed := model.GetTenantPlanAllowedModels(plan)
	if allowed == nil {
		// Empty means all models allowed
		return nil
	}

	if _, ok := allowed[modelName]; !ok {
		return fmt.Errorf("租户计划不允许使用模型: %s", modelName)
	}

	return nil
}

// CheckTenantPlatformChannelQuota verifies that a projected platform-channel
// charge still fits within the tenant's configured cap for the current period.
// The check is read-only: if the period has rolled over we treat used as zero
// for this request, but leave the durable reset to the next increment write.
func CheckTenantPlatformChannelQuota(tenantId int, projectedQuota int) error {
	if tenantId <= 0 || projectedQuota <= 0 {
		return nil
	}

	plan, err := model.GetTenantPlan(tenantId)
	if err != nil {
		return fmt.Errorf("获取租户计划失败: %w", err)
	}
	if plan.PlatformQuotaCap < 0 {
		return nil
	}

	effectiveUsed := plan.PlatformQuotaUsed
	if needReset, _ := model.ComputePlatformQuotaPeriodReset(plan.PlatformQuotaPeriod, plan.PlatformQuotaPeriodStart, time.Now()); needReset {
		effectiveUsed = 0
	}
	return evaluateProjectedQuota(plan.PlatformQuotaCap, effectiveUsed, projectedQuota)
}

func evaluateProjectedQuota(cap int64, effectiveUsed int64, projected int) error {
	if cap < 0 || projected <= 0 {
		return nil
	}
	if effectiveUsed+int64(projected) > cap {
		return fmt.Errorf("租户平台渠道额度不足 (上限 %d，已用 %d，本次需要 %d)",
			cap, effectiveUsed, projected)
	}
	return nil
}

// IncrementTenantPlatformChannelUsed accumulates actual settled usage for
// platform-scope channels. It uses optimistic concurrency keyed on
// platform_quota_period_start so rollover races do not lose writes.
func IncrementTenantPlatformChannelUsed(tenantId int, quotaDelta int) {
	if tenantId <= 0 || quotaDelta <= 0 {
		return
	}
	if model.DB == nil {
		return
	}

	now := time.Now()
	for attempt := 0; attempt < platformQuotaIncrementMaxRetries; attempt++ {
		var row struct {
			PlatformQuotaCap         int64
			PlatformQuotaPeriod      string
			PlatformQuotaPeriodStart int64
		}
		err := model.WithTenantBypass(model.DB).Table("tenant_plans").
			Select("platform_quota_cap, platform_quota_period, platform_quota_period_start").
			Where("tenant_id = ?", tenantId).
			Take(&row).Error
		if err != nil {
			common.SysError(fmt.Sprintf("IncrementTenantPlatformChannelUsed SELECT failed tenant=%d: %s", tenantId, err.Error()))
			return
		}
		// 即使 cap < 0(unlimited) 也照常累加,用于控制台观测;
		// 限额检查由 CheckTenantPlatformChannelQuota 单独负责跳过。

		needReset, newStart := model.ComputePlatformQuotaPeriodReset(row.PlatformQuotaPeriod, row.PlatformQuotaPeriodStart, now)

		var updates map[string]interface{}
		if needReset {
			updates = map[string]interface{}{
				"platform_quota_used":         int64(quotaDelta),
				"platform_quota_period_start": newStart,
			}
		} else {
			updates = map[string]interface{}{
				"platform_quota_used": gorm.Expr("platform_quota_used + ?", quotaDelta),
			}
		}

		res := model.WithTenantBypass(model.DB).Table("tenant_plans").
			Where("tenant_id = ? AND platform_quota_period_start = ?", tenantId, row.PlatformQuotaPeriodStart).
			Updates(updates)
		if res.Error != nil {
			common.SysError(fmt.Sprintf("IncrementTenantPlatformChannelUsed UPDATE failed tenant=%d delta=%d: %s", tenantId, quotaDelta, res.Error.Error()))
			return
		}
		if res.RowsAffected > 0 {
			model.InvalidateTenantPlanCache(tenantId)
			return
		}
	}

	common.SysError(fmt.Sprintf("IncrementTenantPlatformChannelUsed exhausted retries tenant=%d delta=%d", tenantId, quotaDelta))
}

// IncrementTenantRPM increments the RPM counter for a tenant.
// Should be called after a relay request succeeds.
func IncrementTenantRPM(tenantId int) {
	if tenantId <= 0 {
		return
	}

	if common.RedisEnabled && common.RDB != nil {
		// Redis counter already incremented in CheckTenantRPM via INCR
		// No additional increment needed
		return
	}

	// In-memory counter
	entry := getRPMEntry(tenantId)
	entry.mu.Lock()
	defer entry.mu.Unlock()

	now := time.Now()
	if now.After(entry.resetAt) {
		entry.count = 1
		entry.resetAt = now.Add(60 * time.Second)
		return
	}
	entry.count++
}

// IncrementTenantTPM adds `tokens` to the tenant's current-minute TPM counter.
// Called after a relay request completes with known prompt+completion token usage.
//
// 后端选择与 CheckTenantTPM 对称：启动时 Redis 启用则独走 Redis，
// 运行时 INCRBY 出错会记录 SysError 并**丢弃本次计数**——不切到 in-memory。
// 副作用：Redis 抖动窗口内，少数请求不被累计，CheckTenantTPM 实测值会偏低。
// 接受此偏差以保持单一事实源（避免与 Redis 恢复后发生计数器发散）。
func IncrementTenantTPM(tenantId int, tokens int) {
	if tenantId <= 0 || tokens <= 0 {
		return
	}

	if common.RedisEnabled && common.RDB != nil {
		ctx := context.Background()
		key := fmt.Sprintf("tenant_tpm:%d", tenantId)
		newCount, err := common.RDB.IncrBy(ctx, key, int64(tokens)).Result()
		if err != nil {
			common.SysError(fmt.Sprintf("IncrementTenantTPM redis INCRBY error tenant=%d tokens=%d: %s (count dropped, no in-memory fallback)", tenantId, tokens, err.Error()))
			return
		}
		if newCount == int64(tokens) {
			// First increment in this minute — set TTL
			common.RDB.Expire(ctx, key, 60*time.Second)
		}
		return
	}

	// In-memory counter
	entry := getTPMEntry(tenantId)
	entry.mu.Lock()
	defer entry.mu.Unlock()

	now := time.Now()
	if now.After(entry.resetAt) {
		entry.tokens = int64(tokens)
		entry.resetAt = now.Add(60 * time.Second)
		return
	}
	entry.tokens += int64(tokens)
}
