# Phase 5 计划限制强制执行 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 `TenantPlan` 中 3 个现存但未执行的限制字段（`TPMLimit` / `MaxTokens` / `MaxChannels`）补齐运行时强制执行逻辑，使 Phase 5 完成度从 30% → ~75%。

**Architecture:**
- **TPM**：双模式（Redis `INCRBY` + 内存 `sync.Map`）。pre-check 在 relay 入口处（紧跟 RPM 检查）用 `GET`（只读，不预扣）；post-increment 在**所有成功消费路径**调用 `IncrementTenantTPM`，用真实 `PromptTokens + CompletionTokens`。
  - **⚠️ 与 RPM 语义差异（有意设计）**：
    - **RPM**：Redis `INCR` 发生在 pre-check — 尝试一次就计一次，失败/超时/上游错误也计数
    - **TPM**：Redis `GET` 预检查 + `INCRBY` 仅在计费成功后 — 失败/超时请求不占 TPM 预算
    - 理由：TPM 代表"租户实际消耗的模型 token"，不是"尝试消耗"。失败请求没有实际 token 消耗（pre-consumed quota 也已退还），因此不该占 TPM 预算。
    - 副作用：在某分钟内若大量请求失败，TPM 实测值会低于真实的"请求意图" —— 接受此偏差。
  - **覆盖面**：TPM 增量点必须覆盖 3 个成功计费路径：
    - `service/text_quota.go:416` — 文本/聊天
    - `service/quota.go:231` — WSS (PostWssConsumeQuota)
    - `service/quota.go:346` — Audio (PostAudioConsumeQuota)
- **max_tokens / max_channels**：在 controller 层 Count → Compare → Insert。
  - **⚠️ 明确声明**：这是**best-effort enforcement**，**不是原子强制**。并发创建时多个请求可能读到同一旧计数同时通过，导致短暂越界 1-N 个。接受此风险的依据：
    - 创建 token/channel 是 admin-driven 低频操作，不是高并发关键路径
    - `tenant_alerts.go` 已有 `token_limit` 告警（当 `TotalTokens >= MaxTokens` 时触发）；`channel_limit` 告警由 Task 11 补齐（当前代码库缺）
    - 原子实现需要分布式锁或条件 INSERT，复杂度与收益不成正比
  - 使用新增的 `model.CountTenantTokens` / `model.CountTenantChannels`。
- **batch 计数正确性**：`controller/channel.go:639-653` 在构建 `channels` 数组时会过滤空 key。plan MaxChannels 校验必须在 `channels` 切片**构建完成之后**、`BatchInsertChannels` 之前，用 `len(channels)` 作为 `incomingCount`，避免空行导致误拒。
- 所有新增 DB 查询必须加 `tenant_id` WHERE，遵循现有 guardrail 协议。

**Tech Stack:** Go 1.22.4，Gin，GORM，Redis（可选），SQLite/MySQL/PostgreSQL 兼容。

**Preconditions:** 项目尚未部署，不需要迁移脚本或数据回填。

---

## File Structure

**Modify:**
- `service/tenant_quota.go` — 新增 TPM counter types + `CheckTenantTPM` + `IncrementTenantTPM`
- `types/error.go` — 新增 `ErrorCodeTenantTPMExceeded` 常量
- `controller/relay.go` — 在 RPM 检查后插入 TPM 检查
- `service/text_quota.go` — 在 `RecordConsumeLog` 调用处追加 `IncrementTenantTPM`（text 路径）
- `service/quota.go` — 在 `PostWssConsumeQuota`（WSS 路径）+ `PostAudioConsumeQuota`（Audio 路径）的 `RecordConsumeLog` 调用处追加 `IncrementTenantTPM`
- `service/tenant_alerts.go` — 新增 `channel_limit` alert 分支（Plan 引用它作为 MaxChannels 兜底，必须真实存在）
- `controller/token.go` — `AddToken` 加 plan `MaxTokens` 校验
- `controller/channel.go` — `AddChannel` 加 plan `MaxChannels` 校验（含 batch 场景）
- `model/token.go` — 新增 `CountTenantTokens(tenantId int) (int64, error)`
- `model/channel.go` — 新增 `CountTenantChannels(tenantId int) (int64, error)`

**Create:**
- `service/tenant_quota_test.go` — TPM 逻辑单元测试

---

## Task 1：新增 ErrorCodeTenantTPMExceeded 错误码

**Files:**
- Modify: `types/error.go`（在 `ErrorCodeTenantRPMExceeded` 之后）

- [ ] **Step 1: 定位现有 TenantRPM 错误码**

运行：
```bash
grep -n "ErrorCodeTenantRPMExceeded" types/error.go
```
期望：输出包含 `ErrorCodeTenantRPMExceeded` 定义所在行号与消息映射的行。记录这一行号 N。

- [ ] **Step 2: 紧跟 RPM 错误码追加 TPM 错误码**

在 `ErrorCodeTenantRPMExceeded` 的常量声明块中，新增一行：
```go
ErrorCodeTenantTPMExceeded ErrorCode = "tenant_tpm_exceeded"
```

如果存在错误码 → 人类可读消息的映射 map（通常在同文件），同步追加：
```go
ErrorCodeTenantTPMExceeded: "租户每分钟 Token 数已达计划上限",
```

- [ ] **Step 3: 编译验证**

```bash
"/c/Program Files/Go/bin/go.exe" build ./types/...
```
期望：无错误退出。

- [ ] **Step 4: Commit**

```bash
git add types/error.go
git commit -m "feat(multi-tenant): add ErrorCodeTenantTPMExceeded error code

Co-Authored-By: Claude Opus 4 (1M context) <noreply@anthropic.com>"
```

---

## Task 2：TPM counter 基础设施 + IncrementTenantTPM

**Files:**
- Modify: `service/tenant_quota.go`（在 `rpmEntry` 定义之后新增 `tpmEntry` + 在文件末尾新增 `IncrementTenantTPM`）

- [ ] **Step 1: 新增 tpmEntry 类型与存储**

在 `service/tenant_quota.go` 第 23 行 `rpmCounters sync.Map` 之后插入：
```go
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
```

- [ ] **Step 2: 在文件末尾新增 IncrementTenantTPM 函数**

在 `IncrementTenantRPM` 之后（文件末尾）追加：
```go
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
```

- [ ] **Step 3: 编译验证**

```bash
"/c/Program Files/Go/bin/go.exe" build ./service/...
```
期望：无错误退出。

- [ ] **Step 4: Commit**

```bash
git add service/tenant_quota.go
git commit -m "feat(multi-tenant): add TPM counter infrastructure (tpmEntry, IncrementTenantTPM)

Mirrors RPM counter: Redis INCRBY with 60s TTL, in-memory sync.Map fallback.

Co-Authored-By: Claude Opus 4 (1M context) <noreply@anthropic.com>"
```

---

## Task 3：CheckTenantTPM 函数

**Files:**
- Modify: `service/tenant_quota.go`（在 `CheckTenantModelAccess` 之前或 `CheckTenantRPM` 之后插入）

- [ ] **Step 1: 新增 CheckTenantTPM 公共函数**

在 `CheckTenantRPM` 定义之后（约第 96 行后）插入：
```go
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
```

- [ ] **Step 2: 编译验证**

```bash
"/c/Program Files/Go/bin/go.exe" build ./service/...
```
期望：无错误退出。

- [ ] **Step 3: Commit**

```bash
git add service/tenant_quota.go
git commit -m "feat(multi-tenant): add CheckTenantTPM function

Reads current-minute TPM counter (Redis or in-memory) and rejects when
tenant plan TPMLimit is reached. Reactive check — same semantics as RPM.

Co-Authored-By: Claude Opus 4 (1M context) <noreply@anthropic.com>"
```

---

## Task 4：TPM 单元测试

**Files:**
- Create: `service/tenant_quota_test.go`

**范围说明**：本任务只覆盖纯逻辑路径（内存计数器 + 私有 `checkTenantTPMMemory`）。以下**不覆盖**，留给 Task 12 runtime smoke 验证：
- 公共 `CheckTenantTPM` 入口（依赖 `model.GetTenantPlan` → 需要 DB）
- Redis 路径（需要 Redis 实例）
- `CheckTenantTPM` 在 relay 链路中的端到端接入

- [ ] **Step 1: 写失败测试**

创建 `service/tenant_quota_test.go`，内容完整如下：
```go
package service

import (
	"strings"
	"sync"
	"testing"
	"time"
)

// resetTPMCounters 重置内存 TPM 计数器，测试前必调。
func resetTPMCounters() {
	tpmCounters = sync.Map{}
}

func TestIncrementTenantTPM_InMemory_Accumulates(t *testing.T) {
	resetTPMCounters()
	IncrementTenantTPM(42, 100)
	IncrementTenantTPM(42, 250)

	entry := getTPMEntry(42)
	entry.mu.Lock()
	defer entry.mu.Unlock()
	if entry.tokens != 350 {
		t.Fatalf("expected tokens=350, got %d", entry.tokens)
	}
	if entry.resetAt.Before(time.Now()) {
		t.Fatalf("resetAt should be in the future, got %v", entry.resetAt)
	}
}

func TestIncrementTenantTPM_ZeroOrNegativeIgnored(t *testing.T) {
	resetTPMCounters()
	IncrementTenantTPM(0, 100)   // tenantId 0
	IncrementTenantTPM(-1, 100)  // tenantId negative
	IncrementTenantTPM(42, 0)    // tokens 0
	IncrementTenantTPM(42, -5)   // tokens negative

	count := 0
	tpmCounters.Range(func(_, _ any) bool { count++; return true })
	if count != 0 {
		t.Fatalf("expected no counters created, got %d", count)
	}
}

func TestCheckTenantTPMMemory_UnderLimit(t *testing.T) {
	resetTPMCounters()
	IncrementTenantTPM(42, 500)
	if err := checkTenantTPMMemory(42, 1000); err != nil {
		t.Fatalf("expected nil (under limit), got %v", err)
	}
}

func TestCheckTenantTPMMemory_AtLimit(t *testing.T) {
	resetTPMCounters()
	IncrementTenantTPM(42, 1000)
	err := checkTenantTPMMemory(42, 1000)
	if err == nil {
		t.Fatal("expected error when tokens == limit, got nil")
	}
	if !strings.Contains(err.Error(), "1000") {
		t.Fatalf("error should mention limit 1000, got: %s", err.Error())
	}
}

func TestCheckTenantTPMMemory_OverLimit(t *testing.T) {
	resetTPMCounters()
	IncrementTenantTPM(42, 1500)
	err := checkTenantTPMMemory(42, 1000)
	if err == nil {
		t.Fatal("expected error when tokens > limit, got nil")
	}
}

func TestCheckTenantTPMMemory_WindowExpiry(t *testing.T) {
	resetTPMCounters()
	entry := getTPMEntry(42)
	entry.mu.Lock()
	entry.tokens = 9999
	entry.resetAt = time.Now().Add(-1 * time.Second) // already expired
	entry.mu.Unlock()

	if err := checkTenantTPMMemory(42, 1000); err != nil {
		t.Fatalf("expected nil after window expiry, got %v", err)
	}
}
```

- [ ] **Step 2: 运行测试验证失败或通过**

```bash
"/c/Program Files/Go/bin/go.exe" test ./service/ -run TestIncrementTenantTPM -v
"/c/Program Files/Go/bin/go.exe" test ./service/ -run TestCheckTenantTPM -v
```
期望：全部 PASS（若 Task 2/3 实现正确则这里直接 PASS；本任务主要验证行为回归）。

- [ ] **Step 3: Commit**

```bash
git add service/tenant_quota_test.go
git commit -m "test(multi-tenant): add unit tests for TPM counter + CheckTenantTPM

Covers: accumulation, input validation, at/over limit, window expiry.

Co-Authored-By: Claude Opus 4 (1M context) <noreply@anthropic.com>"
```

---

## Task 5：在 relay 入口接入 CheckTenantTPM

**Files:**
- Modify: `controller/relay.go:280-298`（现有 tenant-level enforcement 块）

- [ ] **Step 1: 插入 TPM 检查**

定位 `controller/relay.go` 中的 tenant-level enforcement 块（查找 `service.CheckTenantRPM(relayInfo.TenantId)`），在 RPM 检查代码块之后、ModelAccess 检查之前插入：
```go
		if err := service.CheckTenantTPM(relayInfo.TenantId); err != nil {
			addTraceEvent(c, "tenant_check", fmt.Sprintf("租户TPM检查失败: %s", err.Error()), nil)
			newAPIError = types.NewErrorWithStatusCode(err, types.ErrorCodeTenantTPMExceeded, http.StatusTooManyRequests, types.ErrOptionWithSkipRetry())
			return
		}
```

插入后完整块形如：
```go
		if err := service.CheckTenantRPM(relayInfo.TenantId); err != nil {
			addTraceEvent(c, "tenant_check", fmt.Sprintf("租户RPM检查失败: %s", err.Error()), nil)
			newAPIError = types.NewErrorWithStatusCode(err, types.ErrorCodeTenantRPMExceeded, http.StatusTooManyRequests, types.ErrOptionWithSkipRetry())
			return
		}
		if err := service.CheckTenantTPM(relayInfo.TenantId); err != nil {
			addTraceEvent(c, "tenant_check", fmt.Sprintf("租户TPM检查失败: %s", err.Error()), nil)
			newAPIError = types.NewErrorWithStatusCode(err, types.ErrorCodeTenantTPMExceeded, http.StatusTooManyRequests, types.ErrOptionWithSkipRetry())
			return
		}
		if err := service.CheckTenantModelAccess(relayInfo.TenantId, relayInfo.OriginModelName); err != nil {
```

- [ ] **Step 2: 编译验证**

```bash
"/c/Program Files/Go/bin/go.exe" build ./controller/... ./service/... ./types/...
```
期望：无错误退出。

- [ ] **Step 3: Commit**

```bash
git add controller/relay.go
git commit -m "feat(multi-tenant): wire CheckTenantTPM into relay pre-check chain

Tenant TPM is now enforced before model access check, returning 429 with
ErrorCodeTenantTPMExceeded when the per-minute token quota is exhausted.

Co-Authored-By: Claude Opus 4 (1M context) <noreply@anthropic.com>"
```

---

## Task 6：在所有成功消费路径接入 IncrementTenantTPM

**Files:**
- Modify: `service/text_quota.go:416` — 文本/聊天路径
- Modify: `service/quota.go:231` — WSS 路径（`PostWssConsumeQuota` 内）
- Modify: `service/quota.go:346` — Audio 路径（`PostAudioConsumeQuota` 内）

**背景**：仓库里有 3 条成功计费路径都调用 `model.RecordConsumeLog` 写消费日志。只接入 text 会导致 WSS/audio 请求消耗 token 却不累计 TPM，让 `CheckTenantTPM` 在这两条路径上形同虚设。必须 3 处同步接入。

- [ ] **Step 1: 定位 3 个 RecordConsumeLog 调用位置**

运行：
```bash
grep -n "model.RecordConsumeLog(ctx, relayInfo.UserId" service/text_quota.go service/quota.go
```
期望：输出 3 个位置：
- `service/text_quota.go` 约 L416
- `service/quota.go` 约 L231（`PostWssConsumeQuota` 内）
- `service/quota.go` 约 L346（`PostAudioConsumeQuota` 内）

记录实际行号。

- [ ] **Step 2: 读上下文确认字段名**

Read 3 个位置各 L-25 到 L+10 行范围。确认每个调用点用于 `PromptTokens` / `CompletionTokens` 参数的实际变量：
- text_quota.go:416 使用 `summary.PromptTokens` + `summary.CompletionTokens`（待实际确认）
- quota.go:231 (WSS) 使用 `usage.InputTokens` + `usage.OutputTokens`（见文件 L233-234）
- quota.go:346 (Audio) 使用 `usage.PromptTokens` + `usage.CompletionTokens`（见文件 L348-349）

如实际字段名与上述不符，以代码为准。

- [ ] **Step 3: 在 text 路径（text_quota.go:416）调用前插入 IncrementTenantTPM**

在 `model.RecordConsumeLog(ctx, relayInfo.UserId, ...)` 调用之前：
```go
	// Tenant TPM counter: accumulate real prompt+completion tokens for this minute.
	IncrementTenantTPM(relayInfo.TenantId, summary.PromptTokens+summary.CompletionTokens)
```
（字段名以 Step 2 确认为准。）

- [ ] **Step 4: 在 WSS 路径（quota.go:231）调用前插入 IncrementTenantTPM**

在 `model.RecordConsumeLog(ctx, relayInfo.UserId, ...)` 调用之前：
```go
	// Tenant TPM counter: WSS path.
	IncrementTenantTPM(relayInfo.TenantId, usage.InputTokens+usage.OutputTokens)
```

- [ ] **Step 5: 在 Audio 路径（quota.go:346）调用前插入 IncrementTenantTPM**

在 `PostAudioConsumeQuota` 末尾 `model.RecordConsumeLog(ctx, relayInfo.UserId, ...)` 调用之前：
```go
	// Tenant TPM counter: Audio path.
	IncrementTenantTPM(relayInfo.TenantId, usage.PromptTokens+usage.CompletionTokens)
```

注意：在 WSS/Audio 路径中，若 `totalTokens == 0`（上游超时，quota 被置 0 的分支），上一段逻辑已走 else 跳过 `UpdateUserUsedQuotaAndRequestCount`。但 `RecordConsumeLog` 仍会被调用记录"可能超时"事件。对 TPM 的正确处理：**仅当真实 token > 0 时才增量**。由于 `IncrementTenantTPM` 内部已有 `if tokens <= 0 { return }` 守卫（见 Task 2），调用点可以直接调用，守卫会正确短路 0-token 的记录。无需额外条件。

- [ ] **Step 6: 编译验证**

```bash
"/c/Program Files/Go/bin/go.exe" build ./service/... ./controller/...
```
期望：无错误退出。

- [ ] **Step 7: Commit**

```bash
git add service/text_quota.go service/quota.go
git commit -m "feat(multi-tenant): increment tenant TPM on all successful billing paths

Covers text (text_quota.go), WSS (PostWssConsumeQuota) and Audio
(PostAudioConsumeQuota) paths. Uses real prompt+completion tokens from
the billing usage, not pre-request estimates. 0-token cases are guarded
inside IncrementTenantTPM.

Co-Authored-By: Claude Opus 4 (1M context) <noreply@anthropic.com>"
```

---

## Task 7：model.CountTenantTokens 辅助函数

**Files:**
- Modify: `model/token.go`（新增函数，建议放在 `CountUserTokens` 附近以便并列）

- [ ] **Step 1: 定位 CountUserTokens 位置**

运行：
```bash
grep -n "func CountUserTokens" model/token.go
```
期望：输出一行号。记录为 N。

- [ ] **Step 2: 在 CountUserTokens 之后追加 CountTenantTokens**

读取 `model/token.go` 行 N 到 N+15 范围作为模板，在 `CountUserTokens` 函数之后插入：
```go
// CountTenantTokens returns the number of non-deleted tokens owned by the tenant.
// Used to enforce TenantPlan.MaxTokens at token-creation time.
func CountTenantTokens(tenantId int) (int64, error) {
	if tenantId <= 0 {
		return 0, fmt.Errorf("invalid tenantId: %d", tenantId)
	}
	var count int64
	err := DB.Model(&Token{}).Where("tenant_id = ?", tenantId).Count(&count).Error
	return count, err
}
```

注意：
- GORM 软删除会自动添加 `deleted_at IS NULL`；无需手写
- `tenant_id = ?` 显式写入 WHERE，不依赖 guardrail callback（Query guardrail 只 warn）
- 若 `model/token.go` 顶部无 `fmt` import 则追加

- [ ] **Step 3: 编译验证**

```bash
"/c/Program Files/Go/bin/go.exe" build ./model/...
```
期望：无错误退出。

- [ ] **Step 4: Commit**

```bash
git add model/token.go
git commit -m "feat(multi-tenant): add CountTenantTokens helper for plan enforcement

Co-Authored-By: Claude Opus 4 (1M context) <noreply@anthropic.com>"
```

---

## Task 8：在 AddToken 中执行 plan MaxTokens 校验（best-effort）

**Files:**
- Modify: `controller/token.go:168-236`（`AddToken` 函数体）

**⚠️ 声明**：此检查是 **best-effort**，不是原子强制。Count → Compare → Insert 三步之间无锁，并发请求可能同时越过上限。依据同 Architecture 段所述：admin-driven 低频操作 + alerts 兜底。代码注释须明确标记。

- [ ] **Step 1: 定位现有 maxTokens 校验块**

运行：
```bash
grep -n "GetMaxUserTokens\|CountUserTokens" controller/token.go
```
期望：两行输出，都在 `AddToken` 内部。

- [ ] **Step 2: 在现有 per-user 校验之后追加 plan 级校验**

在 `AddToken` 中，`if int(count) >= maxTokens { ... return }` 块之后、`key, err := common.GenerateKey()` 之前插入：
```go
	// 租户计划级令牌数量校验（best-effort：Count→Compare→Insert 非原子，
	// 高并发下可能越界 1-N 个。admin 低频操作可接受，token_limit 告警兜底）
	tenantId := middleware.GetTenantId(c)
	plan, err := model.GetTenantPlan(tenantId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if plan.MaxTokens > 0 {
		tenantTokenCount, err := model.CountTenantTokens(tenantId)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		if int(tenantTokenCount) >= plan.MaxTokens {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": fmt.Sprintf("已达到租户计划的令牌数量上限 (%d)", plan.MaxTokens),
			})
			return
		}
	}
```

确认 import：`middleware` + `model` + `fmt` 均已 import（读取文件顶部 import 块确认）。如缺失则追加。

- [ ] **Step 3: 编译验证**

```bash
"/c/Program Files/Go/bin/go.exe" build ./controller/...
```
期望：无错误退出。

- [ ] **Step 4: 合理性核查（手动）**

- [ ] 确认 `tenantId` 取自 `middleware.GetTenantId(c)` 而非其他来源
- [ ] 确认 `model.GetTenantPlan` 在租户无显式 plan 时会返回默认 free plan（已核实，见 `model/tenant_plan.go:54-101`）
- [ ] 确认 `MaxTokens <= 0` 代表不限制（语义与其他字段一致）

- [ ] **Step 5: Commit**

```bash
git add controller/token.go
git commit -m "feat(multi-tenant): enforce TenantPlan.MaxTokens in AddToken

Checks plan MaxTokens (> 0 means enforced) after the global per-user limit.
Returns descriptive message when tenant token count reaches plan cap.

Co-Authored-By: Claude Opus 4 (1M context) <noreply@anthropic.com>"
```

---

## Task 9：model.CountTenantChannels 辅助函数

**Files:**
- Modify: `model/channel.go`（新增函数）

- [ ] **Step 1: 定位一个现有 Channel 查询函数作为放置参考**

运行：
```bash
grep -n "^func.*Channel.*count\|^func Count" model/channel.go
```
记录一个合适插入点的行号。

- [ ] **Step 2: 追加 CountTenantChannels 函数**

在 `model/channel.go` 选定位置插入：
```go
// CountTenantChannels returns the number of channels owned by the tenant.
// Channel uses hard-delete (no DeletedAt column), so this counts all rows
// present in the channels table for this tenant.
// Used to enforce TenantPlan.MaxChannels at channel-creation time.
func CountTenantChannels(tenantId int) (int64, error) {
	if tenantId <= 0 {
		return 0, fmt.Errorf("invalid tenantId: %d", tenantId)
	}
	var count int64
	err := DB.Model(&Channel{}).Where("tenant_id = ?", tenantId).Count(&count).Error
	return count, err
}
```

若 `fmt` 未 import 则追加。

- [ ] **Step 3: 编译验证**

```bash
"/c/Program Files/Go/bin/go.exe" build ./model/...
```
期望：无错误退出。

- [ ] **Step 4: Commit**

```bash
git add model/channel.go
git commit -m "feat(multi-tenant): add CountTenantChannels helper for plan enforcement

Co-Authored-By: Claude Opus 4 (1M context) <noreply@anthropic.com>"
```

---

## Task 10：在 AddChannel 中执行 plan MaxChannels 校验（best-effort，含 batch）

**Files:**
- Modify: `controller/channel.go:567-666`（`AddChannel` 函数体）

**⚠️ 声明**：同 Task 8，这是 best-effort 检查，并发 race 可能越界；admin 低频操作可接受。

**⚠️ 计数正确性**：`controller/channel.go:639-653` 的循环会 `continue` 掉空 key，因此真实插入行数 = `len(channels)`，**不等于** `len(keys)`（split 原始结果）。校验必须放在 `channels` 切片构建完成之后、`BatchInsertChannels` 之前。

- [ ] **Step 1: 读取 AddChannel 关键区间**

Read `controller/channel.go:567-666`。关键锚点：
- L584：`addChannelRequest.Channel.TenantId = middleware.GetTenantId(c)` — 租户已可取
- L587-637：`switch addChannelRequest.Mode` 把 keys 切片填好（single/batch/multi_to_single）
- L639-653：循环构建 `channels := make([]model.Channel, 0, len(keys))`，过滤空 key
- L655：`err = model.BatchInsertChannels(channels)` — 校验必须在此之前
- 确认 import 顶部是否已含 `model`、`middleware`、`fmt`

- [ ] **Step 2: 在 channels 切片构建完、BatchInsertChannels 调用前插入校验**

定位到 `controller/channel.go:653` (`channels = append(channels, *localChannel)`) 之后、L655 (`err = model.BatchInsertChannels(channels)`) 之前，插入以下逻辑：

```go
	// 租户计划级 Channel 数量校验（best-effort：Count→Compare→Insert 非原子，
	// 高并发下可能越界 1-N 个。admin 低频操作可接受，channel_limit 告警兜底）
	// 注意：必须用 len(channels)（清洗后的实际创建数），不是 len(keys)——
	// L641 会跳过空行。
	{
		tenantId := middleware.GetTenantId(c)
		plan, err := model.GetTenantPlan(tenantId)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		if plan.MaxChannels > 0 {
			currentCount, err := model.CountTenantChannels(tenantId)
			if err != nil {
				common.ApiError(c, err)
				return
			}
			incomingCount := int64(len(channels))
			if currentCount+incomingCount > int64(plan.MaxChannels) {
				c.JSON(http.StatusOK, gin.H{
					"success": false,
					"message": fmt.Sprintf("已达到租户计划的渠道数量上限 (当前: %d, 本次: %d, 上限: %d)",
						currentCount, incomingCount, plan.MaxChannels),
				})
				return
			}
		}
	}
```

**关键点**：
- 用 `{}` 包一层局部作用域避免污染外围变量名（原函数里没有 `plan` / `currentCount` 等标识符，但加作用域更稳妥）
- `incomingCount` = `len(channels)` 自动覆盖 single / batch / multi_to_single 三种模式：
  - single：`channels` 含 1 个
  - batch：`channels` 含过滤后的 N 个（空行已跳过）
  - multi_to_single：`keys = []string{addChannelRequest.Channel.Key}` 拼好的单 key，`channels` 含 1 个
- 整批拒绝（不部分创建），因为 `BatchInsertChannels` 在一次调用中整批写入

- [ ] **Step 3: 确认 import 完整**

检查 `controller/channel.go` 顶部 import，确认包含 `github.com/QuantumNous/new-api/middleware`、`github.com/QuantumNous/new-api/model`、`fmt`。缺失则补。

- [ ] **Step 4: 编译验证**

```bash
"/c/Program Files/Go/bin/go.exe" build ./controller/...
```
期望：无错误退出。

- [ ] **Step 5: 合理性核查**

- [ ] 空行 batch 请求不会被误拒（`incomingCount = len(channels)` 自动处理）
- [ ] `MaxChannels <= 0` 不校验（不限制语义，与其他字段一致）
- [ ] 超限时整批拒绝，已有部分 `channels` 不入库（校验在 `BatchInsertChannels` 前）

- [ ] **Step 6: Commit**

```bash
git add controller/channel.go
git commit -m "feat(multi-tenant): enforce TenantPlan.MaxChannels in AddChannel (best-effort)

Placed after channels slice is built (post empty-key filtering) and before
BatchInsertChannels, so incomingCount reflects actual insert count. Covers
single / batch / multi_to_single modes uniformly via len(channels).

Race window is acknowledged best-effort; channel_limit alert is the safety
net.

Co-Authored-By: Claude Opus 4 (1M context) <noreply@anthropic.com>"
```

---

## Task 11：补 `channel_limit` alert（真实对齐 Risk 兜底描述）

**Files:**
- Modify: `service/tenant_alerts.go`（在现有 `token_limit` 分支之后、`return alerts, nil` 之前插入 channel_limit 分支）

**背景**：Plan 的 Risk #4 段把 `channel_limit` alert 说成"已有的兜底"，但代码只实现了 `member_limit` 和 `token_limit`，没有 channel 分支。`service/tenant_metrics.go` 已有 `TotalChannels` 字段（验证见 L16、L62），加 alert 只是照抄 token_limit 的 8 行结构。

- [ ] **Step 1: 定位现有 token_limit 分支**

运行：
```bash
grep -n "token_limit" service/tenant_alerts.go
```
期望：指向 `AlertType: "token_limit"` 所在行（约 L141）及 `if plan.MaxTokens > 0` 开头（约 L138）。

- [ ] **Step 2: 紧邻 token_limit 分支之后追加 channel_limit 分支**

在 `service/tenant_alerts.go` 的 `// Token limit` 分支之后、函数末尾 `return alerts, nil` 之前插入：
```go
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
```

- [ ] **Step 3: 编译验证**

```bash
"/c/Program Files/Go/bin/go.exe" build ./service/...
```
期望：无错误退出。

- [ ] **Step 4: Commit**

```bash
git add service/tenant_alerts.go
git commit -m "feat(multi-tenant): add channel_limit tenant alert

Mirrors token_limit/member_limit: triggers when TotalChannels >= MaxChannels.
Required as the alert-based safety net for best-effort MaxChannels
enforcement in AddChannel.

Co-Authored-By: Claude Opus 4 (1M context) <noreply@anthropic.com>"
```

---

## Task 12：全量构建 + 测试验证

**Files:**（本任务不修改文件，仅验证）

- [ ] **Step 1: 全量后端构建**

```bash
"/c/Program Files/Go/bin/go.exe" build ./model/... ./controller/... ./middleware/... ./service/... ./router/... ./relay/... ./types/...
```
期望：无错误退出。

- [ ] **Step 2: 运行所有单元测试**

```bash
"/c/Program Files/Go/bin/go.exe" test ./service/... -v
"/c/Program Files/Go/bin/go.exe" test ./unit_test/... -v
```
期望：全部 PASS。若现有测试因环境无 DB 而 skip 属预期；TPM 相关测试（Task 4 新增）必须全绿。

- [ ] **Step 3: 写状态文档更新**

修改 `docs/superpowers/plans/2026-04-16-completion-status.md`：

找到 Phase 5 表格（约 line 185-195），更新以下行：
```
| tpm_limit | ✅ | ✅ | CheckTenantTPM() + IncrementTenantTPM()，Redis/内存双模式 |
| max_tokens | ✅ | ✅ | AddToken 内校验 plan.MaxTokens，配 CountTenantTokens |
| max_channels | ✅ | ✅ | AddChannel 内校验（单+批量），配 CountTenantChannels |
```

并将 Phase 5 标题行从 `⚠️ 30%` 更新为 `⚠️ 75%`（账单体系未做，保留 warning）。

对应的"未完成"列表中移除：
- `CheckTenantTPM()` 实现与 Relay 接入
- Token 创建时检查 `max_tokens`、Channel 创建时检查 `max_channels`

Phase 7 段（约 line 221）也需同步：告警类型从 "8 种" 改为 "9 种"，列表末尾追加 `channel_limit`（由本 Plan Task 11 补齐）。

- [ ] **Step 4: 最终 commit**

```bash
git add docs/superpowers/plans/2026-04-16-completion-status.md
git commit -m "docs(multi-tenant): mark Phase 5 tpm/max_tokens/max_channels enforcement complete

Co-Authored-By: Claude Opus 4 (1M context) <noreply@anthropic.com>"
```

---

## 风险与注意事项

1. **TPM 是反应式检查**：突发请求可能一次打爆配额（类似 RPM）。如需硬限，需做 token 预留与回滚机制，超出本计划范围。

2. **⚠️ TPM 与 RPM 语义差异（有意设计，不是 bug）**：
   | 维度 | RPM | TPM |
   |------|-----|-----|
   | 计数时机 | Redis `INCR` 在 pre-check | Redis `GET` pre-check + `INCRBY` 仅在 billing 成功后 |
   | 失败/超时请求 | 计入配额（INCR 已发生） | **不**计入配额（未到 billing 成功点） |
   | 并发 pre-check | INCR 原子、分布式一致 | GET 预检、非严格一致（读后值才增） |
   | 语义 | "尝试次数/分钟" | "实际消耗 token/分钟" |
   - **副作用 1**：同一分钟内大量失败请求时，TPM 实测会低于"请求意图"（因为失败请求不占 TPM 预算）。业务预期是合理的（失败没真实消耗）。
   - **副作用 2**：TPM pre-check 与 INCRBY 之间有窗口，突发并发可能短暂越过 limit。接受此偏差。
   - **不要试图让两者一致** —— 若把 TPM 改成 pre-check 时 `INCRBY 估算值`，还要在失败时回滚，复杂度暴涨且违反 YAGNI。

3. **Redis/内存语义差异**：
   - Redis 路径：分布式准确（多实例共享计数器）
   - 内存路径：每进程独立，多实例部署会放宽 N 倍（N = 实例数）
   - 与 RPM 当前实现同样的取舍，无新增风险

4. **⚠️ max_tokens / max_channels 是 best-effort，不是原子强制**：
   - 实现路径：Count → Compare → Insert，三步无锁
   - 并发创建时多个请求可能读到同一旧计数同时通过，短暂越界 1-N 个
   - 兜底：`service/tenant_alerts.go` 已有 `token_limit`（`metrics.TotalTokens >= plan.MaxTokens`）；`channel_limit` 在 Task 11 中新增（Plan 1 当前缺失）。超限时通过 `/api/tenant/alerts` 触发 warning 级告警
   - 未升级为原子强制的理由：创建 token/channel 是 admin 低频操作，不是高并发路径；原子实现需要分布式锁或条件 INSERT，复杂度与实际风险不成比例
   - 若后续出现真实越界投诉，升级方案：`service/tenant_quota.go` 里加一个 `tenant_creation_locks sync.Map`（每 tenant 一把 mutex），或在 `BatchInsertChannels` 事务里加 `SELECT ... FOR UPDATE` + 条件插入

5. **非 LLM 路径 TPM 不统计**：图像/MJ/任务类请求走 `service/task_billing.go` / `relay/mjproxy_handler.go` 的独立 `RecordConsumeLog` 调用，本 Plan **不覆盖**这两处。理由：图像任务的 token 语义与文本模型不同（如 MJ 完全没有 token 概念，task_billing 的 token 字段是计费单位），强行纳入 TPM 会污染 token-per-minute 的语义。后续若有明确业务需求，单独扩展。

6. **测试覆盖范围**：
   - Task 4 单元测试：纯逻辑（内存计数器 + 私有 `checkTenantTPMMemory`）
   - 未覆盖：公共 `CheckTenantTPM` + `GetTenantPlan` 集成路径（需要 DB）、Redis 路径（需要 Redis）、relay 链路端到端
   - 这些缺口留给 Task 12 runtime smoke，以及项目部署前集成测试补齐

7. **guardrail 警告**：新增的 `CountTenantTokens` / `CountTenantChannels` 显式带 `tenant_id = ?`，不会触发 Query guardrail warn。

---

## 完成后的状态快照

执行完 Task 1-12 后，Phase 5 状态从：

| 限制 | 字段 | 拦截 | 备注 |
|---|---|---|---|
| quota_limit | ✅ | ✅ | |
| rpm_limit | ✅ | ✅ | |
| allowed_models | ✅ | ✅ | |
| tpm_limit | ✅ | ❌ | |
| max_tokens | ✅ | ❌ | |
| max_channels | ✅ | ❌ | |
| max_members | ✅ | ⚠️ | 邀请时 |

变为：

| 限制 | 字段 | 拦截 | 备注 |
|---|---|---|---|
| quota_limit | ✅ | ✅ | |
| rpm_limit | ✅ | ✅ | |
| allowed_models | ✅ | ✅ | |
| **tpm_limit** | ✅ | ✅ | Redis/内存双模式 |
| **max_tokens** | ✅ | ✅ | Token 创建时 |
| **max_channels** | ✅ | ✅ | Channel 创建时（含批量） |
| max_members | ✅ | ⚠️ | 邀请时（未动） |

剩余 Phase 5 未完成项（不在本计划范围，留作 Plan 3 候选）：
- 租户级账单/账本（tenant_bills / tenant_ledgers 表）
- 套餐续费/升级/降级
- 到期停服/宽限期/状态机
- 计划变更与告警联动
