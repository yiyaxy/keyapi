# Shell & Nav — Design Spec

**Date:** 2026-04-17
**Sub-project:** #1 of 7 in the keyapi/web refactor roadmap
**Status:** Draft → awaiting user review
**Owner:** LO / ENI

---

## 1. Context & Goals

keyapi/web 是一个基于 Semi UI 的 AI 网关 / API Key 管理 SaaS 前端。已于本轮建立
`.impeccable.md` + `CLAUDE.md` 中的 Design Context：

- 用户画像：**最终付费用户**（开发者型个人 / 小团队管理员）
- 品牌气质：**技术 · 锐利 · 现代**
- 参考系：OpenAI Platform / Anthropic Console
- 主题：双主题，品牌色一致

当前外壳（`src/components/layout/`）存在三个问题：

1. `SiderBar.jsx` 724 行 / `PageLayout.jsx` 222 行 —— 单文件职责过重，不可维护
2. 顶栏塞了 11 个子组件（logo / 租户 / 通知 / 主题 / 语言 / 新年 / Playground 按钮 / 用户区 / 顶部导航 / 移动菜单 / action 集合），视觉拥挤且与"最终付费用户"的克制画像背离
3. 侧栏的信息架构未显式按 JTBD 分组，55+ 页面平铺带来导航负担

本子项目目标：**重做 Shell 与 Navigation，将骨架对齐 Design Context**，为后续 6 个子项目（Dashboard、付费闭环、开发者工作台、数据消费、管理员向、支持类）提供稳定的外壳。

### JTBD 对照

1. 60 秒内看懂"剩多少 / 花了多少 / 下一笔何时扣" → BalanceCard 常驻 + Dashboard hero 卡
2. 一键完成充值 / 切换订阅 / 开票 → BILLING 分组置于 DEVELOP 之上
3. 拿到可用的 API key 与最小接入片段 → DEVELOP 分组；Keys + Playground + Models & pricing 集中

## 2. Scope

**In-scope（本 spec 覆盖）：**

- `src/components/layout/` 全部文件的拆分与重写
- 全局折叠 / 响应式 / 主题切换的统一 hook
- 导航数据模型（`useNavItems`）与路由权限过滤
- Header、Sidebar、BalanceCard、SidebarDrawer、UserMenu、TenantSwitcher
- 相关 i18n keys 新增（zh 源 + 同步占位）
- 视觉 / 行为 / 主题 / 权限 / i18n / 代码质量 六类验证清单

**Out-of-scope（显式排除）：**

- 任何具体 page 内部（`src/pages/**/index.jsx` 的重构，留给后续子项目）
- VChart theme / 图表调色（留到"数据消费"子项目）
- Footer 实质内容（本 PR 只放骨架与占位）
- 后端 API 变更、用户权限模型变更（复用现有 `user.role` / `user.tenants`）
- 命令面板（`Cmd+K` search）
- 新组件库评估或替换

## 3. Decisions (locked during brainstorm)

| # | 决策 | 值 | 来源 |
|---|---|---|---|
| Q1 | Nav topology | **A — 左栏为王（OpenAI 派）**。Header 只保留 logo + 租户切换 + 用户头像 | `.superpowers/brainstorm/.../nav-topology.html` |
| Q2 | 侧栏信息架构 | **OVERVIEW / BILLING / DEVELOP / SUPPORT** + 条件分组 **TENANT ADMIN** / **PLATFORM** | `.../sidebar-ia.html` |
| Q3 | Balance 位置 | **A — 侧栏底部固定卡**（金额 + CTA，**无进度条**，2d 选项）；Dashboard 另有 hero 卡 | `.../balance-placement.html` |
| Q4 | 折叠 & 响应式 | **三态**：≥1024 持久 240px / 768–1023 自动 64px rail / <768 drawer；`Ctrl/⌘+\` 切换；localStorage 记忆；200ms 过渡 | `.../collapse-responsive.html` |

## 4. Architecture

### 4.1 Target file layout

```
src/components/layout/
├── PageLayout.jsx              # 壳：Header + Sidebar + <Outlet/>
├── Footer.jsx                  # 保留；内容收敛（本 PR 只定骨架）
├── useLayoutState.js           # 新：collapse state + localStorage + 媒体查询
├── useNavItems.js              # 新：路由表 + 权限 + feature flag → nav 数据
│
├── header/                     # 原 headerbar/ 改名
│   ├── Header.jsx              # 瘦顶栏骨架
│   ├── HeaderLogo.jsx
│   ├── TenantSwitcher.jsx      # 重构：combobox + search + recent，单租户时隐藏
│   ├── UserMenu.jsx            # 合并原 UserArea + 通知 / 主题 / 语言 / NewYear
│   └── MobileMenuButton.jsx    # <768 才渲染
│
└── sidebar/                    # 拆自 SiderBar.jsx（724 行 → 5 文件，每个 ≤200）
    ├── Sidebar.jsx             # 壳：展开 / rail 分流 + 过渡
    ├── NavTree.jsx             # 分组容器
    ├── NavGroup.jsx            # 分组 label + 子条目
    ├── NavItem.jsx             # 单条目 icon + label + active / tooltip
    ├── BalanceCard.jsx         # 底部卡（展开 / 折叠两态）
    └── SidebarDrawer.jsx       # <768 抽屉变体
```

**弃用 / 迁移：**

- `headerbar/Navigation.jsx` — 删除（顶栏不再承担一级导航）
- `headerbar/PlaygroundButton.jsx` — 删除（入口已在 DEVELOP 分组）
- `headerbar/ActionButtons.jsx` — 删除（所有动作并入 UserMenu）
- `headerbar/NotificationButton.jsx` — 内容迁入 `UserMenu` 的"通知"项（打开抽屉 + badge）
- `headerbar/ThemeToggle.jsx` — 内容迁入 `UserMenu` 主题子菜单
- `headerbar/LanguageSelector.jsx` — 内容迁入 `UserMenu` 语言子菜单
- `headerbar/NewYearButton.jsx` — 迁入 `UserMenu` 顶部"活动"临时区（有开关，无活动不渲染）

### 4.2 Navigation data model

```js
// useNavItems.js 产出数据
[
  {
    group: 'OVERVIEW',
    i18nKey: 'nav.group.overview',
    items: [
      { id: 'dashboard',     icon: 'dashboard', to: '/',              i18nKey: 'nav.dashboard' },
      { id: 'logs',          icon: 'history',   to: '/log',           i18nKey: 'nav.logs' },
      { id: 'request-trace', icon: 'search',    to: '/request-trace', i18nKey: 'nav.requestTrace' },
      { id: 'analytics',     icon: 'trend',     to: '/analytics',     i18nKey: 'nav.analytics' },
    ],
  },
  {
    group: 'BILLING',
    i18nKey: 'nav.group.billing',
    items: [
      { id: 'topup',        icon: 'credit-card', to: '/topup',        i18nKey: 'nav.topup' },
      { id: 'subscription', icon: 'package',     to: '/subscription', i18nKey: 'nav.subscription' },
      { id: 'redemption',   icon: 'gift',        to: '/redemption',   i18nKey: 'nav.redemption' },
      { id: 'invoices',     icon: 'file-text',   to: '/invoice',      i18nKey: 'nav.invoices' },
    ],
  },
  {
    group: 'DEVELOP',
    i18nKey: 'nav.group.develop',
    items: [
      { id: 'api-keys',   icon: 'key',      to: '/token',      i18nKey: 'nav.apiKeys' },
      { id: 'playground', icon: 'flask',    to: '/playground', i18nKey: 'nav.playground' },
      { id: 'chat',       icon: 'message',  to: '/chat',       i18nKey: 'nav.chat' },
      { id: 'models',     icon: 'box',      to: '/pricing',    i18nKey: 'nav.modelsAndPricing' },
    ],
  },
  {
    group: 'SUPPORT',
    i18nKey: 'nav.group.support',
    items: [
      { id: 'tickets', icon: 'help',     to: '/ticket', i18nKey: 'nav.tickets' },
      { id: 'inbox',   icon: 'inbox',    to: '/inbox',  i18nKey: 'nav.inbox' },
    ],
  },
  {
    group: 'TENANT_ADMIN',
    requireRole: 'tenant_admin',
    i18nKey: 'nav.group.tenant',
    items: [
      { id: 'tenant-dashboard', icon: 'building', to: '/tenant',         i18nKey: 'nav.tenantDashboard' },
      { id: 'tenant-members',   icon: 'users',    to: '/tenant/members', i18nKey: 'nav.members' },
      { id: 'tenant-plan',      icon: 'package',  to: '/tenant/plan',    i18nKey: 'nav.plan' },
      { id: 'tenant-config',    icon: 'settings', to: '/tenant/config',  i18nKey: 'nav.tenantConfig' },
      { id: 'tenant-bills',     icon: 'receipt',  to: '/tenant/bills',   i18nKey: 'nav.tenantBills' },
      { id: 'tenant-alerts',    icon: 'bell',     to: '/tenant/alerts',  i18nKey: 'nav.alerts' },
      { id: 'tenant-audit',     icon: 'shield',   to: '/tenant/audit',   i18nKey: 'nav.audit' },
      { id: 'channels',         icon: 'plug',     to: '/channel',        i18nKey: 'nav.channels' },
    ],
  },
  {
    group: 'PLATFORM',
    requireRole: 'super_admin',
    i18nKey: 'nav.group.platform',
    items: [
      { id: 'tenants',        icon: 'bank',       to: '/platform/tenants', i18nKey: 'nav.platformTenants' },
      { id: 'agents',         icon: 'robot',      to: '/agents',           i18nKey: 'nav.agents' },
      { id: 'admin-invoices', icon: 'file-text',  to: '/invoice-admin',    i18nKey: 'nav.adminInvoices' },
      { id: 'admin-tickets',  icon: 'help',       to: '/ticket-admin',     i18nKey: 'nav.adminTickets' },
      { id: 'site-settings',  icon: 'settings',   to: '/setting',          i18nKey: 'nav.siteSettings' },
    ],
  },
]
```

> 实际路由路径以当前 `src/App.jsx` 为准；本表仅为参考结构，实现时按路由表对齐。

分组级过滤由 `useNavItems` 在 hook 内完成，消费端只拿到可见结果。

## 5. Header Design

### 5.1 Layout

```
┌────────────────────────────────────────────────────────────────┐
│  [logo] keyapi   [acme ▾]                        [👤 avatar ▾] │
└────────────────────────────────────────────────────────────────┘
```

- 高度 **56px**；底边 1px `--semi-color-border`；无阴影
- 左：`HeaderLogo`（点击回 `/`）+ `TenantSwitcher`（仅当 `user.tenants.length >= 2` 时渲染）
- 右：`UserMenu`
- 移动端（<768）：左侧首位插 `MobileMenuButton`

### 5.2 TenantSwitcher

- Semi `Select` + `filter`（搜索）+ 自定义 renderSelectedItem
- 顶部展示"recent"（最近切换的 3 个租户）+ 分隔 + 全量列表
- 切换后刷新当前路由数据（不强制 reload）
- 空状态：0 租户时由上游守卫负责跳转，本组件不渲染

### 5.3 UserMenu

Semi `Dropdown` 结构（自上而下）：

1. 用户邮箱 / 用户名（只读行，`cursor: default`）
2. `—— 分隔 ——`
3. **活动**（临时区；有 active campaign 时显示，否则整块不渲染）
   - e.g. 新年活动入口
4. `—— 分隔 ——`
5. Settings → `/setting`
6. 通知（右侧 badge 显示未读数；点击打开通知抽屉）
7. 主题 → 子菜单：跟随系统 / 明 / 暗（当前值打勾）
8. 语言 → 子菜单：中文 / English / ...（当前值打勾）
9. `—— 分隔 ——`
10. About / Privacy / Agreement / Refund policy（次级链接组）
11. `—— 分隔 ——`
12. Sign out

avatar 尺寸 32px，圆角 `--semi-border-radius-circle`；dropdown 宽 240。

## 6. Sidebar Design

### 6.1 Expanded (240px)

```
┌──────────────────┐
│ OVERVIEW         │  .nav-group-label — 11px uppercase
│                  │  letter-spacing: 0.08em; color text-2
│ ◉ Dashboard      │  active: bg fill-1; 左 2px 主色竖线
│   Logs           │  default: color text-1
│   Request trace  │
│   Analytics      │
│                  │
│ BILLING          │
│   Top up         │
│   Subscription   │
│   Redeem code    │
│   Invoices       │
│                  │
│ (更多分组…)       │
│                  │
├──────────────────┤
│ BALANCE          │  10px text-2; tracking 0.05em
│ ¥ 1,284.50       │  18px/600 tabular-nums; text-0
│ [    Top up    ] │  Semi Button type=tertiary block
└──────────────────┘
```

- NavItem 高度 **32px**，padding-left 12 / padding-right 8，icon 18px
- hover：bg `--semi-color-fill-0`
- active：bg `--semi-color-fill-1` + 左 2px 主色竖线 + 文字 text-0 weight 500
- 分组 label 前后间距 12px；分组间 12px 空白（不画分隔线）
- 侧栏 padding 上下 12；条目间距 2
- 滚动：内部 `overflow-y:auto`（保留现有 webkit scrollbar 隐藏规则）

### 6.2 Active matching rule

- 基于路由前缀匹配：当前 `location.pathname` 以 `item.to` 开头视为命中
- 同一分组多条目命中时，只高亮 **最深匹配**（`to` 字符串更长者优先）
- 例：`/tenant/members` 命中 `{ to: '/tenant' }` 与 `{ to: '/tenant/members' }`；仅后者高亮
- 不支持跨分组同时高亮（避免视觉噪声）

### 6.3 Collapsed rail (64px)

- 仅 icon，无 label / 无分组 label（分组间 8px 空白区分）
- 每条 icon hover → Semi `Tooltip`（position=right，delay 300ms）展示完整 label
- active 态：保留左 2px 主色竖线 + bg fill-1
- BalanceCard：仅 12px tabular 金额居中显示，无 label / 无 CTA；hover 整张卡出 tooltip（三行：BALANCE / 金额 / Top up 链接）

### 6.4 Drawer (<768)

- 左滑入，**宽 240px**（与桌面展开态一致）
- 遮罩 `--semi-color-overlay-bg`；点击遮罩 / Esc / 路由跳转自动关闭
- 动画 200ms cubic-bezier(0.2, 0, 0, 1)
- 内容结构与桌面展开态一致（包含 BalanceCard）

## 7. BalanceCard

### 7.1 Expanded state

- 宽：占侧栏内容宽度（240 - padding = 216）
- 结构：
  - 第 1 行 `BALANCE` label（10px，text-2，uppercase）
  - 第 2 行 金额（18px，600，tabular-nums，text-0）
  - 第 3 行 Semi `Button`：type=tertiary，block，label=`Top up`
- **不含进度条**（决策 Q3 = 2d）
- 余额数据源：沿用现有 `useContext` / global state（本 PR 不改数据层）
- 加载中：显示 `Skeleton` 宽条代替金额；CTA 保持可点

### 7.2 Collapsed state

- 仅金额，12px tabular，居中
- 金额位置顶部留 8px，底部留 8px
- 整卡 hover → Tooltip：`BALANCE / ¥ 1,284.50 / Top up →`

### 7.3 Overflow / edge cases

- 金额超过 10 字符（例：`¥ 999,999,999.00`）：展开态降到 16px；折叠态不显示金额，只显示图标 `💰` + tooltip 里给完整数
- 金额为 0 或负数：以 `--semi-color-danger` 显示（提示欠费）
- 未登录：BalanceCard 整块不渲染

## 8. Collapse & Responsive

### 8.1 State management

```js
// useLayoutState.js
const STORAGE_KEY = 'keyapi.sidebar.collapsed';
const BREAKPOINTS = { drawer: 768, rail: 1024 };

// mode 计算规则（按窗口宽度）：
//   w <  768         → 'drawer' （忽略 localStorage）
//   768 <= w < 1024  → 'rail'   （强制；localStorage 无效）
//   w >= 1024        → localStorage 值或 'expanded'
//
// 用户主动切换：
//   只在 w >= 1024 有效；写回 localStorage
//   在 rail / drawer 下快捷键与按钮静默忽略（按钮本身不渲染）
//
// resize 监听：
//   跨断点时重算 mode；不写回 localStorage
//   节流 100ms
```

### 8.2 Trigger

- Header 收合按钮：仅 ≥1024 渲染（rail / drawer 下隐藏）
- 快捷键 `Ctrl/⌘ + \`：仅 ≥1024 生效
  - 选型理由：避开 Safari `Cmd+B`（粗体）冲突；与 VS Code / Cursor 的 secondary sidebar 一致
  - 实现：全局 `keydown` 监听，在 input/textarea 聚焦时忽略

### 8.3 Transitions

- Sidebar width：`transition: width 200ms cubic-bezier(0.2, 0, 0, 1)`
- 条目 label / 分组 label：`opacity 150ms ease-out`（折叠时 label 先 fade）
- 主内容 margin-left：跟随 sidebar width（同一 transition）
- Drawer 进出：同 200ms cubic-bezier

### 8.4 `prefers-reduced-motion`

- 用户开启减动效时，所有过渡降到 0ms（CSS `@media (prefers-reduced-motion: reduce)`）

## 9. Theming & Tokens

- **零 hex**。颜色 / 圆角 / 间距全部走 Semi CSS variables 或 `tailwind.config.js` 映射 class
- 主题切换：设置 `body[theme-mode="dark"|"light"]`，Semi 组件自动跟随
- 值源唯一：`localStorage['theme-mode']` = `auto | light | dark`
  - 初次渲染：`auto` 时读 `prefers-color-scheme`
  - UserMenu 子菜单切换 → 写回 localStorage → 触发 `theme-mode` 更新
  - Semi `OriginTheme` provider 兜底
- **双主题 parity 检查**（每个组件都要过）：
  - active 态 `fill-1 × text-0` 对比度 ≥ 4.5:1
  - hover `fill-0` 在暗色下仍可感知
  - 边框、tooltip 背景在两主题下都不消失
  - BalanceCard 金额视觉权重在两主题下一致
- 图表 theme 不在本 PR 范围

## 10. Access Control

- 无 user → 路由守卫跳登录；Shell 不渲染
- `requireRole: 'tenant_admin'` → 当前 tenant 中用户 role ∈ {`admin`, `owner`}
- `requireRole: 'super_admin'` → 顶层 user.role === 平台超管标识（按当前代码实际字段）
- `featureFlag: 'x'` → 从 status/config 读布尔
- 不匹配的分组**整块不渲染**（不使用 disabled 灰色态）
- 特例：TenantSwitcher —— `user.tenants.length >= 2` 才渲染

## 11. i18n

### Key 命名

| 区域 | 前缀 | 示例 |
|---|---|---|
| 分组 label | `nav.group.*` | `nav.group.overview` |
| 条目 label | `nav.*` | `nav.dashboard`, `nav.apiKeys` |
| Header | `header.*` | `header.tenantSwitcher.placeholder` |
| User menu | `header.user.*` | `header.user.settings`, `header.user.theme.auto` |
| Balance | `sidebar.balance.*` | `sidebar.balance.label`, `sidebar.balance.topup` |

### 流程

- 中文源文件（`src/i18n/**/zh.json`）新增 keys
- `bun run i18n:sync` 同步其它语种占位
- `bun run i18n:lint` 确认无未翻译 / 无孤儿 key

### 术语表（保留英文，不翻）

`API Key` · `Token` · `Quota` · `Playground` · `Dashboard`

## 12. Verification Checklist

### 12.1 视觉 / 行为

- [ ] ≥1024 默认展开 240px；`Ctrl/⌘+\` 切到 64px rail，再切回正常
- [ ] 缩放到 768–1023 → 自动 rail；放回 ≥1024 → 恢复 localStorage 记忆值
- [ ] <768 → drawer；点遮罩 / Esc / 路由跳转自动关闭
- [ ] 折叠态 hover 每 icon 出 tooltip（300ms 延迟，不闪烁）
- [ ] BalanceCard 金额：展开 18px tabular，折叠 12px tabular
- [ ] active 状态：2px 主色竖线 + fill-1 背景；只高亮最深匹配

### 12.2 主题

- [ ] UserMenu → 主题 → 明 / 暗 / 跟随系统 三档切换且持久
- [ ] 切换无闪白（Semi 自带行为未被破坏）
- [ ] 明暗两主题下 active / hover / balance / border 都满足对比度

### 12.3 权限

- [ ] 普通用户看不到 TENANT ADMIN / PLATFORM（多账号实测）
- [ ] 单租户用户不渲染 TenantSwitcher
- [ ] 多租户切换 tenant 后，TENANT ADMIN 按新 tenant 权限重算

### 12.4 i18n

- [ ] `bun run i18n:status` 无缺失 key
- [ ] 切到 English / 其它语言，nav 完整翻译；术语表保留英文
- [ ] 中 / 英文 label 长度差异下，折叠 / 展开都不截断

### 12.5 代码质量

- [ ] `SiderBar.jsx` → 5 文件，每个 ≤200 行
- [ ] 无内联 hex / 无 `style={{ color: '#xxx' }}`
- [ ] `bun run lint` / `bun run eslint` 全过
- [ ] `bun run build` 无 warning

## 13. Risks & Open Questions

- **余额数据源耦合**：BalanceCard 沿用现有 global state；若 state 形状与 Balance 显示需求不匹配（例如缺 tabular 所需的数值类型），实现阶段可能需一次性规范化。实现者先勘察 `src/context/` 中余额读取路径。
- **路由前缀冲突**：active 匹配假设同组条目 `to` 互不为前缀。若现有路由存在 `/tenant` 与 `/tenant/members` 同组，需在实现中验证"最深匹配"规则无误。
- **super admin 字段名**：本文以 `user.role === 'root'` 为例；实现阶段需查 `src/context/User/*` 或后端字段真实取值。
- **键盘快捷键与 IME**：中文输入法下 `Ctrl+\` 通常不冲突，但需在 Windows / macOS / Linux 三平台各回归一次。
- **通知抽屉**：本 PR 只让 UserMenu 点击"通知"能打开抽屉 —— 抽屉组件复用现有 `NoticeModal`，若现有组件不是抽屉形态，本 PR 额外包一层 Drawer。

## 14. Out of Scope (displayed here so later PRs know)

- 具体页面内部重做（Dashboard / TopUp / Invoice / Token / ... 均留给后续子项目）
- VChart theme / 图表调色
- Footer 内容设计
- 命令面板（Cmd+K search）
- 后端 / 权限模型变更

## 15. Next step

Spec 经 LO 审查确认后，调用 `superpowers:writing-plans` 将本文件翻译为可执行的实现计划（`docs/superpowers/plans/<date>-shell-and-nav-plan.md`），含文件级改动清单、步骤顺序、每步验证标准、回退点。
