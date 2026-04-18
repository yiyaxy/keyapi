# web-next Slice 1 — App Shell + Auth — 设计文档

> 日期：2026-04-18
> 分支：`feat/web-rewrite`
> 关联背景：
> - 根 `.impeccable.md`（设计 context）
> - `design_file/`（token / hi-fi kit / spec cards，**视觉真源**）
> - `web-next/`（已初始化的 Vite 6 + React 19 + TS strict + Tailwind 3 脚手架）
>
> **本文档覆盖新前端重写的第一个 slice**——app shell、认证流程、API 客户端、i18n、路由基座。这是后续所有 slice 的地基，先落地再往上加功能页。

---

## 1. 背景与目标

### 1.1 前置

- 既有 `web/`（React 18 + Semi Design + 55 页）继续服役；`web-next/` 并行重写、完成后再切流量
- `design_file/` 提供 token（OKLCH 色板、type scale、spacing、motion）+ hi-fi JSX kit（Dashboard / Keys / Playground / Billing）+ 19 张 spec card —— **所有视觉决策的唯一真源**
- 后端 API 保持不变，继续在 `localhost:3000`；Vite 代理 `/api`、`/pg`、`/v1` 到后端
- 分支 `feat/web-rewrite` 已切，脚手架已完成（`bun install` / `typecheck` / `dev` 通过，`http://localhost:4928` 可跑）

### 1.2 本次目标（Slice 1）

让付费开发者用户可以**注册 → 登录 → 进入 app shell → 在 sidebar 里看到完整信息架构**（但功能页暂未实现，落到 "Coming soon" 空状态）。

具体覆盖：
- 6 个功能页：`/login`、`/register`、`/forgot`、`/reset`、`/forbidden`，加上 shell 内的 `/*` ComingSoon
- App Shell：sidebar（240px）+ topbar（56px）+ user menu + 主题 / 语言切换
- Auth 流：Email + 密码（含邮箱验证码注册） + WeChat 扫码 + 密码重置
- API 客户端：axios 实例、session cookie、tenant header、401 / 403 / 5xx 归一处理
- i18n 骨架：zh / en 双语，按 namespace 拆文件，Intl 格式化
- Testing：Vitest + React Testing Library + MSW，关键路径有测

### 1.3 不覆盖

| 模块 | 推到哪里 |
|---|---|
| Dashboard / Keys / TopUp / Subscription / Log 的真实实现 | **Slice 2**（Buyer console core） |
| Playground（SSE + markdown + shiki） | **Slice 3** |
| InvoiceUser / Message / Settings（真实）/ Policy 静态页 | **Slice 4 / 7** |
| Tenant admin 套件 | **Slice 5** |
| Platform ops 套件 | **Slice 6** |
| Setup（首装）页 | 不做，`web/` 保留 |
| GitHub / Google / Telegram / LinuxDO / OIDC OAuth | **Phase 2**；后端支持但 Slice 1 不暴露 |
| 2FA、Turnstile、mobile 响应式（< 1024px） | **Phase 2** |
| 命令面板（⌘K）真实交互 | **Phase 2**；day-1 只渲染壳 + "Coming soon" tooltip |
| E2E（Playwright）、视觉回归（Chromatic） | **Slice 2+ 再评估** |

---

## 2. 关键决策记录

| 决策项 | 选择 | 理由 |
|---|---|---|
| **认证架构** | 方案 A — `<AuthProvider>` + `<ProtectedRoute>` | 经典、好测、和 TanStack Query 职责清晰（Auth 归 context，其他数据归 Query）；loader 方案（RRv7）复杂度暂不必要 |
| **登录通道** | Email + 密码（注册带验证码）+ WeChat 验证码弹窗 | GitHub / Google / Telegram / LinuxDO / OIDC 推 Phase 2 |
| **租户切换器** | 不做，silent 绑当前租户 | day-1 付费用户只属自己租户；管理员多租户场景 Phase 2 再加 |
| **Sidebar 呈现** | day-1 全显示 7 个导航项，未实现页统一跳 `<ComingSoon>` | 完整 IA 可见；Slice 2 落地只替换内容，不改 shell |
| **Plan / Account 位置** | 收进 user menu；sidebar 只留 BUILD + BILLING 两组 | 更干净、更匹配 OpenAI Platform 审美 |
| **密码重置** | day-1 做 | 不做会让忘密码用户找管理员，体验断裂 |
| **注册流** | 两步式同页（邮箱 → 验证码 + 密码） | 比整页跳流畅；错误可就地修正 |
| **WeChat 流** | 输入 code 的 modal（非 QR / polling） | 现有后端 `GET /api/oauth/wechat?code=...` 直接完成登录/注册 |
| **错误显示** | 表单内联 banner（不 toast） | 持久、开发者友好、不遮挡 |
| **错误码策略** | day-1 以 `message` 为主，`code` 只用于少量通用错误 | 现有 dashboard / auth 接口并未稳定返回 `code`，直接依赖会误判 |
| **Session 存储** | Cookie session + 前端最小 bootstrap 持久化 | 现有受保护接口还依赖 `New-API-User` header，刷新后需要本地保留 `id`（及 `tenant_id`）才能调 `/api/user/self` |
| **响应式** | 桌面优先，< 1024px 提示 "Use a larger screen" | 付费开发者几乎桌面使用；mobile drawer 推 Phase 2 |
| **Password 强度条** | 简易规则（长度 + 大小写 + 数字 + 符号） | zxcvbn-ts gzip +140KB，性价比不足；后端已有最小 6 位约束 |
| **Testing 范围** | 单测（pure fn）+ 组件测（关键业务组件）+ MSW 集成测（auth 三条路径） | 为 Slice 2+ 铺路；day-1 不引入 E2E / visual regression |

---

## 3. Scope

### 3.1 In

**页面**
- `/login`、`/register`、`/forgot`、`/reset?email=...&token=...`、`/user/reset?email=...&token=...`、`/forbidden`
- `/` alias → `/dashboard`（ComingSoon）
- `/dashboard`、`/keys`、`/playground`、`/logs`、`/topup`、`/plan`、`/account`（全部 `<ComingSoon feature={key} />`）
- shell 内 `*` → `<NotFound />`

**基础设施**
- `<AppShell>` + `<Sidebar>` + `<Topbar>` + `<UserMenu>`
- `<AuthProvider>` + `<ProtectedRoute>` + 路由守卫
- Axios 实例 + interceptors（`New-API-User` / tenant / lang / 401 / 403 / 5xx）
- i18n 骨架（4 namespace × 2 lang）
- 主题 / 语言切换持久化
- 通用错误文案（以 backend `message` 为主）

**测试**
- Vitest + RTL + MSW 配置
- 关键单测：`api` interceptor、`format`、`theme`
- 关键组件测：`AuthContext`、`PasswordStrengthBar`、`ResendCountdown`
- 集成测：登录 happy / 登录失败 / 注册两步式 / forgot→reset 一轮

### 3.2 Out

见 §1.3 表。

---

## 4. 路由地图

### 4.1 Public（无 auth，无 shell）

```
/login                         登录
/register                      注册
/forgot                        忘记密码
/reset?email=...&token=...     重置密码（web-next 自定义别名）
/user/reset?email=...&token=... 重置密码（兼容后端邮件内真实链接）
/forbidden                     403 页（shell 外）
```

> **注**：
> - 前端不需要独立 `/wechat/callback` 路由；现有 WeChat 登录是 `GET /api/oauth/wechat?code=...`
> - 后端重置邮件当前拼出来的是 `/user/reset?...`，因此 Slice 1 必须兼容这个路径，不能只做 `/reset`

### 4.2 Protected（需 auth，挂 shell）

```
/                         → redirect /dashboard
/dashboard                <ComingSoon feature="dashboard" />
/keys                     <ComingSoon feature="keys" />
/playground               <ComingSoon feature="playground" />
/logs                     <ComingSoon feature="logs" />
/topup                    <ComingSoon feature="topup" />
/plan                     <ComingSoon feature="plan" />
/account                  <ComingSoon feature="account" />
/*                        <NotFound />  (inside shell)
```

### 4.3 重定向规则

| 情况 | 行为 |
|---|---|
| 未登录访问 protected route | `navigate('/login?redirect=' + encodeURIComponent(location.pathname + location.search))` |
| 已登录访问 `/login` 或 `/register` | `navigate('/dashboard')` |
| Axios 401 响应 | 清 auth state + `navigate('/login?redirect=' + current)`（已在 protected 触发）；如在 public 触发则忽略 |
| Axios 403 响应 | `navigate('/forbidden')` |
| Reset 缺 token 或 email | `navigate('/forgot')` |

---

## 5. Shell 架构

### 5.1 布局（design_file 锁定）

- Sidebar 宽 **240px**，桌面端常驻
- Topbar 高 **56px**，粘顶
- 主内容宽度 fluid，max 1280px，居中
- 三层背景：page `bg-0` / sidebar + topbar `bg-0` / 卡片 `bg-1`

### 5.2 Sidebar IA

```
┌──────────────────────┐
│ [logo] new-api       │   ← 12px eyebrow spacing 上下 16
├──────────────────────┤
│ BUILD                │   ← eyebrow label
│   Dashboard          │
│   API keys           │
│   Playground         │
│   Logs               │
│                      │
│ BILLING              │
│   Top up · invoices  │
│                      │
│ …                    │
├──────────────────────┤
│ ┌──┐ su.yang         │   ← user chip，点击打开 UserMenu
│ │SY│ Acme Inc · Pro  │
│ └──┘                 │
└──────────────────────┘
```

导航项图标（Lucide，1.5 stroke，16px）：
- Dashboard: `LayoutDashboard`
- API keys: `KeyRound`
- Playground: `Play`
- Logs: `List`
- Top up · invoices: `Receipt`

Active state：背景 `bg-2`，文字 `text-0`，不加左侧彩色条。
Hover：背景 `bg-1`，文字 `text-0`。

### 5.3 Topbar

- 左：动态页面标题（从 route meta 读）
- 中：`<TopbarSearchStub>` ——  `Find anything ⌘K` 的壳；点击 / 按键**不打开**，只显示 Tooltip "Coming soon"
- 右：**action slot**（`<Outlet context={{ setAction }} />` 暴露；Slice 1 各页不填）

### 5.4 UserMenu（Radix `DropdownMenu`）

```
UserChip 点击 → 弹出
  Theme →
    ○ Light
    ○ Dark
    ● System
  Language →
    ○ 中文
    ● English
  Account                    → /account
  ─────────────────
  Log out                    → POST /api/user/logout + navigate /login
```

### 5.5 文件骨架

```
src/components/layout/
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
```

---

## 6. Auth 流

### 6.1 共用骨架（`<AuthLayout>`）

```
bg-0 全页
  居中 card，宽 400，bg-1，border，padding 24
    Logo（32px）
    eyebrow：Sign in / Create account / Reset password
    h2 标题
    <slot>  ← 每个页面的表单
    分隔线 "or"（仅 login）
    <slot>  ← 其他登录方式（仅 login 有 WeChat）
    底部链接切换页（text-13, muted）
```

不放 marketing 插图；不放渐变；不放花哨动画——零装饰，纯表单。

### 6.2 `/login`

**Form（zod schema）**
```ts
const loginSchema = z.object({
  username: z.string().min(1),   // email 或 username 都走同字段
  password: z.string().min(1),
});
```
- Email / username 输入（autocomplete=email 或 username）
- Password 输入（autocomplete=current-password，带 `<PasswordField>` eye 切换）
- `[Submit]` **Sign in**（primary，submitting 时替换为 spinner + "Signing in…"）
- 链接 `Forgot?` → `/forgot`

**"or" 分隔下**
- `<Button variant="secondary">` **Continue with WeChat**（icon + label）→ 打开 `<WechatCodeModal>`
- 文本链接 `No account? Create one →` → `/register`

**提交**
- `POST /api/user/login` body `{ username, password }`
- 成功：后端 set cookie，并返回最小 user stub（含 `id` / `tenant_id`）；前端先持久化 bootstrap，再调 `GET /api/user/self` 填 AuthContext → `navigate(redirectParam || '/')`
- 失败：优先展示后端 `message`；不要依赖稳定 `code`

### 6.3 `/register`

**两步式同页（status state）**

**Step 1 — send code**
- Email（zod: email）
- `[Submit]` **Send verification code** → `GET /api/verification?email=...`（Turnstile 开启时额外带 `turnstile` query）
- 成功：Step 2 展开；`emailSent=true` 存 local state（不入 URL）

**Step 2 — finish signup**
- Email 只读 + "Change" 链接（重置 state 回 Step 1）
- Verification code（`<Input maxLength={6}>` autocomplete=one-time-code，数字）
- `<ResendCountdown>` 60s 内 disabled，倒计时结束后可点重发
- Username（optional；空则后端用 email 前缀）
- Password（带 `<PasswordStrengthBar>`）
- Confirm password（zod custom refine：与 password 相同）
- `[Submit]` **Create account** → `POST /api/user/register`

**成功**
- 后端当前**不会**自动登录，也不会返回 user；若要保持 day-1 的“注册后进入 app shell”目标，前端必须在 register success 后**显式再调一次** `POST /api/user/login`
- 登录成功后按 `/login` 相同步骤：先写 bootstrap，再调 `/api/user/self`，然后 `navigate('/dashboard')`

### 6.4 `/forgot`

- Email 输入
- `[Submit]` **Send reset link** → `GET /api/reset_password?email=...`（Turnstile 开启时额外带 `turnstile` query）
- 成功：card body 切为 "Check your inbox: {email}"，展示 60s resend 倒计时
- 底部链接 `← Back to sign in`

### 6.5 `/reset?email=...&token=...` / `/user/reset?email=...&token=...`

- 页面加载时校验 query：缺 email 或 token → `navigate('/forgot')`
- Email（只读，展示）
- Day-1 **不能**做“用户自填新密码”表单：当前后端 `POST /api/user/reset` 实际只认 `{ email, token }`，并会**随机生成一个 12 位新密码**作为 `data` 返回
- `[Submit]` **Reset password** → `POST /api/user/reset` body `{ email, token }`
- 成功：card body 显示返回的新密码、提供复制按钮，并提示用户回到 `/login` 用该密码登录

### 6.6 WeChat `<WechatCodeModal>`

**触发**：`/login` 点击 "Continue with WeChat"

**流程**
1. Modal 打开，展示一个 code 输入框和简短说明
2. 用户从外部 WeChat 登录流程拿到 code 后粘贴到输入框
3. 点击 submit → `GET /api/oauth/wechat?code=...`
4. `success` → 后端 set cookie 并返回最小 user stub；前端写 bootstrap → 调 `/api/user/self` → close modal → `navigate('/dashboard')`
5. `success=false` → 显示后端 `message`

**Modal 视觉**
- 宽 360，居中
- Title "Continue with WeChat"
- 单个 code 输入框，居中
- 下方辅助文案解释“粘贴微信验证 code 后继续”

**核对结果**：现有后端没有 `wechat/check` polling 端点，也没有返回 QR payload。

### 6.7 交互细节（all forms）

- 按钮 loading：文字换 spinner + "…ing"，按钮宽度保持（避免 layout shift）
- 错误：inline banner（danger-soft），可关闭，离开页面自动清
- Enter 触发主按钮
- 自动 focus：Login → email；Register Step 1 → email；Step 2 → code；Forgot → email；Reset → confirm button
- 倒计时：`<ResendCountdown>` 组件复用 email code / reset email

---

## 7. API Client & Session

### 7.1 Axios 实例（`src/lib/api.ts`）

```ts
import axios from 'axios';

export const api = axios.create({
  baseURL: '/',
  withCredentials: true,
  timeout: 20_000,
  headers: { 'Content-Type': 'application/json' },
});
```

### 7.2 请求拦截器

注入 header：
- `New-API-User` ← bootstrap user id；`UserAuth()` 保护的接口会校验它必须存在且与 session 一致
- `X-Tenant-Id` ← bootstrap tenant id（可缺省；后端会 fallback 到 subdomain / default tenant）
- `Accept-Language` ← `i18n.language`
- Turnstile 不走 header；现有登录/注册/验证码/重置邮件都通过 query 参数 `?turnstile=...`

### 7.3 响应拦截器

```
case HTTP 2xx:
  if data.success === false: throw ApiError.fromBody(data)
  else return data.data ?? data
case HTTP 401:
  auth.logout(silent: true)
  if not on public route: navigate('/login?redirect=' + current)
  throw ApiError({status:401, code:'unauthorized'})
case HTTP 403:
  navigate('/forbidden')
  throw ApiError({status:403, code:'forbidden'})
case HTTP 4xx (其他):
  throw ApiError.fromBody(response.data)
case HTTP 5xx:
  sonner.toast.error(t('errors.server_error'))
  throw ApiError({status, code:'server_error'})
case network error / timeout:
  sonner.toast.error(t('errors.network'))
  throw ApiError({status:0, code:'network'})
```

补充约束：
- 后端**大量**业务错误返回 `200 + { success:false, message }`
- 只有 auth middleware 等少数路径会返回真实 `401 / 403`
- 因此 day-1 必须采用 `success/message` 优先、HTTP status 作为补充的策略

### 7.4 ApiError 类型

```ts
export class ApiError extends Error {
  status: number;
  code: string;           // day-1 只保证 'unauthorized' | 'forbidden' | 'server_error' | 'network' | 'unknown'
  backendMessage?: string;
  fieldErrors?: Record<string, string>;

  static fromBody(body: { message?: string; code?: string; errors?: Record<string, string> }) {
    const e = new ApiError(body.message ?? 'Unknown error');
    e.code = body.code ?? 'unknown';
    e.backendMessage = body.message;
    e.fieldErrors = body.errors;
    return e;
  }
}
```

### 7.5 AuthContext

```ts
type User = {
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

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

type AuthContextValue = {
  user: User | null;
  status: AuthStatus;
  refresh: () => Promise<void>;
  login: (body: { username: string; password: string }) => Promise<void>;
  register: (body: RegisterBody) => Promise<void>;
  logout: (opts?: { silent?: boolean }) => Promise<void>;
};
```

**行为**
- Provider mount → status=`loading`
- 若本地没有 bootstrap user id，则直接 `unauthenticated`
- 若本地有 bootstrap user id，则带 `New-API-User` 调 `/api/user/self`
- 成功 → status=`authenticated`, user=...
- 失败 → status=`unauthenticated`, user=null
- login/register 成功后自动 refresh
- logout 调 `POST /api/user/logout`，然后清 context；`silent: true` 时不调 API（用于 401 清理）

### 7.6 Storage

- Session：cookie（后端管）
- localStorage：
  - `new-api.auth-bootstrap`：至少 `{ id, tenant_id }`；仅用于请求头与刷新后的 `/api/user/self` bootstrap，`/self` 仍是真实用户源
  - `new-api.theme`：`'light' | 'dark'`（absent 表示跟随系统）
  - `new-api.lang`：`'zh' | 'en'`
- 不存 access token、CSRF；bootstrap 内的 `tenant_id` 仅用于请求头，认证与成员关系仍以后端 `/self` 为准

---

## 8. 组件清单

### 8.1 shadcn/ui（day-1 add）

```
Button · Input · Label · Form · Checkbox
Alert · Skeleton · Avatar · Badge · Separator
DropdownMenu · Dialog · Tooltip · Sonner
```

Slice 2+ 再加：Table / Command / Popover / Select / Sheet / Tabs…

### 8.2 自制组件

```
src/components/layout/      （见 §5.5）
src/components/auth/
  AuthLayout.tsx
  InlineBanner.tsx
  PasswordField.tsx
  PasswordStrengthBar.tsx
  ResendCountdown.tsx
  WechatCodeModal.tsx
src/components/common/
  ComingSoon.tsx
  FullPageSkeleton.tsx
  ErrorBoundary.tsx
  NotFound.tsx
  Forbidden.tsx
  ProtectedRoute.tsx
src/providers/
  AuthProvider.tsx
  AppProviders.tsx          # 组合 Query / Auth / i18n
src/lib/
  api.ts
  format.ts                 # Intl 格式化 helper
  theme.ts                  # 已有，微调
  password.ts               # 密码强度评估（简易规则）
src/hooks/
  useCountdown.ts
  useAuth.ts                # 便捷 consumer
```

### 8.3 新增依赖

```
# runtime
react-hook-form @hookform/resolvers zod sonner
# shadcn peers
@radix-ui/react-dropdown-menu @radix-ui/react-dialog
@radix-ui/react-label @radix-ui/react-separator
@radix-ui/react-slot @radix-ui/react-tooltip

# test
vitest @vitest/coverage-v8 @testing-library/react @testing-library/jest-dom
@testing-library/user-event jsdom msw
```

---

## 9. 错误处理边界

| 层 | 范围 | 处理 |
|---|---|---|
| Axios interceptor | 所有网络请求 | 归一 `ApiError`；401 → silent logout + redirect；403 → /forbidden；5xx / network → 全局 sonner toast |
| Form submit try/catch | 登录 / 注册 / 重置 | 捕获 ApiError → `<InlineBanner>` 显示 i18n code message |
| React Router `errorElement` | 路由渲染异常 | `<RouteErrorFallback>`（"Something went wrong" + Reload 按钮） |
| 根 `<ErrorBoundary>` | 未被路由捕获的 React 错误 | Fallback + console.error；Phase 2 接 Sentry |
| Query `onError`（默认） | TanStack Query 错误 | 401/403 interceptor 已处理；其他由页面级 error state 展示 |

**观测预留**：`logError(err, ctx)` helper 在 `src/lib/observability.ts`，day-1 仅 console；Phase 2 替换实现接 Sentry。

---

## 10. i18n

### 10.1 目录

```
src/i18n/
  index.ts
  locales/
    zh/
      common.json
      auth.json
      shell.json
      errors.json
    en/ (same)
```

Default namespace `common`；组件 `useTranslation('auth')` 指定其他 ns。

### 10.2 Key 命名

- 两层扁平：`login.submit`、`register.step2.code_label`
- ICU plural 仅 en 用，zh 无
- 所有 user-facing 字符串必须走 i18n，zh 为源

### 10.3 切换行为

- LanguageDetector 顺序：`localStorage > navigator`
- `<LangToggle>` 设置 `i18n.changeLanguage(code)` → 写 localStorage
- 不强刷，依赖 react-i18next 响应式

### 10.4 Intl 格式化（`src/lib/format.ts`）

```ts
export const fmtMoney  = (n: number, currency = 'USD') => …
export const fmtNum    = (n: number) => …
export const fmtDate   = (d: Date | string) => …
```
货币 / 数字 / 时间**必须**走这三个函数。

### 10.5 错误码字典（`errors.json`，Slice 1 范围）

> day-1 策略：按 §7.3 / §12 约束，后端业务错误 code 不稳定、前端以 backend `message` 直接展示为主。此字典**只覆盖前端自产的少数通用 code**（interceptor 根据 HTTP status 或网络错误归一产生），不替代 backend message。Phase 2 等后端错误码稳定后再扩表。

```
unauthorized         # HTTP 401 interceptor 归一
forbidden            # HTTP 403 interceptor 归一
server_error         # HTTP 5xx interceptor 归一
network              # 断网 / 超时
unknown              # 兜底（message 也缺失时）
```

展示优先级：`ApiError.backendMessage` → `t('errors.' + code)` → `t('errors.unknown')`。

---

## 11. 测试策略

### 11.1 工具链

- Runner：**Vitest** + `@vitest/coverage-v8`
- DOM：jsdom
- 组件：**React Testing Library** + `@testing-library/user-event`
- 网络 mock：**MSW**（day-1 即上）
- 断言：内置 `expect` + `@testing-library/jest-dom`

### 11.2 day-1 覆盖

**纯函数单测**
- `lib/api.ts`：interceptor 行为（401/403/5xx/success=false）
- `lib/format.ts`：fmtMoney / fmtNum / fmtDate 边界
- `lib/theme.ts`：applyTheme / getStoredTheme
- `lib/password.ts`：强度评估

**组件测**
- `AuthProvider`：mount 调 /self；login 成功 / 失败；logout 清 state
- `PasswordStrengthBar`：各等级渲染
- `ResendCountdown`：初始 60s + 计时 + 可点
- `ProtectedRoute`：未登录 redirect，登录 render children

**集成测（MSW）**
- 登录 happy：填表 → 提交 → 持久化 bootstrap → `/self` 成功 → `navigate('/dashboard')`
- 登录失败：wrong_password / invalid params → InlineBanner
- 注册两步式：发码 → Step 2 展开 → register success → 自动触发 login → 跳 dashboard
- Forgot → Reset：发邮件 → 访问 `/user/reset?...` → confirm → 展示返回的新密码

### 11.3 不测（day-1）

- Shell 视觉组件（Sidebar/Topbar/UserChip）—— 手动 QA 对 design_file screenshots
- WeChat code modal —— day-1 可先靠手动 QA，Slice 2 再补 integration test
- i18n 切换 —— 依赖 react-i18next 本身

### 11.4 CI

- PR gate：`bun run typecheck` && `bun run test` && `bun run build`
- Coverage：不设 gate（day-1 数据太少）

---

## 12. 后端契约核对结果

基于 `router/api-router.go`、`controller/user.go`、`controller/misc.go`、`controller/wechat.go`、`middleware/auth.go`、`middleware/tenant.go` 的实际代码，Slice 1 应按以下真实契约实现：

1. **`GET /api/user/self`** 返回的是扩展 user payload，不是 spec 初稿里的简化 `tenant/plan` 结构；核心字段见 `id / username / display_name / role / platform_role / tenant_role / tenant_id / email / group / quota / used_quota`
2. **`X-Tenant-Id` header** 可缺省；解析顺序是 `X-Tenant-Id -> subdomain -> DefaultTenantId`
3. **受保护接口还要求 `New-API-User` header**；没有它即使 session cookie 存在，也会在 `UserAuth()` 下被 `401`
4. **401 / 403 不统一**；auth middleware 会返回真实 `401 / 403`，但大量 controller 业务错误仍是 `200 + success:false + message`
5. **`POST /api/user/register`** 需要 `verification_code`（在开启邮箱验证时）；register success 仅返回 `{ success:true }`，不会自动登录
6. **验证码接口是 `GET /api/verification?email=...`**，不是 `POST /api/verification`
7. **忘记密码发信接口是 `GET /api/reset_password?email=...`**，不是 `POST /api/reset_email`
8. **`POST /api/user/reset` 当前只按 `{ email, token }` 重置，并返回随机生成的新密码**；`password` 字段在 controller 实现里未使用
9. **WeChat 不是 QR polling**；当前是 `GET /api/oauth/wechat?code=...` 直接登录 / 自动注册
10. **错误 `code` 不稳定**；dashboard / auth day-1 不能依赖后端统一 error code，表单应以 `message` 为主
11. **`docs/openapi/api.json` 与实际路由存在漂移**；例如 `logout`、`oauth/wechat/bind` 的 method 已与 router 代码不一致，因此实现以代码为准

---

## 13. 验收标准（Slice 1 Done 的定义）

- [ ] `bun run build` 产物 `web-next/dist/` 可直接访问 `/login`、`/register`、`/forgot`、`/reset`、`/dashboard`（都不报错）
- [ ] 未登录访问 `/dashboard` 跳 `/login?redirect=/dashboard`，登录后回到 `/dashboard`
- [ ] Email + 密码注册：收验证码 → 填码 → 创建成功 → 前端显式登录一次 → 落 `/dashboard`（ComingSoon）
- [ ] WeChat 登录：点 button → modal 输 code → 登录成功后自动关 modal → 落 `/dashboard`
- [ ] Forgot → 收邮件 → 点链接到 `/user/reset` 或 `/reset` → 确认重置 → 展示并可复制后端返回的新密码
- [ ] Sidebar 7 项全显示，点击全部跳到对应路径的 ComingSoon，URL 同步变
- [ ] UserMenu 可切 theme（light/dark/system）+ lang（zh/en），刷新页面保持
- [ ] 明暗主题下所有文案对比度 ≥ 4.5:1（手动抽查 10 处）
- [ ] Viewport < 1024px 显示 "Use a larger screen"（不尝试响应式布局）
- [ ] `bun run typecheck` 无 error
- [ ] `bun run test` 通过，集成测 4 条路径 green
- [ ] MSW handlers 按 §12 核对后的真实契约配
- [ ] Shell 视觉与 `design_file/ui_kits/console`（Sidebar / Topbar / UserChip）、`design_file/screenshots/*.png`（sidebar active 态、typography hierarchy、UserChip 底部）一致——Slice 1 没有真 Dashboard，不验余额样式

---

## 14. 实施顺序暗示（留给 writing-plans）

粗粒度分组（最终由 plan 细化）：

1. **基础设施**：shadcn init、依赖 add、ESLint、lint 规则、`src/lib/*`（api/format/theme/password）、`src/providers/*`
2. **i18n 骨架**：4 × 2 JSON 文件 stub、LangToggle、Intl format helpers
3. **AuthContext + ProtectedRoute**：先配 MSW infra + `/api/user/self` / login / logout handlers，再写 AuthProvider + ProtectedRoute 组件测
4. **AuthLayout + 表单通用件**：InlineBanner / PasswordField / PasswordStrengthBar / ResendCountdown
5. **/login**（最简路径优先）
6. **/register**（两步式）
7. **/forgot + /reset**（复用 AuthLayout）
8. **WechatCodeModal 逻辑**
9. **AppShell + Sidebar + Topbar + UserMenu + ThemeToggle**
10. **ComingSoon + NotFound + Forbidden + ErrorBoundary + RouteErrorFallback**
11. **集成测 4 条路径（MSW）**
12. **验收清单过一遍，产物 build**

---

## 15. 与现有代码的接触面

Slice 1 **不改** `web/`、`frontend_v2/`、`design_file/`、后端任何代码。如果 §12 核对发现后端返回结构与预期不符，**优先改 spec 再评估是否小改后端**——改后端要开独立 PR，不混入 web-next。

`design_file/` 只读引用（via CSS @import）。`web-next/` 内部完全自管。

Go embed 路径暂不改（`//go:embed web/dist` 继续用 `web/`）；切换 web-next/dist 作为生产产物是 Phase 1 全部 slice 完成后的独立任务。
