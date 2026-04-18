# web-next Slice 1 — App Shell + Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 web-next 重写的第一个 slice——app shell、Email + WeChat 登录、密码重置、路由骨架、i18n、MSW 集成测——让付费开发者能注册、登录、进入 shell 并在 sidebar 里看到完整信息架构。

**Architecture:** Vite 6 + React 19 SPA。`<AuthProvider>` 管 auth state（参考 spec §7.5），`<ProtectedRoute>` 做路由守卫。Axios 实例 + 拦截器注入 `New-API-User` / `X-Tenant-Id` header 并归一错误。UI 用 shadcn/Radix + Tailwind 3，所有 token 走 `design_file/colors_and_type.css`（通过 CSS `@import`，不复制）。

**Tech Stack:** React 19 · Vite 6 · TypeScript 5 strict · Tailwind 3 · shadcn/ui · Radix · TanStack Query · React Router v7 · react-hook-form + zod · react-i18next · Vitest + React Testing Library + MSW · sonner · Lucide.

**Spec:** [`docs/superpowers/specs/2026-04-18-web-next-slice-1-shell-auth-design.md`](../specs/2026-04-18-web-next-slice-1-shell-auth-design.md) — commit `c3d9c05`

**Working directory:** `web-next/`（已脚手架，分支 `feat/web-rewrite`）

**后端接触面：** 只读 `controller/user.go`、`controller/misc.go`、`controller/wechat.go`、`middleware/{auth,tenant}.go`、`router/api-router.go`。不改后端代码；任何 MSW handler 与真实 endpoint 不符，以**后端代码**为准。

---

## 文件地图

### 新建

```
web-next/
  components.json                         # shadcn CLI 配置
  vitest.config.ts                        # vitest + jsdom 配置
  .eslintrc.cjs                           # ESLint（React + hooks + TS）
  .prettierrc.json                        # prettier 配置
  src/
    lib/
      api.ts                              # axios 实例 + ApiError + interceptors
      api.test.ts
      format.ts                           # Intl helpers
      format.test.ts
      password.ts                         # 简易强度评估
      password.test.ts
      bootstrap.ts                        # localStorage auth-bootstrap 读写
      bootstrap.test.ts
      observability.ts                    # logError stub
    providers/
      AuthProvider.tsx
      AuthProvider.test.tsx
      AppProviders.tsx                    # 组合 QueryClient + Auth + Toaster + I18n
    hooks/
      useAuth.ts                          # consumer hook
      useCountdown.ts
      useCountdown.test.ts
    components/
      ui/                                 # shadcn 生成的 primitives（14 个）
      auth/
        AuthLayout.tsx
        InlineBanner.tsx
        InlineBanner.test.tsx
        PasswordField.tsx
        PasswordStrengthBar.tsx
        PasswordStrengthBar.test.tsx
        ResendCountdown.tsx
        ResendCountdown.test.tsx
        WechatCodeModal.tsx
        WechatCodeModal.test.tsx
      layout/
        AppShell.tsx
        Sidebar.tsx
        SidebarGroup.tsx
        NavItem.tsx
        UserChip.tsx
        Topbar.tsx
        TopbarSearchStub.tsx
        UserMenu.tsx
        ThemeToggle.tsx
        LangToggle.tsx
        Logo.tsx
      common/
        ComingSoon.tsx
        FullPageSkeleton.tsx
        ErrorBoundary.tsx
        RouteErrorFallback.tsx
        NotFound.tsx
        Forbidden.tsx
        ProtectedRoute.tsx
        ProtectedRoute.test.tsx
    pages/
      Login.tsx
      Login.test.tsx
      Register.tsx
      Register.test.tsx
      Forgot.tsx
      Reset.tsx
      Reset.test.tsx
    i18n/
      locales/
        zh/{common,auth,shell,errors}.json
        en/{common,auth,shell,errors}.json
    test/
      setup.ts                            # RTL + jest-dom + matchMedia polyfill
      msw/
        handlers.ts                       # MSW handlers（auth 子集）
        server.ts                         # MSW node server
      integration/
        login.test.tsx
        register.test.tsx
        forgot-reset.test.tsx
        wechat.test.tsx
```

### 修改

- `web-next/package.json` — add runtime + dev + shadcn peer deps，新增 `test` / `test:ui` script
- `web-next/tsconfig.app.json` — 加 `include: ["src", "vite-env.d.ts"]` 已 OK；加 `"types": ["vitest/globals"]`
- `web-next/vite.config.ts` — 无需改（dev 代理已就位）
- `web-next/src/index.css` — 无需改（design_file 已 @import）
- `web-next/src/main.tsx` — 无需改
- `web-next/src/App.tsx` — **重写**，用 AppProviders 包 RouterProvider
- `web-next/src/routes.tsx` — **重写**，6 条 public route + protected route group + 404
- `web-next/src/lib/theme.ts` — 不改（已实现 applyTheme/getStoredTheme/initTheme）
- `web-next/src/pages/Home.tsx` — **删除**，被 ComingSoon 替代
- `web-next/src/i18n/index.ts` — 改为从 `locales/*` 动态加载，而不是内联 json
- `web-next/src/i18n/zh.json` / `en.json` — **删除**，由 `locales/zh/*.json` 分 ns 替代

---

## 任务分组

| # | Task | TDD | 依赖 |
|---|---|---|---|
| 1 | 安装依赖 + shadcn init + ESLint/Prettier + Vitest 配置 | 否 | — |
| 2 | MSW + test setup + jest-dom | 否 | 1 |
| 3 | `lib/bootstrap.ts` | ✓ | 1 |
| 4 | `lib/format.ts` | ✓ | 1 |
| 5 | `lib/password.ts` | ✓ | 1 |
| 6 | `lib/observability.ts` + `lib/api.ts`（含 ApiError、interceptors） | ✓ | 3 |
| 7 | i18n locales 拆 ns + 动态加载 | 否 | 1 |
| 8 | `AuthProvider` + `useAuth` + `ProtectedRoute` + `AppProviders` | ✓ | 6, 2 |
| 9 | 表单通用件：InlineBanner + ResendCountdown + useCountdown + PasswordStrengthBar + PasswordField + AuthLayout | ✓ | 8 |
| 10 | `/login` 页 + WechatCodeModal | ✓ | 9 |
| 11 | `/register` 两步式页 | ✓ | 9 |
| 12 | `/forgot` + `/reset` + `/user/reset` 页 | ✓ | 9 |
| 13 | Shell 组件：Logo + NavItem + SidebarGroup + Sidebar + Topbar + TopbarSearchStub + UserChip + UserMenu + ThemeToggle + LangToggle + AppShell | 部分 | 8 |
| 14 | 通用 / 错误组件：ComingSoon + NotFound + Forbidden + ErrorBoundary + RouteErrorFallback + FullPageSkeleton | 否 | 8 |
| 15 | Routes.tsx 重写 + App.tsx 装配 + 删除 Home.tsx | 否 | 10–14 |
| 16 | 4 条 MSW 集成测：login / register / forgot→reset / wechat | ✓ | 10–12 |
| 17 | 验收检查 + production build | 否 | 15, 16 |

---

## Task 1 — Install Dependencies + Configure shadcn/ESLint/Prettier/Vitest

**Files:**
- Modify: `web-next/package.json`
- Create: `web-next/components.json`
- Create: `web-next/.eslintrc.cjs`
- Create: `web-next/.prettierrc.json`
- Create: `web-next/.prettierignore`
- Create: `web-next/vitest.config.ts`
- Modify: `web-next/tsconfig.app.json` — 加 `"types": ["vitest/globals", "@testing-library/jest-dom"]`

- [ ] **Step 1: Install runtime dependencies**

```bash
cd web-next
bun add react-hook-form @hookform/resolvers zod sonner
```

- [ ] **Step 2: Install shadcn Radix peers**

```bash
bun add @radix-ui/react-dropdown-menu @radix-ui/react-dialog @radix-ui/react-label @radix-ui/react-separator @radix-ui/react-slot @radix-ui/react-tooltip @radix-ui/react-avatar
```

- [ ] **Step 3: Install test toolchain**

```bash
bun add -D vitest @vitest/coverage-v8 @testing-library/react @testing-library/jest-dom @testing-library/user-event @testing-library/dom jsdom msw@latest
```

- [ ] **Step 4: Install ESLint + Prettier**

```bash
bun add -D eslint @eslint/js typescript-eslint eslint-plugin-react eslint-plugin-react-hooks eslint-plugin-react-refresh globals @types/node
```

(prettier already in devDependencies from scaffold)

- [ ] **Step 5: Run shadcn CLI init**

```bash
bunx shadcn@latest init -d
```
Answer prompts: TypeScript=yes, style=default, base color=slate (will be overridden by our tokens), CSS variables=yes, tailwind.config=`tailwind.config.ts`, components alias=`@/components`, utils=`@/lib/utils`. Accept defaults for rest.

After init, overwrite `web-next/components.json` with exact content below (slate + our alias):

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.ts",
    "css": "src/index.css",
    "baseColor": "slate",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  }
}
```

> ⚠️ shadcn init 可能改写 `src/index.css` 和 `tailwind.config.ts`。**init 跑完后立刻 `git diff`**；如果 index.css 失去了 `@import '../../design_file/…'` 两行，恢复到 commit 前状态（`git checkout -- src/index.css tailwind.config.ts`）再用以下 step 手动加 shadcn 所需 CSS layer。

- [ ] **Step 6: Patch `src/index.css` to add shadcn layer without losing design_file tokens**

Open `src/index.css` and ensure it reads exactly:

```css
@import '../../design_file/fonts/fonts.css';
@import '../../design_file/colors_and_type.css';

@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  html,
  body,
  #root {
    height: 100%;
  }

  body {
    font-family: var(--font-sans);
    background: var(--bg-0);
    color: var(--text-0);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    text-rendering: optimizeLegibility;
  }

  * {
    border-color: var(--border);
  }
}
```

- [ ] **Step 7: Add shadcn primitives**

```bash
bunx shadcn@latest add button input label form checkbox alert skeleton avatar badge separator dropdown-menu dialog tooltip sonner
```

确认生成了 `src/components/ui/{button,input,label,form,checkbox,alert,skeleton,avatar,badge,separator,dropdown-menu,dialog,tooltip,sonner}.tsx` 14 个文件。

- [ ] **Step 8: Write `.eslintrc.cjs`**

```js
// web-next/.eslintrc.cjs
/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  env: { browser: true, es2022: true, node: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
    'plugin:react/jsx-runtime',
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module', ecmaFeatures: { jsx: true } },
  plugins: ['@typescript-eslint', 'react', 'react-hooks', 'react-refresh'],
  settings: { react: { version: 'detect' } },
  ignorePatterns: ['dist', 'node_modules', 'src/components/ui/**'],
  rules: {
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    'react/prop-types': 'off',
  },
};
```

- [ ] **Step 9: Write `.prettierrc.json` + `.prettierignore`**

```json
{
  "singleQuote": true,
  "jsxSingleQuote": true,
  "semi": true,
  "trailingComma": "es5",
  "printWidth": 100
}
```

```
# web-next/.prettierignore
dist
node_modules
src/components/ui
```

- [ ] **Step 10: Write `vitest.config.ts`**

```ts
// web-next/vitest.config.ts
/// <reference types="vitest" />
import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@design': path.resolve(__dirname, '../design_file'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: ['src/components/ui/**', 'src/test/**', 'src/main.tsx'],
    },
  },
});
```

- [ ] **Step 11: Add test scripts + update `tsconfig.app.json`**

Modify `package.json` scripts block:

```json
"scripts": {
  "dev": "vite",
  "build": "tsc -b && vite build",
  "preview": "vite preview",
  "typecheck": "tsc -b",
  "lint": "prettier . --check",
  "lint:fix": "prettier . --write",
  "eslint": "bunx eslint \"src/**/*.{ts,tsx}\" --cache",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:ui": "vitest --ui"
}
```

Modify `tsconfig.app.json`，在 `compilerOptions` 里加 `"types": ["vitest/globals", "@testing-library/jest-dom"]`。完整 compilerOptions 如下（注意 `types` 这一行是新增）：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": false,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"],
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"],
      "@design/*": ["../design_file/*"]
    }
  },
  "include": ["src", "vite-env.d.ts"]
}
```

- [ ] **Step 12: Verify build + typecheck still pass**

```bash
cd web-next
bun run typecheck
```
Expected: exit 0, no errors.

- [ ] **Step 13: Commit**

```bash
cd E:/new_key_api/keyapi
git add web-next/package.json web-next/bun.lock web-next/components.json web-next/.eslintrc.cjs web-next/.prettierrc.json web-next/.prettierignore web-next/vitest.config.ts web-next/tsconfig.app.json web-next/src/components/ui web-next/src/index.css web-next/tailwind.config.ts web-next/src/lib/utils.ts
git commit -m "chore(web-next): add shadcn primitives + vitest + eslint + prettier"
```

---

## Task 2 — MSW + Test Setup

**Files:**
- Create: `web-next/src/test/setup.ts`
- Create: `web-next/src/test/msw/handlers.ts`
- Create: `web-next/src/test/msw/server.ts`

- [ ] **Step 1: Write `src/test/setup.ts`**

```ts
// web-next/src/test/setup.ts
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';

import { server } from './msw/server';

// Polyfill matchMedia（jsdom 不带）
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  localStorage.clear();
});
afterAll(() => server.close());
```

- [ ] **Step 2: Write `src/test/msw/handlers.ts`**

Defines default happy-path handlers for the 8 endpoints used by Slice 1. Tests can override per-case via `server.use(...)`.

```ts
// web-next/src/test/msw/handlers.ts
import { HttpResponse, http } from 'msw';

const okUser = {
  id: 42,
  username: 'alice',
  email: 'alice@example.com',
  display_name: 'Alice',
  role: 1,
  platform_role: 0,
  tenant_role: 0,
  tenant_id: 1,
  group: 'default',
  quota: 100000,
  used_quota: 25000,
};

export const handlers = [
  // GET /api/user/self — 认证后拉用户
  http.get('/api/user/self', ({ request }) => {
    if (!request.headers.get('new-api-user')) {
      return HttpResponse.json({ success: false, message: 'unauthorized' }, { status: 401 });
    }
    return HttpResponse.json({ success: true, data: okUser });
  }),

  // POST /api/user/login
  http.post('/api/user/login', async ({ request }) => {
    const body = (await request.json()) as { username?: string; password?: string };
    if (body?.password === 'wrong') {
      return HttpResponse.json({ success: false, message: '密码错误' });
    }
    return HttpResponse.json({ success: true, data: { id: okUser.id, tenant_id: okUser.tenant_id } });
  }),

  // POST /api/user/logout
  http.post('/api/user/logout', () => HttpResponse.json({ success: true })),

  // POST /api/user/register
  http.post('/api/user/register', () => HttpResponse.json({ success: true })),

  // GET /api/verification?email=...
  http.get('/api/verification', () => HttpResponse.json({ success: true, message: '验证码已发送' })),

  // GET /api/reset_password?email=...
  http.get('/api/reset_password', () =>
    HttpResponse.json({ success: true, message: '重置邮件已发送' })
  ),

  // POST /api/user/reset — server-generated password
  http.post('/api/user/reset', () =>
    HttpResponse.json({ success: true, data: 'Gx7kPq2mN9vR' })
  ),

  // GET /api/oauth/wechat?code=... — direct login
  http.get('/api/oauth/wechat', ({ request }) => {
    const code = new URL(request.url).searchParams.get('code');
    if (!code || code === 'bad') {
      return HttpResponse.json({ success: false, message: '验证码无效' });
    }
    return HttpResponse.json({ success: true, data: { id: okUser.id, tenant_id: okUser.tenant_id } });
  }),
];
```

- [ ] **Step 3: Write `src/test/msw/server.ts`**

```ts
// web-next/src/test/msw/server.ts
import { setupServer } from 'msw/node';

import { handlers } from './handlers';

export const server = setupServer(...handlers);
```

- [ ] **Step 4: Smoke-check test infra**

Create a throwaway test `src/test/smoke.test.ts`:

```ts
import { expect, test } from 'vitest';

test('msw infra boots', async () => {
  const res = await fetch('/api/verification?email=x@y.com');
  const body = await res.json();
  expect(body).toEqual({ success: true, message: '验证码已发送' });
});
```

Run:

```bash
bun run test
```
Expected: PASS `msw infra boots`. Delete `src/test/smoke.test.ts` after confirmation.

- [ ] **Step 5: Commit**

```bash
git add web-next/src/test
git commit -m "chore(web-next): add MSW node server + test setup"
```

---

## Task 3 — lib/bootstrap.ts

持久化最小 auth 信息到 localStorage（spec §7.6）。

**Files:**
- Create: `web-next/src/lib/bootstrap.ts`
- Create: `web-next/src/lib/bootstrap.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// web-next/src/lib/bootstrap.test.ts
import { afterEach, describe, expect, test } from 'vitest';

import { clearBootstrap, loadBootstrap, saveBootstrap } from './bootstrap';

afterEach(() => localStorage.clear());

describe('auth bootstrap', () => {
  test('returns null when nothing stored', () => {
    expect(loadBootstrap()).toBeNull();
  });

  test('round trips { id, tenant_id }', () => {
    saveBootstrap({ id: 42, tenant_id: 7 });
    expect(loadBootstrap()).toEqual({ id: 42, tenant_id: 7 });
  });

  test('ignores malformed payloads', () => {
    localStorage.setItem('new-api.auth-bootstrap', '{not json');
    expect(loadBootstrap()).toBeNull();
  });

  test('ignores payloads missing id', () => {
    localStorage.setItem('new-api.auth-bootstrap', JSON.stringify({ tenant_id: 7 }));
    expect(loadBootstrap()).toBeNull();
  });

  test('clearBootstrap removes the key', () => {
    saveBootstrap({ id: 42, tenant_id: 7 });
    clearBootstrap();
    expect(loadBootstrap()).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
bun run test src/lib/bootstrap.test.ts
```
Expected: FAIL — `bootstrap` module not found.

- [ ] **Step 3: Implement `lib/bootstrap.ts`**

```ts
// web-next/src/lib/bootstrap.ts
const KEY = 'new-api.auth-bootstrap';

export type AuthBootstrap = {
  id: number;
  tenant_id: number;
};

export function loadBootstrap(): AuthBootstrap | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as AuthBootstrap).id === 'number'
    ) {
      const tenantId =
        typeof (parsed as AuthBootstrap).tenant_id === 'number'
          ? (parsed as AuthBootstrap).tenant_id
          : 1;
      return { id: (parsed as AuthBootstrap).id, tenant_id: tenantId };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveBootstrap(payload: AuthBootstrap): void {
  localStorage.setItem(KEY, JSON.stringify(payload));
}

export function clearBootstrap(): void {
  localStorage.removeItem(KEY);
}
```

- [ ] **Step 4: Run — expect pass**

```bash
bun run test src/lib/bootstrap.test.ts
```
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add web-next/src/lib/bootstrap.ts web-next/src/lib/bootstrap.test.ts
git commit -m "feat(web-next): auth-bootstrap localStorage util"
```

---

## Task 4 — lib/format.ts

Intl helpers（spec §10.4）。

**Files:**
- Create: `web-next/src/lib/format.ts`
- Create: `web-next/src/lib/format.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// web-next/src/lib/format.test.ts
import i18n from 'i18next';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { fmtDate, fmtMoney, fmtNum } from './format';

beforeAll(async () => {
  if (!i18n.isInitialized) {
    await i18n.init({ lng: 'en', resources: { en: { translation: {} } } });
  }
  await i18n.changeLanguage('en');
});

afterAll(async () => {
  await i18n.changeLanguage('en');
});

describe('format', () => {
  test('fmtMoney en USD default 2 decimals', () => {
    expect(fmtMoney(1284.5)).toBe('$1,284.50');
  });

  test('fmtMoney CNY', () => {
    expect(fmtMoney(1000, 'CNY')).toMatch(/CN¥1,000\.00|¥1,000\.00/);
  });

  test('fmtNum thousands', () => {
    expect(fmtNum(9432108)).toBe('9,432,108');
  });

  test('fmtDate returns locale string', () => {
    const out = fmtDate('2026-04-18T12:34:56Z');
    expect(out).toMatch(/\d/);
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
bun run test src/lib/format.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement `lib/format.ts`**

```ts
// web-next/src/lib/format.ts
import i18n from 'i18next';

export function fmtMoney(n: number, currency = 'USD'): string {
  return new Intl.NumberFormat(i18n.language, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export function fmtNum(n: number): string {
  return new Intl.NumberFormat(i18n.language).format(n);
}

export function fmtDate(d: Date | string | number): string {
  const date = d instanceof Date ? d : new Date(d);
  return new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}
```

- [ ] **Step 4: Run — expect pass**

```bash
bun run test src/lib/format.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web-next/src/lib/format.ts web-next/src/lib/format.test.ts
git commit -m "feat(web-next): Intl format helpers"
```

---

## Task 5 — lib/password.ts

简易强度评估（spec §2 决策）。

**Files:**
- Create: `web-next/src/lib/password.ts`
- Create: `web-next/src/lib/password.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// web-next/src/lib/password.test.ts
import { describe, expect, test } from 'vitest';

import { estimateStrength } from './password';

describe('estimateStrength', () => {
  test('empty → none', () => {
    expect(estimateStrength('')).toBe('none');
  });
  test('< 6 chars → weak', () => {
    expect(estimateStrength('ab1')).toBe('weak');
  });
  test('6+ chars but single class → weak', () => {
    expect(estimateStrength('abcdef')).toBe('weak');
  });
  test('2 classes + 8+ → fair', () => {
    expect(estimateStrength('abcdef12')).toBe('fair');
  });
  test('3 classes + 10+ → good', () => {
    expect(estimateStrength('Abcdef1234')).toBe('good');
  });
  test('4 classes + 12+ → strong', () => {
    expect(estimateStrength('Abcdef1234!@')).toBe('strong');
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
bun run test src/lib/password.test.ts
```

- [ ] **Step 3: Implement `lib/password.ts`**

```ts
// web-next/src/lib/password.ts
export type Strength = 'none' | 'weak' | 'fair' | 'good' | 'strong';

export function estimateStrength(pw: string): Strength {
  if (!pw) return 'none';
  const len = pw.length;
  const classes =
    (/[a-z]/.test(pw) ? 1 : 0) +
    (/[A-Z]/.test(pw) ? 1 : 0) +
    (/\d/.test(pw) ? 1 : 0) +
    (/[^A-Za-z0-9]/.test(pw) ? 1 : 0);

  if (len < 6) return 'weak';
  if (classes <= 1) return 'weak';
  if (classes === 2 && len >= 8) return 'fair';
  if (classes === 3 && len >= 10) return 'good';
  if (classes === 4 && len >= 12) return 'strong';
  if (classes >= 3) return 'good';
  return 'fair';
}
```

- [ ] **Step 4: Run — expect pass**

```bash
bun run test src/lib/password.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add web-next/src/lib/password.ts web-next/src/lib/password.test.ts
git commit -m "feat(web-next): password strength estimator"
```

---

## Task 6 — lib/observability.ts + lib/api.ts

核心 axios 实例 + 拦截器（spec §7）。

**Files:**
- Create: `web-next/src/lib/observability.ts`
- Create: `web-next/src/lib/api.ts`
- Create: `web-next/src/lib/api.test.ts`

- [ ] **Step 1: Write `lib/observability.ts`**

```ts
// web-next/src/lib/observability.ts
export function logError(err: unknown, ctx: Record<string, unknown> = {}): void {
  // Phase 2 可替换为 Sentry.captureException；day-1 仅 console.
  // eslint-disable-next-line no-console
  console.error('[web-next]', err, ctx);
}
```

- [ ] **Step 2: Write failing tests for api.ts**

```ts
// web-next/src/lib/api.test.ts
import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, test } from 'vitest';

import { server } from '@/test/msw/server';

import { ApiError, api } from './api';

afterEach(() => server.resetHandlers());

describe('api client', () => {
  test('unwraps success: true payload', async () => {
    server.use(
      http.get('/api/ping', () => HttpResponse.json({ success: true, data: { pong: true } }))
    );
    await expect(api.get('/api/ping').then((r) => r.data)).resolves.toEqual({ pong: true });
  });

  test('throws ApiError on success: false', async () => {
    server.use(
      http.get('/api/fail', () => HttpResponse.json({ success: false, message: '坏了' }))
    );
    await expect(api.get('/api/fail')).rejects.toMatchObject({
      name: 'ApiError',
      backendMessage: '坏了',
    });
  });

  test('throws ApiError with code=server_error on 500', async () => {
    server.use(http.get('/api/boom', () => HttpResponse.json({}, { status: 500 })));
    await expect(api.get('/api/boom')).rejects.toMatchObject({
      name: 'ApiError',
      status: 500,
      code: 'server_error',
    });
  });

  test('injects New-API-User header from bootstrap', async () => {
    localStorage.setItem('new-api.auth-bootstrap', JSON.stringify({ id: 99, tenant_id: 2 }));
    let seen: string | null = null;
    server.use(
      http.get('/api/whoami', ({ request }) => {
        seen = request.headers.get('new-api-user');
        return HttpResponse.json({ success: true, data: null });
      })
    );
    await api.get('/api/whoami');
    expect(seen).toBe('99');
  });

  test('omits New-API-User when no bootstrap', async () => {
    let seen: string | null = null;
    server.use(
      http.get('/api/whoami2', ({ request }) => {
        seen = request.headers.get('new-api-user');
        return HttpResponse.json({ success: true, data: null });
      })
    );
    await api.get('/api/whoami2');
    expect(seen).toBeNull();
  });

  test('ApiError.fromBody defaults code to unknown', () => {
    const e = ApiError.fromBody({ message: 'oops' });
    expect(e.code).toBe('unknown');
    expect(e.backendMessage).toBe('oops');
  });
});
```

- [ ] **Step 3: Run — expect fail**

```bash
bun run test src/lib/api.test.ts
```

- [ ] **Step 4: Implement `lib/api.ts`**

```ts
// web-next/src/lib/api.ts
import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import i18n from 'i18next';

import { loadBootstrap } from './bootstrap';
import { logError } from './observability';

export class ApiError extends Error {
  status: number;
  code: string;
  backendMessage?: string;
  fieldErrors?: Record<string, string>;

  constructor(message: string, status = 0, code = 'unknown') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }

  static fromBody(body: {
    message?: string;
    code?: string;
    errors?: Record<string, string>;
  }): ApiError {
    const msg = body.message ?? 'Unknown error';
    const e = new ApiError(msg, 0, body.code ?? 'unknown');
    e.backendMessage = body.message;
    e.fieldErrors = body.errors;
    return e;
  }
}

// 用事件驱动解耦 navigate/toast，避免 api.ts 依赖 React Router。
type AuthEvent = 'unauthorized' | 'forbidden';
type AuthListener = (e: AuthEvent) => void;
const authListeners = new Set<AuthListener>();

export function onAuthEvent(fn: AuthListener): () => void {
  authListeners.add(fn);
  return () => authListeners.delete(fn);
}

function emitAuthEvent(e: AuthEvent): void {
  authListeners.forEach((l) => {
    try {
      l(e);
    } catch (err) {
      logError(err, { tag: 'auth-event-listener' });
    }
  });
}

type ToastListener = (kind: 'error', message: string) => void;
const toastListeners = new Set<ToastListener>();

export function onToast(fn: ToastListener): () => void {
  toastListeners.add(fn);
  return () => toastListeners.delete(fn);
}

function emitToast(kind: 'error', message: string): void {
  toastListeners.forEach((l) => {
    try {
      l(kind, message);
    } catch (err) {
      logError(err, { tag: 'toast-listener' });
    }
  });
}

export const api = axios.create({
  baseURL: '/',
  withCredentials: true,
  timeout: 20_000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const boot = loadBootstrap();
  if (boot) {
    config.headers.set('New-API-User', String(boot.id));
    config.headers.set('X-Tenant-Id', String(boot.tenant_id));
  }
  if (i18n.language) {
    config.headers.set('Accept-Language', i18n.language);
  }
  return config;
});

api.interceptors.response.use(
  (response) => {
    const body = response.data as { success?: boolean; data?: unknown; message?: string; code?: string };
    if (body && typeof body === 'object' && body.success === false) {
      throw ApiError.fromBody(body);
    }
    if (body && typeof body === 'object' && 'data' in body) {
      response.data = body.data;
    }
    return response;
  },
  (error: AxiosError) => {
    if (error.response) {
      const status = error.response.status;
      const body = error.response.data as Record<string, unknown> | undefined;
      if (status === 401) {
        emitAuthEvent('unauthorized');
        const e = new ApiError('Unauthorized', 401, 'unauthorized');
        e.backendMessage = typeof body?.message === 'string' ? body.message : undefined;
        return Promise.reject(e);
      }
      if (status === 403) {
        emitAuthEvent('forbidden');
        const e = new ApiError('Forbidden', 403, 'forbidden');
        e.backendMessage = typeof body?.message === 'string' ? body.message : undefined;
        return Promise.reject(e);
      }
      if (status >= 500) {
        emitToast('error', 'Server error. Try again in a moment.');
        const e = new ApiError('Server error', status, 'server_error');
        return Promise.reject(e);
      }
      if (body && typeof body === 'object') {
        return Promise.reject(
          ApiError.fromBody(body as { message?: string; code?: string; errors?: Record<string, string> })
        );
      }
      return Promise.reject(new ApiError(error.message, status, 'unknown'));
    }
    // no response → network / timeout
    emitToast('error', 'Network error. Check your connection.');
    return Promise.reject(new ApiError(error.message || 'Network error', 0, 'network'));
  }
);
```

- [ ] **Step 5: Run — expect pass**

```bash
bun run test src/lib/api.test.ts
```
Expected: PASS (6 tests).

- [ ] **Step 6: Typecheck**

```bash
bun run typecheck
```
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add web-next/src/lib/api.ts web-next/src/lib/api.test.ts web-next/src/lib/observability.ts
git commit -m "feat(web-next): axios client + ApiError + auth/toast event buses"
```

---

## Task 7 — i18n locales 拆 namespace + 动态加载

**Files:**
- Delete: `web-next/src/i18n/zh.json`、`web-next/src/i18n/en.json`
- Create: `web-next/src/i18n/locales/zh/common.json`
- Create: `web-next/src/i18n/locales/zh/auth.json`
- Create: `web-next/src/i18n/locales/zh/shell.json`
- Create: `web-next/src/i18n/locales/zh/errors.json`
- Create: `web-next/src/i18n/locales/en/common.json`
- Create: `web-next/src/i18n/locales/en/auth.json`
- Create: `web-next/src/i18n/locales/en/shell.json`
- Create: `web-next/src/i18n/locales/en/errors.json`
- Modify: `web-next/src/i18n/index.ts`

- [ ] **Step 1: Delete old flat locale files**

```bash
cd web-next
rm src/i18n/zh.json src/i18n/en.json
```

- [ ] **Step 2: Write zh locales**

```json
// web-next/src/i18n/locales/zh/common.json
{
  "app.name": "new-api",
  "actions.save": "保存",
  "actions.cancel": "取消",
  "actions.confirm": "确认",
  "actions.back": "返回",
  "actions.copy": "复制",
  "actions.copied": "已复制",
  "states.loading": "加载中…",
  "viewport.too_narrow": "请使用更大的屏幕访问"
}
```

```json
// web-next/src/i18n/locales/zh/auth.json
{
  "login.title": "登录",
  "login.eyebrow": "Sign in",
  "login.username_label": "邮箱 / 用户名",
  "login.password_label": "密码",
  "login.submit": "登录",
  "login.submit_loading": "登录中…",
  "login.forgot": "忘记密码？",
  "login.or": "或",
  "login.wechat": "使用 WeChat 登录",
  "login.to_register": "还没有账户？ 立即注册 →",
  "register.title": "创建账户",
  "register.eyebrow": "Create account",
  "register.step1.email_label": "邮箱",
  "register.step1.send_code": "发送验证码",
  "register.step1.sending": "发送中…",
  "register.step2.email_locked_change": "换一个邮箱",
  "register.step2.code_label": "邮箱验证码",
  "register.step2.username_label": "用户名（可选）",
  "register.step2.password_label": "设置密码",
  "register.step2.password_confirm_label": "确认密码",
  "register.step2.submit": "创建账户",
  "register.step2.submit_loading": "创建中…",
  "register.to_login": "已有账户？ 立即登录 →",
  "forgot.title": "重置密码",
  "forgot.eyebrow": "Reset password",
  "forgot.email_label": "注册邮箱",
  "forgot.submit": "发送重置邮件",
  "forgot.sending": "发送中…",
  "forgot.sent_title": "检查收件箱",
  "forgot.sent_body": "已将重置链接发送到 {{email}}",
  "forgot.resend": "重新发送",
  "forgot.resend_cooldown": "可在 {{seconds}} 秒后重发",
  "forgot.back_to_login": "← 返回登录",
  "reset.title": "设置新密码",
  "reset.eyebrow": "Reset password",
  "reset.email_label": "邮箱",
  "reset.explain": "为了安全起见，我们会随机生成一个新密码并直接返回；请妥善保存。",
  "reset.submit": "重置密码",
  "reset.submitting": "重置中…",
  "reset.success_title": "密码已重置",
  "reset.success_body": "新密码如下，请复制并妥善保存。",
  "reset.go_login": "回到登录 →",
  "wechat.modal_title": "使用 WeChat 登录",
  "wechat.explain": "从微信获取 code 后粘贴到下方",
  "wechat.code_label": "WeChat code",
  "wechat.submit": "继续",
  "wechat.submitting": "验证中…",
  "strength.none": "",
  "strength.weak": "弱",
  "strength.fair": "一般",
  "strength.good": "良好",
  "strength.strong": "强",
  "resend.label": "重新发送",
  "resend.cooldown": "{{seconds}}s"
}
```

```json
// web-next/src/i18n/locales/zh/shell.json
{
  "nav.build": "BUILD",
  "nav.billing": "BILLING",
  "nav.dashboard": "Dashboard",
  "nav.keys": "API keys",
  "nav.playground": "Playground",
  "nav.logs": "Logs",
  "nav.topup": "Top up · invoices",
  "search.placeholder": "Find anything",
  "search.coming_soon": "命令面板 · 待推出",
  "usermenu.theme": "主题",
  "usermenu.language": "语言",
  "usermenu.account": "账户",
  "usermenu.logout": "登出",
  "theme.light": "亮色",
  "theme.dark": "暗色",
  "theme.system": "跟随系统",
  "lang.zh": "中文",
  "lang.en": "English",
  "coming_soon.title": "{{feature}} · Coming soon",
  "coming_soon.body": "这一页正在建设中。",
  "not_found.title": "Not found",
  "not_found.body": "你访问的页面不存在。",
  "not_found.home": "← 回到首页",
  "forbidden.title": "无权访问",
  "forbidden.body": "你的账号没有权限看这个页面。",
  "error_boundary.title": "出了点问题",
  "error_boundary.body": "加载该页面时出错了，可以刷新试试。",
  "error_boundary.reload": "刷新页面"
}
```

```json
// web-next/src/i18n/locales/zh/errors.json
{
  "unauthorized": "登录状态已失效，请重新登录",
  "forbidden": "无权执行该操作",
  "server_error": "服务器暂时不可用，稍后再试",
  "network": "网络异常，请检查连接后重试",
  "unknown": "发生了未知错误"
}
```

- [ ] **Step 3: Write en locales**

```json
// web-next/src/i18n/locales/en/common.json
{
  "app.name": "new-api",
  "actions.save": "Save",
  "actions.cancel": "Cancel",
  "actions.confirm": "Confirm",
  "actions.back": "Back",
  "actions.copy": "Copy",
  "actions.copied": "Copied",
  "states.loading": "Loading…",
  "viewport.too_narrow": "Use a larger screen for now"
}
```

```json
// web-next/src/i18n/locales/en/auth.json
{
  "login.title": "Sign in",
  "login.eyebrow": "Sign in",
  "login.username_label": "Email or username",
  "login.password_label": "Password",
  "login.submit": "Sign in",
  "login.submit_loading": "Signing in…",
  "login.forgot": "Forgot?",
  "login.or": "or",
  "login.wechat": "Continue with WeChat",
  "login.to_register": "No account? Create one →",
  "register.title": "Create account",
  "register.eyebrow": "Create account",
  "register.step1.email_label": "Email",
  "register.step1.send_code": "Send verification code",
  "register.step1.sending": "Sending…",
  "register.step2.email_locked_change": "Change",
  "register.step2.code_label": "Verification code",
  "register.step2.username_label": "Username (optional)",
  "register.step2.password_label": "Password",
  "register.step2.password_confirm_label": "Confirm password",
  "register.step2.submit": "Create account",
  "register.step2.submit_loading": "Creating…",
  "register.to_login": "Already have an account? Sign in →",
  "forgot.title": "Reset password",
  "forgot.eyebrow": "Reset password",
  "forgot.email_label": "Registered email",
  "forgot.submit": "Send reset link",
  "forgot.sending": "Sending…",
  "forgot.sent_title": "Check your inbox",
  "forgot.sent_body": "Reset link sent to {{email}}",
  "forgot.resend": "Resend",
  "forgot.resend_cooldown": "Resend in {{seconds}}s",
  "forgot.back_to_login": "← Back to sign in",
  "reset.title": "Set new password",
  "reset.eyebrow": "Reset password",
  "reset.email_label": "Email",
  "reset.explain": "For safety we'll generate a fresh password and hand it back to you.",
  "reset.submit": "Reset password",
  "reset.submitting": "Resetting…",
  "reset.success_title": "Password reset",
  "reset.success_body": "Your new password is below. Copy it somewhere safe.",
  "reset.go_login": "Back to sign in →",
  "wechat.modal_title": "Continue with WeChat",
  "wechat.explain": "Paste the code from your WeChat flow below",
  "wechat.code_label": "WeChat code",
  "wechat.submit": "Continue",
  "wechat.submitting": "Verifying…",
  "strength.none": "",
  "strength.weak": "Weak",
  "strength.fair": "Fair",
  "strength.good": "Good",
  "strength.strong": "Strong",
  "resend.label": "Resend",
  "resend.cooldown": "{{seconds}}s"
}
```

```json
// web-next/src/i18n/locales/en/shell.json
{
  "nav.build": "BUILD",
  "nav.billing": "BILLING",
  "nav.dashboard": "Dashboard",
  "nav.keys": "API keys",
  "nav.playground": "Playground",
  "nav.logs": "Logs",
  "nav.topup": "Top up · invoices",
  "search.placeholder": "Find anything",
  "search.coming_soon": "Command palette · coming soon",
  "usermenu.theme": "Theme",
  "usermenu.language": "Language",
  "usermenu.account": "Account",
  "usermenu.logout": "Log out",
  "theme.light": "Light",
  "theme.dark": "Dark",
  "theme.system": "System",
  "lang.zh": "中文",
  "lang.en": "English",
  "coming_soon.title": "{{feature}} · Coming soon",
  "coming_soon.body": "This page is under construction.",
  "not_found.title": "Not found",
  "not_found.body": "The page you tried to open does not exist.",
  "not_found.home": "← Back to home",
  "forbidden.title": "Forbidden",
  "forbidden.body": "Your account does not have access to this page.",
  "error_boundary.title": "Something went wrong",
  "error_boundary.body": "We hit an error loading this page. A reload usually helps.",
  "error_boundary.reload": "Reload"
}
```

```json
// web-next/src/i18n/locales/en/errors.json
{
  "unauthorized": "Your session has expired. Please sign in again.",
  "forbidden": "You don't have permission for this action.",
  "server_error": "The server is unavailable. Try again in a moment.",
  "network": "Network error. Check your connection and retry.",
  "unknown": "An unknown error occurred."
}
```

- [ ] **Step 4: Rewrite `src/i18n/index.ts`**

```ts
// web-next/src/i18n/index.ts
import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

import enAuth from './locales/en/auth.json';
import enCommon from './locales/en/common.json';
import enErrors from './locales/en/errors.json';
import enShell from './locales/en/shell.json';
import zhAuth from './locales/zh/auth.json';
import zhCommon from './locales/zh/common.json';
import zhErrors from './locales/zh/errors.json';
import zhShell from './locales/zh/shell.json';

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      zh: { common: zhCommon, auth: zhAuth, shell: zhShell, errors: zhErrors },
      en: { common: enCommon, auth: enAuth, shell: enShell, errors: enErrors },
    },
    fallbackLng: 'zh',
    supportedLngs: ['zh', 'en'],
    ns: ['common', 'auth', 'shell', 'errors'],
    defaultNS: 'common',
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'new-api.lang',
    },
  });

export default i18n;
```

- [ ] **Step 5: Typecheck + build**

```bash
bun run typecheck
bun run build
```
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add web-next/src/i18n
git commit -m "refactor(web-next): split i18n into namespaces, add shell/errors"
```

---

## Task 8 — AuthProvider + useAuth + ProtectedRoute + AppProviders

**Files:**
- Create: `web-next/src/providers/AuthProvider.tsx`
- Create: `web-next/src/providers/AuthProvider.test.tsx`
- Create: `web-next/src/providers/AppProviders.tsx`
- Create: `web-next/src/hooks/useAuth.ts`
- Create: `web-next/src/components/common/ProtectedRoute.tsx`
- Create: `web-next/src/components/common/ProtectedRoute.test.tsx`

- [ ] **Step 1: Write User + AuthContext type + `useAuth` hook**

```ts
// web-next/src/hooks/useAuth.ts
import { createContext, useContext } from 'react';

export type User = {
  id: number;
  username: string;
  email: string;
  display_name: string | null;
  role: number;
  platform_role: number;
  tenant_role: number;
  tenant_id: number;
  group: string;
  quota: number;
  used_quota: number;
};

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

export type AuthContextValue = {
  user: User | null;
  status: AuthStatus;
  refresh: () => Promise<void>;
  login: (body: { username: string; password: string }) => Promise<void>;
  register: (body: {
    username?: string;
    email: string;
    password: string;
    verification_code: string;
  }) => Promise<void>;
  logout: (opts?: { silent?: boolean }) => Promise<void>;
};

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within <AuthProvider>');
  }
  return ctx;
}
```

- [ ] **Step 2: Write failing tests for AuthProvider**

```tsx
// web-next/src/providers/AuthProvider.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, test } from 'vitest';

import { useAuth } from '@/hooks/useAuth';
import { server } from '@/test/msw/server';

import { AuthProvider } from './AuthProvider';

function Probe() {
  const { status, user, login, logout } = useAuth();
  return (
    <div>
      <div data-testid='status'>{status}</div>
      <div data-testid='user'>{user ? user.username : 'anon'}</div>
      <button onClick={() => void login({ username: 'alice', password: 'good' })}>login</button>
      <button onClick={() => void login({ username: 'alice', password: 'wrong' })}>bad-login</button>
      <button onClick={() => void logout()}>logout</button>
    </div>
  );
}

afterEach(() => {
  localStorage.clear();
  server.resetHandlers();
});

describe('AuthProvider', () => {
  test('starts unauthenticated when no bootstrap', async () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'));
    expect(screen.getByTestId('user')).toHaveTextContent('anon');
  });

  test('hydrates from bootstrap via /self', async () => {
    localStorage.setItem('new-api.auth-bootstrap', JSON.stringify({ id: 42, tenant_id: 1 }));
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    expect(screen.getByTestId('user')).toHaveTextContent('alice');
  });

  test('login success persists bootstrap and hydrates user', async () => {
    const user = userEvent.setup();
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'));
    await user.click(screen.getByText('login'));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    expect(JSON.parse(localStorage.getItem('new-api.auth-bootstrap')!)).toEqual({ id: 42, tenant_id: 1 });
  });

  test('login failure leaves state unauthenticated and throws', async () => {
    const user = userEvent.setup();
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'));
    await user.click(screen.getByText('bad-login'));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'));
  });

  test('logout clears bootstrap and user', async () => {
    const user = userEvent.setup();
    localStorage.setItem('new-api.auth-bootstrap', JSON.stringify({ id: 42, tenant_id: 1 }));
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    await user.click(screen.getByText('logout'));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'));
    expect(localStorage.getItem('new-api.auth-bootstrap')).toBeNull();
  });

  test('401 from /self treats user as unauthenticated', async () => {
    localStorage.setItem('new-api.auth-bootstrap', JSON.stringify({ id: 99, tenant_id: 1 }));
    server.use(
      http.get('/api/user/self', () =>
        HttpResponse.json({ success: false, message: 'unauthorized' }, { status: 401 })
      )
    );
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'));
  });
});
```

- [ ] **Step 3: Run — expect fail**

```bash
bun run test src/providers/AuthProvider.test.tsx
```

- [ ] **Step 4: Implement `providers/AuthProvider.tsx`**

```tsx
// web-next/src/providers/AuthProvider.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AuthContext, type AuthStatus, type User } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { clearBootstrap, loadBootstrap, saveBootstrap } from '@/lib/bootstrap';
import { logError } from '@/lib/observability';

type LoginBody = { username: string; password: string };
type LoginOrRegisterStub = { id: number; tenant_id: number };
type RegisterBody = {
  username?: string;
  email: string;
  password: string;
  verification_code: string;
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const mounted = useRef(true);

  useEffect(() => () => { mounted.current = false; }, []);

  const refresh = useCallback(async () => {
    const boot = loadBootstrap();
    if (!boot) {
      if (mounted.current) {
        setUser(null);
        setStatus('unauthenticated');
      }
      return;
    }
    try {
      const res = await api.get<User>('/api/user/self');
      if (!mounted.current) return;
      setUser(res.data);
      setStatus('authenticated');
    } catch (err) {
      if (!mounted.current) return;
      logError(err, { tag: 'auth-refresh' });
      clearBootstrap();
      setUser(null);
      setStatus('unauthenticated');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(
    async (body: LoginBody) => {
      const res = await api.post<LoginOrRegisterStub>('/api/user/login', body);
      saveBootstrap({ id: res.data.id, tenant_id: res.data.tenant_id ?? 1 });
      await refresh();
    },
    [refresh]
  );

  const register = useCallback(
    async (body: RegisterBody) => {
      await api.post('/api/user/register', body);
      // Backend does NOT auto-login on register; explicitly log in so Slice 1
      // lands the user in the app shell right after account creation.
      await login({ username: body.username ?? body.email, password: body.password });
    },
    [login]
  );

  const logout = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) {
      try {
        await api.post('/api/user/logout');
      } catch (err) {
        logError(err, { tag: 'auth-logout' });
      }
    }
    clearBootstrap();
    if (!mounted.current) return;
    setUser(null);
    setStatus('unauthenticated');
  }, []);

  const value = useMemo(
    () => ({ user, status, refresh, login, register, logout }),
    [user, status, refresh, login, register, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
```

- [ ] **Step 5: Run — expect pass**

```bash
bun run test src/providers/AuthProvider.test.tsx
```
Expected: PASS (6 tests).

- [ ] **Step 6: Write `components/common/ProtectedRoute.tsx` + test**

```tsx
// web-next/src/components/common/ProtectedRoute.tsx
import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { useAuth } from '@/hooks/useAuth';

import { FullPageSkeleton } from './FullPageSkeleton';

export function ProtectedRoute() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return <FullPageSkeleton />;
  }
  if (status === 'unauthenticated') {
    const redirect = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?redirect=${redirect}`} replace />;
  }
  return <Outlet />;
}
```

But `FullPageSkeleton` is not yet created. Create a stub version now that will be refined later:

```tsx
// web-next/src/components/common/FullPageSkeleton.tsx
export function FullPageSkeleton() {
  return (
    <div
      data-testid='full-page-skeleton'
      className='flex h-screen items-center justify-center bg-bg-0 text-fg-1'
    >
      <span className='text-13'>…</span>
    </div>
  );
}
```

```tsx
// web-next/src/components/common/ProtectedRoute.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, test } from 'vitest';

import { AuthProvider } from '@/providers/AuthProvider';

import { ProtectedRoute } from './ProtectedRoute';

describe('ProtectedRoute', () => {
  test('redirects to /login?redirect=… when unauthenticated', async () => {
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/keys']}>
          <Routes>
            <Route path='/login' element={<div data-testid='login'>login</div>} />
            <Route element={<ProtectedRoute />}>
              <Route path='/keys' element={<div data-testid='keys'>keys</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    );
    await waitFor(() => expect(screen.getByTestId('login')).toBeInTheDocument());
    expect(window.location.href).not.toContain('keys');
  });

  test('renders outlet when authenticated', async () => {
    localStorage.setItem('new-api.auth-bootstrap', JSON.stringify({ id: 42, tenant_id: 1 }));
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/keys']}>
          <Routes>
            <Route element={<ProtectedRoute />}>
              <Route path='/keys' element={<div data-testid='keys'>keys</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    );
    await waitFor(() => expect(screen.getByTestId('keys')).toBeInTheDocument());
  });
});
```

- [ ] **Step 7: Run ProtectedRoute tests — expect pass**

```bash
bun run test src/components/common/ProtectedRoute.test.tsx
```

- [ ] **Step 8: Write `providers/AppProviders.tsx`**

```tsx
// web-next/src/providers/AppProviders.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Toaster, toast } from 'sonner';

import { onAuthEvent, onToast } from '@/lib/api';

import { AuthProvider } from './AuthProvider';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
  },
});

function ApiEventBridge() {
  const navigate = useNavigate();

  useEffect(() => {
    const offAuth = onAuthEvent((event) => {
      if (event === 'unauthorized') {
        const redirect = encodeURIComponent(window.location.pathname + window.location.search);
        const publicRoutes = ['/login', '/register', '/forgot', '/reset', '/user/reset', '/forbidden'];
        const onPublic = publicRoutes.some((p) => window.location.pathname.startsWith(p));
        if (!onPublic) navigate(`/login?redirect=${redirect}`);
      } else if (event === 'forbidden') {
        navigate('/forbidden');
      }
    });
    const offToast = onToast((_, message) => {
      toast.error(message);
    });
    return () => {
      offAuth();
      offToast();
    };
  }, [navigate]);

  return null;
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ApiEventBridge />
        {children}
        <Toaster position='top-right' richColors closeButton />
      </AuthProvider>
    </QueryClientProvider>
  );
}
```

- [ ] **Step 9: Typecheck**

```bash
bun run typecheck
```

- [ ] **Step 10: Commit**

```bash
git add web-next/src/providers web-next/src/hooks/useAuth.ts web-next/src/components/common/ProtectedRoute.tsx web-next/src/components/common/ProtectedRoute.test.tsx web-next/src/components/common/FullPageSkeleton.tsx
git commit -m "feat(web-next): AuthProvider + ProtectedRoute + AppProviders"
```

---

## Task 9 — 表单通用件 (InlineBanner, useCountdown, ResendCountdown, PasswordStrengthBar, PasswordField, AuthLayout)

**Files:**
- Create: `web-next/src/components/auth/InlineBanner.tsx`
- Create: `web-next/src/components/auth/InlineBanner.test.tsx`
- Create: `web-next/src/hooks/useCountdown.ts`
- Create: `web-next/src/hooks/useCountdown.test.ts`
- Create: `web-next/src/components/auth/ResendCountdown.tsx`
- Create: `web-next/src/components/auth/ResendCountdown.test.tsx`
- Create: `web-next/src/components/auth/PasswordStrengthBar.tsx`
- Create: `web-next/src/components/auth/PasswordStrengthBar.test.tsx`
- Create: `web-next/src/components/auth/PasswordField.tsx`
- Create: `web-next/src/components/auth/AuthLayout.tsx`

- [ ] **Step 1: InlineBanner failing test**

```tsx
// web-next/src/components/auth/InlineBanner.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';

import { InlineBanner } from './InlineBanner';

describe('InlineBanner', () => {
  test('renders message and role=alert', () => {
    render(<InlineBanner level='danger' message='boom' />);
    const el = screen.getByRole('alert');
    expect(el).toHaveTextContent('boom');
  });

  test('close calls onClose', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<InlineBanner level='danger' message='boom' onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement InlineBanner**

```tsx
// web-next/src/components/auth/InlineBanner.tsx
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

import { cn } from '@/lib/utils';

export type BannerLevel = 'danger' | 'warn' | 'success' | 'info';

const ICONS: Record<BannerLevel, typeof AlertCircle> = {
  danger: AlertCircle,
  warn: AlertCircle,
  success: CheckCircle2,
  info: Info,
};

const STYLES: Record<BannerLevel, string> = {
  danger: 'bg-danger-soft text-fg-0',
  warn: 'bg-warn-soft text-fg-0',
  success: 'bg-success-soft text-fg-0',
  info: 'bg-info-soft text-fg-0',
};

export function InlineBanner({
  level,
  message,
  onClose,
  className,
}: {
  level: BannerLevel;
  message: string;
  onClose?: () => void;
  className?: string;
}) {
  const Icon = ICONS[level];
  return (
    <div
      role='alert'
      className={cn('flex items-start gap-2 rounded-sm px-3 py-2 text-13', STYLES[level], className)}
    >
      <Icon size={14} strokeWidth={1.5} className='mt-[2px] shrink-0' />
      <p className='flex-1'>{message}</p>
      {onClose && (
        <button
          type='button'
          aria-label='Close'
          onClick={onClose}
          className='shrink-0 rounded-xs p-[2px] hover:bg-bg-2'
        >
          <X size={14} strokeWidth={1.5} />
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run — expect pass**

```bash
bun run test src/components/auth/InlineBanner.test.tsx
```

- [ ] **Step 5: useCountdown failing test**

```ts
// web-next/src/hooks/useCountdown.test.ts
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { useCountdown } from './useCountdown';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useCountdown', () => {
  test('ticks down to 0 and stops', () => {
    const { result } = renderHook(() => useCountdown());
    act(() => result.current.start(3));
    expect(result.current.seconds).toBe(3);
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.seconds).toBe(2);
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current.seconds).toBe(0);
    expect(result.current.running).toBe(false);
  });

  test('reset cancels the interval', () => {
    const { result } = renderHook(() => useCountdown());
    act(() => result.current.start(10));
    act(() => vi.advanceTimersByTime(3000));
    act(() => result.current.reset());
    expect(result.current.seconds).toBe(0);
    expect(result.current.running).toBe(false);
  });
});
```

- [ ] **Step 6: Run — expect fail, then implement**

```ts
// web-next/src/hooks/useCountdown.ts
import { useCallback, useEffect, useRef, useState } from 'react';

export function useCountdown() {
  const [seconds, setSeconds] = useState(0);
  const [running, setRunning] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setRunning(false);
  }, []);

  const start = useCallback(
    (total: number) => {
      stop();
      setSeconds(total);
      setRunning(true);
      intervalRef.current = setInterval(() => {
        setSeconds((s) => {
          if (s <= 1) {
            if (intervalRef.current !== null) {
              clearInterval(intervalRef.current);
              intervalRef.current = null;
            }
            setRunning(false);
            return 0;
          }
          return s - 1;
        });
      }, 1000);
    },
    [stop]
  );

  const reset = useCallback(() => {
    stop();
    setSeconds(0);
  }, [stop]);

  useEffect(() => () => stop(), [stop]);

  return { seconds, running, start, reset };
}
```

- [ ] **Step 7: Run — expect pass**

```bash
bun run test src/hooks/useCountdown.test.ts
```

- [ ] **Step 8: ResendCountdown component + test**

```tsx
// web-next/src/components/auth/ResendCountdown.tsx
import { useTranslation } from 'react-i18next';

import { useCountdown } from '@/hooks/useCountdown';

type Props = {
  initialSeconds?: number;
  onResend: () => void | Promise<void>;
  labelKey?: string;
};

export function ResendCountdown({ initialSeconds = 60, onResend, labelKey = 'resend.label' }: Props) {
  const { seconds, running, start } = useCountdown();
  const { t } = useTranslation('auth');

  async function handle() {
    await onResend();
    start(initialSeconds);
  }

  if (running) {
    return (
      <span className='text-13 text-fg-2' aria-live='polite'>
        {t('resend.cooldown', { seconds })}
      </span>
    );
  }

  return (
    <button type='button' className='text-13 text-accent hover:underline' onClick={handle}>
      {t(labelKey)}
    </button>
  );
}
```

```tsx
// web-next/src/components/auth/ResendCountdown.test.tsx
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import '@/i18n';

import { ResendCountdown } from './ResendCountdown';

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => vi.useRealTimers());

describe('ResendCountdown', () => {
  test('clicks fire onResend then enters cooldown', async () => {
    const onResend = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<ResendCountdown onResend={onResend} initialSeconds={3} />);
    await user.click(screen.getByRole('button'));
    expect(onResend).toHaveBeenCalled();
    expect(screen.getByText(/3s|3 s/)).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(3000));
    await screen.findByRole('button');
  });
});
```

- [ ] **Step 9: PasswordStrengthBar + test**

```tsx
// web-next/src/components/auth/PasswordStrengthBar.tsx
import { useTranslation } from 'react-i18next';

import { type Strength, estimateStrength } from '@/lib/password';
import { cn } from '@/lib/utils';

const WIDTHS: Record<Strength, string> = {
  none: 'w-0',
  weak: 'w-1/4',
  fair: 'w-2/4',
  good: 'w-3/4',
  strong: 'w-full',
};

const COLORS: Record<Strength, string> = {
  none: 'bg-bg-2',
  weak: 'bg-danger',
  fair: 'bg-warn',
  good: 'bg-info',
  strong: 'bg-success',
};

export function PasswordStrengthBar({ value }: { value: string }) {
  const s = estimateStrength(value);
  const { t } = useTranslation('auth');
  return (
    <div className='flex items-center gap-2'>
      <div className='relative h-1 flex-1 overflow-hidden rounded-pill bg-bg-2' role='progressbar'
        aria-valuemin={0} aria-valuemax={4} aria-valuenow={['none', 'weak', 'fair', 'good', 'strong'].indexOf(s)}>
        <div className={cn('absolute left-0 top-0 h-full transition-all', WIDTHS[s], COLORS[s])} />
      </div>
      <span className='w-10 text-right text-12 text-fg-1'>{t(`strength.${s}`)}</span>
    </div>
  );
}
```

```tsx
// web-next/src/components/auth/PasswordStrengthBar.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import '@/i18n';

import { PasswordStrengthBar } from './PasswordStrengthBar';

describe('PasswordStrengthBar', () => {
  test('empty password shows nothing', () => {
    render(<PasswordStrengthBar value='' />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0');
  });

  test('strong password shows strong', () => {
    render(<PasswordStrengthBar value='Abcdef1234!@' />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('4');
  });
});
```

Run tests, commit.

- [ ] **Step 10: PasswordField**

```tsx
// web-next/src/components/auth/PasswordField.tsx
import { Eye, EyeOff } from 'lucide-react';
import { forwardRef, useState } from 'react';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type Props = React.InputHTMLAttributes<HTMLInputElement>;

export const PasswordField = forwardRef<HTMLInputElement, Props>(function PasswordField(
  { className, ...rest },
  ref
) {
  const [shown, setShown] = useState(false);
  return (
    <div className={cn('relative', className)}>
      <Input ref={ref} type={shown ? 'text' : 'password'} {...rest} className='pr-9' />
      <button
        type='button'
        aria-label={shown ? 'Hide password' : 'Show password'}
        onClick={() => setShown((v) => !v)}
        className='absolute right-2 top-1/2 -translate-y-1/2 rounded-xs p-1 text-fg-1 hover:bg-bg-2 hover:text-fg-0'
      >
        {shown ? <EyeOff size={14} strokeWidth={1.5} /> : <Eye size={14} strokeWidth={1.5} />}
      </button>
    </div>
  );
});
```

- [ ] **Step 11: AuthLayout**

```tsx
// web-next/src/components/auth/AuthLayout.tsx
import { Logo } from '@/components/layout/Logo';

type Props = {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
};

export function AuthLayout({ eyebrow, title, children, footer }: Props) {
  return (
    <div className='min-h-screen bg-bg-0 px-4 py-12'>
      <div className='mx-auto flex max-w-[400px] flex-col items-stretch'>
        <div className='mx-auto mb-6'>
          <Logo size={32} />
        </div>
        <div className='rounded-md border border-line bg-bg-1 p-6'>
          <div className='eyebrow'>{eyebrow}</div>
          <h2 className='h2 mt-2'>{title}</h2>
          <div className='mt-6'>{children}</div>
        </div>
        {footer && <div className='mt-4 text-center text-13 text-fg-1'>{footer}</div>}
      </div>
    </div>
  );
}
```

AuthLayout depends on `Logo`. Create a minimal Logo now that Task 13 will keep / refine:

```tsx
// web-next/src/components/layout/Logo.tsx
export function Logo({ size = 24 }: { size?: number }) {
  return (
    <div
      className='inline-flex items-center justify-center rounded-md bg-primary text-primary-fg'
      style={{ width: size, height: size }}
      aria-label='new-api'
    >
      <span className='font-mono text-[10px] font-semibold tracking-tight'>n·a</span>
    </div>
  );
}
```

- [ ] **Step 12: Run all auth tests + typecheck**

```bash
bun run test src/components/auth src/hooks/useCountdown.test.ts
bun run typecheck
```

- [ ] **Step 13: Commit**

```bash
git add web-next/src/components/auth web-next/src/hooks web-next/src/components/layout/Logo.tsx
git commit -m "feat(web-next): auth form primitives + AuthLayout + useCountdown"
```

---

## Task 10 — /login + WechatCodeModal

**Files:**
- Create: `web-next/src/pages/Login.tsx`
- Create: `web-next/src/pages/Login.test.tsx`
- Create: `web-next/src/components/auth/WechatCodeModal.tsx`

- [ ] **Step 1: Write failing test for Login**

```tsx
// web-next/src/pages/Login.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, test } from 'vitest';

import '@/i18n';
import { AuthProvider } from '@/providers/AuthProvider';

import { Login } from './Login';

function mount() {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/login?redirect=/keys']}>
        <Routes>
          <Route path='/login' element={<Login />} />
          <Route path='/keys' element={<div data-testid='keys'>keys</div>} />
          <Route path='/register' element={<div data-testid='register'>register</div>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>
  );
}

describe('Login page', () => {
  test('happy path: submit → navigate to redirect', async () => {
    const user = userEvent.setup();
    mount();
    await user.type(await screen.findByLabelText(/邮箱|email/i), 'alice@example.com');
    await user.type(screen.getByLabelText(/密码|password/i), 'good');
    await user.click(screen.getByRole('button', { name: /登录|sign in/i }));
    await waitFor(() => expect(screen.getByTestId('keys')).toBeInTheDocument());
  });

  test('failure: wrong password shows inline banner', async () => {
    const user = userEvent.setup();
    mount();
    await user.type(await screen.findByLabelText(/邮箱|email/i), 'alice@example.com');
    await user.type(screen.getByLabelText(/密码|password/i), 'wrong');
    await user.click(screen.getByRole('button', { name: /登录|sign in/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/密码错误|password/));
  });
});
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement WechatCodeModal**

```tsx
// web-next/src/components/auth/WechatCodeModal.tsx
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';

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
import { ApiError, api } from '@/lib/api';
import { saveBootstrap } from '@/lib/bootstrap';
import { useAuth } from '@/hooks/useAuth';

import { InlineBanner } from './InlineBanner';

const schema = z.object({ code: z.string().min(1, 'required') });
type Values = z.infer<typeof schema>;

export function WechatCodeModal({
  open,
  onOpenChange,
  redirectTo = '/',
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  redirectTo?: string;
}) {
  const { t } = useTranslation('auth');
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { code: '' },
  });

  async function onSubmit(values: Values) {
    setError(null);
    try {
      const res = await api.get<{ id: number; tenant_id: number }>('/api/oauth/wechat', {
        params: { code: values.code },
      });
      saveBootstrap({ id: res.data.id, tenant_id: res.data.tenant_id ?? 1 });
      await refresh();
      onOpenChange(false);
      navigate(redirectTo, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.backendMessage ?? err.message);
      } else {
        setError('Unknown error');
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-[360px]'>
        <DialogHeader>
          <DialogTitle>{t('wechat.modal_title')}</DialogTitle>
          <DialogDescription>{t('wechat.explain')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-4'>
          <div className='space-y-2'>
            <Label htmlFor='wechat-code'>{t('wechat.code_label')}</Label>
            <Input id='wechat-code' autoFocus autoComplete='one-time-code' {...form.register('code')} />
          </div>
          {error && <InlineBanner level='danger' message={error} onClose={() => setError(null)} />}
          <Button type='submit' className='w-full' disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? t('wechat.submitting') : t('wechat.submit')}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Implement Login page**

```tsx
// web-next/src/pages/Login.tsx
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';

import { AuthLayout } from '@/components/auth/AuthLayout';
import { InlineBanner } from '@/components/auth/InlineBanner';
import { PasswordField } from '@/components/auth/PasswordField';
import { WechatCodeModal } from '@/components/auth/WechatCodeModal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { useAuth } from '@/hooks/useAuth';
import { ApiError } from '@/lib/api';

const schema = z.object({
  username: z.string().min(1, 'required'),
  password: z.string().min(1, 'required'),
});
type Values = z.infer<typeof schema>;

export function Login() {
  const { t } = useTranslation('auth');
  const { login, status } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [wechatOpen, setWechatOpen] = useState(false);
  const redirect = params.get('redirect') || '/';

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { username: '', password: '' },
  });

  useEffect(() => {
    form.setFocus('username');
  }, [form]);

  if (status === 'authenticated') {
    return <Navigate to={redirect} replace />;
  }

  async function onSubmit(values: Values) {
    setError(null);
    try {
      await login(values);
      navigate(redirect, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.backendMessage ?? err.message);
      } else {
        setError(String(err));
      }
    }
  }

  return (
    <AuthLayout
      eyebrow={t('login.eyebrow')}
      title={t('login.title')}
      footer={
        <>
          {t('login.to_register').replace('→', '')}
          <Link to='/register' className='ml-1 text-accent hover:underline'>
            {'→'}
          </Link>
        </>
      }
    >
      <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-4'>
        <div className='space-y-2'>
          <Label htmlFor='username'>{t('login.username_label')}</Label>
          <Input id='username' autoComplete='username' {...form.register('username')} />
        </div>
        <div className='space-y-2'>
          <div className='flex items-baseline justify-between'>
            <Label htmlFor='password'>{t('login.password_label')}</Label>
            <Link to='/forgot' className='text-13 text-accent hover:underline'>
              {t('login.forgot')}
            </Link>
          </div>
          <PasswordField id='password' autoComplete='current-password' {...form.register('password')} />
        </div>
        {error && <InlineBanner level='danger' message={error} onClose={() => setError(null)} />}
        <Button type='submit' className='w-full' disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? t('login.submit_loading') : t('login.submit')}
        </Button>
      </form>
      <div className='my-6 flex items-center gap-3'>
        <Separator className='flex-1' />
        <span className='text-13 text-fg-2'>{t('login.or')}</span>
        <Separator className='flex-1' />
      </div>
      <Button type='button' variant='secondary' className='w-full' onClick={() => setWechatOpen(true)}>
        {t('login.wechat')}
      </Button>
      <WechatCodeModal open={wechatOpen} onOpenChange={setWechatOpen} redirectTo={redirect} />
    </AuthLayout>
  );
}
```

- [ ] **Step 5: Run — expect pass**

```bash
bun run test src/pages/Login.test.tsx
```

- [ ] **Step 6: Commit**

```bash
git add web-next/src/pages/Login.tsx web-next/src/pages/Login.test.tsx web-next/src/components/auth/WechatCodeModal.tsx
git commit -m "feat(web-next): /login page + WeChat code modal"
```

---

## Task 11 — /register (two-step)

**Files:**
- Create: `web-next/src/pages/Register.tsx`
- Create: `web-next/src/pages/Register.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// web-next/src/pages/Register.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, test } from 'vitest';

import '@/i18n';
import { AuthProvider } from '@/providers/AuthProvider';

import { Register } from './Register';

function mount() {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/register']}>
        <Routes>
          <Route path='/register' element={<Register />} />
          <Route path='/' element={<div data-testid='home'>home</div>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>
  );
}

describe('Register page', () => {
  test('two-step: send code → fill form → submit → auto-login → navigate /', async () => {
    const user = userEvent.setup();
    mount();
    await user.type(await screen.findByLabelText(/邮箱|email/i), 'alice@example.com');
    await user.click(screen.getByRole('button', { name: /发送|send/i }));
    await waitFor(() => screen.getByLabelText(/验证码|code/i));
    await user.type(screen.getByLabelText(/验证码|code/i), '123456');
    await user.type(screen.getByLabelText(/用户名|username/i), 'alice');
    await user.type(screen.getByLabelText(/^设置密码|^password$/i), 'Abcdef1234!@');
    await user.type(screen.getByLabelText(/确认密码|confirm/i), 'Abcdef1234!@');
    await user.click(screen.getByRole('button', { name: /创建|create/i }));
    await waitFor(() => expect(screen.getByTestId('home')).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement Register page**

```tsx
// web-next/src/pages/Register.tsx
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { z } from 'zod';

import { AuthLayout } from '@/components/auth/AuthLayout';
import { InlineBanner } from '@/components/auth/InlineBanner';
import { PasswordField } from '@/components/auth/PasswordField';
import { PasswordStrengthBar } from '@/components/auth/PasswordStrengthBar';
import { ResendCountdown } from '@/components/auth/ResendCountdown';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/useAuth';
import { ApiError, api } from '@/lib/api';

const step1Schema = z.object({ email: z.string().email() });
type Step1Values = z.infer<typeof step1Schema>;

const step2Schema = z
  .object({
    code: z.string().min(1),
    username: z.string().optional(),
    password: z.string().min(6),
    password_confirm: z.string().min(6),
  })
  .refine((v) => v.password === v.password_confirm, {
    path: ['password_confirm'],
    message: 'mismatch',
  });
type Step2Values = z.infer<typeof step2Schema>;

export function Register() {
  const { t } = useTranslation('auth');
  const { status, register } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<1 | 2>(1);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);

  const f1 = useForm<Step1Values>({ resolver: zodResolver(step1Schema), defaultValues: { email: '' } });
  const f2 = useForm<Step2Values>({
    resolver: zodResolver(step2Schema),
    defaultValues: { code: '', username: '', password: '', password_confirm: '' },
  });
  const password = f2.watch('password') || '';

  if (status === 'authenticated') {
    return <Navigate to='/' replace />;
  }

  async function sendCode(targetEmail: string) {
    await api.get('/api/verification', { params: { email: targetEmail } });
  }

  async function onStep1(values: Step1Values) {
    setError(null);
    try {
      await sendCode(values.email);
      setEmail(values.email);
      setStep(2);
    } catch (err) {
      if (err instanceof ApiError) setError(err.backendMessage ?? err.message);
      else setError(String(err));
    }
  }

  async function onStep2(values: Step2Values) {
    setError(null);
    try {
      await register({
        email,
        password: values.password,
        username: values.username || undefined,
        verification_code: values.code,
      });
      navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError) setError(err.backendMessage ?? err.message);
      else setError(String(err));
    }
  }

  return (
    <AuthLayout
      eyebrow={t('register.eyebrow')}
      title={t('register.title')}
      footer={
        <>
          {t('register.to_login').replace('→', '')}
          <Link to='/login' className='ml-1 text-accent hover:underline'>
            {'→'}
          </Link>
        </>
      }
    >
      {step === 1 ? (
        <form onSubmit={f1.handleSubmit(onStep1)} className='space-y-4'>
          <div className='space-y-2'>
            <Label htmlFor='email'>{t('register.step1.email_label')}</Label>
            <Input id='email' type='email' autoFocus autoComplete='email' {...f1.register('email')} />
          </div>
          {error && <InlineBanner level='danger' message={error} onClose={() => setError(null)} />}
          <Button type='submit' className='w-full' disabled={f1.formState.isSubmitting}>
            {f1.formState.isSubmitting ? t('register.step1.sending') : t('register.step1.send_code')}
          </Button>
        </form>
      ) : (
        <form onSubmit={f2.handleSubmit(onStep2)} className='space-y-4'>
          <div className='flex items-center justify-between rounded-sm bg-bg-2 px-3 py-2'>
            <span className='mono text-13 text-fg-0'>{email}</span>
            <button
              type='button'
              className='text-13 text-accent hover:underline'
              onClick={() => {
                setStep(1);
                setError(null);
              }}
            >
              {t('register.step2.email_locked_change')}
            </button>
          </div>
          <div className='space-y-2'>
            <div className='flex items-center justify-between'>
              <Label htmlFor='code'>{t('register.step2.code_label')}</Label>
              <ResendCountdown onResend={() => sendCode(email)} initialSeconds={60} />
            </div>
            <Input id='code' autoFocus inputMode='numeric' maxLength={6} autoComplete='one-time-code' {...f2.register('code')} />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='username'>{t('register.step2.username_label')}</Label>
            <Input id='username' autoComplete='username' {...f2.register('username')} />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='password'>{t('register.step2.password_label')}</Label>
            <PasswordField id='password' autoComplete='new-password' {...f2.register('password')} />
            <PasswordStrengthBar value={password} />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='password_confirm'>{t('register.step2.password_confirm_label')}</Label>
            <PasswordField id='password_confirm' autoComplete='new-password' {...f2.register('password_confirm')} />
          </div>
          {error && <InlineBanner level='danger' message={error} onClose={() => setError(null)} />}
          <Button type='submit' className='w-full' disabled={f2.formState.isSubmitting}>
            {f2.formState.isSubmitting ? t('register.step2.submit_loading') : t('register.step2.submit')}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
```

- [ ] **Step 4: Run — expect pass**

```bash
bun run test src/pages/Register.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add web-next/src/pages/Register.tsx web-next/src/pages/Register.test.tsx
git commit -m "feat(web-next): /register two-step page"
```

---

## Task 12 — /forgot + /reset + /user/reset

**Files:**
- Create: `web-next/src/pages/Forgot.tsx`
- Create: `web-next/src/pages/Reset.tsx`
- Create: `web-next/src/pages/Reset.test.tsx`

- [ ] **Step 1: Write Reset failing test**

```tsx
// web-next/src/pages/Reset.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, test } from 'vitest';

import '@/i18n';

import { Reset } from './Reset';

function mount(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path='/reset' element={<Reset />} />
        <Route path='/user/reset' element={<Reset />} />
        <Route path='/forgot' element={<div data-testid='forgot'>forgot</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('Reset page', () => {
  test('missing token redirects to /forgot', async () => {
    mount('/reset?email=a@b.com');
    await waitFor(() => expect(screen.getByTestId('forgot')).toBeInTheDocument());
  });

  test('submit shows server-generated password', async () => {
    const user = userEvent.setup();
    mount('/user/reset?email=a@b.com&token=abcd');
    await user.click(await screen.findByRole('button', { name: /重置|reset/i }));
    await waitFor(() => expect(screen.getByText('Gx7kPq2mN9vR')).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Implement Forgot**

```tsx
// web-next/src/pages/Forgot.tsx
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { z } from 'zod';

import { AuthLayout } from '@/components/auth/AuthLayout';
import { InlineBanner } from '@/components/auth/InlineBanner';
import { ResendCountdown } from '@/components/auth/ResendCountdown';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, api } from '@/lib/api';

const schema = z.object({ email: z.string().email() });
type Values = z.infer<typeof schema>;

export function Forgot() {
  const { t } = useTranslation('auth');
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: '' } });

  async function send(target: string) {
    await api.get('/api/reset_password', { params: { email: target } });
  }

  async function onSubmit(values: Values) {
    setError(null);
    try {
      await send(values.email);
      setSentTo(values.email);
    } catch (err) {
      if (err instanceof ApiError) setError(err.backendMessage ?? err.message);
      else setError(String(err));
    }
  }

  return (
    <AuthLayout
      eyebrow={t('forgot.eyebrow')}
      title={sentTo ? t('forgot.sent_title') : t('forgot.title')}
      footer={
        <Link to='/login' className='text-accent hover:underline'>
          {t('forgot.back_to_login')}
        </Link>
      }
    >
      {sentTo ? (
        <div className='space-y-4'>
          <p className='text-13 text-fg-1'>{t('forgot.sent_body', { email: sentTo })}</p>
          <ResendCountdown onResend={() => send(sentTo)} initialSeconds={60} />
        </div>
      ) : (
        <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-4'>
          <div className='space-y-2'>
            <Label htmlFor='email'>{t('forgot.email_label')}</Label>
            <Input id='email' type='email' autoFocus autoComplete='email' {...form.register('email')} />
          </div>
          {error && <InlineBanner level='danger' message={error} onClose={() => setError(null)} />}
          <Button type='submit' className='w-full' disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? t('forgot.sending') : t('forgot.submit')}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
```

- [ ] **Step 3: Implement Reset**

```tsx
// web-next/src/pages/Reset.tsx
import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useSearchParams } from 'react-router-dom';

import { AuthLayout } from '@/components/auth/AuthLayout';
import { InlineBanner } from '@/components/auth/InlineBanner';
import { Button } from '@/components/ui/button';
import { ApiError, api } from '@/lib/api';

export function Reset() {
  const { t } = useTranslation('auth');
  const [params] = useSearchParams();
  const email = params.get('email');
  const token = params.get('token');
  const [submitting, setSubmitting] = useState(false);
  const [newPassword, setNewPassword] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (copied) {
      const id = setTimeout(() => setCopied(false), 2000);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [copied]);

  if (!email || !token) {
    return <Navigate to='/forgot' replace />;
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.post<string>('/api/user/reset', { email, token });
      setNewPassword(res.data);
    } catch (err) {
      if (err instanceof ApiError) setError(err.backendMessage ?? err.message);
      else setError(String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function copy() {
    if (!newPassword) return;
    await navigator.clipboard.writeText(newPassword);
    setCopied(true);
  }

  return (
    <AuthLayout
      eyebrow={t('reset.eyebrow')}
      title={newPassword ? t('reset.success_title') : t('reset.title')}
      footer={
        newPassword ? (
          <Link to='/login' className='text-accent hover:underline'>
            {t('reset.go_login')}
          </Link>
        ) : (
          <Link to='/login' className='text-accent hover:underline'>
            {t('forgot.back_to_login')}
          </Link>
        )
      }
    >
      {newPassword ? (
        <div className='space-y-4'>
          <p className='text-13 text-fg-1'>{t('reset.success_body')}</p>
          <div className='flex items-center justify-between rounded-sm bg-bg-2 px-3 py-2'>
            <span className='mono text-16 font-semibold'>{newPassword}</span>
            <button
              type='button'
              aria-label='copy'
              onClick={copy}
              className='rounded-xs p-1 text-fg-1 hover:bg-bg-3 hover:text-fg-0'
            >
              {copied ? <Check size={16} strokeWidth={1.5} /> : <Copy size={16} strokeWidth={1.5} />}
            </button>
          </div>
        </div>
      ) : (
        <div className='space-y-4'>
          <div className='space-y-2'>
            <div className='eyebrow'>{t('reset.email_label')}</div>
            <div className='mono text-13 text-fg-0'>{email}</div>
          </div>
          <p className='text-13 text-fg-1'>{t('reset.explain')}</p>
          {error && <InlineBanner level='danger' message={error} onClose={() => setError(null)} />}
          <Button type='button' className='w-full' disabled={submitting} onClick={submit}>
            {submitting ? t('reset.submitting') : t('reset.submit')}
          </Button>
        </div>
      )}
    </AuthLayout>
  );
}
```

- [ ] **Step 4: Run — expect pass**

```bash
bun run test src/pages/Reset.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add web-next/src/pages/Forgot.tsx web-next/src/pages/Reset.tsx web-next/src/pages/Reset.test.tsx
git commit -m "feat(web-next): /forgot + /reset (+/user/reset) pages"
```

---

## Task 13 — Shell components

**Files (all create):**
- `web-next/src/components/layout/NavItem.tsx`
- `web-next/src/components/layout/SidebarGroup.tsx`
- `web-next/src/components/layout/Sidebar.tsx`
- `web-next/src/components/layout/Topbar.tsx`
- `web-next/src/components/layout/TopbarSearchStub.tsx`
- `web-next/src/components/layout/UserChip.tsx`
- `web-next/src/components/layout/UserMenu.tsx`
- `web-next/src/components/layout/ThemeToggle.tsx`
- `web-next/src/components/layout/LangToggle.tsx`
- `web-next/src/components/layout/AppShell.tsx`
- Overwrite (from Task 9 stub): `web-next/src/components/layout/Logo.tsx`

(已存在 Logo 的最小版；本任务保持不变或微调成 32px 变体。)

- [ ] **Step 1: NavItem**

```tsx
// web-next/src/components/layout/NavItem.tsx
import type { LucideIcon } from 'lucide-react';
import { NavLink } from 'react-router-dom';

import { cn } from '@/lib/utils';

type Props = {
  to: string;
  label: string;
  icon: LucideIcon;
};

export function NavItem({ to, label, icon: Icon }: Props) {
  return (
    <NavLink
      to={to}
      end={to === '/dashboard'}
      className={({ isActive }) =>
        cn(
          'flex h-8 items-center gap-2 rounded-sm px-2 text-13 transition-colors',
          isActive ? 'bg-bg-2 text-fg-0' : 'text-fg-1 hover:bg-bg-1 hover:text-fg-0'
        )
      }
    >
      <Icon size={16} strokeWidth={1.5} />
      <span>{label}</span>
    </NavLink>
  );
}
```

- [ ] **Step 2: SidebarGroup**

```tsx
// web-next/src/components/layout/SidebarGroup.tsx
export function SidebarGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className='mb-4'>
      <div className='eyebrow px-2 pb-2'>{label}</div>
      <div className='space-y-[2px]'>{children}</div>
    </div>
  );
}
```

- [ ] **Step 3: Sidebar**

```tsx
// web-next/src/components/layout/Sidebar.tsx
import { KeyRound, LayoutDashboard, List, Play, Receipt } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Logo } from './Logo';
import { NavItem } from './NavItem';
import { SidebarGroup } from './SidebarGroup';
import { UserChip } from './UserChip';

export function Sidebar() {
  const { t } = useTranslation('shell');
  return (
    <aside className='flex w-[240px] shrink-0 flex-col border-r border-line bg-bg-0'>
      <div className='flex h-14 items-center gap-2 border-b border-line px-4'>
        <Logo size={24} />
        <span className='font-semibold'>{t('app.name', { ns: 'common' })}</span>
      </div>
      <nav className='flex-1 overflow-y-auto p-3'>
        <SidebarGroup label={t('nav.build')}>
          <NavItem to='/dashboard' label={t('nav.dashboard')} icon={LayoutDashboard} />
          <NavItem to='/keys' label={t('nav.keys')} icon={KeyRound} />
          <NavItem to='/playground' label={t('nav.playground')} icon={Play} />
          <NavItem to='/logs' label={t('nav.logs')} icon={List} />
        </SidebarGroup>
        <SidebarGroup label={t('nav.billing')}>
          <NavItem to='/topup' label={t('nav.topup')} icon={Receipt} />
        </SidebarGroup>
      </nav>
      <div className='border-t border-line p-3'>
        <UserChip />
      </div>
    </aside>
  );
}
```

- [ ] **Step 4: TopbarSearchStub**

```tsx
// web-next/src/components/layout/TopbarSearchStub.tsx
import { Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

export function TopbarSearchStub() {
  const { t } = useTranslation('shell');
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type='button'
            className='flex h-8 w-[280px] items-center gap-2 rounded-sm border border-line bg-bg-1 px-3 text-13 text-fg-2 hover:bg-bg-2'
          >
            <Search size={14} strokeWidth={1.5} />
            <span className='flex-1 text-left'>{t('search.placeholder')}</span>
            <kbd className='mono text-12 text-fg-2'>⌘K</kbd>
          </button>
        </TooltipTrigger>
        <TooltipContent>{t('search.coming_soon')}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
```

- [ ] **Step 5: Topbar**

```tsx
// web-next/src/components/layout/Topbar.tsx
import { TopbarSearchStub } from './TopbarSearchStub';

type Props = {
  title: string;
  action?: React.ReactNode;
};

export function Topbar({ title, action }: Props) {
  return (
    <header className='flex h-14 items-center gap-4 border-b border-line bg-bg-0 px-6'>
      <h1 className='flex-1 h3'>{title}</h1>
      <TopbarSearchStub />
      {action}
    </header>
  );
}
```

- [ ] **Step 6: UserChip**

```tsx
// web-next/src/components/layout/UserChip.tsx
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';

import { UserMenu } from './UserMenu';

function initials(name: string | null | undefined, fallback: string) {
  const src = (name || fallback || '').trim();
  if (!src) return 'NA';
  const parts = src.split(/\s+/);
  const head = parts[0]?.[0] ?? '';
  const tail = parts.length > 1 ? parts[parts.length - 1]?.[0] : parts[0]?.[1] ?? '';
  return (head + tail).toUpperCase() || 'NA';
}

export function UserChip() {
  const { user } = useAuth();
  if (!user) return null;
  const label = user.display_name || user.username;
  const second = `${user.tenant_id ? `Tenant #${user.tenant_id}` : ''}${user.group ? ` · ${user.group}` : ''}`;
  return (
    <UserMenu>
      <button
        type='button'
        className={cn(
          'flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left transition-colors hover:bg-bg-1'
        )}
      >
        <span className='flex h-8 w-8 shrink-0 items-center justify-center rounded-pill bg-accent-soft mono text-12 font-semibold text-fg-0'>
          {initials(user.display_name, user.username)}
        </span>
        <span className='min-w-0 flex-1'>
          <span className='block truncate text-13 text-fg-0'>{label}</span>
          <span className='block truncate text-12 text-fg-2'>{second}</span>
        </span>
      </button>
    </UserMenu>
  );
}
```

- [ ] **Step 7: ThemeToggle (sub-menu)**

```tsx
// web-next/src/components/layout/ThemeToggle.tsx
import { Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from '@/components/ui/dropdown-menu';
import { applyTheme, getStoredTheme, type ThemeMode } from '@/lib/theme';

export function ThemeToggle() {
  const { t } = useTranslation('shell');
  const [mode, setMode] = useState<ThemeMode>(getStoredTheme);
  useEffect(() => applyTheme(mode), [mode]);

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className='flex items-center gap-2'>
        <Sun size={14} strokeWidth={1.5} />
        <span>{t('usermenu.theme')}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuRadioGroup value={mode} onValueChange={(v) => setMode(v as ThemeMode)}>
          <DropdownMenuRadioItem value='light'>
            <Sun size={14} strokeWidth={1.5} className='mr-2' /> {t('theme.light')}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value='dark'>
            <Moon size={14} strokeWidth={1.5} className='mr-2' /> {t('theme.dark')}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value='system'>
            <Monitor size={14} strokeWidth={1.5} className='mr-2' /> {t('theme.system')}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
```

- [ ] **Step 8: LangToggle**

```tsx
// web-next/src/components/layout/LangToggle.tsx
import { Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from '@/components/ui/dropdown-menu';

export function LangToggle() {
  const { i18n, t } = useTranslation('shell');

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className='flex items-center gap-2'>
        <Languages size={14} strokeWidth={1.5} />
        <span>{t('usermenu.language')}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuRadioGroup
          value={i18n.language.startsWith('zh') ? 'zh' : 'en'}
          onValueChange={(v) => void i18n.changeLanguage(v)}
        >
          <DropdownMenuRadioItem value='zh'>{t('lang.zh')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value='en'>{t('lang.en')}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
```

- [ ] **Step 9: UserMenu**

```tsx
// web-next/src/components/layout/UserMenu.tsx
import { LogOut, UserCog } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/hooks/useAuth';

import { LangToggle } from './LangToggle';
import { ThemeToggle } from './ThemeToggle';

export function UserMenu({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation('shell');
  const { logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align='start' side='top' sideOffset={6} className='w-56'>
        <ThemeToggle />
        <LangToggle />
        <DropdownMenuItem onClick={() => navigate('/account')}>
          <UserCog size={14} strokeWidth={1.5} className='mr-2' />
          {t('usermenu.account')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleLogout}>
          <LogOut size={14} strokeWidth={1.5} className='mr-2' />
          {t('usermenu.logout')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 10: AppShell**

```tsx
// web-next/src/components/layout/AppShell.tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useLocation } from 'react-router-dom';

import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

const TITLES: Record<string, string> = {
  '/dashboard': 'nav.dashboard',
  '/keys': 'nav.keys',
  '/playground': 'nav.playground',
  '/logs': 'nav.logs',
  '/topup': 'nav.topup',
  '/plan': 'nav.topup',
  '/account': 'usermenu.account',
};

export function AppShell() {
  const { t } = useTranslation('shell');
  const location = useLocation();
  const [wide, setWide] = useState<boolean>(() =>
    typeof window === 'undefined' ? true : window.innerWidth >= 1024
  );
  useEffect(() => {
    function onResize() {
      setWide(window.innerWidth >= 1024);
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  if (!wide) {
    return (
      <div className='flex h-screen items-center justify-center bg-bg-0 p-6 text-center'>
        <p className='text-13 text-fg-1'>{t('viewport.too_narrow', { ns: 'common' })}</p>
      </div>
    );
  }

  const key = Object.keys(TITLES).find((k) => location.pathname.startsWith(k));
  const titleKey = key ? TITLES[key] : 'nav.dashboard';

  return (
    <div className='flex h-screen overflow-hidden'>
      <Sidebar />
      <main className='flex flex-1 flex-col overflow-hidden'>
        <Topbar title={t(titleKey)} />
        <div className='flex-1 overflow-y-auto'>
          <div className='mx-auto max-w-[1280px] px-6 py-6'>
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
}
```

- [ ] **Step 11: Typecheck + build**

```bash
bun run typecheck
bun run build
```
Expected: both exit 0.

- [ ] **Step 12: Commit**

```bash
git add web-next/src/components/layout
git commit -m "feat(web-next): shell layout (sidebar + topbar + user menu + theme/lang toggles)"
```

---

## Task 14 — ComingSoon / NotFound / Forbidden / ErrorBoundary / RouteErrorFallback / FullPageSkeleton (refine)

**Files:**
- Create: `web-next/src/components/common/ComingSoon.tsx`
- Create: `web-next/src/components/common/NotFound.tsx`
- Create: `web-next/src/components/common/Forbidden.tsx`
- Create: `web-next/src/components/common/ErrorBoundary.tsx`
- Create: `web-next/src/components/common/RouteErrorFallback.tsx`
- Modify: `web-next/src/components/common/FullPageSkeleton.tsx` (refine from Task 8 stub)

- [ ] **Step 1: ComingSoon**

```tsx
// web-next/src/components/common/ComingSoon.tsx
import { Construction } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export function ComingSoon({ feature }: { feature: string }) {
  const { t } = useTranslation('shell');
  return (
    <div className='flex min-h-[60vh] flex-col items-center justify-center text-center'>
      <Construction size={28} strokeWidth={1.5} className='mb-4 text-fg-2' />
      <h2 className='h3'>{t('coming_soon.title', { feature })}</h2>
      <p className='muted mt-2 max-w-md'>{t('coming_soon.body')}</p>
    </div>
  );
}
```

- [ ] **Step 2: NotFound**

```tsx
// web-next/src/components/common/NotFound.tsx
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

export function NotFound() {
  const { t } = useTranslation('shell');
  return (
    <div className='flex min-h-[60vh] flex-col items-center justify-center text-center'>
      <h2 className='h3'>{t('not_found.title')}</h2>
      <p className='muted mt-2'>{t('not_found.body')}</p>
      <Link to='/' className='mt-6 text-13 text-accent hover:underline'>
        {t('not_found.home')}
      </Link>
    </div>
  );
}
```

- [ ] **Step 3: Forbidden (public, shell 外)**

```tsx
// web-next/src/components/common/Forbidden.tsx
import { ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

export function Forbidden() {
  const { t } = useTranslation('shell');
  return (
    <div className='flex min-h-screen flex-col items-center justify-center bg-bg-0 px-4 text-center'>
      <ShieldAlert size={32} strokeWidth={1.5} className='mb-4 text-fg-2' />
      <h2 className='h3'>{t('forbidden.title')}</h2>
      <p className='muted mt-2'>{t('forbidden.body')}</p>
      <Link to='/login' className='mt-6 text-13 text-accent hover:underline'>
        ← /login
      </Link>
    </div>
  );
}
```

- [ ] **Step 4: ErrorBoundary**

```tsx
// web-next/src/components/common/ErrorBoundary.tsx
import { Component, type ReactNode } from 'react';

import { logError } from '@/lib/observability';

type Props = { fallback: ReactNode; children: ReactNode };
type State = { hasError: boolean };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(err: Error, info: React.ErrorInfo): void {
    logError(err, { tag: 'error-boundary', componentStack: info.componentStack });
  }

  render(): ReactNode {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}
```

- [ ] **Step 5: RouteErrorFallback**

```tsx
// web-next/src/components/common/RouteErrorFallback.tsx
import { RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useRouteError } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { logError } from '@/lib/observability';

export function RouteErrorFallback() {
  const err = useRouteError();
  const { t } = useTranslation('shell');
  logError(err, { tag: 'route-error' });
  return (
    <div className='flex min-h-screen flex-col items-center justify-center bg-bg-0 px-4 text-center'>
      <h2 className='h3'>{t('error_boundary.title')}</h2>
      <p className='muted mt-2 max-w-md'>{t('error_boundary.body')}</p>
      <Button className='mt-6' onClick={() => window.location.reload()}>
        <RotateCcw size={14} strokeWidth={1.5} className='mr-2' /> {t('error_boundary.reload')}
      </Button>
    </div>
  );
}
```

- [ ] **Step 6: Refine FullPageSkeleton**

Replace the Task 8 stub with:

```tsx
// web-next/src/components/common/FullPageSkeleton.tsx
export function FullPageSkeleton() {
  return (
    <div
      data-testid='full-page-skeleton'
      className='flex h-screen items-center justify-center bg-bg-0'
      aria-busy='true'
    >
      <div className='flex items-center gap-2 text-fg-2'>
        <span className='inline-block h-2 w-2 animate-pulse rounded-pill bg-fg-2' />
        <span className='text-13'>…</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Typecheck + commit**

```bash
bun run typecheck
git add web-next/src/components/common
git commit -m "feat(web-next): coming-soon + not-found + forbidden + error boundary"
```

---

## Task 15 — Routes + App wiring + remove old Home.tsx

**Files:**
- Modify: `web-next/src/routes.tsx`
- Modify: `web-next/src/App.tsx`
- Modify: `web-next/src/main.tsx` — 无改动（已 `initTheme()` + `import './i18n'`）
- Delete: `web-next/src/pages/Home.tsx`

- [ ] **Step 1: Rewrite `src/routes.tsx`**

```tsx
// web-next/src/routes.tsx
import { Navigate, createBrowserRouter } from 'react-router-dom';

import { AppShell } from '@/components/layout/AppShell';
import { ComingSoon } from '@/components/common/ComingSoon';
import { Forbidden } from '@/components/common/Forbidden';
import { NotFound } from '@/components/common/NotFound';
import { ProtectedRoute } from '@/components/common/ProtectedRoute';
import { RouteErrorFallback } from '@/components/common/RouteErrorFallback';
import { Forgot } from '@/pages/Forgot';
import { Login } from '@/pages/Login';
import { Register } from '@/pages/Register';
import { Reset } from '@/pages/Reset';

export const router = createBrowserRouter([
  {
    errorElement: <RouteErrorFallback />,
    children: [
      { path: '/login', element: <Login /> },
      { path: '/register', element: <Register /> },
      { path: '/forgot', element: <Forgot /> },
      { path: '/reset', element: <Reset /> },
      { path: '/user/reset', element: <Reset /> },
      { path: '/forbidden', element: <Forbidden /> },
      {
        element: <ProtectedRoute />,
        children: [
          {
            element: <AppShell />,
            children: [
              { path: '/', element: <Navigate to='/dashboard' replace /> },
              { path: '/dashboard', element: <ComingSoon feature='Dashboard' /> },
              { path: '/keys', element: <ComingSoon feature='API keys' /> },
              { path: '/playground', element: <ComingSoon feature='Playground' /> },
              { path: '/logs', element: <ComingSoon feature='Logs' /> },
              { path: '/topup', element: <ComingSoon feature='Top up · invoices' /> },
              { path: '/plan', element: <ComingSoon feature='Plan' /> },
              { path: '/account', element: <ComingSoon feature='Account' /> },
              { path: '*', element: <NotFound /> },
            ],
          },
        ],
      },
    ],
  },
]);
```

- [ ] **Step 2: Rewrite `src/App.tsx`**

```tsx
// web-next/src/App.tsx
import { RouterProvider } from 'react-router-dom';

import { AppProviders } from '@/providers/AppProviders';

import { router } from './routes';

export default function App() {
  return (
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  );
}
```

**⚠️ NB**: `<AppProviders>` 内部用了 `useNavigate()`（在 `ApiEventBridge`），而 `useNavigate` 必须在 `RouterProvider` 下面。把 Router provider 放里面、App Providers 放外面会**运行时报错**。正确结构：Provider tree 外层是 QueryClient + Auth + Toaster；Router 在内层；ApiEventBridge 必须**放在 Router 里**。

调整为以下结构：

```tsx
// web-next/src/App.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';

import { Toaster } from 'sonner';

import { AuthProvider } from '@/providers/AuthProvider';

import { router } from './routes';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
        <Toaster position='top-right' richColors closeButton />
      </AuthProvider>
    </QueryClientProvider>
  );
}
```

And move `ApiEventBridge` into the router tree. Update `src/routes.tsx` to wrap the root with a `<Layout>` that includes the bridge:

```tsx
// Add to src/routes.tsx top:
import { useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { onAuthEvent, onToast } from '@/lib/api';

function RootLayout() {
  const navigate = useNavigate();
  useEffect(() => {
    const offAuth = onAuthEvent((event) => {
      if (event === 'unauthorized') {
        const current = window.location.pathname + window.location.search;
        const publicRoutes = ['/login', '/register', '/forgot', '/reset', '/user/reset', '/forbidden'];
        if (!publicRoutes.some((p) => window.location.pathname.startsWith(p))) {
          navigate(`/login?redirect=${encodeURIComponent(current)}`, { replace: true });
        }
      } else if (event === 'forbidden') {
        navigate('/forbidden', { replace: true });
      }
    });
    const offToast = onToast((_, message) => toast.error(message));
    return () => {
      offAuth();
      offToast();
    };
  }, [navigate]);
  return <Outlet />;
}
```

Then change the router config so `errorElement` branch has `element: <RootLayout />`:

```tsx
export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    errorElement: <RouteErrorFallback />,
    children: [
      { path: '/login', element: <Login /> },
      // …unchanged…
    ],
  },
]);
```

Delete `src/providers/AppProviders.tsx`（被 App.tsx 直接组装取代）。

- [ ] **Step 3: Delete old Home.tsx**

```bash
cd web-next
rm src/pages/Home.tsx
```

- [ ] **Step 4: Typecheck + build**

```bash
bun run typecheck
bun run build
```
Expected: both exit 0.

- [ ] **Step 5: Dev smoke test**

```bash
bun run dev
```
Browser `http://localhost:4928/`:
- 未登录 → 跳 `/login?redirect=/dashboard`
- 填 `alice` / `good` 登录（开发期：前端对着真后端；开发期不走 MSW。若后端未起，用 `/forbidden` 和 `/login` 页来验证样式）
- 切 theme / lang 验证持久化

Note: 如果后端未运行，登录会失败——这是预期的；此 step 只验证路由和样式。

- [ ] **Step 6: Commit**

```bash
git add web-next/src/App.tsx web-next/src/routes.tsx
git rm web-next/src/pages/Home.tsx
git rm web-next/src/providers/AppProviders.tsx
git commit -m "feat(web-next): wire routes + App shell + public auth pages"
```

---

## Task 16 — Integration tests (MSW, 4 flows)

**Files:**
- Create: `web-next/src/test/integration/login.test.tsx`
- Create: `web-next/src/test/integration/register.test.tsx`
- Create: `web-next/src/test/integration/forgot-reset.test.tsx`
- Create: `web-next/src/test/integration/wechat.test.tsx`

Helper: a shared mount that wires the full app against an in-memory router at an initial entry.

- [ ] **Step 1: Write integration test helper (inline in each flow test; no shared util file for day-1)**

- [ ] **Step 2: login happy path**

```tsx
// web-next/src/test/integration/login.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, test } from 'vitest';

import '@/i18n';
import { ComingSoon } from '@/components/common/ComingSoon';
import { ProtectedRoute } from '@/components/common/ProtectedRoute';
import { Login } from '@/pages/Login';
import { AuthProvider } from '@/providers/AuthProvider';

function mount(entry = '/login?redirect=/dashboard') {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path='/login' element={<Login />} />
          <Route element={<ProtectedRoute />}>
            <Route path='/dashboard' element={<ComingSoon feature='Dashboard' />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthProvider>
  );
}

describe('integration: login flow', () => {
  test('sign in → bootstrap saved → /self → dashboard ComingSoon visible', async () => {
    const user = userEvent.setup();
    mount();
    await user.type(await screen.findByLabelText(/邮箱|email/i), 'alice@example.com');
    await user.type(screen.getByLabelText(/密码|password/i), 'good');
    await user.click(screen.getByRole('button', { name: /登录|sign in/i }));
    await waitFor(() => expect(screen.getByText(/Coming soon/)).toBeInTheDocument());
    expect(JSON.parse(localStorage.getItem('new-api.auth-bootstrap')!)).toEqual({ id: 42, tenant_id: 1 });
  });
});
```

- [ ] **Step 3: register two-step**

```tsx
// web-next/src/test/integration/register.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, test } from 'vitest';

import '@/i18n';
import { ComingSoon } from '@/components/common/ComingSoon';
import { ProtectedRoute } from '@/components/common/ProtectedRoute';
import { Register } from '@/pages/Register';
import { AuthProvider } from '@/providers/AuthProvider';

describe('integration: register flow', () => {
  test('two-step form → auto-login → dashboard ComingSoon', async () => {
    const user = userEvent.setup();
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/register']}>
          <Routes>
            <Route path='/register' element={<Register />} />
            <Route element={<ProtectedRoute />}>
              <Route path='/' element={<ComingSoon feature='Dashboard' />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    );
    await user.type(await screen.findByLabelText(/邮箱|email/i), 'alice@example.com');
    await user.click(screen.getByRole('button', { name: /发送|send/i }));
    await user.type(await screen.findByLabelText(/验证码|code/i), '123456');
    await user.type(screen.getByLabelText(/用户名|username/i), 'alice');
    await user.type(screen.getByLabelText(/^设置密码|^password$/i), 'Abcdef1234!@');
    await user.type(screen.getByLabelText(/确认密码|confirm/i), 'Abcdef1234!@');
    await user.click(screen.getByRole('button', { name: /创建|create/i }));
    await waitFor(() => expect(screen.getByText(/Coming soon/)).toBeInTheDocument());
  });
});
```

- [ ] **Step 4: forgot → reset full round**

```tsx
// web-next/src/test/integration/forgot-reset.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, test } from 'vitest';

import '@/i18n';
import { Forgot } from '@/pages/Forgot';
import { Reset } from '@/pages/Reset';

describe('integration: forgot → reset', () => {
  test('send reset email → visit /user/reset with token → submit → see new password', async () => {
    const user = userEvent.setup();
    // Step 1: /forgot sends email
    const { unmount } = render(
      <MemoryRouter initialEntries={['/forgot']}>
        <Routes>
          <Route path='/forgot' element={<Forgot />} />
        </Routes>
      </MemoryRouter>
    );
    await user.type(await screen.findByLabelText(/邮箱|email/i), 'alice@example.com');
    await user.click(screen.getByRole('button', { name: /发送|send/i }));
    await waitFor(() => expect(screen.getByText(/inbox|收件箱/i)).toBeInTheDocument());
    unmount();

    // Step 2: Visit /user/reset?... (simulating email link)
    render(
      <MemoryRouter initialEntries={['/user/reset?email=alice@example.com&token=abcd']}>
        <Routes>
          <Route path='/user/reset' element={<Reset />} />
          <Route path='/login' element={<div data-testid='login'>login</div>} />
        </Routes>
      </MemoryRouter>
    );
    await user.click(await screen.findByRole('button', { name: /重置|reset/i }));
    await waitFor(() => expect(screen.getByText('Gx7kPq2mN9vR')).toBeInTheDocument());
  });
});
```

- [ ] **Step 5: wechat code login**

```tsx
// web-next/src/test/integration/wechat.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, test } from 'vitest';

import '@/i18n';
import { ComingSoon } from '@/components/common/ComingSoon';
import { ProtectedRoute } from '@/components/common/ProtectedRoute';
import { Login } from '@/pages/Login';
import { AuthProvider } from '@/providers/AuthProvider';

describe('integration: WeChat code login', () => {
  test('click WeChat → enter code → dashboard ComingSoon', async () => {
    const user = userEvent.setup();
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/login']}>
          <Routes>
            <Route path='/login' element={<Login />} />
            <Route element={<ProtectedRoute />}>
              <Route path='/' element={<ComingSoon feature='Dashboard' />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    );
    await user.click(await screen.findByRole('button', { name: /wechat/i }));
    await user.type(await screen.findByLabelText(/wechat code/i), 'ok-code');
    await user.click(screen.getByRole('button', { name: /继续|continue/i }));
    await waitFor(() => expect(screen.getByText(/Coming soon/)).toBeInTheDocument());
  });
});
```

- [ ] **Step 6: Run all tests**

```bash
bun run test
```
Expected: **all** test files green (unit + component + integration).

- [ ] **Step 7: Commit**

```bash
git add web-next/src/test/integration
git commit -m "test(web-next): integration flows — login, register, forgot→reset, wechat"
```

---

## Task 17 — Acceptance check + production build

**Files:** (no new files)

- [ ] **Step 1: Run full test suite**

```bash
cd web-next
bun run test
```
Expected: all green.

- [ ] **Step 2: Full typecheck**

```bash
bun run typecheck
```
Expected: exit 0.

- [ ] **Step 3: Production build**

```bash
bun run build
```
Expected: exit 0；`dist/` 生成。

- [ ] **Step 4: Serve preview + walkthrough**

```bash
bun run preview
```
Open http://localhost:4173 (Vite preview default). Manual verify:
- [ ] 未登录访问 `/dashboard` → 跳 `/login?redirect=/dashboard`
- [ ] 登录后回到 `/dashboard` 显示 Coming soon
- [ ] Sidebar 5 项全可点（Dashboard / API keys / Playground / Logs / Top up · invoices）
- [ ] URL 随点击更新，页面切到对应 feature 的 Coming soon
- [ ] UserChip 点击 → menu 有 Theme / Language / Account / Log out
- [ ] Theme light/dark/system 切换生效，刷新保留
- [ ] Lang zh/en 切换生效，刷新保留
- [ ] Logout 清空 bootstrap 并跳回 /login
- [ ] Chrome DevTools → Lighthouse > Accessibility contrast 手动抽查 10 处（body text on bg-0/1/2，primary button，accent link）
- [ ] Viewport 缩到 < 1024px → 显示 "Use a larger screen"
- [ ] 访问 `/foo/bar`（shell 内未定义） → NotFound
- [ ] 访问 `/forbidden` → Forbidden 页
- [ ] WeChat 按钮打开 modal，`Esc` 能关

- [ ] **Step 5: Dev smoke with real backend (optional)**

If Go backend is running on `:3000`:

```bash
cd E:/new_key_api/keyapi
go run main.go  # separate terminal
cd web-next
bun run dev
```
Open `http://localhost:4928/login` and try a real registration round.

- [ ] **Step 6: Commit final state**

如果 Step 4 里发现需要微调的小问题（比如 CSS 抖动、一处文案、某个 ComingSoon label），直接 `git add`+commit：

```bash
git commit -m "fix(web-next): slice 1 polish from acceptance walkthrough"
```

- [ ] **Step 7: 更新 VERSIONS.md（如果项目有该惯例）**

检查 `VERSIONS.md` 是否需要加 web-next slice 1 条目（可选，跟随项目惯例）。

- [ ] **Step 8: Final confirmation**

全部验收点通过后，告诉用户：
- Slice 1 已完成，功能符合 `docs/superpowers/specs/2026-04-18-web-next-slice-1-shell-auth-design.md` §13 验收清单
- 分支 `feat/web-rewrite` 准备好 PR（或合入策略由用户决定）
- Slice 2 (Buyer console core) 的 brainstorming 可以独立开启

---

## Appendix A — 后端契约速查（spec §12 摘要）

| 端点 | Method | 成功响应 | 备注 |
|---|---|---|---|
| `/api/user/self` | GET | `{ success:true, data: User }` | 要求 `New-API-User` header |
| `/api/user/login` | POST | `{ success:true, data: { id, tenant_id } }` | 失败 `200 + success:false + message` |
| `/api/user/logout` | POST | `{ success:true }` | |
| `/api/user/register` | POST | `{ success:true }` | 不自动登录；前端需显式 login |
| `/api/verification?email=...` | GET | `{ success:true, message }` | 发验证码 |
| `/api/reset_password?email=...` | GET | `{ success:true, message }` | 发重置邮件 |
| `/api/user/reset` | POST | `{ success:true, data: '新密码' }` | 后端生成随机 12 位密码 |
| `/api/oauth/wechat?code=...` | GET | `{ success:true, data: { id, tenant_id } }` | 直接登录 / 自动注册 |

如 MSW 与真实后端存在差异，修 `src/test/msw/handlers.ts`，不改前端代码。

## Appendix B — Tailwind + design_file 速查

- 颜色：`bg-bg-0/1/2/3`、`text-fg-0/1/2`、`border-line`、`bg-primary`、`text-accent`、`bg-{danger,warn,success,info}-soft`
- 圆角：`rounded-xs/sm/md/lg/pill`
- 字体家族：`font-sans`（已默认） / `font-mono`
- 语义 class（来自 `colors_and_type.css`）：`.h1 .h2 .h3 .h4 .body .muted .subtle .eyebrow .mono .money .money-xl .money-lg .money-md .money-sm .text-12/13/14/16/18/20/24/32/48`
- 动效：`transition-colors` 默认 180ms；新做 transition 优先用 CSS variable `--ease-out` + `--dur-*`

## Appendix C — 常见坑

1. **shadcn init 会改 `src/index.css` 和 `tailwind.config.ts`**，Task 1 Step 5–6 里有恢复步骤
2. **`useNavigate`/`useSearchParams` 必须在 `<RouterProvider>` 内**（Task 15 Step 2 显式修复）
3. **MSW node server 要在 setup.ts 里 `server.listen({ onUnhandledRequest: 'error' })`**，方便发现漏 mock 的请求
4. **Radix DropdownMenu 子菜单在 portal 里**，测试需要 `findBy*` 而不是 `getBy*`
5. **刷新页面后登录状态由 `new-api.auth-bootstrap` 恢复**；MSW `/api/user/self` handler 依赖 `New-API-User` header，清 localStorage 后要确认 unauthenticated 分支
6. **`bun run build` 要先 `tsc -b`**，build 之前的 typecheck 失败会直接让 build 失败——不要跳过 typecheck

---

## Self-Review 摘要（plan 作者已检）

- Spec coverage：§1.2 6 项（6 auth pages + shell + auth flows + API client + i18n + testing）全部对应到 Task 6/7/8/9/10/11/12/13/14/15/16，验收 §13 每条都能在 Task 17 walkthrough 对到
- Placeholder 扫描：无 TBD / TODO / 省略；每个 Task 的 code step 都有真实代码块
- 类型一致性：`User` 字段（spec §7.5）在 handlers / AuthContext / UserChip 三处一致；`AuthBootstrap = { id, tenant_id }` 一致；ApiError.code 字典一致
- Scope：单个 slice 14 个 feature task + 3 个支撑 task（setup/test infra/wiring），均可执行、都有 commit
