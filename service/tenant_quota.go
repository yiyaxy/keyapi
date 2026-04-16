package service

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
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

// ---------- in-memory TPM counter (fallback when Redis is unavailable) ----------

type tpmEntry struct {
	mu      sync.Mutex
	tokens  int64
	resetAt time.Time
}

var (
	tpmCounters sync.Map // tenantId -> *tpmEntry
)

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
// Note: this is a reactive check — it rejects only when the counter already
// exceeds the limit. Burst requests that individually exceed the limit are
// permitted (matches RPM semantics).
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
		// Key missing or Redis error — fail open
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
// Redis path uses INCRBY; in-memory path uses atomic add with a 60s rolling window.
func IncrementTenantTPM(tenantId int, tokens int) {
	if tenantId <= 0 || tokens <= 0 {
		return
	}

	if common.RedisEnabled && common.RDB != nil {
		ctx := context.Background()
		key := fmt.Sprintf("tenant_tpm:%d", tenantId)
		newCount, err := common.RDB.IncrBy(ctx, key, int64(tokens)).Result()
		if err != nil {
			common.SysError(fmt.Sprintf("IncrementTenantTPM redis error tenant=%d: %s", tenantId, err.Error()))
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
