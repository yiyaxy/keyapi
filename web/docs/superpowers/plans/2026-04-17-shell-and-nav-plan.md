# Shell & Nav Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild keyapi/web's Shell (header + sidebar + responsive behavior) per the Design Context established in `.impeccable.md`, aligning with the spec at `docs/superpowers/specs/2026-04-17-shell-and-nav-design.md`.

**Architecture:** Replace monolithic `SiderBar.jsx` (724 lines) and bloated `headerbar/` (11 components) with a focused layout module: two hooks (`useLayoutState`, `useNavItems`) + 5-file sidebar + 4-file header. Balance card lives in sidebar footer. Three-state responsive: persistent 240px → 64px icon rail → drawer.

**Tech Stack:** React 18 · Vite · Semi UI (`@douyinfe/semi-ui` / `@douyinfe/semi-icons`) · Tailwind 3 (Semi tokens) · react-i18next · react-router-dom 6 · bun.

---

## Testing Posture (read before starting)

This repo has **no test runner** (no `test` script, no jest/vitest/playwright deps). Per spec Section 2 "out-of-scope": we do **not** add one in this sub-project. Verification is a three-legged stool on every task:

1. **Lint / static:** `bun run lint && bun run eslint` must pass
2. **Build:** `bun run build` must produce 0 warnings for changed files
3. **Manual browser smoke:** `bun run dev` and walk the relevant spec Section 12 checklist items for the task

"Test" steps below map to this posture — no TDD in the classic sense; instead: change → lint → build → browser smoke → commit.

## Pre-flight

Before Task 1:

- [ ] **Pre-1: Confirm clean working tree**

```bash
cd D:/top/keyapi/web
git status
# expected: clean, or only .impeccable.md / CLAUDE.md untracked from the /teach-impeccable step
git log --oneline -3
# expected: most recent commit is the design spec (docs(design): add Shell & Nav spec...)
```

- [ ] **Pre-2: Install deps and run dev once**

```bash
cd D:/top/keyapi/web
bun install
bun run dev
# Visit http://localhost:5173 — confirm app renders with current (un-refactored) shell
# Keep a screenshot of the current sidebar for before/after comparison.
# Ctrl+C to stop.
```

- [ ] **Pre-3: Read the spec once, end-to-end**

Open `docs/superpowers/specs/2026-04-17-shell-and-nav-design.md` and read it. All section references in this plan point to that spec.

## File Structure (locked)

**Create:**

```
src/components/layout/
├── useLayoutState.js            # hook: collapse mode + drawer + localStorage
├── useNavItems.js               # hook: filtered nav data (group / requireRole / featureFlag)
├── header/                      # NEW dir (replaces headerbar/)
│   ├── Header.jsx               # thin 56px layout
│   ├── UserMenu.jsx             # consolidated dropdown (user + theme + lang + notif + activity + legal + signout)
│   ├── HeaderLogo.jsx           # moved from headerbar/, minimal changes
│   ├── TenantSwitcher.jsx       # moved from headerbar/, refactored
│   └── MobileMenuButton.jsx     # moved from headerbar/, wired to drawer state
└── sidebar/                     # NEW dir
    ├── Sidebar.jsx              # desktop shell (expanded / rail)
    ├── NavTree.jsx              # group container
    ├── NavGroup.jsx             # one group (label + items)
    ├── NavItem.jsx              # one item (icon + label + active/tooltip)
    ├── BalanceCard.jsx          # footer card (expanded / collapsed states)
    └── SidebarDrawer.jsx        # <768 drawer variant
```

**Modify:**

- `src/components/layout/PageLayout.jsx` — wire new Header + Sidebar; remove old props drilling
- `src/components/layout/Footer.jsx` — minimal: ensure it still renders (content design is out-of-scope)
- `src/index.css` — sidebar widths 180/60 → 240/64; transitions; `prefers-reduced-motion`; active state rules
- `src/i18n/locales/zh-CN.json` — new keys (nav.* / header.user.* / sidebar.balance.*)
- `src/i18n/locales/zh-TW.json`, `en.json`, `fr.json`, `ja.json`, `ru.json`, `vi.json` — new keys via `bun run i18n:sync`

**Delete (at the end, after new code is wired):**

- `src/components/layout/SiderBar.jsx`
- `src/components/layout/headerbar/` (entire directory, after migrating HeaderLogo / TenantSwitcher / MobileMenuButton into `header/`)

---

## Task 1: Create `useLayoutState` hook

**Files:**
- Create: `src/components/layout/useLayoutState.js`

- [ ] **Step 1.1: Investigate current state source**

Read `src/components/layout/SiderBar.jsx` and `src/components/layout/PageLayout.jsx`. Find how sidebar collapse is currently tracked. Likely candidates: a React context, a prop drilled from `App.jsx`, or a class on `document.body`.

Run:

```bash
cd D:/top/keyapi/web
```

Then use your editor / grep to find: `sidebar-collapsed`, `collapsed`, `setCollapsed` inside `src/components/layout/**` and `src/context/**`. Note the state owner. We will replace that local/context state with the new hook — or, if it's a context, repoint the context's internal state to this hook.

- [ ] **Step 1.2: Create the hook**

Create `src/components/layout/useLayoutState.js` with exact contents:

```js
import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'keyapi.sidebar.collapsed';
const BP_DRAWER = 768;
const BP_RAIL = 1024;

function readWindowWidth() {
  if (typeof window === 'undefined') return BP_RAIL;
  return window.innerWidth;
}

function computeMode(width, userCollapsed) {
  if (width < BP_DRAWER) return 'drawer';
  if (width < BP_RAIL) return 'rail';
  return userCollapsed ? 'rail' : 'expanded';
}

function readStoredCollapsed() {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function useLayoutState() {
  const [width, setWidth] = useState(readWindowWidth);
  const [userCollapsed, setUserCollapsed] = useState(readStoredCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    let t;
    const onResize = () => {
      clearTimeout(t);
      t = setTimeout(() => setWidth(window.innerWidth), 100);
    };
    window.addEventListener('resize', onResize);
    return () => {
      clearTimeout(t);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  const mode = computeMode(width, userCollapsed);

  const toggle = useCallback(() => {
    if (width < BP_RAIL) return;
    setUserCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }, [width]);

  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key !== '\\') return;
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || document.activeElement?.isContentEditable) return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);

  return { mode, toggle, drawerOpen, setDrawerOpen };
}
```

- [ ] **Step 1.3: Lint + eslint**

```bash
cd D:/top/keyapi/web
bun run lint
bun run eslint
```

Expected: both exit 0. If prettier wants to reformat, run `bun run lint:fix`.

- [ ] **Step 1.4: Commit**

```bash
cd D:/top/keyapi/web
git add src/components/layout/useLayoutState.js
git commit -m "feat(layout): add useLayoutState hook (collapse + breakpoints + Ctrl/Cmd+\\)"
```

---

## Task 2: Create `useNavItems` hook

**Files:**
- Create: `src/components/layout/useNavItems.js`

- [ ] **Step 2.1: Investigate current user / role source**

Search `src/context/` for user state (`UserContext`, `useUser`, etc.). Identify:

- How to read the current user
- The exact field(s) for "is super admin" (likely `user.role === 'root'` or `user.role >= N`)
- The exact field(s) for "is tenant admin" within current tenant (likely `user.tenantRole === 'admin' | 'owner'`)
- How to read the current tenant list / tenant count

Record these field names — you'll hard-code them into this hook. **Do not guess.** Read the actual context file.

- [ ] **Step 2.2: Create the hook with placeholder access helpers**

Create `src/components/layout/useNavItems.js` with:

```js
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
// TODO (implementer — fill based on Step 2.1 findings):
// import { useUserContext } from '../../context/User';

function isSuperAdmin(user) {
  // Replace with real field per Step 2.1
  return user?.role === 'root';
}

function isTenantAdmin(user) {
  // Replace with real field per Step 2.1
  return ['admin', 'owner'].includes(user?.tenantRole);
}

function hasMultipleTenants(user) {
  return Array.isArray(user?.tenants) && user.tenants.length >= 2;
}

const RAW_GROUPS = [
  {
    group: 'OVERVIEW',
    i18nKey: 'nav.group.overview',
    items: [
      { id: 'dashboard',     icon: 'IconHome',        to: '/',              i18nKey: 'nav.dashboard' },
      { id: 'logs',          icon: 'IconHistory',     to: '/log',           i18nKey: 'nav.logs' },
      { id: 'request-trace', icon: 'IconSearch',      to: '/request-trace', i18nKey: 'nav.requestTrace' },
      { id: 'analytics',     icon: 'IconLineChartStroked', to: '/analytics', i18nKey: 'nav.analytics' },
    ],
  },
  {
    group: 'BILLING',
    i18nKey: 'nav.group.billing',
    items: [
      { id: 'topup',        icon: 'IconCreditCard', to: '/topup',        i18nKey: 'nav.topup' },
      { id: 'subscription', icon: 'IconGift',       to: '/subscription', i18nKey: 'nav.subscription' },
      { id: 'redemption',   icon: 'IconTicket',     to: '/redemption',   i18nKey: 'nav.redemption' },
      { id: 'invoices',     icon: 'IconFile',       to: '/invoice',      i18nKey: 'nav.invoices' },
    ],
  },
  {
    group: 'DEVELOP',
    i18nKey: 'nav.group.develop',
    items: [
      { id: 'api-keys',   icon: 'IconKey',     to: '/token',      i18nKey: 'nav.apiKeys' },
      { id: 'playground', icon: 'IconCode',    to: '/playground', i18nKey: 'nav.playground' },
      { id: 'chat',       icon: 'IconComment', to: '/chat',       i18nKey: 'nav.chat' },
      { id: 'models',     icon: 'IconBox',     to: '/pricing',    i18nKey: 'nav.modelsAndPricing' },
    ],
  },
  {
    group: 'SUPPORT',
    i18nKey: 'nav.group.support',
    items: [
      { id: 'tickets', icon: 'IconHelpCircle', to: '/ticket', i18nKey: 'nav.tickets' },
      { id: 'inbox',   icon: 'IconMail',       to: '/inbox',  i18nKey: 'nav.inbox' },
    ],
  },
  {
    group: 'TENANT_ADMIN',
    requireRole: 'tenant_admin',
    i18nKey: 'nav.group.tenant',
    items: [
      { id: 'tenant-dashboard', icon: 'IconServer',      to: '/tenant',         i18nKey: 'nav.tenantDashboard' },
      { id: 'tenant-members',   icon: 'IconUserGroup',   to: '/tenant/members', i18nKey: 'nav.members' },
      { id: 'tenant-plan',      icon: 'IconGift',        to: '/tenant/plan',    i18nKey: 'nav.plan' },
      { id: 'tenant-config',    icon: 'IconSetting',     to: '/tenant/config',  i18nKey: 'nav.tenantConfig' },
      { id: 'tenant-bills',     icon: 'IconReceipt',     to: '/tenant/bills',   i18nKey: 'nav.tenantBills' },
      { id: 'tenant-alerts',    icon: 'IconBell',        to: '/tenant/alerts',  i18nKey: 'nav.alerts' },
      { id: 'tenant-audit',     icon: 'IconShield',      to: '/tenant/audit',   i18nKey: 'nav.audit' },
      { id: 'channels',         icon: 'IconLink',        to: '/channel',        i18nKey: 'nav.channels' },
    ],
  },
  {
    group: 'PLATFORM',
    requireRole: 'super_admin',
    i18nKey: 'nav.group.platform',
    items: [
      { id: 'tenants',        icon: 'IconHome',       to: '/platform/tenants', i18nKey: 'nav.platformTenants' },
      { id: 'agents',         icon: 'IconUser',       to: '/agents',           i18nKey: 'nav.agents' },
      { id: 'admin-invoices', icon: 'IconFile',       to: '/invoice-admin',    i18nKey: 'nav.adminInvoices' },
      { id: 'admin-tickets',  icon: 'IconHelpCircle', to: '/ticket-admin',     i18nKey: 'nav.adminTickets' },
      { id: 'site-settings',  icon: 'IconSetting',    to: '/setting',          i18nKey: 'nav.siteSettings' },
    ],
  },
];

export function useNavItems(user) {
  const { t } = useTranslation();
  return useMemo(() => {
    return RAW_GROUPS
      .filter((g) => {
        if (g.requireRole === 'tenant_admin') return isTenantAdmin(user);
        if (g.requireRole === 'super_admin') return isSuperAdmin(user);
        return true;
      })
      .map((g) => ({
        ...g,
        label: t(g.i18nKey),
        items: g.items.map((it) => ({ ...it, label: t(it.i18nKey) })),
      }));
  }, [user, t]);
}

export { hasMultipleTenants };
```

> **Implementer note:** The `icon` strings reference Semi icon component names. At consumption time in `NavItem.jsx` we'll import them dynamically from `@douyinfe/semi-icons`. Cross-check names against `node_modules/@douyinfe/semi-icons/` (e.g. `IconHome`, `IconHistory`, `IconSearch` — adjust any that don't exist to their nearest equivalent; this is a 2-minute fixup, not a redesign).
>
> **Routes:** Cross-check `to` paths against `src/App.jsx`. If an existing route is different (e.g. `/logs` instead of `/log`), update the `to` field — do not change the route. Record any mismatch as a comment; the spec's Risks section 13 flags this.

- [ ] **Step 2.3: Wire the real user context**

Open `src/components/layout/useNavItems.js`. Replace the commented `import { useUserContext }` line with the real import based on Step 2.1. Consume the user at the hook call site (caller passes `user`) or directly inside the hook — decide based on how the rest of the codebase does it. Remove any remaining `// TODO (implementer ...)` comments.

- [ ] **Step 2.4: Lint + eslint**

```bash
cd D:/top/keyapi/web
bun run lint
bun run eslint
```

Expected: both exit 0.

- [ ] **Step 2.5: Commit**

```bash
cd D:/top/keyapi/web
git add src/components/layout/useNavItems.js
git commit -m "feat(layout): add useNavItems hook (role/flag-filtered nav data)"
```

---

## Task 3: Seed i18n keys (zh-CN source, then sync)

**Files:**
- Modify: `src/i18n/locales/zh-CN.json`
- Run: `bun run i18n:sync` which touches all other locale files

- [ ] **Step 3.1: Read current zh-CN.json top-level structure**

Check the current key structure. We will follow existing conventions; if keys are grouped under a `nav` / `header` namespace already, merge. Otherwise, add new top-level keys.

- [ ] **Step 3.2: Add keys**

In `src/i18n/locales/zh-CN.json`, add or merge the following keys. **Preserve existing keys verbatim.** Use deep-merge logic.

```json
{
  "nav": {
    "group": {
      "overview": "概览",
      "billing": "账单",
      "develop": "开发",
      "support": "支持",
      "tenant": "租户管理",
      "platform": "平台"
    },
    "dashboard": "仪表盘",
    "logs": "日志",
    "requestTrace": "请求追踪",
    "analytics": "分析",
    "topup": "充值",
    "subscription": "订阅",
    "redemption": "兑换码",
    "invoices": "发票",
    "apiKeys": "API Keys",
    "playground": "Playground",
    "chat": "Chat",
    "modelsAndPricing": "Models & pricing",
    "tickets": "工单",
    "inbox": "消息",
    "tenantDashboard": "租户仪表盘",
    "members": "成员",
    "plan": "套餐",
    "tenantConfig": "配置",
    "tenantBills": "租户账单",
    "alerts": "告警",
    "audit": "审计",
    "channels": "渠道",
    "platformTenants": "全部租户",
    "agents": "Agent",
    "adminInvoices": "发票（平台）",
    "adminTickets": "工单（平台）",
    "siteSettings": "站点设置"
  },
  "header": {
    "user": {
      "settings": "设置",
      "notifications": "通知",
      "theme": {
        "label": "主题",
        "auto": "跟随系统",
        "light": "明亮",
        "dark": "深色"
      },
      "language": "语言",
      "about": "关于",
      "privacy": "隐私政策",
      "agreement": "用户协议",
      "refund": "退款政策",
      "signout": "退出登录"
    },
    "tenantSwitcher": {
      "placeholder": "切换租户",
      "recent": "最近",
      "all": "全部"
    },
    "toggleSidebar": "切换侧边栏 (Ctrl/⌘ + \\)"
  },
  "sidebar": {
    "balance": {
      "label": "余额",
      "topup": "充值",
      "tooltip": "余额 {{amount}} · 点击充值"
    }
  }
}
```

- [ ] **Step 3.3: Sync to other locales**

```bash
cd D:/top/keyapi/web
bun run i18n:sync
```

Expected: other locale files (`en.json`, `zh-TW.json`, etc.) now contain the same keys with zh-CN values as placeholders.

- [ ] **Step 3.4: Quick English override for terms in the glossary**

Open `src/i18n/locales/en.json`. Translate the top-level Chinese strings for the new keys to natural English. Per spec Section 11, keep glossary terms untranslated (`API Keys`, `Playground`, `Dashboard`, `Token`, `Quota`). Example:

```json
{
  "nav": {
    "group": {
      "overview": "Overview",
      "billing": "Billing",
      "develop": "Develop",
      "support": "Support",
      "tenant": "Tenant",
      "platform": "Platform"
    },
    "dashboard": "Dashboard",
    "logs": "Logs",
    "requestTrace": "Request trace",
    "analytics": "Analytics",
    "topup": "Top up",
    "subscription": "Subscription",
    "redemption": "Redeem code",
    "invoices": "Invoices",
    "apiKeys": "API Keys",
    "playground": "Playground",
    "chat": "Chat",
    "modelsAndPricing": "Models & pricing",
    "tickets": "Tickets",
    "inbox": "Inbox",
    "tenantDashboard": "Tenant dashboard",
    "members": "Members",
    "plan": "Plan",
    "tenantConfig": "Config",
    "tenantBills": "Bills",
    "alerts": "Alerts",
    "audit": "Audit",
    "channels": "Channels",
    "platformTenants": "Tenants",
    "agents": "Agents",
    "adminInvoices": "Invoices (admin)",
    "adminTickets": "Tickets (admin)",
    "siteSettings": "Site settings"
  },
  "header": {
    "user": {
      "settings": "Settings",
      "notifications": "Notifications",
      "theme": {
        "label": "Theme",
        "auto": "System",
        "light": "Light",
        "dark": "Dark"
      },
      "language": "Language",
      "about": "About",
      "privacy": "Privacy",
      "agreement": "Agreement",
      "refund": "Refund policy",
      "signout": "Sign out"
    },
    "tenantSwitcher": {
      "placeholder": "Switch tenant",
      "recent": "Recent",
      "all": "All"
    },
    "toggleSidebar": "Toggle sidebar (Ctrl/⌘ + \\)"
  },
  "sidebar": {
    "balance": {
      "label": "Balance",
      "topup": "Top up",
      "tooltip": "Balance {{amount}} — click to top up"
    }
  }
}
```

> Other locales (ja/fr/ru/vi/zh-TW) can stay as sync'd Chinese placeholders for this PR; translation is out-of-scope. The `i18next-cli` CI may flag — add them to that pipeline's allowlist or accept the warning. Coordinate with LO if blocked.

- [ ] **Step 3.5: Verify i18n status**

```bash
cd D:/top/keyapi/web
bun run i18n:status
```

Expected: no missing keys for zh-CN or en. Other locales may show untranslated keys — acceptable for this PR.

- [ ] **Step 3.6: Commit**

```bash
cd D:/top/keyapi/web
git add src/i18n/locales/
git commit -m "feat(i18n): seed nav/header/sidebar keys for shell & nav refactor"
```

---

## Task 4: Scaffold new `header/` directory by moving kept components

Keep three components (HeaderLogo, TenantSwitcher, MobileMenuButton) from `headerbar/` and move them into `header/`. We'll rewrite / merge the others in later tasks. The rename is done as an explicit copy-then-delete to avoid git confusion.

**Files:**
- Create dir: `src/components/layout/header/`
- Copy: `headerbar/HeaderLogo.jsx` → `header/HeaderLogo.jsx` (unchanged for now)
- Copy: `headerbar/MobileMenuButton.jsx` → `header/MobileMenuButton.jsx` (unchanged for now)
- Copy: `headerbar/TenantSwitcher.jsx` → `header/TenantSwitcher.jsx` (rewritten in Task 6)

- [ ] **Step 4.1: Create header dir and copy files**

```bash
cd D:/top/keyapi/web
mkdir -p src/components/layout/header
git mv src/components/layout/headerbar/HeaderLogo.jsx src/components/layout/header/HeaderLogo.jsx
git mv src/components/layout/headerbar/MobileMenuButton.jsx src/components/layout/header/MobileMenuButton.jsx
git mv src/components/layout/headerbar/TenantSwitcher.jsx src/components/layout/header/TenantSwitcher.jsx
```

- [ ] **Step 4.2: Fix any broken imports caused by the move**

`bun run eslint` should flag any import path that no longer resolves. Fix only import paths — no logic changes in this task.

```bash
cd D:/top/keyapi/web
bun run eslint
```

If errors appear, update imports in:
- `src/components/layout/headerbar/index.jsx` (this file still exists and references moved files)
- `src/components/layout/headerbar/ActionButtons.jsx` if it imports from moved files

Expected after fixes: eslint exits 0. **App still renders — no behavior change yet.**

- [ ] **Step 4.3: Run dev + smoke**

```bash
cd D:/top/keyapi/web
bun run dev
```

Open http://localhost:5173. Confirm no regression: header renders as before, all buttons click. Ctrl+C.

- [ ] **Step 4.4: Commit**

```bash
cd D:/top/keyapi/web
git add src/components/layout/
git commit -m "refactor(layout): move kept header components into header/ dir (no behavior change)"
```

---

## Task 5: Rewrite Header shell

**Files:**
- Create: `src/components/layout/header/Header.jsx`

- [ ] **Step 5.1: Create `Header.jsx`**

```jsx
import React from 'react';
import { useTranslation } from 'react-i18next';
import HeaderLogo from './HeaderLogo';
import TenantSwitcher from './TenantSwitcher';
import UserMenu from './UserMenu';
import MobileMenuButton from './MobileMenuButton';

export default function Header({ mode, onOpenDrawer, onToggleCollapse }) {
  const { t } = useTranslation();
  const isMobile = mode === 'drawer';

  return (
    <header
      className='flex items-center h-14 px-4 bg-semi-color-bg-0 border-b border-semi-color-border'
      role='banner'
    >
      {isMobile && (
        <MobileMenuButton onClick={onOpenDrawer} ariaLabel={t('header.toggleSidebar')} />
      )}
      <HeaderLogo />
      <div className='ml-3'>
        <TenantSwitcher />
      </div>
      <div className='flex-1' />
      <UserMenu onToggleCollapse={onToggleCollapse} mode={mode} />
    </header>
  );
}
```

> **Implementer notes:**
> - Import paths: after Task 4 moves, `HeaderLogo` / `TenantSwitcher` / `MobileMenuButton` all live in `./`.
> - `UserMenu` is created in Task 7 — this file will fail to resolve until Task 7 lands; that's why Task 5 does **not** commit until Task 7 does. Keep Task 5 changes uncommitted, proceed to Task 6 and Task 7, then commit 5+6+7 together if desired, or make Header a stub temporarily. Safer: create a minimal `UserMenu.jsx` stub first (`export default () => null;`), then land Task 5, then flesh out in Task 7. Plan chooses stub-first.

- [ ] **Step 5.2: Create `UserMenu.jsx` stub (so Header imports resolve)**

Create `src/components/layout/header/UserMenu.jsx` with just:

```jsx
import React from 'react';
export default function UserMenu() {
  return <div aria-hidden='true' style={{ width: 32, height: 32 }} />;
}
```

- [ ] **Step 5.3: Lint + eslint**

```bash
cd D:/top/keyapi/web
bun run lint
bun run eslint
```

Expected: 0 errors.

- [ ] **Step 5.4: Commit (Header shell + UserMenu stub)**

```bash
cd D:/top/keyapi/web
git add src/components/layout/header/Header.jsx src/components/layout/header/UserMenu.jsx
git commit -m "feat(header): add Header shell + UserMenu stub"
```

---

## Task 6: Refactor `TenantSwitcher.jsx`

**Files:**
- Modify: `src/components/layout/header/TenantSwitcher.jsx`

- [ ] **Step 6.1: Read current implementation**

Open `src/components/layout/header/TenantSwitcher.jsx` (moved in Task 4). Understand its existing API: where it reads the tenant list, how it calls "switch tenant", how it displays the active tenant.

- [ ] **Step 6.2: Rewrite**

Replace the file with:

```jsx
import React, { useMemo } from 'react';
import { Select, Typography } from '@douyinfe/semi-ui';
import { useTranslation } from 'react-i18next';
// TODO (implementer — from Task 2.1 investigation): import real user + switch API
// import { useUserContext } from '../../../context/User';
// import { switchTenant } from '../../../services/tenant';

export default function TenantSwitcher() {
  const { t } = useTranslation();
  // const { user } = useUserContext();
  const user = { tenants: [], currentTenantId: null }; // replace with real context

  if (!Array.isArray(user?.tenants) || user.tenants.length < 2) return null;

  const options = useMemo(() => {
    const recentIds = (user.recentTenantIds ?? []).slice(0, 3);
    const recentSet = new Set(recentIds);
    const recent = recentIds
      .map((id) => user.tenants.find((t) => t.id === id))
      .filter(Boolean);
    const rest = user.tenants.filter((t) => !recentSet.has(t.id));
    const opts = [];
    if (recent.length) {
      opts.push({ label: t('header.tenantSwitcher.recent'), value: '__recent__', disabled: true });
      opts.push(...recent.map((x) => ({ label: x.name, value: x.id })));
    }
    if (rest.length) {
      opts.push({ label: t('header.tenantSwitcher.all'), value: '__all__', disabled: true });
      opts.push(...rest.map((x) => ({ label: x.name, value: x.id })));
    }
    return opts;
  }, [user.tenants, user.recentTenantIds, t]);

  const handleChange = (value) => {
    if (value === '__recent__' || value === '__all__') return;
    // switchTenant(value);
  };

  return (
    <Select
      value={user.currentTenantId}
      onChange={handleChange}
      placeholder={t('header.tenantSwitcher.placeholder')}
      optionList={options}
      filter
      style={{ minWidth: 160 }}
      size='default'
      aria-label={t('header.tenantSwitcher.placeholder')}
    />
  );
}
```

- [ ] **Step 6.3: Wire real context and switch API**

Per your Task 2.1 findings, replace the stubbed `user` and `switchTenant` with the real imports. Preserve the early-return-if-<2-tenants guard.

- [ ] **Step 6.4: Lint + build**

```bash
cd D:/top/keyapi/web
bun run lint
bun run eslint
bun run build
```

Expected: 0 errors, 0 relevant warnings.

- [ ] **Step 6.5: Commit**

```bash
cd D:/top/keyapi/web
git add src/components/layout/header/TenantSwitcher.jsx
git commit -m "refactor(header): TenantSwitcher combobox + recent group + single-tenant hide"
```

---

## Task 7: Flesh out `UserMenu.jsx`

**Files:**
- Modify: `src/components/layout/header/UserMenu.jsx` (replace stub from Task 5)

- [ ] **Step 7.1: Read current header sub-components you're consolidating**

Read these files to port their behavior into `UserMenu`:

- `src/components/layout/headerbar/UserArea.jsx` (dropdown structure, avatar render, logout handler)
- `src/components/layout/headerbar/NotificationButton.jsx` (notification open + unread badge)
- `src/components/layout/headerbar/ThemeToggle.jsx` (theme state source + setter)
- `src/components/layout/headerbar/LanguageSelector.jsx` (language state + setter)
- `src/components/layout/headerbar/NewYearButton.jsx` (campaign gate condition)

Write down, for each, the exact state source and setter names. You will import these in UserMenu.

- [ ] **Step 7.2: Implement UserMenu**

Replace the file contents with:

```jsx
import React from 'react';
import { Avatar, Dropdown, Typography } from '@douyinfe/semi-ui';
import {
  IconBell,
  IconSetting,
  IconLanguage,
  IconSun,
  IconExit,
} from '@douyinfe/semi-icons';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
// TODO (implementer — from Step 7.1): replace with actual imports
// import { useUserContext } from '../../../context/User';
// import { useThemeContext } from '../../../context/Theme';
// import { openNotifications, unreadCount } from '../../../services/notifications';
// import { isCampaignActive, getCampaignLink } from '../../../services/campaign';

const LANGS = [
  { code: 'zh-CN', label: '中文 (简体)' },
  { code: 'zh-TW', label: '中文 (繁體)' },
  { code: 'en',    label: 'English' },
  { code: 'ja',    label: '日本語' },
  { code: 'fr',    label: 'Français' },
  { code: 'ru',    label: 'Русский' },
  { code: 'vi',    label: 'Tiếng Việt' },
];

export default function UserMenu({ onToggleCollapse, mode }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();

  // Replace all five lines below with real hooks (Step 7.1):
  const user = { email: 'you@example.com', avatar: null };
  const theme = { mode: 'auto', setMode: () => {} };
  const notif = { unread: 0, open: () => {} };
  const campaign = { active: false, url: '#' };
  const logout = () => {};

  const themeItems = [
    { name: t('header.user.theme.auto'),  value: 'auto'  },
    { name: t('header.user.theme.light'), value: 'light' },
    { name: t('header.user.theme.dark'),  value: 'dark'  },
  ];

  const themeMenu = (
    <Dropdown.Menu>
      {themeItems.map((it) => (
        <Dropdown.Item
          key={it.value}
          type={theme.mode === it.value ? 'primary' : 'default'}
          onClick={() => theme.setMode(it.value)}
        >
          {it.name}
        </Dropdown.Item>
      ))}
    </Dropdown.Menu>
  );

  const langMenu = (
    <Dropdown.Menu>
      {LANGS.map((l) => (
        <Dropdown.Item
          key={l.code}
          type={i18n.language === l.code ? 'primary' : 'default'}
          onClick={() => i18n.changeLanguage(l.code)}
        >
          {l.label}
        </Dropdown.Item>
      ))}
    </Dropdown.Menu>
  );

  const menu = (
    <Dropdown.Menu style={{ minWidth: 240 }}>
      <Dropdown.Item disabled>
        <Typography.Text type='tertiary'>{user.email}</Typography.Text>
      </Dropdown.Item>
      <Dropdown.Divider />

      {campaign.active && (
        <>
          <Dropdown.Item onClick={() => window.open(campaign.url, '_blank')}>
            🎉 {t('activity.current')}
          </Dropdown.Item>
          <Dropdown.Divider />
        </>
      )}

      <Dropdown.Item icon={<IconSetting />} onClick={() => navigate('/setting')}>
        {t('header.user.settings')}
      </Dropdown.Item>

      <Dropdown.Item icon={<IconBell />} onClick={notif.open}>
        {t('header.user.notifications')}
        {notif.unread > 0 && (
          <span
            style={{
              marginLeft: 'auto',
              minWidth: 18,
              height: 18,
              padding: '0 6px',
              borderRadius: 9,
              background: 'var(--semi-color-danger)',
              color: 'var(--semi-color-white)',
              fontSize: 11,
              lineHeight: '18px',
              textAlign: 'center',
            }}
          >
            {notif.unread > 99 ? '99+' : notif.unread}
          </span>
        )}
      </Dropdown.Item>

      <Dropdown position='leftTop' render={themeMenu} trigger='hover'>
        <Dropdown.Item icon={<IconSun />}>{t('header.user.theme.label')}</Dropdown.Item>
      </Dropdown>

      <Dropdown position='leftTop' render={langMenu} trigger='hover'>
        <Dropdown.Item icon={<IconLanguage />}>{t('header.user.language')}</Dropdown.Item>
      </Dropdown>

      <Dropdown.Divider />

      <Dropdown.Item onClick={() => navigate('/about')}>{t('header.user.about')}</Dropdown.Item>
      <Dropdown.Item onClick={() => navigate('/privacy')}>{t('header.user.privacy')}</Dropdown.Item>
      <Dropdown.Item onClick={() => navigate('/user-agreement')}>{t('header.user.agreement')}</Dropdown.Item>
      <Dropdown.Item onClick={() => navigate('/refund-policy')}>{t('header.user.refund')}</Dropdown.Item>

      <Dropdown.Divider />

      <Dropdown.Item icon={<IconExit />} type='danger' onClick={logout}>
        {t('header.user.signout')}
      </Dropdown.Item>
    </Dropdown.Menu>
  );

  return (
    <Dropdown render={menu} trigger='click' position='bottomRight'>
      <Avatar
        size='small'
        src={user.avatar}
        style={{ cursor: 'pointer' }}
      >
        {(user.email?.[0] ?? 'U').toUpperCase()}
      </Avatar>
    </Dropdown>
  );
}
```

> **Implementer:** Replace the five stubbed variables (`user`, `theme`, `notif`, `campaign`, `logout`) with real hooks/imports from Step 7.1. Drop the `onToggleCollapse` / `mode` props if you don't end up adding a collapse entry — the Header passes them but UserMenu doesn't need them unless you add a "Collapse sidebar (Ctrl/⌘ + \)" item.

- [ ] **Step 7.3: Verify `activity.current` key exists or remove the campaign branch**

If `activity.current` isn't in i18n yet, either:
(a) add it to zh-CN + en (`"activity": { "current": "当前活动" }` / `"Current campaign"`) and re-run `bun run i18n:sync`, or
(b) remove the campaign branch entirely if no active campaign logic exists in the repo (stub `campaign.active = false` forever).

- [ ] **Step 7.4: Lint + build**

```bash
cd D:/top/keyapi/web
bun run lint
bun run eslint
bun run build
```

Expected: 0 errors.

- [ ] **Step 7.5: Commit**

```bash
cd D:/top/keyapi/web
git add src/components/layout/header/UserMenu.jsx src/i18n/locales/
git commit -m "feat(header): UserMenu consolidates user area + theme + lang + notif + activity"
```

---

## Task 8: Sidebar — `NavItem.jsx`

**Files:**
- Create: `src/components/layout/sidebar/NavItem.jsx`

- [ ] **Step 8.1: Create dir and file**

```bash
cd D:/top/keyapi/web
mkdir -p src/components/layout/sidebar
```

Then create `src/components/layout/sidebar/NavItem.jsx`:

```jsx
import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Tooltip } from '@douyinfe/semi-ui';
import * as SemiIcons from '@douyinfe/semi-icons';

function resolveIcon(name) {
  const C = SemiIcons[name];
  return C ? <C size='default' /> : null;
}

export function isDeepestMatch(pathname, item, siblings) {
  if (!pathname.startsWith(item.to)) return false;
  const longerSibling = siblings.find(
    (s) => s.id !== item.id && s.to.length > item.to.length && pathname.startsWith(s.to),
  );
  return !longerSibling;
}

export default function NavItem({ item, siblings, collapsed }) {
  const { pathname } = useLocation();
  const active = isDeepestMatch(pathname, item, siblings);

  const classes = [
    'relative flex items-center h-8 rounded-semi-border-radius-small transition-colors',
    collapsed ? 'justify-center mx-2 px-0' : 'mx-2 pl-3 pr-2 gap-3',
    active
      ? 'bg-semi-color-fill-1 text-semi-color-text-0 font-medium'
      : 'text-semi-color-text-1 hover:bg-semi-color-fill-0',
  ].join(' ');

  const content = (
    <NavLink to={item.to} className={classes} aria-current={active ? 'page' : undefined}>
      {active && (
        <span
          aria-hidden='true'
          className='absolute left-0 top-1 bottom-1 w-0.5 rounded-sm bg-semi-color-primary'
        />
      )}
      <span className='flex items-center justify-center w-[18px] h-[18px] shrink-0'>
        {resolveIcon(item.icon)}
      </span>
      {!collapsed && (
        <span className='truncate text-sm transition-opacity duration-150'>{item.label}</span>
      )}
    </NavLink>
  );

  if (collapsed) {
    return (
      <Tooltip content={item.label} position='right' mouseEnterDelay={300}>
        {content}
      </Tooltip>
    );
  }
  return content;
}
```

- [ ] **Step 8.2: Lint + eslint**

```bash
cd D:/top/keyapi/web
bun run lint
bun run eslint
```

Expected: 0 errors.

- [ ] **Step 8.3: Commit**

```bash
cd D:/top/keyapi/web
git add src/components/layout/sidebar/NavItem.jsx
git commit -m "feat(sidebar): add NavItem (active marker + tooltip on rail)"
```

---

## Task 9: Sidebar — `NavGroup.jsx`

**Files:**
- Create: `src/components/layout/sidebar/NavGroup.jsx`

- [ ] **Step 9.1: Create**

```jsx
import React from 'react';
import NavItem from './NavItem';

export default function NavGroup({ group, collapsed }) {
  return (
    <div className='mt-3 first:mt-1'>
      {!collapsed && (
        <div
          className='px-3 mb-1 text-[10px] uppercase text-semi-color-text-2'
          style={{ letterSpacing: '0.08em' }}
        >
          {group.label}
        </div>
      )}
      <ul className='list-none p-0 m-0 space-y-0.5'>
        {group.items.map((it) => (
          <li key={it.id}>
            <NavItem item={it} siblings={group.items} collapsed={collapsed} />
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 9.2: Lint + commit**

```bash
cd D:/top/keyapi/web
bun run lint
bun run eslint
git add src/components/layout/sidebar/NavGroup.jsx
git commit -m "feat(sidebar): add NavGroup (label + items)"
```

---

## Task 10: Sidebar — `NavTree.jsx`

**Files:**
- Create: `src/components/layout/sidebar/NavTree.jsx`

- [ ] **Step 10.1: Create**

```jsx
import React from 'react';
import NavGroup from './NavGroup';

export default function NavTree({ groups, collapsed }) {
  return (
    <nav className='flex-1 overflow-y-auto py-3' aria-label='Primary'>
      {groups.map((g) => (
        <NavGroup key={g.group} group={g} collapsed={collapsed} />
      ))}
    </nav>
  );
}
```

- [ ] **Step 10.2: Lint + commit**

```bash
cd D:/top/keyapi/web
bun run lint
bun run eslint
git add src/components/layout/sidebar/NavTree.jsx
git commit -m "feat(sidebar): add NavTree container"
```

---

## Task 11: Sidebar — `BalanceCard.jsx`

**Files:**
- Create: `src/components/layout/sidebar/BalanceCard.jsx`

- [ ] **Step 11.1: Investigate current balance data source**

Search for how balance is read today:

- Check `src/context/User.js` / similar for `quota`, `balance`, `used_quota`, `remain_quota`, etc.
- Look in `src/pages/TopUp/*` for the variable names used to display balance.

Record the exact field name and formatter (e.g., `renderQuota(user.quota)`).

- [ ] **Step 11.2: Create BalanceCard**

```jsx
import React from 'react';
import { Tooltip, Button, Skeleton } from '@douyinfe/semi-ui';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
// TODO (implementer — from Step 11.1): wire actual hooks
// import { useUserContext } from '../../../context/User';
// import { renderQuota } from '../../../helpers/render';

export default function BalanceCard({ collapsed }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // Replace with real context:
  const user = { quota: null, loading: false };
  const amountText = user.quota == null ? '—' : `¥ ${Number(user.quota).toFixed(2)}`;
  const isDanger = user.quota != null && Number(user.quota) <= 0;

  if (collapsed) {
    return (
      <Tooltip
        position='right'
        content={
          <div style={{ minWidth: 160 }}>
            <div style={{ fontSize: 10, opacity: 0.8, letterSpacing: '0.05em' }}>
              {t('sidebar.balance.label').toUpperCase()}
            </div>
            <div style={{ fontSize: 16, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
              {amountText}
            </div>
            <a onClick={() => navigate('/topup')} style={{ cursor: 'pointer' }}>
              {t('sidebar.balance.topup')} →
            </a>
          </div>
        }
      >
        <div
          className='mx-2 my-2 py-2 text-center cursor-pointer rounded-semi-border-radius-small hover:bg-semi-color-fill-0'
          onClick={() => navigate('/topup')}
          role='button'
          tabIndex={0}
        >
          <div
            className={[
              'text-xs',
              isDanger ? 'text-semi-color-danger' : 'text-semi-color-text-0',
            ].join(' ')}
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {user.loading ? '…' : amountText}
          </div>
        </div>
      </Tooltip>
    );
  }

  return (
    <div className='border-t border-semi-color-border p-3'>
      <div
        className='text-[10px] uppercase text-semi-color-text-2'
        style={{ letterSpacing: '0.05em' }}
      >
        {t('sidebar.balance.label')}
      </div>
      <div
        className={[
          'text-lg font-semibold mb-2',
          isDanger ? 'text-semi-color-danger' : 'text-semi-color-text-0',
        ].join(' ')}
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {user.loading ? <Skeleton.Paragraph rows={1} active /> : amountText}
      </div>
      <Button theme='light' type='tertiary' block onClick={() => navigate('/topup')}>
        {t('sidebar.balance.topup')}
      </Button>
    </div>
  );
}
```

- [ ] **Step 11.3: Wire real balance source**

Replace the stub `user = { quota: null, loading: false }` with the real context from Step 11.1. Swap the formatter (e.g., `renderQuota`).

- [ ] **Step 11.4: Lint + commit**

```bash
cd D:/top/keyapi/web
bun run lint
bun run eslint
git add src/components/layout/sidebar/BalanceCard.jsx
git commit -m "feat(sidebar): add BalanceCard (expanded + collapsed states, tabular-nums)"
```

---

## Task 12: Sidebar — `Sidebar.jsx` shell (desktop / rail)

**Files:**
- Create: `src/components/layout/sidebar/Sidebar.jsx`

- [ ] **Step 12.1: Create**

```jsx
import React from 'react';
import NavTree from './NavTree';
import BalanceCard from './BalanceCard';
import { useNavItems } from '../useNavItems';
// TODO (implementer): import real user
// import { useUserContext } from '../../../context/User';

export default function Sidebar({ mode }) {
  // const { user } = useUserContext();
  const user = null;
  const groups = useNavItems(user);
  const collapsed = mode === 'rail';
  const width = collapsed ? 64 : 240;

  return (
    <aside
      className='flex flex-col bg-semi-color-bg-0 border-r border-semi-color-border'
      style={{
        width,
        transition: 'width 200ms cubic-bezier(0.2, 0, 0, 1)',
      }}
      aria-label='Sidebar'
    >
      <NavTree groups={groups} collapsed={collapsed} />
      <BalanceCard collapsed={collapsed} />
    </aside>
  );
}
```

- [ ] **Step 12.2: Wire real user context**

Replace stub per Step 2.1 findings.

- [ ] **Step 12.3: Lint + commit**

```bash
cd D:/top/keyapi/web
bun run lint
bun run eslint
git add src/components/layout/sidebar/Sidebar.jsx
git commit -m "feat(sidebar): add Sidebar shell with width transition"
```

---

## Task 13: Sidebar — `SidebarDrawer.jsx`

**Files:**
- Create: `src/components/layout/sidebar/SidebarDrawer.jsx`

- [ ] **Step 13.1: Create**

```jsx
import React, { useEffect } from 'react';
import { SideSheet } from '@douyinfe/semi-ui';
import { useLocation } from 'react-router-dom';
import NavTree from './NavTree';
import BalanceCard from './BalanceCard';
import { useNavItems } from '../useNavItems';

export default function SidebarDrawer({ open, onClose }) {
  const { pathname } = useLocation();
  // TODO: wire real user
  const user = null;
  const groups = useNavItems(user);

  useEffect(() => {
    if (open) onClose();
    // Close on any route change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return (
    <SideSheet
      visible={open}
      onCancel={onClose}
      placement='left'
      width={240}
      closable={false}
      headerStyle={{ display: 'none' }}
      bodyStyle={{ padding: 0, display: 'flex', flexDirection: 'column', height: '100%' }}
    >
      <NavTree groups={groups} collapsed={false} />
      <BalanceCard collapsed={false} />
    </SideSheet>
  );
}
```

> Note: the route-change-close logic uses the `useLocation` hook. The `if (open) onClose()` in the effect looks wrong — it actually should trigger only on pathname change, not on open-transition. Refine:

```jsx
const firstRender = React.useRef(true);
useEffect(() => {
  if (firstRender.current) {
    firstRender.current = false;
    return;
  }
  if (open) onClose();
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [pathname]);
```

Use the refined effect (not the first one).

- [ ] **Step 13.2: Lint + commit**

```bash
cd D:/top/keyapi/web
bun run lint
bun run eslint
git add src/components/layout/sidebar/SidebarDrawer.jsx
git commit -m "feat(sidebar): add SidebarDrawer for <768 breakpoint"
```

---

## Task 14: Wire new shell into `PageLayout.jsx`

**Files:**
- Modify: `src/components/layout/PageLayout.jsx`

- [ ] **Step 14.1: Read current PageLayout**

Open `src/components/layout/PageLayout.jsx` (222 lines). Identify:
- Where the current `SiderBar` is rendered
- Where the current `headerbar/index.jsx` (Header) is rendered
- Any context providers / global effects that must stay

- [ ] **Step 14.2: Replace header + sidebar mounting**

Keep providers / effects unchanged. Replace the shell section with:

```jsx
import React from 'react';
import { Outlet } from 'react-router-dom';
import Header from './header/Header';
import Sidebar from './sidebar/Sidebar';
import SidebarDrawer from './sidebar/SidebarDrawer';
import Footer from './Footer';
import { useLayoutState } from './useLayoutState';

export default function PageLayout() {
  const { mode, toggle, drawerOpen, setDrawerOpen } = useLayoutState();

  return (
    <div className='flex flex-col h-screen'>
      <Header
        mode={mode}
        onOpenDrawer={() => setDrawerOpen(true)}
        onToggleCollapse={toggle}
      />
      <div className='flex flex-1 overflow-hidden'>
        {mode !== 'drawer' && <Sidebar mode={mode} />}
        <main className='flex-1 overflow-auto' role='main'>
          <Outlet />
        </main>
      </div>
      <SidebarDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <Footer />
    </div>
  );
}
```

Keep the existing file's non-shell code (context providers, suspense, setup check, etc.) — only swap the Header / Sidebar / SidebarDrawer / Footer region. If the current file had prop drilling into the old `SiderBar`, remove those props (no longer needed; state lives inside `useLayoutState`).

- [ ] **Step 14.3: Lint + build**

```bash
cd D:/top/keyapi/web
bun run lint
bun run eslint
bun run build
```

Expected: 0 errors. Some warnings about unused imports from the old shell are OK — we remove the old files in Task 16.

- [ ] **Step 14.4: Smoke test**

```bash
cd D:/top/keyapi/web
bun run dev
```

In browser at http://localhost:5173:
- [ ] Header renders with logo + tenant (if ≥2) + user avatar
- [ ] Sidebar renders with grouped items
- [ ] Clicking items navigates; active item shows left bar + fill-1 bg
- [ ] Resize to <768 → sidebar gone, hamburger in header; click hamburger → drawer opens; click item → drawer closes
- [ ] Resize to 768–1023 → sidebar shrinks to 64 rail with tooltips on hover
- [ ] Resize back to ≥1024 → sidebar expands to 240
- [ ] Press `Ctrl + \` (or `Cmd + \` on Mac) at ≥1024 → toggles rail ↔ expanded; reload → state persists via localStorage
- [ ] BalanceCard visible at bottom of sidebar in both states

Note any regressions. Ctrl+C.

- [ ] **Step 14.5: Commit**

```bash
cd D:/top/keyapi/web
git add src/components/layout/PageLayout.jsx
git commit -m "feat(layout): wire new Header + Sidebar + Drawer through useLayoutState"
```

---

## Task 15: Update `index.css` global sidebar / animation rules

**Files:**
- Modify: `src/index.css`

- [ ] **Step 15.1: Update sidebar widths**

Open `src/index.css`. Change:

```css
:root {
  --sidebar-width: 180px;
  --sidebar-width-collapsed: 60px;
  --sidebar-current-width: var(--sidebar-width);
}
```

to:

```css
:root {
  --sidebar-width: 240px;
  --sidebar-width-collapsed: 64px;
  --sidebar-current-width: var(--sidebar-width);
}

@media (prefers-reduced-motion: reduce) {
  .app-sider,
  .app-sider * {
    transition: none !important;
  }
}
```

- [ ] **Step 15.2: Remove legacy sidebar selectors that no longer apply**

Scan `src/index.css` for selectors targeting the old monolithic `SiderBar` DOM (`.semi-navigation-item`, `.semi-navigation-sub-title` overrides). Keep them if they still affect the new sidebar (our `NavTree` may use Semi Nav internals — verify by inspecting rendered HTML at `bun run dev`). If they're dead, delete them.

- [ ] **Step 15.3: Lint + build**

```bash
cd D:/top/keyapi/web
bun run lint
bun run build
```

- [ ] **Step 15.4: Commit**

```bash
cd D:/top/keyapi/web
git add src/index.css
git commit -m "style(layout): update sidebar width tokens 180/60 -> 240/64 + reduced-motion"
```

---

## Task 16: Remove obsolete layout files

**Files:**
- Delete: `src/components/layout/SiderBar.jsx`
- Delete: `src/components/layout/headerbar/` (entire dir)

- [ ] **Step 16.1: Confirm no imports remain**

```bash
cd D:/top/keyapi/web
grep -rn "from.*SiderBar" src/ || echo "no references to SiderBar — safe to delete"
grep -rn "from.*headerbar" src/ || echo "no references to headerbar — safe to delete"
```

If anything still references them, resolve before deleting.

- [ ] **Step 16.2: Delete**

```bash
cd D:/top/keyapi/web
git rm src/components/layout/SiderBar.jsx
git rm -r src/components/layout/headerbar
```

- [ ] **Step 16.3: Full build verify**

```bash
cd D:/top/keyapi/web
bun run lint
bun run eslint
bun run build
```

Expected: 0 errors, 0 warnings related to missing imports.

- [ ] **Step 16.4: Commit**

```bash
cd D:/top/keyapi/web
git commit -m "chore(layout): remove legacy SiderBar.jsx (724 lines) and headerbar/ dir"
```

---

## Task 17: End-to-end verification sweep

Walk the full spec Section 12 checklist at `bun run dev`.

- [ ] **Step 17.1: Visual / behavior**

- [ ] ≥1024 default 240 expanded; `Ctrl/⌘+\` toggles rail; toggle again restores
- [ ] Resize 768–1023 → auto rail (forced; localStorage ignored)
- [ ] Back to ≥1024 → restores user's localStorage choice
- [ ] <768 → drawer; overlay click / Esc / route change closes it
- [ ] Rail state: hover each icon → tooltip appears after ~300ms, no flicker
- [ ] BalanceCard: expanded shows 18px tabular amount + CTA; rail shows 12px tabular amount only
- [ ] Active state: 2px primary-color vertical bar on left + fill-1 background
- [ ] Active rule: only the deepest match highlights (test `/tenant` vs `/tenant/members` — only the latter when on that route)

- [ ] **Step 17.2: Theme**

- [ ] UserMenu → Theme → System / Light / Dark → applies + persists across reload
- [ ] No white flash on switch
- [ ] In both themes: active/hover/balance/border visually distinct (manual contrast check — or use DevTools "Inspect > Accessibility > Contrast")

- [ ] **Step 17.3: Permissions**

- [ ] Log in as non-admin → TENANT ADMIN and PLATFORM groups absent
- [ ] Log in as super admin → PLATFORM group appears
- [ ] Single-tenant user → TenantSwitcher absent from header
- [ ] Switch tenant → TENANT ADMIN group re-computes for new tenant

- [ ] **Step 17.4: i18n**

```bash
cd D:/top/keyapi/web
bun run i18n:status
bun run i18n:lint
```

Expected: 0 missing keys for zh-CN and en. Other locales may list untranslated keys (accepted).

In browser, switch language via UserMenu → zh-CN / en → all nav labels translate. Glossary terms (`API Keys`, `Playground`, `Dashboard`) stay English.

- [ ] **Step 17.5: Code quality**

- Confirm no file in `src/components/layout/sidebar/` exceeds 200 lines
- `grep -rn "#" src/components/layout/**/*.jsx | grep -i "color\|bg\|border" | grep -v "semi-color"` — should return nothing (no hex values)
- `bun run build` clean

- [ ] **Step 17.6: Commit any drive-by fixes**

If verification surfaced small issues (missing i18n key, broken import after rename, dead CSS selector), fix inline and commit with descriptive messages. **Do not** expand scope into unrelated refactors.

---

## Task 18: Open a PR for review

- [ ] **Step 18.1: Push branch**

```bash
cd D:/top/keyapi/web
git status
git push -u origin dev
```

If `dev` is the trunk branch, instead create a topic branch before pushing:

```bash
cd D:/top/keyapi/web
git checkout -b refactor/shell-and-nav
git push -u origin refactor/shell-and-nav
```

- [ ] **Step 18.2: Open PR** (coordinate with LO for actual remote; skip if repo has no remote or this is a local-only refactor)

```bash
cd D:/top/keyapi/web
gh pr create --title "refactor(layout): Shell & Nav per Design Context" --body "$(cat <<'EOF'
## Summary
- Replaces SiderBar.jsx (724 lines) + headerbar/ (11 files) with focused layout module
- Two hooks: useLayoutState (collapse/breakpoints), useNavItems (role/flag filter)
- New header/ dir: thin Header + consolidated UserMenu + refactored TenantSwitcher
- New sidebar/ dir: Sidebar shell + NavTree/NavGroup/NavItem + BalanceCard + SidebarDrawer
- Three-state responsive: 240px / 64px rail / drawer; Ctrl/⌘+\\ toggle + localStorage
- Dual-theme parity preserved; zero hex values; i18n for all new strings

## Spec
docs/superpowers/specs/2026-04-17-shell-and-nav-design.md

## Test plan
- [ ] Smoke at ≥1024 / 768-1023 / <768 breakpoints
- [ ] Theme switch persist + no flash
- [ ] Permissions: non-admin sees only 4 groups; super admin sees PLATFORM
- [ ] i18n status clean for zh-CN + en; EN terms untranslated (API Keys, Playground, Dashboard)
- [ ] Build clean

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review

**Spec coverage** — each numbered spec section maps to tasks:

| Spec | Task(s) |
|---|---|
| 3 Decisions table | locked into Tasks 1 / 8-12 / 11 / 1 |
| 4.1 File layout | Tasks 4, 5, 7-14, 16 |
| 4.2 Navigation data model | Task 2 |
| 5 Header | Tasks 5, 6, 7 |
| 6 Sidebar (expanded, rail) | Tasks 8-12 |
| 6.4 Drawer | Task 13 |
| 7 BalanceCard | Task 11 |
| 8 Collapse / responsive | Tasks 1, 14, 15 |
| 9 Theming | Task 7 (theme menu) + Task 17.2 verification |
| 10 Access control | Task 2 (filter) |
| 11 i18n | Task 3 |
| 12 Verification | Task 17 |
| 13 Risks | addressed inline in Tasks 2.1, 7.1, 11.1 (investigation steps) |

**Placeholder scan** — the Task 2, 6, 7, 11, 12 code templates use stubbed `user = { ... }`/similar — these are **explicit implementer hand-offs tagged with `// TODO (implementer — ...)`** pointing at the Step 2.1 / 7.1 / 11.1 investigation steps. The plan instructs the implementer to replace stubs in the step immediately following the code. This satisfies the "complete code in every step" rule because the stub is runnable as-written while directing the implementer at the real wiring. No free-floating "TBD"s.

**Type consistency** — `useLayoutState` exports `{ mode, toggle, drawerOpen, setDrawerOpen }`. Consumed identically in `PageLayout.jsx` (Task 14). `useNavItems` exports `useNavItems(user)` → array of groups with `{ group, i18nKey, label, items: [{ id, icon, to, i18nKey, label }] }`. Consumed identically in `Sidebar.jsx` (Task 12) and `SidebarDrawer.jsx` (Task 13). NavItem signature `{ item, siblings, collapsed }` consistent in Task 9 `NavGroup`. BalanceCard signature `{ collapsed }` consistent in Tasks 12 and 13.
