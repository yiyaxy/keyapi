# web-next Slice 2a — Keys + Dashboard — 设计文档

> **本文档覆盖 web-next 买家 console 的第一波真实实现**——`/keys`（API 密钥管理）与 `/dashboard`（用量概览），以及**配套后端租户隔离补丁**（阻塞级安全修复）。Slice 1 留下的 `ComingSoon` 占位由这两个页面替换。

**上游 spec**：[`docs/superpowers/specs/2026-04-18-web-next-slice-1-shell-auth-design.md`](./2026-04-18-web-next-slice-1-shell-auth-design.md)
**所处 slice 链**：Slice 1 Shell+Auth ✅ → **Slice 2a Keys+Dashboard**（本文档） → Slice 2b TopUp+Plan → Slice 2c Logs+Account → Slice 3 Playground → …

---

## 1. 背景与目标

### 1.1 前置
Slice 1 已交付：shell、auth、路由骨架、i18n、错误体系、测试基建、shadcn↔design_file token 桥接。租户 plumbing 在 slice 1 已验证（UserChip 正确显示 `Tenant #<id> · <group>`，axios 拦截器自动注入 `X-Tenant-Id` + `New-API-User` 头）。

### 1.2 本次目标（Slice 2a）
1. **后端**：修复 `controller/token.go` 中 5 处 handler 的租户隔离漏洞。GetToken / GetTokenKey / UpdateToken 走 `GetTokenByIds(id, userId)`、GetTokenKeysByIds 走 `GetTokenKeysByIds(ids, userId)`、DeleteToken 走 `DeleteTokenById(id, userId)`——**三个 model 函数全部不校验 `tenant_id`**。新增 3 个 tenant-aware 变体（`GetTokenByIdsTenant`、`GetTokenKeysByIdsTenant`、`DeleteTokenByIdTenant`），controller 切过去；保留旧函数不删（被 relay / channel 其他路径引用）。
2. **前端 `/keys`**：买家自助 CRUD API 密钥——列表、创建、编辑全字段、启用/禁用、删除、按需展开 key 全串。4 列极简表格 + 行外 `⋯` DropdownMenu + 右侧 SideSheet 编辑。
3. **前端 `/dashboard`**：买家用量概览——3 个 widget（Quota 卡 / 30 天用量折线 / 活动汇总卡）。时间段 7d/30d 下拉，URL search param 驱动。
4. **测试**：延续 slice 1 哲学（unit + component + MSW 集成），新增 5 条集成路径覆盖 keys/dashboard 关键流。后端 `unit_test/tenant_test.go` 扩展 5 个 case 覆盖新函数。

### 1.3 不覆盖（推到后续 slice）
| 模块 | 推到哪里 |
|---|---|
| Logs 页（`/logs` 仍 ComingSoon） | Slice 2c |
| Top up / Plan 页（`/topup`、`/plan` 仍 ComingSoon） | Slice 2b |
| Account 页（`/account` 仍 ComingSoon） | Slice 2c |
| Token 创建时一次性显示 + Regenerate（OpenAI Platform 风格） | 用户明确选了 reveal-toggle 方案，此变体不做 |
| Model icon 头像群（老 Semi UI 风格） | 不做；改用 "+N 种" 文字计数 + hover 列表 |
| 实时 RPM / TPM / 模型分布图 | 买家作用域 analytics 端点不存在；本 slice 不新增后端 |
| 多租户切换 UI | Phase 2 |
| 移动端响应式（<1024px） | Phase 2（slice 1 已定） |

---

## 2. 关键决策记录

| 决策项 | 选择 | 理由 |
|---|---|---|
| **租户漏洞修复时机** | 本 slice 一起做 | CLAUDE.md 明确 P0 安全；shipping 带洞前端 = 带洞上线 |
| **Keys 表列数** | 4 列极简 + SideSheet 编辑全字段 | 和 slice 1 定的 OpenAI Platform 审美一致；低频字段（group/model/IP）不占表格带宽 |
| **Key 展示 UX** | reveal-toggle（可重显） | 用户明确选择 B 方案；后端 `POST /:id/key` 已支持，利用现有能力 |
| **Dashboard widget 数量** | 3 个（精简 v1） | 买家作用域数据源有限（`/data/self` + `/log/self/stat`）；堆更多 widget 会落到要么假数据要么跟 Logs 页重复 |
| **代码组织** | feature-folder（`components/keys/` + `components/dashboard/` + `hooks/`）| slice 1 是扁平平铺；引入子 feature folder 防止 Keys 页膨胀成 500+ 行单文件 |
| **数据层** | TanStack Query（slice 1 已装 `QueryClient`） | 表格天然适合 stale-while-revalidate + mutation invalidation；optimistic 支持成熟 |
| **optimistic updates** | delete / toggle-status 走 optimistic；create / update 不走 | delete+toggle 无表单数据；create/update 需等后端回 id / 完整字段 |
| **表单** | react-hook-form + zod（slice 1 auth 风格一致） | 统一 |
| **图表库** | recharts | shadcn 的 chart 封装用它；16KB gzip 可接受；生态活跃 |
| **时间段持久化** | URL `?range=7d` / `?range=30d` | 可分享 + reload 保留；不走 Context 避免组件耦合 |
| **Revealed key 回收** | 5s 后本地 state 自动切回掩码 | 比 "永远可见" 或 "手动收起" 更安全；避免用户离开屏幕后肩窥 |
| **Topbar action slot** | AppShell 通过 React Router `Outlet context` 把 `setPageAction(node)` 传给页面；页面在 `useEffect` 里 set/unset | slice 1 的 `Topbar` 支持 `action` prop 但 AppShell 没 wire；page-level action（Create / Range select）需要一条 shell-level infra |
| **Create dialog 默认值** | `unlimited_quota: true` | 后端 `AddToken` (controller/token.go:170) 不做 "继承 user.quota" 归一化，原样收字段；`unlimited_quota=false` + `remain_quota` 不传 = 建出 0 额度死 key。Unlimited 作默认最能符合"快速建立第一个能用 key"的用户意图，用户可在 Edit 面板切非无限 |

---

## 3. 后端：租户隔离补丁

### 3.1 问题定位

`controller/token.go` 的 5 处 handler 依赖 `model.GetTokenByIds(id, userId int)`（`model/token.go`）。这个函数只做 `WHERE id = ? AND user_id = ?`，**不检查 tenant_id**。攻击者在 tenant A 拿到 token ID（例如通过 log 或猜测），如果恰好能登录 tenant B 且其 user_id 在 tenant B 也存在（多租户 user 合并场景），就能读/改/删 tenant A 的 token。

涉及 controller handler（注意 **Delete 和其他 4 个走不同 model 函数**，需要两个新 model 函数）：

| handler | 路由 | 底层 model 函数 | 当前 WHERE 条件 | 修法 |
|---|---|---|---|---|
| `GetToken` | `GET /api/token/:id` | `GetTokenByIds(id, userId)` | `id AND user_id` | 切到新 `GetTokenByIdsTenant(id, userId, tenantId)` |
| `GetTokenKey` | `POST /api/token/:id/key` | `GetTokenByIds(id, userId)` | 同上 | 同上 |
| `UpdateToken` | `PUT /api/token/` | `GetTokenByIds(id, userId)` | 同上 | 同上 |
| `GetTokenKeysByIds` | `POST /api/token/batch/keys` | `GetTokenKeysByIds(ids, userId)` | `id IN (?) AND user_id = ?` | 切到新 `GetTokenKeysByIdsTenant(ids, userId, tenantId)` |
| **`DeleteToken`** | `DELETE /api/token/:id` | **`DeleteTokenById(id, userId)`** (model/token.go:394) | `id AND user_id` | **切到新 `DeleteTokenByIdTenant(id, userId, tenantId)`** |

### 3.2 修复方案

**`model/token.go`** 新增三个函数：

```go
// GetTokenByIdsTenant 是 GetTokenByIds 的 tenant-aware 版本。
// 拒绝 id/userId/tenantId 任一为 0 的调用（fail-closed）。
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

// GetTokenKeysByIdsTenant 批量版。
func GetTokenKeysByIdsTenant(ids []int, userId, tenantId int) (map[int]string, error) {
    if len(ids) == 0 || userId == 0 || tenantId == 0 {
        return nil, errors.New("ids, userId, tenantId are required")
    }
    var tokens []Token
    err := DB.Select("id, key").Where("id IN ? AND user_id = ? AND tenant_id = ?", ids, userId, tenantId).Find(&tokens).Error
    if err != nil {
        return nil, err
    }
    out := make(map[int]string, len(tokens))
    for _, t := range tokens {
        out[t.Id] = t.Key
    }
    return out, nil
}

// DeleteTokenByIdTenant 是 DeleteTokenById 的 tenant-aware 版本。
// 保留 DeleteTokenById 不删（可能被其他路径调用）；controller 切到这里。
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

**原 `GetTokenByIds` / `DeleteTokenById` / `GetTokenKeysByIds` 都保留**。grep 确认除 controller 外还有其他调用点（relay / channel），不能贸然删除或改签名。Controller 层不再用它们做权限校验。

**`controller/token.go`** 5 处 handler 改写：在已有 `userId := c.GetInt("id")` 之后，新增 `tenantId := middleware.GetTenantId(c)`，然后：
- `GetToken` / `GetTokenKey` / `UpdateToken` → `GetTokenByIdsTenant(id, userId, tenantId)`
- `GetTokenKeysByIds` → `GetTokenKeysByIdsTenant(ids, userId, tenantId)`
- `DeleteToken` (line 262) → `DeleteTokenByIdTenant(id, userId, tenantId)`

### 3.3 对前端的影响
零。响应 shape、状态码、正常路径行为全部不变。只是跨租户的 id 查询从"放行"变成"not found"。

### 3.4 后端测试（`unit_test/tenant_test.go` 扩展）

```go
func TestGetTokenByIdsTenant(t *testing.T) {
    // setup: 建 tenant A 下的 user=1 token=100，tenant B 下的 user=2 token=200
    cases := []struct {
        name     string
        id       int
        userId   int
        tenantId int
        wantErr  bool
    }{
        {"same tenant same user", 100, 1, 1, false},
        {"same tenant different user", 100, 2, 1, true},
        {"cross tenant any user",   100, 1, 2, true}, // 核心：就是 bug 场景
        {"zero tenantId rejected",  100, 1, 0, true},
        {"zero userId rejected",    100, 0, 1, true},
    }
    for _, c := range cases { /* ... */ }
}
```

同样规模 5 case 各覆盖 `GetTokenKeysByIdsTenant` 和 `DeleteTokenByIdTenant`（共 15 case）。关键 assertion：跨租户 delete 返回 `not found`，目标行留在数据库（不被删）。

---

## 4. 前端 `/keys` 页面

### 4.1 路由 & 入口
`routes.tsx` 把 `/keys` 的 `element` 从 `<ComingSoon feature='API keys' />` 换成 `<KeysPage />`（`pages/Keys.tsx`）。

### 4.1.1 Page action slot（shell infra）

slice 1 的 `<Topbar>` 已支持 `action` prop，但 `AppShell` 硬编传 `title` 不传 `action`，页面无法挂入右上角按钮。本 slice 必须同时动：

**`AppShell.tsx` 改动**：
```tsx
// 新增 state 保存 page-level action 节点
const [pageAction, setPageAction] = useState<ReactNode>(null);
// Outlet 通过 context 暴露 setter
<Outlet context={{ setPageAction }} />
// Topbar 渲染 action
<Topbar title={t(titleKey)} action={pageAction} />
```

**新增 hook `hooks/usePageAction.ts`**：
```tsx
export function usePageAction(action: ReactNode) {
  const { setPageAction } = useOutletContext<{ setPageAction: (n: ReactNode) => void }>();
  useEffect(() => {
    setPageAction(action);
    return () => setPageAction(null);
  }, [action, setPageAction]);
}
```

Keys 页和 Dashboard 页都调 `usePageAction(...)` 挂按钮 / Select。

### 4.2 布局（AppShell 内）
```
Topbar (由 shell 渲染)
  title: "API keys"
  action: <Button>Create key</Button>  ← 通过 usePageAction 注入
Content (Outlet 渲染)
  empty state  |  <KeysTable items={tokens} />  |  error state
Pagination (if total > pageSize)
```

### 4.3 表格（4 列 + Ops）

| 列 | 渲染 | 空值处理 |
|---|---|---|
| **Name** | 粗体 `token.name`；下行灰色小字显示 group chain 简写（`auto` / `vip → default`） | name 空 → "Untitled" |
| **Key** | 掩码 `sk-••••{last4}` + 眼睛按钮 + 复制按钮；点击眼睛 → lazy 触发 `POST /:id/key`，成功后本组件 state 保留全串 5 秒自动回收 | 无 |
| **Usage** | `{fmtNum(used_quota)} / {fmtNum(remain_quota + used_quota)}`（货币化展示走 `fmtMoney`）+ 进度条（`data-0` 色）；`unlimited_quota=true` → 渲染 "Unlimited" badge | `remain_quota + used_quota === 0` → "—" |
| **Created** | `fmtDate(created_time, 'medium')`；`status !== 1` 时整行 opacity 0.6 + 右侧加 "Disabled" / "Expired" / "Exhausted" Badge | 无 |
| **Ops** | 最右固定列；DropdownMenu 触发按钮 `⋯`；菜单项：Edit / Enable·Disable / Delete（destructive） | 无 |

**注**：status 取值语义见 `model/token.go`：1=Enabled, 2=Disabled, 3=Expired, 4=Exhausted。Enable/Disable 切换只在 1↔2 间翻转；Expired/Exhausted 状态不可切回 Enabled（后端约束）。

### 4.4 Create dialog

shadcn `<Dialog>`。仅两个字段：
- **Name**（必填，1–50 字符）
- **Group**（Select，默认 `auto`；选项从 `GET /api/user/self/channel-groups`（controller `GetChannelGroups`，router/api-router.go:134）拉取；失败时 fallback `['auto', 'default']`）

提交：`POST /api/token/` body `{ name, group, unlimited_quota: true, remain_quota: 0, expired_time: -1 }`。**关键**：`unlimited_quota: true` 是**必须默认**，否则后端原样收字段会建出 `remain_quota=0 + unlimited=false` 的死 key（controller/token.go:170 不做"继承 user.quota"归一化）。用户想建非无限 key，在 Edit 面板开关调整。

成功后列表 invalidate，新 token 出现在表中第一行（默认 `created_time DESC`）。

小字提示："Created as unlimited. Switch to a custom quota, set IP allowlist, or scope to specific models in Edit."

### 4.5 Edit SideSheet

shadcn `<Dialog>` 以 `className` 改造成右侧 drawer（宽 480px）：

| 字段 | 组件 | 约束 |
|---|---|---|
| Name | `<Input>` | 1–50 字符 |
| Status | `<Switch>` Enabled/Disabled | Expired/Exhausted 状态禁用开关并标注原因 |
| Unlimited quota | `<Switch>` | 开启时禁用下面的 quota 输入 |
| Remain quota | `<Input type='number'>` | 0 ≤ x ≤ 1e9；unlimited 时灰 |
| Expires | `<DatePicker>`（shadcn Calendar 封）+ 快捷按钮：+1d / +7d / +30d / Never | Never → `expired_time=-1` |
| Model limits | Popover + Checkbox list（shadcn 没 MultiSelect；slice 2a 用粗粒度实现：点 trigger 弹 Popover 显示所有模型复选框，关闭后 summary 显示 "N selected"） | 数据源 `useAvailableModels()` → `GET /api/user/models`（controller `GetUserModels`，router/api-router.go:138）；空 = 不限 |
| Allow IPs | `<Textarea>`（行分隔） | 空 = 不限；每行校验 CIDR/IP 合法 |
| Group chain | 同上 MultiSelect + `<Switch>` Cross group retry | Cross retry 需选 ≥ 2 组才 enabled |

底部固定：`<Button>Save</Button>`（主）/ `<Button variant='secondary'>Cancel</Button>`。submit 走 `useUpdateToken` mutation，错误渲染 sheet 顶部 InlineBanner，不关 sheet 直到 dismiss 或成功。

### 4.6 Delete 流

点 Delete → 轻量 `<Dialog>` confirm："Delete `<name>`? Requests using this key will start failing." → 确认触发 `useDeleteToken.mutate`（optimistic 移除行）→ sonner toast `"Key deleted"`（不做 Undo 还原，仅 dismiss）。失败 → optimistic 回滚 + toast.error(err.backendMessage)。

### 4.7 空态
0 个 token 时（list query 返回 total=0）：
```
[ key icon 大尺寸 ]
No API keys yet
Create your first API key to start making requests.
[Create key] 按钮
```

### 4.8 Loading / 错误态
- 首次 load：6 行 Skeleton（table row 结构）
- 后续 refetch：不闪 skeleton，stale-while-revalidate 原地更新
- List query 失败：整页错误态 banner + Retry 按钮（点击 `refetch()`）
- 500 / 网络错：axios 拦截器已 toast；local 不重复

### 4.9 Key reveal 子流程

组件 `<KeyCell tokenId keyMasked />` 维护本地 state：
```tsx
const [revealed, setRevealed] = useState<string | null>(null);
const { mutate: reveal, isPending } = useRevealKey(tokenId);

useEffect(() => {
  if (!revealed) return;
  const id = setTimeout(() => setRevealed(null), 5_000);
  return () => clearTimeout(id);
}, [revealed]);

function onToggle() {
  if (revealed) { setRevealed(null); return; }
  reveal(undefined, { onSuccess: (full) => setRevealed(full) });
}
```

显示逻辑：`revealed ? full : keyMasked`；按钮图标 Eye/EyeOff 随 state 切换；isPending 时按钮显示小 Spin 替代图标。

---

## 5. 前端 `/dashboard` 页面

### 5.1 路由 & 入口
`routes.tsx` 把 `/dashboard` 的 `element` 从 `<ComingSoon feature='Dashboard' />` 换成 `<DashboardPage />`（`pages/Dashboard.tsx`）。

### 5.2 布局
```
Topbar
  title: "Dashboard"
  action: <Select>  7d / 30d (default: 30d)
Content (max-w-[1080px] mx-auto)
  <QuotaCard />
  <UsageTrendCard />    (height ≈ 280px)
  <ActivityCard />
```

单列固定宽，不做 grid 自适应（桌面优先；<1024px 已在 slice 1 做了 viewport 提示）。

### 5.3 `<QuotaCard>`

**数据源**：`user` 对象来自 `useAuth()`，不额外请求。关键字段语义（`/api/user/self` 返回的 `controller/user.go:490-491`）：
- `user.quota` = **当前余额**（可用 quota）
- `user.used_quota` = **历史累计已用**

因此：
- **Balance 大字** = `user.quota`（直接用）
- **Total** = `user.quota + user.used_quota`
- **Used** = `user.used_quota`
- **进度条宽** = `used_quota / (quota + used_quota)` 百分比（total 为 0 时进度条宽 0）

**渲染**：
```
╭─────────────────────────────────────╮
│  Balance                             │
│  $74.55                              │   ← fmtMoney(user.quota / quota_per_unit)
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │   ← 进度条
│  Used $25.45 of $100.00              │   ← fmtMoney(used_quota) · fmtMoney(quota + used_quota)
╰─────────────────────────────────────╯
```

- `user.quota === 0 && user.used_quota === 0` → 全新用户，不显示 balance 数字，改显：
  ```
  No balance · Top up to start    [Top up →]
  ```
  Top up 按钮跳 `/topup`（目前仍是 ComingSoon，链路成形即可）
- `user.quota === 0 && user.used_quota > 0` → 余额耗尽，Balance 显示 `$0.00`，下面副行照常，右上追加小 badge "Exhausted"

### 5.4 `<UsageTrendCard>`

**数据源**：`useUsageTrend(startTs, endTs)` → `GET /api/data/self?start_timestamp=<ts>&end_timestamp=<ts>`

**真实响应 shape**（`model/usedata.go:12` 的 `QuotaData` struct，`controller/usedata.go:32` 原样返回）：
```ts
type QuotaDataRow = {
  id: number;
  tenant_id: number;
  user_id: number;
  username: string;
  model_name: string;         // 按模型分桶
  created_at: number;         // unix 秒，桶时间戳（一般是小时粒度，取决于 logQuotaDataCache 的 key bucketing）
  token_used: number;
  count: number;              // 请求次数
  quota: number;              // 消耗额度（raw units，÷ quota_per_unit 才是货币）
};
// 端点返回 QuotaDataRow[]（多模型 × 多时间桶的扁平数组）
```

**前端聚合**：
- 把行按日期桶聚合 → 每天一个点：`{ day: floor(created_at / 86400) * 86400, quota: sum(row.quota), count: sum(row.count) }`
- 用 `range` 生成完整日期序列，无数据日补 0（避免曲线断裂）

**渲染**：
- shadcn `<Card>` 包 `<CardHeader>`（title "Usage over last {range}"）+ `<CardContent>`
- recharts `<LineChart>` 高 280；x-axis `day`（`fmtDate` 短格式 'MMM d'），y-axis `fmtMoney(quota/quota_per_unit)`
- Tooltip：hover 日期 → `{fmtDate} · {fmtMoney} · {fmtNum(count)} requests`

**空态**（新注册，`QuotaDataRow[]` 长度 0）：
```
[ line chart icon ]
No usage yet
Create a key to begin making requests.
[Create key →]  ← 跳 /keys
```

**Loading**：整 card 换成高 280 的 `<Skeleton>`。

### 5.5 `<ActivityCard>`

**数据源**：`useUserStat(startTs, endTs)` → `GET /api/log/self/stat?start_timestamp=<ts>&end_timestamp=<ts>`

**真实响应 shape**（`controller/log.go:163-175`）：
```ts
type LogSelfStat = {
  quota: number;                    // 已消耗额度 raw units
  rpm: number;                      // 近期 requests/min
  tpm: number;                      // 近期 tokens/min
  total_requests: number;
  total_tokens: number;
  smartcache_savings_quota: number; // 缓存命中节省的 raw units
};
```

**渲染**：3 个 `<StatTile>` 横排（flex gap-4），使用 `total_requests` / `total_tokens` / `quota` 字段（`rpm` / `tpm` / `smartcache_savings_quota` 本 slice 不展示，留给 Logs 页 slice 2c）：
```
Requests        Tokens           Consumed
{total_requests}  {total_tokens}   {fmtMoney(quota/quota_per_unit)}
12,347          8.2M             $25.45
```

每 tile：
```
╭─────────────────────╮
│  Requests            │  ← muted label
│  12,347              │  ← h3 大数字
╰─────────────────────╯
```

### 5.6 时间段切换

`<RangeSelect>` 通过 `usePageAction(<RangeSelect />)` 挂到 Topbar action 位。值 `7d` / `30d`（默认 `30d`）。

```tsx
const [params, setParams] = useSearchParams();
const range = (params.get('range') === '7d' ? '7d' : '30d');
// onChange: setParams({ range: v });
```

所有 widget 读 `range`（dashboard 顶层计算 `startTs/endTs` 传下）。URL 变化 + reload 保留 + 分享可用。

---

## 6. 数据层（TanStack Query）

### 6.1 Query keys

```ts
// src/hooks/queryKeys.ts
export const qk = {
  tokens: {
    list: (page: number) => ['tokens', 'list', page] as const,
    detail: (id: number) => ['tokens', 'detail', id] as const,
  },
  user: {
    self: ['user', 'self'] as const,                           // AuthProvider 内部用
    dataSelf: (startTs: number, endTs: number) =>
      ['user', 'data', startTs, endTs] as const,
    statSelf: (startTs: number, endTs: number) =>
      ['user', 'stat', startTs, endTs] as const,
  },
  meta: {
    availableModels: ['meta', 'models'] as const,
  },
} as const;
```

### 6.2 Hooks 清单

| Hook | 返回 | 策略 |
|---|---|---|
| `useTokensQuery(page)` | `{ items, total, isLoading, error, refetch }` | `staleTime: 30_000` |
| `useCreateToken()` | `{ mutate, isPending }` | onSuccess → `qc.invalidateQueries({ queryKey: ['tokens'] })` |
| `useUpdateToken()` | `{ mutate, isPending }` | optimistic 更新 list 缓存；onError 回滚；onSettled invalidate |
| `useDeleteToken()` | `{ mutate, isPending }` | optimistic 移除行；onError 回滚 |
| `useToggleTokenStatus(id)` | `{ mutate }` | 薄层包 `useUpdateToken`，传 `status_only=1`，optimistic |
| `useRevealKey(tokenId)` | `{ mutate: () => Promise<string> }` | 不缓存；每次调用新拉；不写 React Query cache（敏感数据） |
| `useUsageTrend(startTs, endTs)` | `{ data: QuotaDataRow[], isLoading }` | `GET /api/data/self`；`staleTime: 5 * 60_000`；range 变即重拉 |
| `useUserStat(startTs, endTs)` | `{ data: LogSelfStat, isLoading }` | `GET /api/log/self/stat`；`staleTime: 5 * 60_000` |
| `useAvailableModels()` | `{ data: string[] }` | `GET /api/user/models`；`staleTime: Infinity`（页面会话内不变） |
| `useChannelGroups()` | `{ data: ChannelGroup[] }`，其中 `ChannelGroup = { name: string; ratio: number \| string; desc: string }` | `GET /api/user/self/channel-groups` 返回 `Record<string, {ratio, desc}>`；**`ratio` 可能是 `number`（常规组的倍率）或 `string`（`auto` 组固定返回字符串 `"自动"`，见 `controller/group.go:76`）**。hook 归一化为 `[{name, ratio, desc}]`，UI 渲染按类型分支：number 显示 `×{ratio.toFixed(2)}`，string 直接显示；`staleTime: Infinity` |

### 6.3 全局 QueryClient 调整

已在 slice 1 的 `App.tsx` 定义：
```ts
new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
  },
})
```

新增：`refetchOnReconnect: true`（网络恢复时主动刷新）。

### 6.4 Optimistic 写流（delete 为例）

```ts
export function useDeleteToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      api.delete(`/api/token/${id}`).then(r => r.data),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['tokens', 'list'] });
      const previous = qc.getQueriesData({ queryKey: ['tokens', 'list'] });
      qc.setQueriesData<{ items: Token[]; total: number }>(
        { queryKey: ['tokens', 'list'] },
        (old) => old ? { ...old, items: old.items.filter(t => t.id !== id), total: old.total - 1 } : old
      );
      return { previous };
    },
    onError: (_err, _id, ctx) => {
      ctx?.previous?.forEach(([key, data]) => qc.setQueryData(key, data));
      toast.error('Failed to delete key');
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['tokens', 'list'] });
    },
  });
}
```

---

## 7. 错误处理（flow-by-flow）

| 场景 | 处理 |
|---|---|
| GET `/token/` 500 | api.ts 兜底 toast + 整页错误 banner "Failed to load · Retry" |
| GET `/token/` 401 | api.ts emit `unauthorized` → RootLayout 跳 `/login?redirect=/keys`（slice 1 已就绪） |
| POST create `{success:false, message:"Plan limit reached"}` | `ApiError.backendMessage` 渲染成 Create dialog 内联 InlineBanner |
| POST create 超 `plan.MaxTokens` | backend message 直接显示 |
| PUT update 失败 | optimistic rollback；SideSheet 顶部 InlineBanner；不关 sheet 直到用户 dismiss 或重试成功 |
| DELETE 失败 | optimistic 回滚行；toast.error；不显示确认 dialog 内 banner（已关） |
| POST `/:id/key` 失败 | cell 内 tiny toast "Failed to reveal"；toggle state 不切换 |
| Network down | axios 拦截器已 toast `network`；local 不重复 |
| 跨租户 id 查询（修后） | 后端 404 → 列表刷新；UI 不特殊化 |
| `/data/self` 返空数组 | UsageTrendCard 空态文案 + 跳 `/keys` CTA |

**边界值**：
- `remain_quota < 0`（极端并发） → 显示 0
- `model_limits` 空字符串 = 不限
- `allow_ips` 每行 trim；空行忽略
- `expired_time === -1` → "Never"
- `used_quota + remain_quota === 0` → Usage 列显 "—"

---

## 8. 测试范围

### 8.1 后端

`unit_test/tenant_test.go` 扩展（**共 15 case，3 函数 × 5 模式**）：
- `TestGetTokenByIdsTenant`：5 case（同 tenant 同 user / 同 tenant 别 user / 跨 tenant / tenantId=0 / userId=0）
- `TestGetTokenKeysByIdsTenant`：5 case（同上模式）
- `TestDeleteTokenByIdTenant`：5 case（同上模式，并额外断言**跨租户 delete 返回 not found 且目标行仍在 DB**——这是漏洞本身的直接回归测）

### 8.2 前端单测（TDD）

| 文件 | 测试点 |
|---|---|
| `hooks/useTokens.test.tsx` | list query 返回 items；create 成功触发 list invalidate；delete optimistic 行消失；delete 失败回滚 |
| `hooks/useUsageTrend.test.tsx` | range 变化触发重拉；空响应不崩 |
| `lib/token-schema.test.ts` | zod schema 边界（name 长度 / remain_quota 非负 / IP 每行格式 / group 逗号拆分） |
| `lib/usage-aggregate.test.ts` | **dashboard 趋势卡核心逻辑**：小时桶 → 按日 reduce 求和；跨月边界不丢点；空输入不崩；`range` 内无数据日补 0；时区边界（UTC vs 本地）一致（选定 UTC 聚合避免浏览器时区飘移） |

### 8.3 前端组件测

| 文件 | 测试点 |
|---|---|
| `components/keys/EditTokenSheet.test.tsx` | submit 触发 mutate；必填校验；Unlimited 禁用 quota 输入；Cross group retry 需 ≥ 2 组 |
| `components/keys/KeyCell.test.tsx` | reveal 调 mutate 并渲染全串；5s 后回缩；失败不切换 |
| `components/dashboard/QuotaCard.test.tsx` | 0 quota 显示 Top up CTA；进度条计算；正常态数字格式 |
| `components/dashboard/StatTile.test.tsx` | 数字格式化；空值降级 |

### 8.4 MSW 集成测（`test/integration/`）

1. **`keys-create.test.tsx`**：空 `/keys` → Create dialog → 填 name/group → 提交 → 行出现 + toast
2. **`keys-edit-optimistic.test.tsx`**：改 name → SideSheet 提交 → 表格立即更新（mock 延迟响应）
3. **`keys-delete-rollback.test.tsx`**：mock 返 `success:false` → 行回插 + toast error
4. **`keys-reveal.test.tsx`**：点眼睛 → `POST /:id/key` 返回 → 5s timer 后回掩码
5. **`dashboard-loads.test.tsx`**：mock `/data/self` 返 30 天样本 + `/stat/self` 返聚合 → 3 widget 正常渲染

### 8.5 验收闸（complete-time）

```bash
# 后端
go build ./controller/... ./model/... ./middleware/... ./service/...
go test ./unit_test/ -run TestGetTokenByIdsTenant -v
go test ./unit_test/ -run TestGetTokenKeysByIdsTenant -v
go test ./unit_test/ -run TestDeleteTokenByIdTenant -v

# 前端
cd web-next
bun run typecheck
bun run eslint
bun run test
bun run build
```

浏览器走查清单（带后端联调）：
- [ ] `/keys` 空态 → Create → 新行
- [ ] 点眼睛 reveal 全串 → 5s 自动回掩码
- [ ] Edit SideSheet 改 name → 表格乐观更新
- [ ] Delete → 行消失 + toast
- [ ] Enable/Disable toggle → 行降透明 + Disabled badge
- [ ] `/dashboard` 3 widget 正常渲染
- [ ] range 切 7d/30d → URL 更新 + widget 重拉
- [ ] `quota=0` 账号 → QuotaCard 显示 Top up CTA
- [ ] 新账号无用量 → UsageTrendCard 空态
- [ ] 跨租户 id（手造 URL 直接访问）→ 404 / 刷新

---

## 9. 文件地图

### 9.1 后端（新增 / 修改）
```
model/token.go                    # 新增 GetTokenByIdsTenant, GetTokenKeysByIdsTenant, DeleteTokenByIdTenant
controller/token.go               # 5 处 handler 切换
unit_test/tenant_test.go          # 扩展 15 个 case（3 函数 × 5 模式）
```

### 9.2 前端新增
```
web-next/
  src/
    pages/
      Keys.tsx
      Dashboard.tsx
    components/
      keys/
        KeysTable.tsx
        TokenRow.tsx
        KeyCell.tsx
        KeyCell.test.tsx
        CreateTokenDialog.tsx
        EditTokenSheet.tsx
        EditTokenSheet.test.tsx
        DeleteConfirmDialog.tsx
        EmptyKeys.tsx
      dashboard/
        QuotaCard.tsx
        QuotaCard.test.tsx
        UsageTrendCard.tsx
        ActivityCard.tsx
        StatTile.tsx
        StatTile.test.tsx
        RangeSelect.tsx
      ui/                                # shadcn CLI 生成
        select.tsx
        switch.tsx
        popover.tsx
        textarea.tsx
        calendar.tsx
        card.tsx
        chart.tsx                        # shadcn chart wrapper（依赖 recharts）
    hooks/
      usePageAction.ts                   # shell infra（§4.1.1）
      useTokens.ts
      useTokens.test.tsx
      useRevealKey.ts
      useUsageTrend.ts
      useUsageTrend.test.tsx
      useUserStat.ts
      useAvailableModels.ts
      useChannelGroups.ts
    lib/
      queryKeys.ts
      token-schema.ts
      token-schema.test.ts
      usage-aggregate.ts                 # QuotaDataRow[] → daily 聚合（§5.4）
      usage-aggregate.test.ts
    test/
      integration/
        keys-create.test.tsx
        keys-edit-optimistic.test.tsx
        keys-delete-rollback.test.tsx
        keys-reveal.test.tsx
        dashboard-loads.test.tsx
```

### 9.3 前端修改
```
web-next/src/routes.tsx                  # /keys 和 /dashboard 的 element 替换
web-next/src/components/layout/AppShell.tsx   # useState pageAction + Outlet context + Topbar action 注入（§4.1.1）
web-next/src/i18n/locales/{zh,en}/keys.json         # 新 ns
web-next/src/i18n/locales/{zh,en}/dashboard.json    # 新 ns
web-next/src/i18n/index.ts               # 注册 keys / dashboard 两个新 ns
web-next/src/App.tsx                     # QueryClient refetchOnReconnect: true
web-next/package.json                    # 加 recharts + shadcn 新增 primitive
web-next/bun.lock                        # 自动更新
```

---

## 10. 依赖新增

### runtime
```json
{
  "dependencies": {
    "recharts": "^2.15.0",
    "@radix-ui/react-select": "^2.x",
    "@radix-ui/react-switch": "^1.x",
    "@radix-ui/react-popover": "^1.x",
    "react-day-picker": "^9.x",
    "date-fns": "^4.x"
  }
}
```

### shadcn primitives 新增（通过 `bunx shadcn@latest add <name>` 生成）
- `select` — Create dialog 的 group select + Edit sheet 的 group chain select
- `switch` — Edit sheet 的 Status / Unlimited / Cross group retry 三个开关
- `popover` — model limits 多选器外壳
- `textarea` — allow_ips 输入
- `calendar` + DatePicker 组合 — expired_time 选择器（shadcn datepicker 是 Popover + Calendar 的组合范例）
- `card` — Dashboard 三个 widget 外壳
- `chart` — shadcn 的 recharts 轻封装（ChartContainer / ChartTooltip）

shadcn primitive 会自动把对应 Radix peer dep 写进 `package.json`；runtime 列表是为了明确本 slice 实际引入的 npm 包。


---

## 11. i18n 新增 namespace

`keys` ns（zh + en）— 大致 25–30 个 key：
- `page.title`, `page.create`, `page.empty.title`, `page.empty.body`, `page.empty.cta`
- `table.col.name`, `table.col.key`, `table.col.usage`, `table.col.created`
- `status.enabled`, `status.disabled`, `status.expired`, `status.exhausted`, `status.unlimited`
- `create.title`, `create.name`, `create.group`, `create.submit`, `create.hint_advanced`
- `edit.title`, `edit.field.*`, `edit.save`, `edit.cancel`
- `delete.title`, `delete.body`, `delete.confirm`
- `reveal.copy`, `reveal.copied`, `reveal.failed`

`dashboard` ns（zh + en）— 大致 15 个 key：
- `page.title`, `range.7d`, `range.30d`
- `quota.label`, `quota.used_of_total`, `quota.zero_body`, `quota.topup`
- `usage.title`, `usage.empty.title`, `usage.empty.body`, `usage.empty.cta`
- `activity.requests`, `activity.tokens`, `activity.consumed`

---

## 12. 风险 & 缓解

| 风险 | 缓解 |
|---|---|
| 租户补丁改到非测试路径的 `GetTokenByIds` / `DeleteTokenById` / `GetTokenKeysByIds` 被 relay 复用，误改会炸 relay | 只**新增** tenant-aware 变体；旧函数签名一字不动；controller 层切换到新函数；grep 确认其他调用点不受影响；加 go build 全包验证 |
| recharts 加入后 bundle 继续增大（slice 1 已 725KB gzip 224KB 警告） | 本 slice 接受单 chunk；chunk split 推 slice 2c 后做（更多图表页进来后集中优化） |
| MultiSelect 组件 shadcn 没现成，自造成本 | slice 2a 内用 Popover + Checkbox list 粗粒度实现；slice 2b/2c 遇到同样需求时再抽成公共组件 |
| Delete 无 Undo 还原流程，用户误删无法恢复 | UI 明确 "Requests using this key will start failing"；Create 成本低，用户可重建 |
| reveal-toggle UX 比一次性展示更容易暴露 key（肩窥） | 5s 自动回收降低窗口；未来 slice 可能加 "only show once" 偏好设置 |
| Create 默认 `unlimited_quota: true` 让新 key 不受用户 quota 限制 | 后端 relay 阶段仍然扣用户 quota（`user.quota`），unlimited 只解除 token 自身的 quota 上限；用户不会因为无限 token 超支。Edit 面板即可切回非无限 |
| Topbar action 通过 `Outlet context` 注入，页面 unmount 时要清 | `usePageAction` hook 的 cleanup 已 `setPageAction(null)`；竞态在同页 re-render 时理论存在，但 effect dep 包含 `action` 可缓解 |

---

## 13. 开放问题（实现阶段确认）

以下问题在 spec 内均已锁定，实现阶段无需再读代码确认：

- ✅ `/api/log/self/stat` shape → `controller/log.go:163–175`（`quota` / `rpm` / `tpm` / `total_requests` / `total_tokens` / `smartcache_savings_quota`）
- ✅ `/api/user/models` shape → `controller/user.go:621` 明确返回 `[]string`（仅模型名数组，无 `{id, name}` 对象）
- ✅ `/api/user/self/channel-groups` shape → `controller/group.go:58`；`ratio` 类型为 `number | string`（`auto` 组为字符串 `"自动"`）；`useChannelGroups` 归一化为 `ChannelGroup[]`
- ✅ Token `Group` 字段 → `model/token.go:31` 是 `string`；多组时用逗号分隔（CSV 语义，与老 UI `TokensColumnDefs.jsx` 一致）；前端 schema `parseGroupChain(str): string[]` / `serializeGroupChain(arr): string`
- ✅ `QuotaData.created_at` 桶粒度 → `model/usedata.go:62` 明确小时对齐（`createdAt - (createdAt % 3600)`）；`usage-aggregate.ts` 按 24 个点一天 reduce

本 section 现为空——slice 2a 实现阶段不再有"等确认"的接口细节。

---

## 14. 开始实现

设计文档审批后，运行 `superpowers:writing-plans` 生成实现计划（task-by-task 的 plan.md），按 slice 1 风格：17–20 个 task，TDD 标记，依赖图，每 task 自有 build/test 验收 gate。
