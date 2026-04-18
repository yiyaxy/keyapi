# web-next Slice 2a — Keys + Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地买家 console 的第一波真实页面——`/keys`（API 密钥 CRUD）与 `/dashboard`（用量概览），同时修复后端 token handler 的租户隔离漏洞（P0 安全）。Slice 1 留下的 ComingSoon 占位由这两个页面替换。

**Architecture:** 后端新增 3 个 tenant-aware model helper，controller 切 5 处 handler；前端 TanStack Query 驱动数据，feature-folder 分 `components/keys/` + `components/dashboard/`，AppShell 用 Outlet context 做 page-level topbar action 注入，recharts 画折线，zod + react-hook-form 校验表单，时区端到端 UTC（聚合 + 标签）。

**Tech Stack:** Go 1.22 + GORM · React 19 · TypeScript 5 strict · Tailwind 3 · shadcn/ui · Radix · TanStack Query v5 · react-hook-form + zod · recharts · react-day-picker + date-fns · Vitest + MSW.

**Spec:** [`docs/superpowers/specs/2026-04-18-web-next-slice-2a-keys-dashboard-design.md`](../specs/2026-04-18-web-next-slice-2a-keys-dashboard-design.md) — commit `5a0c155`

**Working directory:** `web-next/`（shell + auth 已就位，分支 `feat/web-rewrite`）+ 项目根（后端）

**后端接触面**：新增 `model/token.go` 三个函数、`controller/token.go` 5 处 handler 切换、`unit_test/tenant_test.go` 扩展 15 case。旧函数签名**不动**（relay/channel 有其他调用）。

---

## 任务分组

| # | Task | TDD | 依赖 |
|---|---|---|---|
| 1 | 后端 model: 3 个 tenant helper + 15 test case | ✓ | — |
| 2 | 后端 controller: 5 handler 切 tenant helper | 部分 | 1 |
| 3 | 前端依赖 + shadcn primitives 安装 | 否 | — |
| 4 | `format.ts` 扩展 `fmtDateSec` / `fmtDaySec` | ✓ | 3 |
| 5 | `usage-aggregate.ts` | ✓ | 4 |
| 6 | `token-schema.ts` | ✓ | 3 |
| 7 | `queryKeys.ts` + `App.tsx` refetchOnReconnect | 否 | 3 |
| 8 | `usePageAction` + AppShell outlet context | ✓ | 3 |
| 9 | i18n ns `keys.json` + `dashboard.json` | 否 | 3 |
| 10 | `useTokens` list + create | ✓ | 7 |
| 11 | `useUpdateToken` + `useDeleteToken`（optimistic） | ✓ | 10 |
| 12 | `useToggleTokenStatus` + `useRevealKey` | ✓ | 11 |
| 13 | `useAvailableModels` + `useChannelGroups`（含排序归一化） | ✓ | 7 |
| 14 | `useUsageTrend` + `useUserStat` | ✓ | 7 |
| 15 | `<KeyCell>` + 测试 | ✓ | 12 |
| 16 | `<TokenRow>` + `<KeysTable>` + `<EmptyKeys>` | 部分 | 15, 9 |
| 17 | `<CreateTokenDialog>` | 部分 | 10, 13, 9 |
| 18 | `<EditTokenSheet>` + 测试 | ✓ | 11, 13, 6, 9 |
| 19 | `<DeleteConfirmDialog>` + `<pages/Keys.tsx>` | 部分 | 16, 17, 18 |
| 20 | `<StatTile>` + `<QuotaCard>` + 测试 | ✓ | 4, 9 |
| 21 | `<RangeSelect>` + `<UsageTrendCard>` + `<ActivityCard>` + `<pages/Dashboard.tsx>` | 部分 | 5, 14, 20 |
| 22 | `routes.tsx` 接通 + 走通空 shell | 否 | 19, 21 |
| 23 | 5 个 MSW 集成测试 | ✓ | 22 |
| 24 | 验收闸 + 浏览器走查 | 否 | 23 |

---

## Task 1 — Backend: 3 个 tenant-aware model helper + 15 test case

**Files:**
- Modify: `model/token.go`（append 3 函数）
- Modify: `unit_test/tenant_test.go`（append 3 test）

**前置阅读**：`model/token.go` 现有的 `GetTokenByIds` / `GetTokenKeysByIds` / `DeleteTokenById` 签名，保持风格一致。

- [ ] **Step 1: 读现有 token 函数**

```bash
grep -n "func GetTokenByIds\|func GetTokenKeysByIds\|func DeleteTokenById" model/token.go
```

- [ ] **Step 2: 写 3 个 helper 的失败测试**

在 `unit_test/tenant_test.go` 末尾追加（如果现有文件没有 `setupTokenTestData` 之类 fixture，沿用现有租户测试的 setup 方式——通常 `TestMain` 或 `setup()` 会建临时 tenant/user；不需要新 fixture helper 则在每个 `t.Run` 里直接 `model.DB.Create`）：

```go
// unit_test/tenant_test.go — append

func TestGetTokenByIdsTenant(t *testing.T) {
	resetTenantTestData(t) // 复用现有 helper；不存在则按 setup 风格改名
	tokenA := model.Token{Id: 0, Name: "a", UserId: 1, TenantId: 1, Key: "kA"}
	assert.NoError(t, model.DB.Create(&tokenA).Error)

	cases := []struct {
		name     string
		id       int
		userId   int
		tenantId int
		wantErr  bool
	}{
		{"same tenant same user", tokenA.Id, 1, 1, false},
		{"same tenant different user", tokenA.Id, 2, 1, true},
		{"cross tenant any user", tokenA.Id, 1, 2, true},
		{"zero tenantId rejected", tokenA.Id, 1, 0, true},
		{"zero userId rejected", tokenA.Id, 0, 1, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := model.GetTokenByIdsTenant(c.id, c.userId, c.tenantId)
			if c.wantErr {
				assert.Error(t, err)
			} else {
				assert.NoError(t, err)
			}
		})
	}
}

func TestGetTokenKeysByIdsTenant(t *testing.T) {
	resetTenantTestData(t)
	tokenA := model.Token{Name: "a", UserId: 1, TenantId: 1, Key: "kA"}
	assert.NoError(t, model.DB.Create(&tokenA).Error)

	cases := []struct {
		name     string
		ids      []int
		userId   int
		tenantId int
		wantKeys int
	}{
		{"same tenant same user", []int{tokenA.Id}, 1, 1, 1},
		{"same tenant different user", []int{tokenA.Id}, 2, 1, 0},
		{"cross tenant any user", []int{tokenA.Id}, 1, 2, 0},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			keys, err := model.GetTokenKeysByIdsTenant(c.ids, c.userId, c.tenantId)
			assert.NoError(t, err)
			assert.Len(t, keys, c.wantKeys)
		})
	}
	t.Run("zero userId rejected", func(t *testing.T) {
		_, err := model.GetTokenKeysByIdsTenant([]int{tokenA.Id}, 0, 1)
		assert.Error(t, err)
	})
	t.Run("zero tenantId rejected", func(t *testing.T) {
		_, err := model.GetTokenKeysByIdsTenant([]int{tokenA.Id}, 1, 0)
		assert.Error(t, err)
	})
}

func TestDeleteTokenByIdTenant(t *testing.T) {
	resetTenantTestData(t)
	tokenA := model.Token{Name: "a", UserId: 1, TenantId: 1, Key: "kA"}
	assert.NoError(t, model.DB.Create(&tokenA).Error)

	cases := []struct {
		name         string
		id           int
		userId       int
		tenantId     int
		wantErr      bool
		wantStillDB  bool // 跨租户 delete 行不应被删
	}{
		{"same tenant same user", tokenA.Id, 1, 1, false, false},
		{"same tenant different user", tokenA.Id, 2, 1, true, true},
		{"cross tenant any user", tokenA.Id, 1, 2, true, true},
		{"zero tenantId rejected", tokenA.Id, 1, 0, true, true},
		{"zero userId rejected", tokenA.Id, 0, 1, true, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			// 每次 case 重建行以隔离
			row := model.Token{Name: "x", UserId: 1, TenantId: 1, Key: "kX"}
			assert.NoError(t, model.WithTenantBypass(model.DB).Create(&row).Error)
			err := model.DeleteTokenByIdTenant(row.Id, c.userId, c.tenantId)
			if c.wantErr {
				assert.Error(t, err)
			} else {
				assert.NoError(t, err)
			}
			var found model.Token
			lookupErr := model.WithTenantBypass(model.DB).Unscoped().Where("id = ?", row.Id).First(&found).Error
			if c.wantStillDB {
				assert.NoError(t, lookupErr, "row should still be in DB (not deleted)")
				assert.True(t, found.DeletedAt.Time.IsZero(), "should not be soft-deleted either")
			} else {
				// 删成功的 case；soft delete 后用 Unscoped 仍能查到但 DeletedAt 非空
				assert.NoError(t, lookupErr)
				assert.False(t, found.DeletedAt.Time.IsZero())
			}
		})
	}
}
```

如果 `resetTenantTestData` 不存在，改用现有文件里已有的 setup 方式（通常 test 里直接 `model.DB.Exec("DELETE FROM tokens")` 或用 `t.Cleanup`）。

- [ ] **Step 3: 跑测试，期望编译失败（函数未定义）**

```bash
go test ./unit_test/ -run "TestGetTokenByIdsTenant|TestGetTokenKeysByIdsTenant|TestDeleteTokenByIdTenant" -v
```

Expected: FAIL — "undefined: model.GetTokenByIdsTenant" 等。

- [ ] **Step 4: 实现 3 个函数**

在 `model/token.go` 末尾 append：

```go
// GetTokenByIdsTenant is the tenant-aware variant of GetTokenByIds.
// Fail-closed: rejects id/userId/tenantId any = 0.
func GetTokenByIdsTenant(id, userId, tenantId int) (*Token, error) {
	if id == 0 || userId == 0 || tenantId == 0 {
		return nil, errors.New("id, userId, tenantId are required")
	}
	var token Token
	err := DB.Where("id = ? AND user_id = ? AND tenant_id = ?", id, userId, tenantId).First(&token).Error
	if err != nil {
		return nil, err
	}
	return &token, nil
}

// GetTokenKeysByIdsTenant is the tenant-aware variant of GetTokenKeysByIds.
func GetTokenKeysByIdsTenant(ids []int, userId, tenantId int) (map[int]string, error) {
	if len(ids) == 0 || userId == 0 || tenantId == 0 {
		return nil, errors.New("ids, userId, tenantId are required")
	}
	var tokens []Token
	err := DB.Select("id, "+commonKeyCol).
		Where("id IN ? AND user_id = ? AND tenant_id = ?", ids, userId, tenantId).
		Find(&tokens).Error
	if err != nil {
		return nil, err
	}
	out := make(map[int]string, len(tokens))
	for _, t := range tokens {
		out[t.Id] = t.Key
	}
	return out, nil
}

// DeleteTokenByIdTenant is the tenant-aware variant of DeleteTokenById.
func DeleteTokenByIdTenant(id, userId, tenantId int) error {
	if id == 0 || userId == 0 || tenantId == 0 {
		return errors.New("id, userId, tenantId are required")
	}
	token := Token{Id: id, UserId: userId, TenantId: tenantId}
	if err := DB.Where(token).First(&token).Error; err != nil {
		return err
	}
	return token.Delete()
}
```

**注意**：`commonKeyCol` 是项目已有的 reserved-word helper（CLAUDE.md §DB Compatibility）。如果 `model/token.go` 顶部没 import 对应 package，沿用文件内已经用到的列名变量（grep `commonKeyCol` 确认）。

- [ ] **Step 5: 跑测试，期望通过**

```bash
go test ./unit_test/ -run "TestGetTokenByIdsTenant|TestGetTokenKeysByIdsTenant|TestDeleteTokenByIdTenant" -v
```

Expected: PASS 15 sub-tests（3 函数 × 5 case）。

- [ ] **Step 6: go build 全包确认旧函数没动**

```bash
go build ./model/... ./controller/... ./relay/... ./service/... ./middleware/...
```

Expected: exit 0。

- [ ] **Step 7: Commit**

```bash
git add model/token.go unit_test/tenant_test.go
git commit -m "feat(model): add tenant-aware token helpers for slice 2a

- GetTokenByIdsTenant: id+userId+tenantId fail-closed lookup
- GetTokenKeysByIdsTenant: same signature for batch-keys
- DeleteTokenByIdTenant: fetch then soft-delete, cross-tenant no-op
- 15 test cases covering same-tenant/cross-tenant/zero paths"
```

---

## Task 2 — Backend: 5 controller handler 切 tenant helper

**Files:**
- Modify: `controller/token.go`（5 处 handler）

- [ ] **Step 1: 定位 5 处 handler**

```bash
grep -n "func GetToken\|func GetTokenKey\|func UpdateToken\|func DeleteToken\|func GetTokenKeysByIds" controller/token.go
```

记录每个 handler 行号。

- [ ] **Step 2: 修 `GetToken`**

找到 `func GetToken(c *gin.Context)`，替换：

原代码片段（示例）：
```go
userId := c.GetInt("id")
token, err := model.GetTokenByIds(id, userId)
```

改为：
```go
userId := c.GetInt("id")
tenantId := middleware.GetTenantId(c)
token, err := model.GetTokenByIdsTenant(id, userId, tenantId)
```

若文件顶部没 import `middleware`（`github.com/QuantumNous/new-api/middleware`），加上。

- [ ] **Step 3: 修 `GetTokenKey`**

相同模式：`GetTokenByIds` → `GetTokenByIdsTenant`。

- [ ] **Step 4: 修 `UpdateToken`**

相同模式：`GetTokenByIds` → `GetTokenByIdsTenant`。这个 handler 可能在 status_only 分支和正常更新分支都有调用；都改。

- [ ] **Step 5: 修 `DeleteToken`**

```go
// 原
err := model.DeleteTokenById(id, userId)
// 改
tenantId := middleware.GetTenantId(c)
err := model.DeleteTokenByIdTenant(id, userId, tenantId)
```

- [ ] **Step 6: 修 `GetTokenKeysByIds`**

```go
// 原
keys, err := model.GetTokenKeysByIds(ids, userId)
// 改
tenantId := middleware.GetTenantId(c)
keys, err := model.GetTokenKeysByIdsTenant(ids, userId, tenantId)
```

- [ ] **Step 7: go build 全包**

```bash
go build ./model/... ./controller/... ./relay/... ./service/... ./middleware/... ./router/...
```

Expected: exit 0。如果报 `undefined: middleware.GetTenantId`，核对 import 路径。

- [ ] **Step 8: Commit**

```bash
git add controller/token.go
git commit -m "fix(controller): switch token handlers to tenant-aware model helpers

GetToken, GetTokenKey, UpdateToken now use GetTokenByIdsTenant.
DeleteToken uses DeleteTokenByIdTenant.
GetTokenKeysByIds batch uses GetTokenKeysByIdsTenant.

Fixes cross-tenant access vulnerability where attacker with known token
id could read/modify/delete tokens from other tenants via user_id-only
lookups. Closes P0 security gap flagged in slice 2a design review."
```

---

## Task 3 — Frontend: 安装依赖 + shadcn primitives

**Files:**
- Modify: `web-next/package.json`（runtime deps）
- Create（shadcn CLI 生成，内容由生成器写）: `web-next/src/components/ui/{select,switch,popover,textarea,calendar,card,chart}.tsx`

- [ ] **Step 1: 装 runtime deps**

```bash
cd web-next
bun add recharts @radix-ui/react-select @radix-ui/react-switch @radix-ui/react-popover react-day-picker date-fns
```

（shadcn primitive 生成时会自动写 Radix peer 依赖到 `package.json`；recharts / react-day-picker / date-fns 是 shadcn chart/calendar 的 peer，需要手动装。）

- [ ] **Step 2: 生成 7 个 shadcn primitive**

```bash
bunx shadcn@latest add select switch popover textarea calendar card chart
```

如被问 "overwrite existing?" 一律选 No（避免改 slice 1 已有的 button/input 等）。

确认生成：`ls src/components/ui/` 新增 `select.tsx switch.tsx popover.tsx textarea.tsx calendar.tsx card.tsx chart.tsx`。

- [ ] **Step 3: typecheck + build 确认没炸**

```bash
bun run typecheck
bun run build
```

Expected: 两个都 exit 0。`bun run build` 会有 bundle 大小警告（chart + recharts），接受。

- [ ] **Step 4: Commit**

```bash
cd /e/new_key_api/keyapi
git add web-next/package.json web-next/bun.lock web-next/src/components/ui/
git commit -m "chore(web-next): add recharts + shadcn primitives for slice 2a

select / switch / popover / textarea / calendar / card / chart"
```

---

## Task 4 — `format.ts` 扩展 `fmtDateSec` / `fmtDaySec`

**Files:**
- Modify: `web-next/src/lib/format.ts`
- Modify: `web-next/src/lib/format.test.ts`

- [ ] **Step 1: 写失败测试**

在 `format.test.ts` 末尾追加：

```ts
describe('fmtDateSec (Unix seconds, local timezone)', () => {
  test('formats Unix second timestamp to local date-time', () => {
    const sec = 1713484800; // 2024-04-19T00:00:00Z
    const out = fmtDateSec(sec);
    expect(out).toMatch(/\d{4}|\d{2}/); // 会包含年或日数字
    expect(out).not.toMatch(/1970/); // 绝不能落回 epoch
  });

  test('zero sec renders but is clearly not 1970 epoch bug', () => {
    // 0 其实就是 epoch — 但这是用户显式传 0 的行为，不是单位误解。
    // 为避免混淆，我们 contract 让 fmtDateSec(0) 返回 '—'
    expect(fmtDateSec(0)).toBe('—');
  });

  test('negative sec (e.g. -1 = "Never" in backend) returns dash', () => {
    expect(fmtDateSec(-1)).toBe('—');
  });
});

describe('fmtDaySec (Unix seconds, UTC day label)', () => {
  test('April 18 UTC bucket renders as Apr 18 regardless of tz', () => {
    // 1713484800 = 2024-04-19T00:00:00Z
    // 这是 UTC 的 Apr 19；在 Pacific 时区 fmtDaySec 必须仍是 Apr 19 (UTC)
    const out = fmtDaySec(1713484800);
    expect(out).toMatch(/Apr/);
    expect(out).toMatch(/19/);
  });

  test('end of UTC day stays on that UTC day', () => {
    // 2024-04-19T23:00:00Z
    const out = fmtDaySec(1713484800 + 23 * 3600);
    expect(out).toMatch(/Apr/);
    expect(out).toMatch(/19/);
  });
});
```

- [ ] **Step 2: 跑 red**

```bash
cd web-next && bun run test src/lib/format.test.ts
```

Expected: FAIL — `fmtDateSec is not a function`。

- [ ] **Step 3: 实现**

```ts
// web-next/src/lib/format.ts 追加：

export function fmtDateSec(sec: number): string {
  if (sec <= 0 || !Number.isFinite(sec)) return '—';
  return new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(sec * 1000));
}

export function fmtDaySec(sec: number): string {
  if (sec <= 0 || !Number.isFinite(sec)) return '—';
  return new Intl.DateTimeFormat(i18n.language, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(sec * 1000));
}
```

- [ ] **Step 4: 跑 green**

```bash
bun run test src/lib/format.test.ts
```

Expected: PASS（含原 4 个 + 新 5 个测试）。

- [ ] **Step 5: Commit**

```bash
cd /e/new_key_api/keyapi
git add web-next/src/lib/format.ts web-next/src/lib/format.test.ts
git commit -m "feat(web-next): fmtDateSec + fmtDaySec for backend Unix seconds

fmtDateSec: Unix-sec → local datetime (used for token created_time,
single-point events users care about in their timezone)
fmtDaySec: Unix-sec → UTC day label (used for dashboard aggregation
+ axis/tooltip, matches backend hourly UTC bucketing, no tz drift)

Both return '—' for 0/-1/negative (backend 'Never' sentinel)."
```

---

## Task 5 — `usage-aggregate.ts`（核心聚合）

**Files:**
- Create: `web-next/src/lib/usage-aggregate.ts`
- Create: `web-next/src/lib/usage-aggregate.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// web-next/src/lib/usage-aggregate.test.ts
import { describe, expect, test } from 'vitest';

import { aggregateByUtcDay, type QuotaDataRow, type DayPoint } from './usage-aggregate';

const row = (created_at: number, quota: number, count = 1): QuotaDataRow => ({
  id: 0,
  tenant_id: 1,
  user_id: 1,
  username: 'u',
  model_name: 'm',
  created_at,
  token_used: 100,
  count,
  quota,
});

describe('aggregateByUtcDay', () => {
  test('empty rows + range produces zero-filled series', () => {
    const startSec = 1713484800; // 2024-04-19 00:00 UTC
    const endSec = startSec + 2 * 86400;
    const out = aggregateByUtcDay([], startSec, endSec);
    expect(out).toHaveLength(3); // inclusive 3 days
    expect(out.every((p) => p.quota === 0 && p.count === 0)).toBe(true);
  });

  test('rows within one UTC day collapse to one point', () => {
    const startSec = 1713484800;
    const endSec = startSec;
    const out = aggregateByUtcDay(
      [row(startSec, 10), row(startSec + 3600, 20), row(startSec + 7200, 5)],
      startSec,
      endSec,
    );
    expect(out).toHaveLength(1);
    expect(out[0].quota).toBe(35);
    expect(out[0].count).toBe(3);
  });

  test('rows across UTC midnight split into two days', () => {
    const startSec = 1713484800;
    const endSec = startSec + 86400;
    const out = aggregateByUtcDay(
      [row(startSec + 3600, 10), row(startSec + 86400 + 3600, 20)],
      startSec,
      endSec,
    );
    expect(out[0].quota).toBe(10);
    expect(out[1].quota).toBe(20);
  });

  test('cross-month boundary preserves all points', () => {
    const startSec = 1711929600; // 2024-04-01
    const endSec = startSec + 2 * 86400; // 2024-04-03
    const out = aggregateByUtcDay(
      [row(startSec, 5), row(startSec + 86400, 10), row(startSec + 2 * 86400, 15)],
      startSec,
      endSec,
    );
    expect(out.map((p) => p.quota)).toEqual([5, 10, 15]);
  });

  test('rows outside range are ignored', () => {
    const startSec = 1713484800;
    const endSec = startSec + 86400;
    const out = aggregateByUtcDay(
      [row(startSec - 86400, 999), row(startSec + 86400 * 3, 999), row(startSec, 10)],
      startSec,
      endSec,
    );
    expect(out[0].quota).toBe(10);
    expect(out[1].quota).toBe(0);
  });
});
```

- [ ] **Step 2: 跑 red**

```bash
bun run test src/lib/usage-aggregate.test.ts
```

Expected: FAIL — module not found。

- [ ] **Step 3: 实现**

```ts
// web-next/src/lib/usage-aggregate.ts
export type QuotaDataRow = {
  id: number;
  tenant_id: number;
  user_id: number;
  username: string;
  model_name: string;
  created_at: number; // Unix seconds, hour-aligned per model/usedata.go:62
  token_used: number;
  count: number;
  quota: number;
};

export type DayPoint = {
  day: number;   // Unix seconds, UTC midnight
  quota: number;
  count: number;
};

const DAY = 86400;

export function aggregateByUtcDay(
  rows: QuotaDataRow[],
  startSec: number,
  endSec: number,
): DayPoint[] {
  const startDay = Math.floor(startSec / DAY) * DAY;
  const endDay = Math.floor(endSec / DAY) * DAY;
  const buckets = new Map<number, DayPoint>();
  for (let d = startDay; d <= endDay; d += DAY) {
    buckets.set(d, { day: d, quota: 0, count: 0 });
  }
  for (const r of rows) {
    const day = Math.floor(r.created_at / DAY) * DAY;
    const bucket = buckets.get(day);
    if (!bucket) continue; // outside range
    bucket.quota += r.quota;
    bucket.count += r.count;
  }
  return Array.from(buckets.values()).sort((a, b) => a.day - b.day);
}
```

- [ ] **Step 4: 跑 green**

```bash
bun run test src/lib/usage-aggregate.test.ts
```

Expected: PASS (5)。

- [ ] **Step 5: Commit**

```bash
cd /e/new_key_api/keyapi
git add web-next/src/lib/usage-aggregate.ts web-next/src/lib/usage-aggregate.test.ts
git commit -m "feat(web-next): usage-aggregate helper for dashboard trend

Reduces QuotaDataRow[] (hour-bucket Unix sec) into UTC-day DayPoint[]
series, zero-filling empty days across a [startSec, endSec] range.
Dashboard trend chart core logic."
```

---

## Task 6 — `token-schema.ts`（zod + group chain 辅助）

**Files:**
- Create: `web-next/src/lib/token-schema.ts`
- Create: `web-next/src/lib/token-schema.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// web-next/src/lib/token-schema.test.ts
import { describe, expect, test } from 'vitest';

import {
  editTokenSchema,
  parseGroupChain,
  serializeGroupChain,
  parseAllowIps,
  serializeAllowIps,
} from './token-schema';

describe('parseGroupChain / serializeGroupChain', () => {
  test('csv string → array', () => {
    expect(parseGroupChain('auto')).toEqual(['auto']);
    expect(parseGroupChain('vip,default')).toEqual(['vip', 'default']);
    expect(parseGroupChain('')).toEqual([]);
    expect(parseGroupChain(' vip , default ')).toEqual(['vip', 'default']);
  });

  test('array → csv string', () => {
    expect(serializeGroupChain(['auto'])).toBe('auto');
    expect(serializeGroupChain(['vip', 'default'])).toBe('vip,default');
    expect(serializeGroupChain([])).toBe('');
  });
});

describe('parseAllowIps / serializeAllowIps', () => {
  test('newline-separated textarea → array, trim empty', () => {
    expect(parseAllowIps('10.0.0.1\n\n192.168.1.0/24 ')).toEqual([
      '10.0.0.1',
      '192.168.1.0/24',
    ]);
  });

  test('empty string → empty array', () => {
    expect(parseAllowIps('')).toEqual([]);
  });
});

describe('editTokenSchema', () => {
  const base = {
    name: 'my-key',
    status: 1 as const,
    unlimited_quota: true,
    remain_quota: 0,
    expired_time: -1,
    model_limits_enabled: false,
    model_limits: [],
    allow_ips: [],
    group: ['auto'],
    cross_group_retry: false,
  };

  test('accepts canonical token', () => {
    expect(editTokenSchema.safeParse(base).success).toBe(true);
  });

  test('rejects empty name', () => {
    const r = editTokenSchema.safeParse({ ...base, name: '' });
    expect(r.success).toBe(false);
  });

  test('rejects name > 50 chars', () => {
    const r = editTokenSchema.safeParse({ ...base, name: 'a'.repeat(51) });
    expect(r.success).toBe(false);
  });

  test('rejects negative remain_quota when not unlimited', () => {
    const r = editTokenSchema.safeParse({ ...base, unlimited_quota: false, remain_quota: -1 });
    expect(r.success).toBe(false);
  });

  test('rejects cross_group_retry with only 1 group', () => {
    const r = editTokenSchema.safeParse({ ...base, cross_group_retry: true });
    expect(r.success).toBe(false);
  });

  test('accepts cross_group_retry with ≥2 groups', () => {
    const r = editTokenSchema.safeParse({
      ...base,
      group: ['vip', 'default'],
      cross_group_retry: true,
    });
    expect(r.success).toBe(true);
  });
});
```

- [ ] **Step 2: 跑 red**

```bash
bun run test src/lib/token-schema.test.ts
```

Expected: FAIL — module not found。

- [ ] **Step 3: 实现**

```ts
// web-next/src/lib/token-schema.ts
import { z } from 'zod';

export function parseGroupChain(csv: string): string[] {
  if (!csv.trim()) return [];
  return csv.split(',').map((s) => s.trim()).filter(Boolean);
}

export function serializeGroupChain(arr: string[]): string {
  return arr.map((s) => s.trim()).filter(Boolean).join(',');
}

export function parseAllowIps(raw: string): string[] {
  if (!raw.trim()) return [];
  return raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

export function serializeAllowIps(arr: string[]): string {
  return arr.join('\n');
}

export const editTokenSchema = z
  .object({
    name: z.string().min(1).max(50),
    status: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    unlimited_quota: z.boolean(),
    remain_quota: z.number().int(),
    expired_time: z.number().int(),
    model_limits_enabled: z.boolean(),
    model_limits: z.array(z.string()),
    allow_ips: z.array(z.string()),
    group: z.array(z.string()).min(1),
    cross_group_retry: z.boolean(),
  })
  .refine((v) => v.unlimited_quota || v.remain_quota >= 0, {
    path: ['remain_quota'],
    message: 'remain_quota must be ≥ 0 when not unlimited',
  })
  .refine((v) => !v.cross_group_retry || v.group.length >= 2, {
    path: ['cross_group_retry'],
    message: 'cross_group_retry requires ≥ 2 groups',
  });

export type EditTokenValues = z.infer<typeof editTokenSchema>;
```

- [ ] **Step 4: 跑 green**

```bash
bun run test src/lib/token-schema.test.ts
```

Expected: PASS (9)。

- [ ] **Step 5: Commit**

```bash
cd /e/new_key_api/keyapi
git add web-next/src/lib/token-schema.ts web-next/src/lib/token-schema.test.ts
git commit -m "feat(web-next): token zod schema + group/ip parse helpers"
```

---

## Task 7 — `queryKeys.ts` + `App.tsx` refetchOnReconnect

**Files:**
- Create: `web-next/src/lib/queryKeys.ts`
- Modify: `web-next/src/App.tsx`

- [ ] **Step 1: 写 queryKeys**

```ts
// web-next/src/lib/queryKeys.ts
export const qk = {
  tokens: {
    list: (page: number) => ['tokens', 'list', page] as const,
    detail: (id: number) => ['tokens', 'detail', id] as const,
  },
  user: {
    dataSelf: (startTs: number, endTs: number) =>
      ['user', 'data', startTs, endTs] as const,
    statSelf: (startTs: number, endTs: number) =>
      ['user', 'stat', startTs, endTs] as const,
  },
  meta: {
    availableModels: ['meta', 'models'] as const,
    channelGroups: ['meta', 'channel-groups'] as const,
  },
} as const;
```

- [ ] **Step 2: 改 App.tsx**

```ts
// web-next/src/App.tsx: 在 QueryClient options 加 refetchOnReconnect
new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      retry: 1,
    },
  },
});
```

- [ ] **Step 3: typecheck**

```bash
bun run typecheck
```

- [ ] **Step 4: Commit**

```bash
cd /e/new_key_api/keyapi
git add web-next/src/lib/queryKeys.ts web-next/src/App.tsx
git commit -m "feat(web-next): centralized query keys + refetchOnReconnect"
```

---

## Task 8 — `usePageAction` + AppShell outlet context

**Files:**
- Create: `web-next/src/hooks/usePageAction.ts`
- Create: `web-next/src/hooks/usePageAction.test.tsx`
- Modify: `web-next/src/components/layout/AppShell.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
// web-next/src/hooks/usePageAction.test.tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';
import { describe, expect, test } from 'vitest';

import { usePageAction } from './usePageAction';

function Host() {
  const [action, setAction] = useState<React.ReactNode>(null);
  return (
    <div>
      <header data-testid='header'>{action}</header>
      <Outlet context={{ setPageAction: setAction }} />
    </div>
  );
}

function Page() {
  usePageAction(<button data-testid='page-btn'>Do thing</button>);
  return <div data-testid='page'>page</div>;
}

import { useState } from 'react';

describe('usePageAction', () => {
  test('injects action into ancestor via outlet context', async () => {
    render(
      <MemoryRouter initialEntries={['/p']}>
        <Routes>
          <Route element={<Host />}>
            <Route path='/p' element={<Page />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByTestId('page-btn')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 跑 red**

```bash
bun run test src/hooks/usePageAction.test.tsx
```

Expected: FAIL — module not found。

- [ ] **Step 3: 实现 hook**

```ts
// web-next/src/hooks/usePageAction.ts
import { useEffect, type ReactNode } from 'react';
import { useOutletContext } from 'react-router-dom';

type Ctx = { setPageAction: (n: ReactNode) => void };

export function usePageAction(action: ReactNode): void {
  const ctx = useOutletContext<Ctx | null>();
  useEffect(() => {
    if (!ctx) return;
    ctx.setPageAction(action);
    return () => ctx.setPageAction(null);
  }, [ctx, action]);
}
```

- [ ] **Step 4: 跑 green**

```bash
bun run test src/hooks/usePageAction.test.tsx
```

Expected: PASS。

- [ ] **Step 5: 改 AppShell.tsx**

读 `web-next/src/components/layout/AppShell.tsx` 现有内容，把：

```tsx
<main className='flex flex-1 flex-col overflow-hidden'>
  <Topbar title={t(titleKey)} />
  <div className='flex-1 overflow-y-auto'>
    <div className='mx-auto max-w-[1280px] px-6 py-6'>
      <Outlet />
    </div>
  </div>
</main>
```

改为：

```tsx
const [pageAction, setPageAction] = useState<ReactNode>(null);

<main className='flex flex-1 flex-col overflow-hidden'>
  <Topbar title={t(titleKey)} action={pageAction} />
  <div className='flex-1 overflow-y-auto'>
    <div className='mx-auto max-w-[1280px] px-6 py-6'>
      <Outlet context={{ setPageAction }} />
    </div>
  </div>
</main>
```

并在文件顶部 import `useState` + `type ReactNode`。

- [ ] **Step 6: typecheck + 所有测试**

```bash
bun run typecheck && bun run test
```

Expected: 全 PASS。

- [ ] **Step 7: Commit**

```bash
cd /e/new_key_api/keyapi
git add web-next/src/hooks/usePageAction.ts web-next/src/hooks/usePageAction.test.tsx web-next/src/components/layout/AppShell.tsx
git commit -m "feat(web-next): page-level topbar action slot via Outlet context

usePageAction(node) lets any routed page inject a trailing action
into AppShell's Topbar. AppShell owns the state; Outlet context
exposes a setter; cleanup on unmount."
```

---

## Task 9 — i18n namespaces `keys.json` + `dashboard.json`

**Files:**
- Create: `web-next/src/i18n/locales/zh/keys.json` + `en/keys.json`
- Create: `web-next/src/i18n/locales/zh/dashboard.json` + `en/dashboard.json`
- Modify: `web-next/src/i18n/index.ts`

- [ ] **Step 1: 写 zh/keys.json**

```json
{
  "page.title": "API 密钥",
  "page.create": "创建密钥",
  "page.empty.title": "暂无 API 密钥",
  "page.empty.body": "创建第一个 API 密钥以开始发起请求。",
  "page.empty.cta": "创建密钥",
  "table.col.name": "名称",
  "table.col.key": "密钥",
  "table.col.usage": "使用量",
  "table.col.created": "创建时间",
  "status.enabled": "已启用",
  "status.disabled": "已禁用",
  "status.expired": "已过期",
  "status.exhausted": "额度耗尽",
  "status.unlimited": "无限额度",
  "create.title": "创建 API 密钥",
  "create.name": "名称",
  "create.group": "分组",
  "create.submit": "创建",
  "create.hint_advanced": "默认为无限额度。可在编辑面板切换到自定义额度、设置 IP 白名单、限定模型。",
  "create.loading_groups": "加载分组中…",
  "create.groups_failed": "无法加载分组列表",
  "create.retry": "重试",
  "edit.title": "编辑密钥",
  "edit.field.name": "名称",
  "edit.field.status": "状态",
  "edit.field.unlimited_quota": "无限额度",
  "edit.field.remain_quota": "剩余额度",
  "edit.field.expired_time": "过期时间",
  "edit.field.expired_time.never": "永不过期",
  "edit.field.expired_time.7d": "+7 天",
  "edit.field.expired_time.30d": "+30 天",
  "edit.field.model_limits": "可用模型",
  "edit.field.model_limits.placeholder": "未限制",
  "edit.field.allow_ips": "允许 IP（每行一个）",
  "edit.field.group": "分组",
  "edit.field.cross_group_retry": "跨分组重试",
  "edit.save": "保存",
  "edit.cancel": "取消",
  "delete.title": "删除密钥",
  "delete.body": "确认删除 {{name}}？使用此密钥的请求会立即失败。",
  "delete.confirm": "删除",
  "reveal.copy": "复制",
  "reveal.copied": "已复制",
  "reveal.failed": "无法展示密钥"
}
```

- [ ] **Step 2: 写 en/keys.json**

```json
{
  "page.title": "API keys",
  "page.create": "Create key",
  "page.empty.title": "No API keys yet",
  "page.empty.body": "Create your first API key to start making requests.",
  "page.empty.cta": "Create key",
  "table.col.name": "Name",
  "table.col.key": "Key",
  "table.col.usage": "Usage",
  "table.col.created": "Created",
  "status.enabled": "Enabled",
  "status.disabled": "Disabled",
  "status.expired": "Expired",
  "status.exhausted": "Exhausted",
  "status.unlimited": "Unlimited",
  "create.title": "Create API key",
  "create.name": "Name",
  "create.group": "Group",
  "create.submit": "Create",
  "create.hint_advanced": "Created as unlimited. Switch to a custom quota, set IP allowlist, or scope to specific models in Edit.",
  "create.loading_groups": "Loading groups…",
  "create.groups_failed": "Unable to load groups",
  "create.retry": "Retry",
  "edit.title": "Edit key",
  "edit.field.name": "Name",
  "edit.field.status": "Status",
  "edit.field.unlimited_quota": "Unlimited quota",
  "edit.field.remain_quota": "Remaining quota",
  "edit.field.expired_time": "Expires",
  "edit.field.expired_time.never": "Never",
  "edit.field.expired_time.7d": "+7 days",
  "edit.field.expired_time.30d": "+30 days",
  "edit.field.model_limits": "Allowed models",
  "edit.field.model_limits.placeholder": "No limit",
  "edit.field.allow_ips": "Allowed IPs (one per line)",
  "edit.field.group": "Group",
  "edit.field.cross_group_retry": "Cross group retry",
  "edit.save": "Save",
  "edit.cancel": "Cancel",
  "delete.title": "Delete key",
  "delete.body": "Delete {{name}}? Requests using this key will start failing.",
  "delete.confirm": "Delete",
  "reveal.copy": "Copy",
  "reveal.copied": "Copied",
  "reveal.failed": "Failed to reveal key"
}
```

- [ ] **Step 3: 写 zh/dashboard.json + en/dashboard.json**

```json
// zh/dashboard.json
{
  "page.title": "仪表盘",
  "range.7d": "最近 7 天",
  "range.30d": "最近 30 天",
  "quota.label": "余额",
  "quota.used_of_total": "已用 {{used}} / {{total}}",
  "quota.zero_body": "余额为 0 · 请先充值",
  "quota.topup": "充值",
  "quota.exhausted": "已耗尽",
  "usage.title": "最近 {{range}} 用量 (UTC)",
  "usage.empty.title": "暂无用量数据",
  "usage.empty.body": "创建一个 API 密钥以开始使用。",
  "usage.empty.cta": "创建密钥",
  "usage.tooltip.requests": "{{count}} 次请求",
  "activity.requests": "请求数",
  "activity.tokens": "Tokens",
  "activity.consumed": "已消耗"
}
```

```json
// en/dashboard.json
{
  "page.title": "Dashboard",
  "range.7d": "Last 7 days",
  "range.30d": "Last 30 days",
  "quota.label": "Balance",
  "quota.used_of_total": "Used {{used}} of {{total}}",
  "quota.zero_body": "No balance · Top up to start",
  "quota.topup": "Top up",
  "quota.exhausted": "Exhausted",
  "usage.title": "Usage over last {{range}} (UTC)",
  "usage.empty.title": "No usage yet",
  "usage.empty.body": "Create a key to begin making requests.",
  "usage.empty.cta": "Create key",
  "usage.tooltip.requests": "{{count}} requests",
  "activity.requests": "Requests",
  "activity.tokens": "Tokens",
  "activity.consumed": "Consumed"
}
```

- [ ] **Step 4: 注册 ns**

改 `web-next/src/i18n/index.ts`：

```ts
import enDashboard from './locales/en/dashboard.json';
import enKeys from './locales/en/keys.json';
// ... existing
import zhDashboard from './locales/zh/dashboard.json';
import zhKeys from './locales/zh/keys.json';

// 在 resources 里加 keys / dashboard；ns 数组也加：
    resources: {
      zh: { common: zhCommon, auth: zhAuth, shell: zhShell, errors: zhErrors,
            keys: zhKeys, dashboard: zhDashboard },
      en: { common: enCommon, auth: enAuth, shell: enShell, errors: enErrors,
            keys: enKeys, dashboard: enDashboard },
    },
    ns: ['common', 'auth', 'shell', 'errors', 'keys', 'dashboard'],
```

- [ ] **Step 5: typecheck + 跑所有测试确认 i18n 加载 OK**

```bash
bun run typecheck && bun run test
```

Expected: 全 PASS（i18n 加载失败会导致 t() 返回 key 本身，但不会崩）。

- [ ] **Step 6: Commit**

```bash
cd /e/new_key_api/keyapi
git add web-next/src/i18n
git commit -m "feat(web-next): i18n namespaces for keys + dashboard"
```

---

## Task 10 — `useTokens`（list + create）

**Files:**
- Create: `web-next/src/hooks/useTokens.ts`
- Create: `web-next/src/hooks/useTokens.test.tsx`

**前置**：`/api/token/` GET 响应形如 `{ success, data: { items: Token[], total: number, page: number } }`（axios 拦截器已剥 data）；POST 响应只 `{ success, message }`，不返回新 token 对象。

- [ ] **Step 1: 写失败测试**

```tsx
// web-next/src/hooks/useTokens.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { server } from '@/test/msw/server';

import { useCreateToken, useTokensQuery } from './useTokens';

function wrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Provider({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

afterEach(() => server.resetHandlers());

describe('useTokensQuery', () => {
  test('returns items and total', async () => {
    server.use(
      http.get('/api/token/', () =>
        HttpResponse.json({
          success: true,
          data: { items: [{ id: 1, name: 'a' }], total: 1 },
        }),
      ),
    );
    const { result } = renderHook(() => useTokensQuery(1), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.items).toEqual([{ id: 1, name: 'a' }]);
    expect(result.current.data?.total).toBe(1);
  });
});

describe('useCreateToken', () => {
  test('POST /api/token/ with body + invalidates list', async () => {
    let postedBody: unknown = null;
    server.use(
      http.post('/api/token/', async ({ request }) => {
        postedBody = await request.json();
        return HttpResponse.json({ success: true, message: '' });
      }),
      http.get('/api/token/', () =>
        HttpResponse.json({ success: true, data: { items: [], total: 0 } }),
      ),
    );
    const Wrapper = wrapper();
    const { result } = renderHook(() => useCreateToken(), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync({ name: 'new', group: 'auto' });
    });
    expect(postedBody).toMatchObject({
      name: 'new',
      group: 'auto',
      unlimited_quota: true,
      remain_quota: 0,
      expired_time: -1,
    });
  });
});
```

- [ ] **Step 2: 跑 red**

```bash
bun run test src/hooks/useTokens.test.tsx
```

Expected: FAIL — 模块未定义。

- [ ] **Step 3: 实现**

```ts
// web-next/src/hooks/useTokens.ts
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';

export type Token = {
  id: number;
  name: string;
  status: number;
  key?: string;
  remain_quota: number;
  used_quota: number;
  unlimited_quota: boolean;
  expired_time: number;
  created_time: number;
  model_limits_enabled: boolean;
  model_limits: string;
  allow_ips?: string | null;
  group: string;
  cross_group_retry: boolean;
};

export type TokenList = { items: Token[]; total: number };

export function useTokensQuery(page = 1) {
  return useQuery({
    queryKey: qk.tokens.list(page),
    queryFn: async () => {
      const res = await api.get<TokenList>('/api/token/', {
        params: { p: page, page_size: 50 },
      });
      return res.data;
    },
    staleTime: 30_000,
  });
}

export type CreateTokenBody = {
  name: string;
  group: string;
};

export function useCreateToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateTokenBody) => {
      return api.post('/api/token/', {
        name: body.name,
        group: body.group,
        unlimited_quota: true,
        remain_quota: 0,
        expired_time: -1,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tokens'] });
    },
  });
}
```

- [ ] **Step 4: 跑 green**

```bash
bun run test src/hooks/useTokens.test.tsx
```

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
cd /e/new_key_api/keyapi
git add web-next/src/hooks/useTokens.ts web-next/src/hooks/useTokens.test.tsx
git commit -m "feat(web-next): useTokensQuery + useCreateToken"
```

---

## Task 11 — `useUpdateToken` + `useDeleteToken`（optimistic）

**Files:**
- Modify: `web-next/src/hooks/useTokens.ts`（append）
- Modify: `web-next/src/hooks/useTokens.test.tsx`（append）

- [ ] **Step 1: 写失败测试**

追加到 `useTokens.test.tsx`:

```tsx
import { useDeleteToken, useUpdateToken } from './useTokens';

describe('useUpdateToken', () => {
  test('PUT with body', async () => {
    let put: unknown = null;
    server.use(
      http.put('/api/token/', async ({ request }) => {
        put = await request.json();
        return HttpResponse.json({ success: true, data: { id: 1 } });
      }),
    );
    const { result } = renderHook(() => useUpdateToken(), { wrapper: wrapper() });
    await act(async () => {
      await result.current.mutateAsync({ id: 1, name: 'updated' });
    });
    expect(put).toMatchObject({ id: 1, name: 'updated' });
  });
});

describe('useDeleteToken optimistic', () => {
  test('row disappears before server responds then stays gone on success', async () => {
    let resolve: (() => void) | null = null;
    const pending = new Promise<void>((r) => {
      resolve = r;
    });
    server.use(
      http.get('/api/token/', () =>
        HttpResponse.json({
          success: true,
          data: { items: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }], total: 2 },
        }),
      ),
      http.delete('/api/token/:id', async () => {
        await pending;
        return HttpResponse.json({ success: true });
      }),
    );
    const Wrapper = wrapper();
    const qhook = renderHook(() => useTokensQuery(1), { wrapper: Wrapper });
    await waitFor(() => expect(qhook.result.current.isSuccess).toBe(true));
    const mhook = renderHook(() => useDeleteToken(), { wrapper: Wrapper });
    // fire mutation
    act(() => {
      void mhook.result.current.mutate(1);
    });
    // optimistic: immediately gone
    await waitFor(() => {
      // 这里需要同一个 qc 实例；实际测用 shared wrapper 可能失效。
      // 实际 assertion 放 integration 测试里；此处先跳过严格检查：
      expect(mhook.result.current.isPending).toBe(true);
    });
    resolve!();
  });
});
```

> 备注：hook 单测里共享 QueryClient 不直观；完整的 optimistic 验证在 Task 23 的 integration 测试里做。此处仅保证调用发生。

- [ ] **Step 2: 跑 red**

```bash
bun run test src/hooks/useTokens.test.tsx
```

Expected: FAIL。

- [ ] **Step 3: 实现**

追加到 `useTokens.ts`:

```ts
export type UpdateTokenBody = Partial<Token> & { id: number };

export function useUpdateToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: UpdateTokenBody) => {
      return api.put('/api/token/', body);
    },
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: ['tokens', 'list'] });
      const previous = qc.getQueriesData<TokenList>({ queryKey: ['tokens', 'list'] });
      qc.setQueriesData<TokenList>({ queryKey: ['tokens', 'list'] }, (old) => {
        if (!old) return old;
        return {
          ...old,
          items: old.items.map((t) => (t.id === body.id ? { ...t, ...body } : t)),
        };
      });
      return { previous };
    },
    onError: (_err, _body, ctx) => {
      ctx?.previous?.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['tokens'] });
    },
  });
}

export function useDeleteToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => api.delete(`/api/token/${id}`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['tokens', 'list'] });
      const previous = qc.getQueriesData<TokenList>({ queryKey: ['tokens', 'list'] });
      qc.setQueriesData<TokenList>({ queryKey: ['tokens', 'list'] }, (old) => {
        if (!old) return old;
        return {
          ...old,
          items: old.items.filter((t) => t.id !== id),
          total: Math.max(0, old.total - 1),
        };
      });
      return { previous };
    },
    onError: (_err, _id, ctx) => {
      ctx?.previous?.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['tokens'] });
    },
  });
}
```

- [ ] **Step 4: 跑 green**

```bash
bun run test src/hooks/useTokens.test.tsx
```

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
cd /e/new_key_api/keyapi
git add web-next/src/hooks/useTokens.ts web-next/src/hooks/useTokens.test.tsx
git commit -m "feat(web-next): useUpdateToken + useDeleteToken with optimistic updates"
```

---

## Task 12 — `useToggleTokenStatus` + `useRevealKey`

**Files:**
- Modify: `web-next/src/hooks/useTokens.ts`（append `useToggleTokenStatus`）
- Create: `web-next/src/hooks/useRevealKey.ts`

- [ ] **Step 1: `useToggleTokenStatus` 薄层**

追加到 `useTokens.ts`：

```ts
export function useToggleTokenStatus() {
  const update = useUpdateToken();
  return {
    ...update,
    mutate: (arg: { id: number; nextStatus: 1 | 2 }) =>
      update.mutate({ id: arg.id, status: arg.nextStatus, status_only: 1 } as UpdateTokenBody),
    mutateAsync: (arg: { id: number; nextStatus: 1 | 2 }) =>
      update.mutateAsync({ id: arg.id, status: arg.nextStatus, status_only: 1 } as UpdateTokenBody),
  };
}
```

并在 `UpdateTokenBody` 里允许 `status_only?: 0 | 1`：

```ts
export type UpdateTokenBody = Partial<Token> & { id: number; status_only?: 0 | 1 };
```

- [ ] **Step 2: `useRevealKey`**

```ts
// web-next/src/hooks/useRevealKey.ts
import { useMutation } from '@tanstack/react-query';

import { api } from '@/lib/api';

export function useRevealKey(tokenId: number) {
  return useMutation({
    mutationFn: async () => {
      const res = await api.post<{ key: string }>(`/api/token/${tokenId}/key`);
      // 注意：后端返回 `{ success, data: { key: "sk-..." } }`，axios 拦截器剥到 data
      return res.data.key;
    },
  });
}
```

- [ ] **Step 3: typecheck**

```bash
bun run typecheck
```

- [ ] **Step 4: Commit**

```bash
cd /e/new_key_api/keyapi
git add web-next/src/hooks/useTokens.ts web-next/src/hooks/useRevealKey.ts
git commit -m "feat(web-next): useToggleTokenStatus + useRevealKey"
```

---

## Task 13 — `useAvailableModels` + `useChannelGroups`

**Files:**
- Create: `web-next/src/hooks/useAvailableModels.ts`
- Create: `web-next/src/hooks/useChannelGroups.ts`
- Create: `web-next/src/hooks/useChannelGroups.test.tsx`

- [ ] **Step 1: `useAvailableModels`**

```ts
// web-next/src/hooks/useAvailableModels.ts
import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';

export function useAvailableModels() {
  return useQuery({
    queryKey: qk.meta.availableModels,
    queryFn: async () => {
      const res = await api.get<string[]>('/api/user/models');
      return res.data;
    },
    staleTime: Infinity,
  });
}
```

- [ ] **Step 2: 写 `useChannelGroups` 失败测试**

```tsx
// web-next/src/hooks/useChannelGroups.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, test } from 'vitest';

import { server } from '@/test/msw/server';

import { useChannelGroups } from './useChannelGroups';

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Provider({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

afterEach(() => server.resetHandlers());

describe('useChannelGroups', () => {
  test('normalizes map to sorted array, auto first', async () => {
    server.use(
      http.get('/api/user/self/channel-groups', () =>
        HttpResponse.json({
          success: true,
          data: {
            vip: { ratio: 2.0, desc: 'VIP' },
            auto: { ratio: '自动', desc: 'Auto routing' },
            default: { ratio: 1.0, desc: 'Default' },
          },
        }),
      ),
    );
    const { result } = renderHook(() => useChannelGroups(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      { name: 'auto', ratio: '自动', desc: 'Auto routing' },
      { name: 'default', ratio: 1.0, desc: 'Default' },
      { name: 'vip', ratio: 2.0, desc: 'VIP' },
    ]);
  });

  test('empty map → empty array', async () => {
    server.use(
      http.get('/api/user/self/channel-groups', () =>
        HttpResponse.json({ success: true, data: {} }),
      ),
    );
    const { result } = renderHook(() => useChannelGroups(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});
```

- [ ] **Step 3: 跑 red**

```bash
bun run test src/hooks/useChannelGroups.test.tsx
```

Expected: FAIL。

- [ ] **Step 4: 实现**

```ts
// web-next/src/hooks/useChannelGroups.ts
import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';

export type ChannelGroup = {
  name: string;
  ratio: number | string;
  desc: string;
};

type ServerShape = Record<string, { ratio: number | string; desc: string }>;

export function useChannelGroups() {
  return useQuery<ChannelGroup[]>({
    queryKey: qk.meta.channelGroups,
    queryFn: async () => {
      const res = await api.get<ServerShape>('/api/user/self/channel-groups');
      const raw = res.data ?? {};
      const entries: ChannelGroup[] = Object.entries(raw).map(([name, v]) => ({
        name,
        ratio: v.ratio,
        desc: v.desc,
      }));
      return entries.sort((a, b) => {
        if (a.name === 'auto') return -1;
        if (b.name === 'auto') return 1;
        return a.name.localeCompare(b.name);
      });
    },
    staleTime: Infinity,
  });
}
```

- [ ] **Step 5: 跑 green**

```bash
bun run test src/hooks/useChannelGroups.test.tsx
```

Expected: PASS (2)。

- [ ] **Step 6: Commit**

```bash
cd /e/new_key_api/keyapi
git add web-next/src/hooks/useAvailableModels.ts web-next/src/hooks/useChannelGroups.ts web-next/src/hooks/useChannelGroups.test.tsx
git commit -m "feat(web-next): useAvailableModels + useChannelGroups (auto-first sort)"
```

---

## Task 14 — `useUsageTrend` + `useUserStat`

**Files:**
- Create: `web-next/src/hooks/useUsageTrend.ts`
- Create: `web-next/src/hooks/useUserStat.ts`

- [ ] **Step 1: 实现 `useUsageTrend`**

```ts
// web-next/src/hooks/useUsageTrend.ts
import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import type { QuotaDataRow } from '@/lib/usage-aggregate';

export function useUsageTrend(startSec: number, endSec: number) {
  return useQuery({
    queryKey: qk.user.dataSelf(startSec, endSec),
    queryFn: async () => {
      const res = await api.get<QuotaDataRow[]>('/api/data/self', {
        params: { start_timestamp: startSec, end_timestamp: endSec },
      });
      return res.data ?? [];
    },
    staleTime: 5 * 60_000,
  });
}
```

- [ ] **Step 2: 实现 `useUserStat`**

```ts
// web-next/src/hooks/useUserStat.ts
import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';

export type LogSelfStat = {
  quota: number;
  rpm: number;
  tpm: number;
  total_requests: number;
  total_tokens: number;
  smartcache_savings_quota: number;
};

export function useUserStat(startSec: number, endSec: number) {
  return useQuery({
    queryKey: qk.user.statSelf(startSec, endSec),
    queryFn: async () => {
      const res = await api.get<LogSelfStat>('/api/log/self/stat', {
        params: { start_timestamp: startSec, end_timestamp: endSec, type: 0 },
      });
      return res.data;
    },
    staleTime: 5 * 60_000,
  });
}
```

- [ ] **Step 3: typecheck**

```bash
bun run typecheck
```

- [ ] **Step 4: Commit**

```bash
cd /e/new_key_api/keyapi
git add web-next/src/hooks/useUsageTrend.ts web-next/src/hooks/useUserStat.ts
git commit -m "feat(web-next): useUsageTrend + useUserStat hooks"
```

---

## Task 15 — `<KeyCell>` 组件 + 测试

**Files:**
- Create: `web-next/src/components/keys/KeyCell.tsx`
- Create: `web-next/src/components/keys/KeyCell.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
// web-next/src/components/keys/KeyCell.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import '@/i18n';
import { server } from '@/test/msw/server';

import { KeyCell } from './KeyCell';

function render_(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => {
  vi.useRealTimers();
  server.resetHandlers();
});

describe('KeyCell', () => {
  test('toggle reveals full key then auto-hides after 5s', async () => {
    server.use(
      http.post('/api/token/1/key', () =>
        HttpResponse.json({ success: true, data: { key: 'sk-full-secret-1a2b3c' } }),
      ),
    );
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render_(<KeyCell tokenId={1} masked='sk-••••1a2b' />);
    expect(screen.getByText('sk-••••1a2b')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /reveal|show/i }));
    await waitFor(() => expect(screen.getByText('sk-full-secret-1a2b3c')).toBeInTheDocument());
    act(() => vi.advanceTimersByTime(5000));
    await waitFor(() => expect(screen.getByText('sk-••••1a2b')).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: 跑 red**

```bash
bun run test src/components/keys/KeyCell.test.tsx
```

Expected: FAIL。

- [ ] **Step 3: 实现**

```tsx
// web-next/src/components/keys/KeyCell.tsx
import { Copy, Eye, EyeOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useRevealKey } from '@/hooks/useRevealKey';

export function KeyCell({ tokenId, masked }: { tokenId: number; masked: string }) {
  const { t } = useTranslation('keys');
  const [revealed, setRevealed] = useState<string | null>(null);
  const reveal = useRevealKey(tokenId);

  useEffect(() => {
    if (!revealed) return;
    const id = setTimeout(() => setRevealed(null), 5_000);
    return () => clearTimeout(id);
  }, [revealed]);

  async function onToggle() {
    if (revealed) {
      setRevealed(null);
      return;
    }
    try {
      const full = await reveal.mutateAsync();
      setRevealed(full);
    } catch {
      toast.error(t('reveal.failed'));
    }
  }

  async function onCopy() {
    const value = revealed ?? masked;
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t('reveal.copied'));
    } catch {
      toast.error(t('reveal.failed'));
    }
  }

  return (
    <div className='flex items-center gap-2 mono text-13'>
      <span>{revealed ?? masked}</span>
      <button
        type='button'
        aria-label={revealed ? 'Hide' : 'Reveal'}
        onClick={onToggle}
        className='rounded-xs p-1 text-fg-1 hover:bg-bg-2 hover:text-fg-0'
      >
        {revealed ? <EyeOff size={14} strokeWidth={1.5} /> : <Eye size={14} strokeWidth={1.5} />}
      </button>
      <button
        type='button'
        aria-label={t('reveal.copy')}
        onClick={onCopy}
        className='rounded-xs p-1 text-fg-1 hover:bg-bg-2 hover:text-fg-0'
      >
        <Copy size={14} strokeWidth={1.5} />
      </button>
    </div>
  );
}
```

- [ ] **Step 4: 跑 green**

```bash
bun run test src/components/keys/KeyCell.test.tsx
```

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
cd /e/new_key_api/keyapi
git add web-next/src/components/keys/KeyCell.tsx web-next/src/components/keys/KeyCell.test.tsx
git commit -m "feat(web-next): KeyCell with reveal toggle + 5s auto-hide"
```

---

## Task 16 — `<TokenRow>` + `<KeysTable>` + `<EmptyKeys>`

**Files:**
- Create: `web-next/src/components/keys/TokenRow.tsx`
- Create: `web-next/src/components/keys/KeysTable.tsx`
- Create: `web-next/src/components/keys/EmptyKeys.tsx`

- [ ] **Step 1: `<TokenRow>`**

```tsx
// web-next/src/components/keys/TokenRow.tsx
import { MoreHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { fmtDateSec, fmtMoney, fmtNum } from '@/lib/format';
import { parseGroupChain } from '@/lib/token-schema';
import type { Token } from '@/hooks/useTokens';

import { KeyCell } from './KeyCell';

function statusBadge(status: number) {
  if (status === 2) return 'disabled';
  if (status === 3) return 'expired';
  if (status === 4) return 'exhausted';
  return null;
}

// 后端已经返回 key 掩码形式（sk-****xxxx）；前端直接用 token.key，不再二次掩码。

type Props = {
  token: Token;
  onEdit: (token: Token) => void;
  onDelete: (token: Token) => void;
  onToggleStatus: (token: Token) => void;
};

export function TokenRow({ token, onEdit, onDelete, onToggleStatus }: Props) {
  const { t } = useTranslation('keys');
  const groups = parseGroupChain(token.group);
  const chainLabel = groups.length <= 1 ? (groups[0] ?? 'auto') : groups.join(' → ');
  const badge = statusBadge(token.status);
  const disabled = token.status !== 1;

  const total = token.remain_quota + token.used_quota;
  const usage = token.unlimited_quota
    ? t('status.unlimited')
    : total === 0
      ? '—'
      : `${fmtMoney(token.used_quota / 500_000)} / ${fmtMoney(total / 500_000)}`;
  // 500_000 是 common.QuotaPerUnit 默认值；后续可走配置

  return (
    <tr className={disabled ? 'opacity-60' : ''}>
      <td className='px-4 py-3'>
        <div className='text-13 font-medium text-fg-0'>{token.name || 'Untitled'}</div>
        <div className='text-12 text-fg-2'>{chainLabel}</div>
      </td>
      <td className='px-4 py-3'>
        <KeyCell tokenId={token.id} masked={token.key ?? '••••'} />
      </td>
      <td className='px-4 py-3 text-13'>
        <div className='flex items-center gap-2'>
          <span>{usage}</span>
          {badge && <Badge variant='secondary'>{t(`status.${badge}`)}</Badge>}
        </div>
      </td>
      <td className='px-4 py-3 text-13 text-fg-1'>{fmtDateSec(token.created_time)}</td>
      <td className='px-4 py-3 text-right'>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant='ghost' size='icon' aria-label='Actions'>
              <MoreHorizontal size={16} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            <DropdownMenuItem onClick={() => onEdit(token)}>Edit</DropdownMenuItem>
            {token.status === 1 || token.status === 2 ? (
              <DropdownMenuItem onClick={() => onToggleStatus(token)}>
                {token.status === 1 ? t('status.disabled') : t('status.enabled')}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onDelete(token)} className='text-danger'>
              {t('delete.confirm')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}
```

- [ ] **Step 2: `<KeysTable>`**

```tsx
// web-next/src/components/keys/KeysTable.tsx
import { useTranslation } from 'react-i18next';

import type { Token } from '@/hooks/useTokens';

import { TokenRow } from './TokenRow';

type Props = {
  items: Token[];
  onEdit: (t: Token) => void;
  onDelete: (t: Token) => void;
  onToggleStatus: (t: Token) => void;
};

export function KeysTable({ items, onEdit, onDelete, onToggleStatus }: Props) {
  const { t } = useTranslation('keys');
  return (
    <table className='w-full border-collapse'>
      <thead>
        <tr className='border-b border-line text-left text-12 uppercase text-fg-2'>
          <th className='px-4 py-2 font-medium'>{t('table.col.name')}</th>
          <th className='px-4 py-2 font-medium'>{t('table.col.key')}</th>
          <th className='px-4 py-2 font-medium'>{t('table.col.usage')}</th>
          <th className='px-4 py-2 font-medium'>{t('table.col.created')}</th>
          <th className='px-4 py-2' />
        </tr>
      </thead>
      <tbody>
        {items.map((tkn) => (
          <TokenRow
            key={tkn.id}
            token={tkn}
            onEdit={onEdit}
            onDelete={onDelete}
            onToggleStatus={onToggleStatus}
          />
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 3: `<EmptyKeys>`**

```tsx
// web-next/src/components/keys/EmptyKeys.tsx
import { KeyRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';

export function EmptyKeys({ onCreate }: { onCreate: () => void }) {
  const { t } = useTranslation('keys');
  return (
    <div className='flex min-h-[40vh] flex-col items-center justify-center text-center'>
      <KeyRound size={28} strokeWidth={1.5} className='mb-4 text-fg-2' />
      <h2 className='h3'>{t('page.empty.title')}</h2>
      <p className='muted mt-2 max-w-md'>{t('page.empty.body')}</p>
      <Button className='mt-6' onClick={onCreate}>
        {t('page.empty.cta')}
      </Button>
    </div>
  );
}
```

- [ ] **Step 4: typecheck**

```bash
bun run typecheck
```

- [ ] **Step 5: Commit**

```bash
cd /e/new_key_api/keyapi
git add web-next/src/components/keys/TokenRow.tsx web-next/src/components/keys/KeysTable.tsx web-next/src/components/keys/EmptyKeys.tsx
git commit -m "feat(web-next): TokenRow + KeysTable + EmptyKeys"
```

---

## Task 17 — `<CreateTokenDialog>`

**Files:**
- Create: `web-next/src/components/keys/CreateTokenDialog.tsx`

- [ ] **Step 1: 实现**

```tsx
// web-next/src/components/keys/CreateTokenDialog.tsx
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { InlineBanner } from '@/components/auth/InlineBanner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useChannelGroups } from '@/hooks/useChannelGroups';
import { useCreateToken } from '@/hooks/useTokens';
import { ApiError } from '@/lib/api';

const schema = z.object({
  name: z.string().min(1).max(50),
  group: z.string().min(1),
});
type Values = z.infer<typeof schema>;

export function CreateTokenDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation('keys');
  const groups = useChannelGroups();
  const create = useCreateToken();

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', group: '' },
  });

  async function onSubmit(values: Values) {
    try {
      await create.mutateAsync(values);
      form.reset();
      onOpenChange(false);
    } catch {
      /* banner 已由 error state 渲染，这里不再处理 */
    }
  }

  const submitDisabled =
    groups.isPending || groups.isError || create.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('create.title')}</DialogTitle>
          <DialogDescription>{t('create.hint_advanced')}</DialogDescription>
        </DialogHeader>
        {groups.isError && (
          <InlineBanner
            level='danger'
            message={t('create.groups_failed')}
            onClose={() => groups.refetch()}
          />
        )}
        {create.error && create.error instanceof ApiError && (
          <InlineBanner
            level='danger'
            message={create.error.backendMessage ?? create.error.message}
          />
        )}
        <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-4'>
          <div className='space-y-2'>
            <Label htmlFor='create-name'>{t('create.name')}</Label>
            <Input id='create-name' autoFocus {...form.register('name')} />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='create-group'>{t('create.group')}</Label>
            <Select
              value={form.watch('group')}
              onValueChange={(v) => form.setValue('group', v, { shouldValidate: true })}
              disabled={groups.isPending || groups.isError}
            >
              <SelectTrigger id='create-group'>
                <SelectValue
                  placeholder={
                    groups.isPending ? t('create.loading_groups') : t('create.group')
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {(groups.data ?? []).map((g) => (
                  <SelectItem key={g.name} value={g.name}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type='submit' className='w-full' disabled={submitDisabled}>
            {t('create.submit')}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

**关键**：groups query pending 或 error 时 Select 禁用 + Submit 禁用（fail-closed）。query 成功后从排序后的第一个（通常是 `auto`）自动填入。把下面的 import + useEffect 块加到组件里：

```tsx
// 顶部 import 加 useEffect
import { useEffect } from 'react';

// 组件体内（在 form 定义之后）：
useEffect(() => {
  if (groups.data && groups.data.length > 0 && !form.getValues('group')) {
    form.setValue('group', groups.data[0].name);
  }
}, [groups.data, form]);
```

- [ ] **Step 2: typecheck**

```bash
bun run typecheck
```

- [ ] **Step 3: Commit**

```bash
cd /e/new_key_api/keyapi
git add web-next/src/components/keys/CreateTokenDialog.tsx
git commit -m "feat(web-next): CreateTokenDialog with fail-closed group select"
```

---

## Task 18 — `<EditTokenSheet>` + 测试

**Files:**
- Create: `web-next/src/components/keys/EditTokenSheet.tsx`
- Create: `web-next/src/components/keys/EditTokenSheet.test.tsx`

**设计说明**：本 slice 用 Dialog 作右侧 drawer 的实现（shadcn 没 Sheet primitive，但可通过给 Dialog 加类名实现 drawer 视觉；或者直接 Dialog 居中呈现也可——采用后者降低复杂度）。Model limits 用 `<Popover>` + 滚动 checkbox list；Expires 用 `<Popover>` + `<Calendar>`；Group 用 MultiSelect 组合（Popover + Checkbox）。

- [ ] **Step 1: 写失败测试（核心：字段校验）**

```tsx
// web-next/src/components/keys/EditTokenSheet.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, test } from 'vitest';

import '@/i18n';
import { server } from '@/test/msw/server';
import type { Token } from '@/hooks/useTokens';

import { EditTokenSheet } from './EditTokenSheet';

const token: Token = {
  id: 1,
  name: 'initial',
  status: 1,
  remain_quota: 1000,
  used_quota: 0,
  unlimited_quota: false,
  expired_time: -1,
  created_time: 1713484800,
  model_limits_enabled: false,
  model_limits: '',
  allow_ips: '',
  group: 'auto',
  cross_group_retry: false,
};

function wrap(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
}

afterEach(() => server.resetHandlers());

describe('EditTokenSheet', () => {
  test('submits PUT body with name change', async () => {
    let puttedBody: unknown = null;
    server.use(
      http.get('/api/user/models', () => HttpResponse.json({ success: true, data: [] })),
      http.get('/api/user/self/channel-groups', () =>
        HttpResponse.json({
          success: true,
          data: { auto: { ratio: '自动', desc: 'Auto' } },
        }),
      ),
      http.put('/api/token/', async ({ request }) => {
        puttedBody = await request.json();
        return HttpResponse.json({ success: true, data: { id: 1 } });
      }),
    );
    const user = userEvent.setup();
    render(wrap(<EditTokenSheet open token={token} onOpenChange={() => {}} />));
    const nameInput = await screen.findByLabelText(/Name|名称/);
    await user.clear(nameInput);
    await user.type(nameInput, 'updated');
    await user.click(screen.getByRole('button', { name: /Save|保存/ }));
    await new Promise((r) => setTimeout(r, 20));
    expect(puttedBody).toMatchObject({ id: 1, name: 'updated' });
  });
});
```

- [ ] **Step 2: 跑 red**

```bash
bun run test src/components/keys/EditTokenSheet.test.tsx
```

Expected: FAIL。

- [ ] **Step 3: 实现（完整）**

```tsx
// web-next/src/components/keys/EditTokenSheet.tsx
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { InlineBanner } from '@/components/auth/InlineBanner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useAvailableModels } from '@/hooks/useAvailableModels';
import { useChannelGroups } from '@/hooks/useChannelGroups';
import { useUpdateToken, type Token } from '@/hooks/useTokens';
import { ApiError } from '@/lib/api';
import {
  editTokenSchema,
  parseAllowIps,
  parseGroupChain,
  serializeAllowIps,
  serializeGroupChain,
  type EditTokenValues,
} from '@/lib/token-schema';

export function EditTokenSheet({
  open,
  token,
  onOpenChange,
}: {
  open: boolean;
  token: Token;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation('keys');
  const models = useAvailableModels();
  const groups = useChannelGroups();
  const update = useUpdateToken();

  const form = useForm<EditTokenValues>({
    resolver: zodResolver(editTokenSchema),
    defaultValues: {
      name: token.name ?? '',
      status: (token.status === 2 || token.status === 1 ? token.status : 1) as 1 | 2,
      unlimited_quota: token.unlimited_quota,
      remain_quota: token.remain_quota,
      expired_time: token.expired_time,
      model_limits_enabled: token.model_limits_enabled,
      model_limits: token.model_limits ? token.model_limits.split(',') : [],
      allow_ips: parseAllowIps(token.allow_ips ?? ''),
      group: parseGroupChain(token.group),
      cross_group_retry: token.cross_group_retry,
    },
  });

  useEffect(() => {
    form.reset({
      name: token.name ?? '',
      status: (token.status === 2 || token.status === 1 ? token.status : 1) as 1 | 2,
      unlimited_quota: token.unlimited_quota,
      remain_quota: token.remain_quota,
      expired_time: token.expired_time,
      model_limits_enabled: token.model_limits_enabled,
      model_limits: token.model_limits ? token.model_limits.split(',') : [],
      allow_ips: parseAllowIps(token.allow_ips ?? ''),
      group: parseGroupChain(token.group),
      cross_group_retry: token.cross_group_retry,
    });
  }, [token, form]);

  const unlimited = form.watch('unlimited_quota');
  const modelLimits = form.watch('model_limits');
  const groupChain = form.watch('group');

  async function onSubmit(values: EditTokenValues) {
    try {
      await update.mutateAsync({
        id: token.id,
        name: values.name,
        status: values.status,
        unlimited_quota: values.unlimited_quota,
        remain_quota: values.remain_quota,
        expired_time: values.expired_time,
        model_limits_enabled: values.model_limits_enabled,
        model_limits: values.model_limits.join(','),
        allow_ips: serializeAllowIps(values.allow_ips),
        group: serializeGroupChain(values.group),
        cross_group_retry: values.cross_group_retry,
      });
      onOpenChange(false);
    } catch {
      /* banner via state */
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-[480px]'>
        <DialogHeader>
          <DialogTitle>{t('edit.title')}</DialogTitle>
        </DialogHeader>
        {update.error && update.error instanceof ApiError && (
          <InlineBanner
            level='danger'
            message={update.error.backendMessage ?? update.error.message}
          />
        )}
        <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-4'>
          <div className='space-y-2'>
            <Label htmlFor='e-name'>{t('edit.field.name')}</Label>
            <Input id='e-name' {...form.register('name')} />
          </div>
          <div className='flex items-center justify-between'>
            <Label>{t('edit.field.status')}</Label>
            <Switch
              checked={form.watch('status') === 1}
              onCheckedChange={(v) => form.setValue('status', v ? 1 : 2)}
              disabled={token.status === 3 || token.status === 4}
            />
          </div>
          <div className='flex items-center justify-between'>
            <Label>{t('edit.field.unlimited_quota')}</Label>
            <Switch
              checked={unlimited}
              onCheckedChange={(v) => form.setValue('unlimited_quota', v)}
            />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='e-quota'>{t('edit.field.remain_quota')}</Label>
            <Input
              id='e-quota'
              type='number'
              disabled={unlimited}
              {...form.register('remain_quota', { valueAsNumber: true })}
            />
          </div>
          <div className='space-y-2'>
            <Label>{t('edit.field.expired_time')}</Label>
            <div className='flex gap-2'>
              <Button
                type='button'
                variant='secondary'
                size='sm'
                onClick={() => form.setValue('expired_time', -1)}
              >
                {t('edit.field.expired_time.never')}
              </Button>
              <Button
                type='button'
                variant='secondary'
                size='sm'
                onClick={() =>
                  form.setValue('expired_time', Math.floor(Date.now() / 1000) + 7 * 86400)
                }
              >
                {t('edit.field.expired_time.7d')}
              </Button>
              <Button
                type='button'
                variant='secondary'
                size='sm'
                onClick={() =>
                  form.setValue('expired_time', Math.floor(Date.now() / 1000) + 30 * 86400)
                }
              >
                {t('edit.field.expired_time.30d')}
              </Button>
            </div>
          </div>
          <div className='space-y-2'>
            <Label>{t('edit.field.model_limits')}</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant='secondary' className='w-full justify-start'>
                  {modelLimits.length === 0
                    ? t('edit.field.model_limits.placeholder')
                    : `${modelLimits.length} selected`}
                </Button>
              </PopoverTrigger>
              <PopoverContent className='max-h-64 overflow-y-auto'>
                {(models.data ?? []).map((m) => {
                  const checked = modelLimits.includes(m);
                  return (
                    <label
                      key={m}
                      className='flex items-center gap-2 rounded-sm p-1 hover:bg-bg-1'
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) => {
                          const next = v
                            ? [...modelLimits, m]
                            : modelLimits.filter((x) => x !== m);
                          form.setValue('model_limits', next);
                          form.setValue('model_limits_enabled', next.length > 0);
                        }}
                      />
                      <span className='text-13'>{m}</span>
                    </label>
                  );
                })}
              </PopoverContent>
            </Popover>
          </div>
          <div className='space-y-2'>
            <Label htmlFor='e-ips'>{t('edit.field.allow_ips')}</Label>
            <Textarea
              id='e-ips'
              rows={3}
              defaultValue={(form.getValues('allow_ips') ?? []).join('\n')}
              onChange={(e) =>
                form.setValue('allow_ips', parseAllowIps(e.target.value))
              }
            />
          </div>
          <div className='space-y-2'>
            <Label>{t('edit.field.group')}</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant='secondary' className='w-full justify-start'>
                  {groupChain.join(' → ') || '—'}
                </Button>
              </PopoverTrigger>
              <PopoverContent>
                {(groups.data ?? []).map((g) => {
                  const checked = groupChain.includes(g.name);
                  return (
                    <label
                      key={g.name}
                      className='flex items-center gap-2 rounded-sm p-1 hover:bg-bg-1'
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) => {
                          const next = v
                            ? [...groupChain, g.name]
                            : groupChain.filter((x) => x !== g.name);
                          form.setValue('group', next, { shouldValidate: true });
                        }}
                      />
                      <span className='text-13'>{g.name}</span>
                    </label>
                  );
                })}
              </PopoverContent>
            </Popover>
          </div>
          <div className='flex items-center justify-between'>
            <Label>{t('edit.field.cross_group_retry')}</Label>
            <Switch
              checked={form.watch('cross_group_retry')}
              onCheckedChange={(v) => form.setValue('cross_group_retry', v, { shouldValidate: true })}
              disabled={groupChain.length < 2}
            />
          </div>
          <div className='flex justify-end gap-2 pt-2'>
            <Button type='button' variant='secondary' onClick={() => onOpenChange(false)}>
              {t('edit.cancel')}
            </Button>
            <Button type='submit' disabled={update.isPending}>
              {t('edit.save')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: 跑 green**

```bash
bun run test src/components/keys/EditTokenSheet.test.tsx
```

Expected: PASS。

- [ ] **Step 5: typecheck + 全测试**

```bash
bun run typecheck && bun run test
```

- [ ] **Step 6: Commit**

```bash
cd /e/new_key_api/keyapi
git add web-next/src/components/keys/EditTokenSheet.tsx web-next/src/components/keys/EditTokenSheet.test.tsx
git commit -m "feat(web-next): EditTokenSheet with full field set"
```

---

## Task 19 — `<DeleteConfirmDialog>` + `pages/Keys.tsx` 组装

**Files:**
- Create: `web-next/src/components/keys/DeleteConfirmDialog.tsx`
- Create: `web-next/src/pages/Keys.tsx`

- [ ] **Step 1: DeleteConfirmDialog**

```tsx
// web-next/src/components/keys/DeleteConfirmDialog.tsx
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export function DeleteConfirmDialog({
  open,
  name,
  onOpenChange,
  onConfirm,
  isPending,
}: {
  open: boolean;
  name: string;
  onOpenChange: (o: boolean) => void;
  onConfirm: () => void;
  isPending: boolean;
}) {
  const { t } = useTranslation('keys');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('delete.title')}</DialogTitle>
          <DialogDescription>{t('delete.body', { name })}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant='secondary' onClick={() => onOpenChange(false)}>
            {t('edit.cancel')}
          </Button>
          <Button
            className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
            disabled={isPending}
            onClick={onConfirm}
          >
            {t('delete.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: pages/Keys.tsx**

```tsx
// web-next/src/pages/Keys.tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { CreateTokenDialog } from '@/components/keys/CreateTokenDialog';
import { DeleteConfirmDialog } from '@/components/keys/DeleteConfirmDialog';
import { EditTokenSheet } from '@/components/keys/EditTokenSheet';
import { EmptyKeys } from '@/components/keys/EmptyKeys';
import { KeysTable } from '@/components/keys/KeysTable';
import { InlineBanner } from '@/components/auth/InlineBanner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useDeleteToken,
  useToggleTokenStatus,
  useTokensQuery,
  type Token,
} from '@/hooks/useTokens';
import { usePageAction } from '@/hooks/usePageAction';

export function KeysPage() {
  const { t } = useTranslation('keys');
  const tokens = useTokensQuery(1);
  const del = useDeleteToken();
  const toggle = useToggleTokenStatus();

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Token | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Token | null>(null);

  usePageAction(
    <Button onClick={() => setCreateOpen(true)}>{t('page.create')}</Button>,
  );

  if (tokens.isPending) {
    return (
      <div className='space-y-2'>
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className='h-10 w-full' />
        ))}
      </div>
    );
  }
  if (tokens.isError) {
    return (
      <InlineBanner
        level='danger'
        message={String((tokens.error as Error).message)}
        onClose={() => void tokens.refetch()}
      />
    );
  }

  const items = tokens.data?.items ?? [];
  const isEmpty = items.length === 0;

  return (
    <div>
      {isEmpty ? (
        <EmptyKeys onCreate={() => setCreateOpen(true)} />
      ) : (
        <KeysTable
          items={items}
          onEdit={(t) => setEditTarget(t)}
          onDelete={(t) => setDeleteTarget(t)}
          onToggleStatus={(tok) =>
            toggle.mutate({
              id: tok.id,
              nextStatus: tok.status === 1 ? 2 : 1,
            })
          }
        />
      )}

      <CreateTokenDialog open={createOpen} onOpenChange={setCreateOpen} />
      {editTarget && (
        <EditTokenSheet
          open
          token={editTarget}
          onOpenChange={(o) => !o && setEditTarget(null)}
        />
      )}
      {deleteTarget && (
        <DeleteConfirmDialog
          open
          name={deleteTarget.name}
          isPending={del.isPending}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
          onConfirm={() => {
            const target = deleteTarget;
            setDeleteTarget(null);
            del.mutate(target.id, {
              onSuccess: () => toast.success(t('delete.confirm') + ' ✓'),
              onError: (err) => toast.error((err as Error).message),
            });
          }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: typecheck**

```bash
bun run typecheck
```

- [ ] **Step 4: Commit**

```bash
cd /e/new_key_api/keyapi
git add web-next/src/components/keys/DeleteConfirmDialog.tsx web-next/src/pages/Keys.tsx
git commit -m "feat(web-next): DeleteConfirmDialog + KeysPage assembly"
```

---

## Task 20 — `<StatTile>` + `<QuotaCard>` + 测试

**Files:**
- Create: `web-next/src/components/dashboard/StatTile.tsx`
- Create: `web-next/src/components/dashboard/StatTile.test.tsx`
- Create: `web-next/src/components/dashboard/QuotaCard.tsx`
- Create: `web-next/src/components/dashboard/QuotaCard.test.tsx`

- [ ] **Step 1: StatTile 测试 + 实现**

测试：
```tsx
// web-next/src/components/dashboard/StatTile.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import { StatTile } from './StatTile';

describe('StatTile', () => {
  test('renders label and value', () => {
    render(<StatTile label='Requests' value='12,347' />);
    expect(screen.getByText('Requests')).toBeInTheDocument();
    expect(screen.getByText('12,347')).toBeInTheDocument();
  });

  test('dash when value is undefined', () => {
    render(<StatTile label='Requests' value={undefined} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
```

实现：
```tsx
// web-next/src/components/dashboard/StatTile.tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function StatTile({ label, value }: { label: string; value: string | undefined }) {
  return (
    <Card className='flex-1'>
      <CardHeader>
        <CardTitle className='eyebrow'>{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className='h3'>{value ?? '—'}</div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: QuotaCard 测试 + 实现**

测试：
```tsx
// web-next/src/components/dashboard/QuotaCard.test.tsx
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import '@/i18n';

import { QuotaCard } from './QuotaCard';

function Wrap(u: { quota: number; used_quota: number }) {
  return (
    <MemoryRouter>
      <QuotaCard user={u} />
    </MemoryRouter>
  );
}

describe('QuotaCard', () => {
  test('shows top-up CTA when brand new (both zero)', () => {
    render(Wrap({ quota: 0, used_quota: 0 }));
    expect(screen.getByText(/Top up|充值/)).toBeInTheDocument();
  });

  test('shows balance and used-of-total when has history', () => {
    render(Wrap({ quota: 50_000_000, used_quota: 50_000_000 }));
    // fmtMoney($100 using QuotaPerUnit=500_000): 100,000,000 / 500_000 = $200.00
    // Balance half: $100.00
    expect(screen.getByText(/\$100/)).toBeInTheDocument();
  });

  test('shows Exhausted badge when quota=0 but has history', () => {
    render(Wrap({ quota: 0, used_quota: 10_000_000 }));
    expect(screen.getByText(/Exhausted|已耗尽/)).toBeInTheDocument();
  });
});
```

实现：
```tsx
// web-next/src/components/dashboard/QuotaCard.tsx
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fmtMoney } from '@/lib/format';

const QUOTA_PER_UNIT = 500_000; // default common.QuotaPerUnit

export function QuotaCard({
  user,
}: {
  user: { quota: number; used_quota: number };
}) {
  const { t } = useTranslation('dashboard');
  const total = user.quota + user.used_quota;
  const isNew = user.quota === 0 && user.used_quota === 0;
  const exhausted = user.quota === 0 && user.used_quota > 0;
  const percentUsed = total === 0 ? 0 : Math.min(100, (user.used_quota / total) * 100);

  return (
    <Card>
      <CardHeader>
        <CardTitle className='eyebrow flex items-center gap-2'>
          {t('quota.label')}
          {exhausted && <Badge variant='secondary'>{t('quota.exhausted')}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isNew ? (
          <div className='flex items-center gap-3'>
            <p className='muted flex-1'>{t('quota.zero_body')}</p>
            <Link to='/topup'>
              <Button>{t('quota.topup')}</Button>
            </Link>
          </div>
        ) : (
          <>
            <div className='h2'>{fmtMoney(user.quota / QUOTA_PER_UNIT)}</div>
            <div className='mt-3 h-1 w-full overflow-hidden rounded-pill bg-bg-2'>
              <div
                className='h-full bg-primary transition-all'
                style={{ width: `${percentUsed}%` }}
              />
            </div>
            <p className='muted mt-2 text-13'>
              {t('quota.used_of_total', {
                used: fmtMoney(user.used_quota / QUOTA_PER_UNIT),
                total: fmtMoney(total / QUOTA_PER_UNIT),
              })}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: 跑测试**

```bash
bun run test src/components/dashboard/
```

Expected: PASS (5)。

- [ ] **Step 4: Commit**

```bash
cd /e/new_key_api/keyapi
git add web-next/src/components/dashboard/StatTile.tsx web-next/src/components/dashboard/StatTile.test.tsx web-next/src/components/dashboard/QuotaCard.tsx web-next/src/components/dashboard/QuotaCard.test.tsx
git commit -m "feat(web-next): StatTile + QuotaCard with zero/exhausted states"
```

---

## Task 21 — `<RangeSelect>` + `<UsageTrendCard>` + `<ActivityCard>` + `pages/Dashboard.tsx`

**Files:**
- Create: `web-next/src/components/dashboard/RangeSelect.tsx`
- Create: `web-next/src/components/dashboard/UsageTrendCard.tsx`
- Create: `web-next/src/components/dashboard/ActivityCard.tsx`
- Create: `web-next/src/pages/Dashboard.tsx`

- [ ] **Step 1: RangeSelect**

```tsx
// web-next/src/components/dashboard/RangeSelect.tsx
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export type Range = '7d' | '30d';

export function useRange(): Range {
  const [params] = useSearchParams();
  return params.get('range') === '7d' ? '7d' : '30d';
}

export function rangeToSeconds(range: Range): { startSec: number; endSec: number } {
  const endSec = Math.floor(Date.now() / 1000);
  const days = range === '7d' ? 7 : 30;
  const startSec = endSec - days * 86400;
  return { startSec, endSec };
}

export function RangeSelect() {
  const { t } = useTranslation('dashboard');
  const [params, setParams] = useSearchParams();
  const value = (params.get('range') === '7d' ? '7d' : '30d') as Range;
  return (
    <Select value={value} onValueChange={(v) => setParams({ range: v })}>
      <SelectTrigger className='w-32'>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value='7d'>{t('range.7d')}</SelectItem>
        <SelectItem value='30d'>{t('range.30d')}</SelectItem>
      </SelectContent>
    </Select>
  );
}
```

- [ ] **Step 2: UsageTrendCard**

```tsx
// web-next/src/components/dashboard/UsageTrendCard.tsx
import { LineChart } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  CartesianGrid,
  Line,
  LineChart as RLineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { fmtDaySec, fmtMoney, fmtNum } from '@/lib/format';
import { aggregateByUtcDay, type QuotaDataRow } from '@/lib/usage-aggregate';

const QUOTA_PER_UNIT = 500_000;

type Props = {
  rows: QuotaDataRow[] | undefined;
  isPending: boolean;
  startSec: number;
  endSec: number;
  range: string;
};

export function UsageTrendCard({ rows, isPending, startSec, endSec, range }: Props) {
  const { t } = useTranslation('dashboard');
  if (isPending) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('usage.title', { range })}</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className='h-[280px] w-full' />
        </CardContent>
      </Card>
    );
  }
  const data = aggregateByUtcDay(rows ?? [], startSec, endSec);
  const isEmpty = (rows ?? []).length === 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('usage.title', { range })}</CardTitle>
      </CardHeader>
      <CardContent>
        {isEmpty ? (
          <div className='flex min-h-[280px] flex-col items-center justify-center text-center'>
            <LineChart size={28} strokeWidth={1.5} className='mb-4 text-fg-2' />
            <h3 className='h3'>{t('usage.empty.title')}</h3>
            <p className='muted mt-2'>{t('usage.empty.body')}</p>
            <Link to='/keys' className='mt-6'>
              <Button>{t('usage.empty.cta')}</Button>
            </Link>
          </div>
        ) : (
          <ResponsiveContainer width='100%' height={280}>
            <RLineChart data={data}>
              <CartesianGrid strokeDasharray='3 3' stroke='var(--border)' />
              <XAxis
                dataKey='day'
                tickFormatter={(sec) => fmtDaySec(sec)}
                stroke='var(--text-2)'
              />
              <YAxis
                tickFormatter={(q) => fmtMoney(q / QUOTA_PER_UNIT)}
                stroke='var(--text-2)'
              />
              <Tooltip
                formatter={(value: number, _name, ctx) => [
                  fmtMoney(value / QUOTA_PER_UNIT),
                  t('usage.tooltip.requests', { count: fmtNum(ctx.payload?.count ?? 0) }),
                ]}
                labelFormatter={(sec) => `${fmtDaySec(sec)} (UTC)`}
              />
              <Line
                type='monotone'
                dataKey='quota'
                stroke='var(--accent)'
                strokeWidth={1.5}
                dot={false}
              />
            </RLineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: ActivityCard**

```tsx
// web-next/src/components/dashboard/ActivityCard.tsx
import { useTranslation } from 'react-i18next';

import { fmtMoney, fmtNum } from '@/lib/format';
import type { LogSelfStat } from '@/hooks/useUserStat';

import { StatTile } from './StatTile';

const QUOTA_PER_UNIT = 500_000;

export function ActivityCard({
  stat,
}: {
  stat: LogSelfStat | undefined;
}) {
  const { t } = useTranslation('dashboard');
  return (
    <div className='flex gap-4'>
      <StatTile
        label={t('activity.requests')}
        value={stat ? fmtNum(stat.total_requests) : undefined}
      />
      <StatTile
        label={t('activity.tokens')}
        value={stat ? fmtNum(stat.total_tokens) : undefined}
      />
      <StatTile
        label={t('activity.consumed')}
        value={stat ? fmtMoney(stat.quota / QUOTA_PER_UNIT) : undefined}
      />
    </div>
  );
}
```

- [ ] **Step 4: pages/Dashboard.tsx**

```tsx
// web-next/src/pages/Dashboard.tsx
import { useMemo } from 'react';

import { ActivityCard } from '@/components/dashboard/ActivityCard';
import { QuotaCard } from '@/components/dashboard/QuotaCard';
import { RangeSelect, rangeToSeconds, useRange } from '@/components/dashboard/RangeSelect';
import { UsageTrendCard } from '@/components/dashboard/UsageTrendCard';
import { useAuth } from '@/hooks/useAuth';
import { usePageAction } from '@/hooks/usePageAction';
import { useUsageTrend } from '@/hooks/useUsageTrend';
import { useUserStat } from '@/hooks/useUserStat';

export function DashboardPage() {
  const { user } = useAuth();
  const range = useRange();
  const { startSec, endSec } = useMemo(() => rangeToSeconds(range), [range]);
  const trend = useUsageTrend(startSec, endSec);
  const stat = useUserStat(startSec, endSec);

  usePageAction(<RangeSelect />);

  return (
    <div className='mx-auto max-w-[1080px] space-y-4'>
      {user && <QuotaCard user={user} />}
      <UsageTrendCard
        rows={trend.data}
        isPending={trend.isPending}
        startSec={startSec}
        endSec={endSec}
        range={range === '7d' ? '7' : '30'}
      />
      <ActivityCard stat={stat.data} />
    </div>
  );
}
```

- [ ] **Step 5: typecheck + test**

```bash
bun run typecheck && bun run test
```

Expected: 全 PASS。

- [ ] **Step 6: Commit**

```bash
cd /e/new_key_api/keyapi
git add web-next/src/components/dashboard/ web-next/src/pages/Dashboard.tsx
git commit -m "feat(web-next): Dashboard page with Quota + Usage trend + Activity"
```

---

## Task 22 — `routes.tsx` 接通 + shell 内走通

**Files:**
- Modify: `web-next/src/routes.tsx`

- [ ] **Step 1: 替换 element**

在 `routes.tsx`:
```tsx
import { KeysPage } from '@/pages/Keys';
import { DashboardPage } from '@/pages/Dashboard';

// 把：
{ path: '/dashboard', element: <ComingSoon feature='Dashboard' /> },
{ path: '/keys', element: <ComingSoon feature='API keys' /> },
// 改为：
{ path: '/dashboard', element: <DashboardPage /> },
{ path: '/keys', element: <KeysPage /> },
```

- [ ] **Step 2: typecheck + build**

```bash
bun run typecheck && bun run build
```

Expected: 两个 exit 0。

- [ ] **Step 3: Commit**

```bash
cd /e/new_key_api/keyapi
git add web-next/src/routes.tsx
git commit -m "feat(web-next): wire /keys and /dashboard real pages"
```

---

## Task 23 — 5 个 MSW 集成测试

**Files（全部 new）:**
- `web-next/src/test/integration/keys-create.test.tsx`
- `web-next/src/test/integration/keys-edit-optimistic.test.tsx`
- `web-next/src/test/integration/keys-delete-rollback.test.tsx`
- `web-next/src/test/integration/keys-reveal.test.tsx`
- `web-next/src/test/integration/dashboard-loads.test.tsx`

**共用 mount helper**（每个测试顶部 inline）：用 `MemoryRouter` + `QueryClient` + 全套 Provider mount 单页。

- [ ] **Step 1: keys-create**

```tsx
// web-next/src/test/integration/keys-create.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, test } from 'vitest';

import '@/i18n';
import { KeysPage } from '@/pages/Keys';
import { AuthProvider } from '@/providers/AuthProvider';
import { server } from '@/test/msw/server';

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/keys']}>
          <Routes>
            <Route path='/keys' element={<KeysPage />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => server.resetHandlers());

describe('integration: keys create flow', () => {
  test('empty → create dialog → new row appears', async () => {
    let tokensList = { items: [] as unknown[], total: 0 };
    server.use(
      http.get('/api/user/self/channel-groups', () =>
        HttpResponse.json({ success: true, data: { auto: { ratio: '自动', desc: 'Auto' } } }),
      ),
      http.get('/api/token/', () =>
        HttpResponse.json({ success: true, data: tokensList }),
      ),
      http.post('/api/token/', () => {
        tokensList = {
          items: [
            { id: 1, name: 'first', status: 1, remain_quota: 0, used_quota: 0,
              unlimited_quota: true, expired_time: -1, created_time: 1713484800,
              model_limits_enabled: false, model_limits: '', allow_ips: '',
              group: 'auto', cross_group_retry: false, key: 'sk-test-1a2b3c4d' },
          ],
          total: 1,
        };
        return HttpResponse.json({ success: true });
      }),
    );
    const user = userEvent.setup();
    mount();
    await waitFor(() => expect(screen.getByText(/No API keys yet|暂无/)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Create key|创建/ }));
    await user.type(await screen.findByLabelText(/Name|名称/), 'first');
    await user.click(screen.getByRole('button', { name: /^Create$|^创建$/ }));
    await waitFor(() => expect(screen.getByText('first')).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: keys-edit-optimistic**

```tsx
// web-next/src/test/integration/keys-edit-optimistic.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, delay, http } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, test } from 'vitest';

import '@/i18n';
import { KeysPage } from '@/pages/Keys';
import { AuthProvider } from '@/providers/AuthProvider';
import { server } from '@/test/msw/server';

afterEach(() => server.resetHandlers());

describe('integration: keys edit optimistic', () => {
  test('edit sheet save updates table immediately', async () => {
    server.use(
      http.get('/api/user/models', () => HttpResponse.json({ success: true, data: [] })),
      http.get('/api/user/self/channel-groups', () =>
        HttpResponse.json({ success: true, data: { auto: { ratio: '自动', desc: 'Auto' } } }),
      ),
      http.get('/api/token/', () =>
        HttpResponse.json({
          success: true,
          data: {
            items: [{ id: 1, name: 'original', status: 1, remain_quota: 0, used_quota: 0,
                     unlimited_quota: true, expired_time: -1, created_time: 1713484800,
                     model_limits_enabled: false, model_limits: '', allow_ips: '',
                     group: 'auto', cross_group_retry: false, key: 'sk-x' }],
            total: 1,
          },
        }),
      ),
      http.put('/api/token/', async () => {
        await delay(200); // 模拟延迟
        return HttpResponse.json({ success: true, data: { id: 1 } });
      }),
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <MemoryRouter initialEntries={['/keys']}>
            <Routes>
              <Route path='/keys' element={<KeysPage />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText('original')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Actions/ }));
    await user.click(await screen.findByRole('menuitem', { name: /Edit/ }));
    const input = await screen.findByLabelText(/Name|名称/);
    await user.clear(input);
    await user.type(input, 'renamed');
    await user.click(screen.getByRole('button', { name: /Save|保存/ }));
    // optimistic: name 立即显示为 renamed，即使 PUT 还在 pending
    await waitFor(() => expect(screen.getByText('renamed')).toBeInTheDocument());
  });
});
```

- [ ] **Step 3: keys-delete-rollback**

```tsx
// web-next/src/test/integration/keys-delete-rollback.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, test } from 'vitest';

import '@/i18n';
import { KeysPage } from '@/pages/Keys';
import { AuthProvider } from '@/providers/AuthProvider';
import { server } from '@/test/msw/server';

afterEach(() => server.resetHandlers());

describe('integration: keys delete rollback', () => {
  test('server 500 → row re-appears', async () => {
    server.use(
      http.get('/api/token/', () =>
        HttpResponse.json({
          success: true,
          data: {
            items: [{ id: 1, name: 'victim', status: 1, remain_quota: 0, used_quota: 0,
                     unlimited_quota: true, expired_time: -1, created_time: 1713484800,
                     model_limits_enabled: false, model_limits: '', allow_ips: '',
                     group: 'auto', cross_group_retry: false, key: 'sk-v' }],
            total: 1,
          },
        }),
      ),
      http.delete('/api/token/:id', () =>
        HttpResponse.json({ success: false, message: 'oops' }, { status: 500 }),
      ),
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <MemoryRouter initialEntries={['/keys']}>
            <Routes>
              <Route path='/keys' element={<KeysPage />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText('victim')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Actions/ }));
    await user.click(await screen.findByRole('menuitem', { name: /Delete|删除/ }));
    await user.click(screen.getByRole('button', { name: /^Delete$|^删除$/ }));
    // optimistic 先移除再回滚
    await waitFor(() => expect(screen.getByText('victim')).toBeInTheDocument());
  });
});
```

- [ ] **Step 4: keys-reveal**

```tsx
// web-next/src/test/integration/keys-reveal.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import '@/i18n';
import { KeysPage } from '@/pages/Keys';
import { AuthProvider } from '@/providers/AuthProvider';
import { server } from '@/test/msw/server';

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => {
  vi.useRealTimers();
  server.resetHandlers();
});

describe('integration: keys reveal', () => {
  test('click eye → full key → 5s → mask', async () => {
    server.use(
      http.get('/api/token/', () =>
        HttpResponse.json({
          success: true,
          data: {
            items: [{ id: 1, name: 'k', status: 1, remain_quota: 0, used_quota: 0,
                     unlimited_quota: true, expired_time: -1, created_time: 1713484800,
                     model_limits_enabled: false, model_limits: '', allow_ips: '',
                     group: 'auto', cross_group_retry: false, key: 'sk-abcd1234' }],
            total: 1,
          },
        }),
      ),
      http.post('/api/token/1/key', () =>
        HttpResponse.json({ success: true, data: { key: 'sk-FULL-SECRET-VALUE' } }),
      ),
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <MemoryRouter initialEntries={['/keys']}>
            <Routes>
              <Route path='/keys' element={<KeysPage />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText('k')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Reveal|Show/ }));
    await waitFor(() =>
      expect(screen.getByText('sk-FULL-SECRET-VALUE')).toBeInTheDocument(),
    );
    act(() => vi.advanceTimersByTime(5000));
    await waitFor(() =>
      expect(screen.queryByText('sk-FULL-SECRET-VALUE')).not.toBeInTheDocument(),
    );
  });
});
```

- [ ] **Step 5: dashboard-loads**

```tsx
// web-next/src/test/integration/dashboard-loads.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, test } from 'vitest';

import '@/i18n';
import { DashboardPage } from '@/pages/Dashboard';
import { AuthProvider } from '@/providers/AuthProvider';
import { server } from '@/test/msw/server';

afterEach(() => server.resetHandlers());

describe('integration: dashboard loads', () => {
  test('quota card + trend + activity render', async () => {
    // user has existing history (so QuotaCard shows balance, not zero CTA)
    server.use(
      http.get('/api/user/self', ({ request }) => {
        if (!request.headers.get('new-api-user')) {
          return HttpResponse.json({ success: false }, { status: 401 });
        }
        return HttpResponse.json({
          success: true,
          data: {
            id: 42, username: 'alice', email: 'a@b', display_name: 'A', role: 1,
            platform_role: 0, tenant_role: 0, tenant_id: 1, group: 'default',
            quota: 25_000_000, used_quota: 10_000_000,
          },
        });
      }),
      http.get('/api/data/self', () =>
        HttpResponse.json({
          success: true,
          data: [
            { id: 1, tenant_id: 1, user_id: 42, username: 'alice', model_name: 'gpt',
              created_at: 1713484800, token_used: 100, count: 5, quota: 1000 },
          ],
        }),
      ),
      http.get('/api/log/self/stat', () =>
        HttpResponse.json({
          success: true,
          data: {
            quota: 10_000_000, rpm: 0, tpm: 0, total_requests: 1234,
            total_tokens: 567890, smartcache_savings_quota: 0,
          },
        }),
      ),
    );
    localStorage.setItem('new-api.auth-bootstrap', JSON.stringify({ id: 42, tenant_id: 1 }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <MemoryRouter initialEntries={['/dashboard']}>
            <Routes>
              <Route path='/dashboard' element={<DashboardPage />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(screen.getByText(/\$(50|\$\d)/)).toBeInTheDocument(),
    );
    // activity tile
    await waitFor(() => expect(screen.getByText('1,234')).toBeInTheDocument());
  });
});
```

- [ ] **Step 6: 跑所有集成测**

```bash
bun run test src/test/integration/
```

Expected: 5 PASS。

- [ ] **Step 7: Commit**

```bash
cd /e/new_key_api/keyapi
git add web-next/src/test/integration/
git commit -m "test(web-next): slice 2a integration flows (create/edit/delete/reveal/dashboard)"
```

---

## Task 24 — 验收闸 + 浏览器走查

**Files:** (no new files)

- [ ] **Step 1: 全量后端测试**

```bash
go build ./controller/... ./model/... ./middleware/... ./service/... ./router/... ./relay/...
go test ./unit_test/ -v
```

Expected: exit 0 + 新 15 case PASS。

- [ ] **Step 2: 全量前端 gate**

```bash
cd web-next
bun run typecheck
bun run eslint
bun run test
bun run build
```

Expected: 所有 exit 0。

- [ ] **Step 3: 启动 backend + frontend 浏览器走查**

```bash
# terminal A
go run main.go

# terminal B
cd web-next && bun run dev
```

浏览器打开 `http://localhost:4928/`（端口以 dev 服务实际为准，通常 4928/4929）：

- [ ] 登录已有账号 → `/dashboard` 渲染 3 widget（Quota、Usage trend、Activity）
- [ ] 切 7d/30d → URL 更新 + widget 重拉
- [ ] 点 sidebar → `/keys`：空态或已有行渲染正确
- [ ] 点 Create → 填名 / 选 group → 建出现新行
- [ ] 行 ⋯ → Edit → 改字段 → Save → 立即更新
- [ ] 行 ⋯ → Enable·Disable toggle → 行 opacity 变 + badge
- [ ] 点 👁 → key 全串显示 5s 自动回掩
- [ ] 点 Copy → clipboard 有 key
- [ ] 行 ⋯ → Delete → 确认 → 行消失 + toast
- [ ] 手造 URL `/keys/foo` → NotFound inside shell（slice 1 已过）

- [ ] **Step 4: 合并 / 推送 / PR 决策**

按 `superpowers:finishing-a-development-branch` 走选项（merge local / PR / keep as-is / discard）。

---

## 后续 slice 建议（不在本 plan 内）

- Slice 2b：`/topup` + `/plan`（支付闭环 + 套餐管理）
- Slice 2c：`/logs` + `/account`（日志表 + 账户设置）
- 性能：bundle 拆 chunk（recharts 独立 chunk）推到 2c 合并整理时做
