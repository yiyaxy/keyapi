# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CaMeL-api is a next-generation LLM gateway and AI asset management system. It provides a unified relay proxy for 40+ AI model providers (OpenAI, Claude, Gemini, DeepSeek, etc.) with user/token/quota management, billing, and a React dashboard.

**Go module path:** `github.com/QuantumNous/new-api`

## Build & Run Commands

### Backend (Go 1.22.4)
```bash
# Load Go via gvm (required on this machine)
export PATH="$HOME/.gvm/gos/go1.22.4/bin:$HOME/.gvm/pkgsets/go1.22.4/global/bin:$PATH"

# Run dev server
go run main.go

# Build binary
go build -ldflags "-s -w -X 'github.com/QuantumNous/new-api/common.Version=$(cat VERSION)'" -o new-api

# Run tests
go test ./...
go test ./common/...        # single package
```

### Frontend (React + Bun)
```bash
cd web
bun install
bun run dev          # dev server
bun run build        # production build
bun run lint         # ESLint
bun run eslint:fix   # auto-fix lint issues
```

### Docker Build & Deploy
```bash
# Build image (--no-cache ensures frontend+backend changes are included)
docker build --no-cache -t camel-api:v2.6.MMDD .

# Export image (MUST use tar.gz format, not tar)
docker save camel-api:v2.6.MMDD | gzip > camel-api_v2.6.MMDD.tar.gz

# Deploy to test server
bash scripts/deploy-test.sh camel-api_v2.6.MMDD.tar.gz
```

**Version format:** `v2.6.MMDD` (e.g., v2.6.0222 for Feb 22)

## Architecture

### Request Flow
`Client → Gin Router → Middleware (auth, rate-limit, CORS) → Controller → Service → Model/Relay → Provider API`

### Key Layers

| Layer | Directory | Purpose |
|-------|-----------|---------|
| **Entry** | `main.go` | Init sequence: env → logger → DB → Redis → i18n → OAuth → router → server |
| **Router** | `router/` | `api-router.go` (`/api/*`), `relay-router.go` (`/v1/*` OpenAI-compatible), `web-router.go` (frontend) |
| **Middleware** | `middleware/` | Auth (session/token/API key), rate limiting, CORS, request logging, Turnstile |
| **Controller** | `controller/` | HTTP handlers for users, tokens, channels, billing, OAuth, relay |
| **Service** | `service/` | Business logic: billing, quota, channel selection, token counting, format conversion |
| **Model** | `model/` | GORM entities + DB operations + caching. Supports SQLite/MySQL/PostgreSQL |
| **Relay** | `relay/` | LLM provider integration. `relay/channel/` has per-provider adaptors |
| **DTO** | `dto/` | Request/response data transfer objects for each provider format |
| **Common** | `common/` | Shared utilities, constants, Redis client, rate limiter, env config |
| **Settings** | `setting/` | Config modules: pricing ratios, model settings, performance tuning |

### Relay System (core feature)
- `relay/relay_adaptor.go` — main adaptor that routes to provider-specific handlers
- `relay/channel/` — per-provider implementations (openai, claude, gemini, ali, baidu, aws, etc.)
- Format handlers: `compatible_handler.go` (OpenAI), `claude_handler.go`, `gemini_handler.go`
- Channel selection: `service/channel_select.go` (weighted random, affinity-based)

### Frontend
- React 18 + Vite + Semi Design UI + Tailwind CSS
- Source in `web/src/`, built output embedded into Go binary via `//go:embed web/dist`
- i18n via i18next (6 locales: en, zh, fr, ja, ru, vi)

## Key Patterns

### Sidebar Module Visibility
When adding new sidebar items, you MUST register the module in `web/src/hooks/common/useSidebar.js` → `DEFAULT_ADMIN_CONFIG`:
```javascript
// Example: adding a new admin module
admin: {
  // ...existing modules...
  newModule: true,  // Must add this or isModuleVisible() returns false
}
```
Required config points for new sidebar items:
1. `routerMap` — route path mapping
2. `adminItems` or `financeItems` — menu item definition
3. `render.jsx` → `getLucideIcon()` — icon mapping
4. `DEFAULT_ADMIN_CONFIG` — visibility flag

### Provider Type Constants
Defined in `constant/` — each channel type (OpenAI, Claude, Gemini, etc.) has a numeric constant used throughout routing and relay logic.

### Database Models
GORM with optional Redis caching; cache sync runs on configurable interval (`SYNC_FREQUENCY`). New models added to `model/main.go` → `migrateDB()`.

### Middleware Chain
- API routes: `GlobalAPIRateLimit` + gzip
- Relay routes: `TokenAuth` + CORS + decompression
- Relay auto-detects provider format via headers (e.g., `x-api-key` + `anthropic-version` → Claude)

## Environment Variables (key ones)

| Variable | Purpose |
|----------|---------|
| `PORT` | Server port (default 3000) |
| `SQL_DSN` | DB connection string (default: SQLite) |
| `REDIS_CONN_STRING` | Redis connection (enables memory cache) |
| `SESSION_SECRET` | Session encryption key |
| `SYNC_FREQUENCY` | Cache sync interval in seconds (default 60) |
| `SITE_LABEL` | Human-readable site identifier for logs |
| `GIN_MODE` | Set to `debug` for debug mode |

## Existing Tests

Tests are sparse, located at:
- `common/url_validator_test.go`
- `relay/common/override_test.go`
- `setting/operation_setting/status_code_ranges_test.go`

New unit tests should go under `unit_test/` at project root.

## Frontend Type Definitions

Centralized TypeScript types matching backend Go models are in `web/src/types/`:
- `api.ts` — All API response types (User, Token, Log, Message, Subscription, Channel, etc.)
- `index.ts` — Re-exports API types + frontend-specific UI types

Key type mappings:
- Go `int64` → TS `number`
- Go `bool` → TS `boolean`
- Go `string` → TS `string`
- Go `*string` (pointer) → TS `string | undefined`
- Go `gorm.DeletedAt` → omitted from TS types (handled by backend)

When adding new backend models, update `web/src/types/api.ts` accordingly.

## Task Log

See [VERSIONS.md](./VERSIONS.md) for detailed change history.

### 2026-03-29 — 票通支付宝乐企联用支付信息接入（方案二：直接开具）
- Goal: 在蓝字开票时支持 `invIssueChannel=5`（支付宝乐企联用）和 `paymentList`，满足票通 2.9 接口要求。
- Approach: `InvoiceItem` 新增 4 个支付信息字段；`buildPaymentListFromItems` 自动检测并构建 paymentList；Admin 详情页新增支付信息编辑弹窗。
- Decisions: 自动检测——有任意 item 填写支付信息则自动进入乐企联用模式；普通开票完全不受影响。
- Changed files: 8 backend files + 8 frontend/locale files.
- Test results: `go build ./...` ✅；`bun run build` ✅

### 2026-03-22 — Fix subscription plan breakdown purchase_count semantics
- Goal: change `purchase_count` in subscription plan breakdown from distinct-user count to successful order count; add non-negative clamp for remaining quota.
- Approach: in `GetSubscriptionPlanBreakdown()`, change `COUNT(DISTINCT so.user_id)` → `COUNT(*)` for order-count semantics; add `if remaining < 0 { remaining = 0 }` before quota bucketing to guard against dirty data.
- Decisions: quota aggregation (used/unused/expired) stays full-scope from `user_subscriptions`, not filtered by date range; `purchase_count` and `total_revenue` remain scoped to the selected time range's successful orders.
- Changed files: `model/purchase_analytics.go`.
- Test results: `go build ./...` passed; deployed to local slave.

### 2026-03-22 — Subscription heatmap real log-based daily aggregation
- Goal: replace the averaged `amount_used / duration` heatmap estimation with real per-day subscription consumption from LOG_DB logs.
- Approach: mixed-source aggregation in `GetSubscriptionHeatmap` — keep `user_subscriptions` for coverage/total_quota/subscription_count/future-day logic; add LOG_DB query for `type=2` logs with `subscription_consumed` in `other` JSON; Go-side parse and day-bucket by analytics TZ; replace old proportional division with `usedQuotaByDate[date]`.
- Decisions: query scoped to `other LIKE '%subscription_consumed%'` for pre-filtering; Go-side validates `billing_source=subscription` + `subscription_consumed > 0`; `planID > 0` requires matching `subscription_plan_id`; reuses existing `getFloat64FromMap` and `common.StrToMap`; future days stay `used_quota=0`.
- Changed files: `model/purchase_analytics.go`.
- Test results: `go build ./...` passed.
- Follow-ups: manual verification — open Purchase Analytics → subscription heatmap, compare a known high/low consumption day against `logs` table `subscription_consumed` sums; verify plan hover filter still works; confirm future days show count only.

### 2026-03-20 — Subscription inviter fixed reward
- Goal: when an invited user purchases a subscription, the inviter receives a fixed USD reward (configured per SubscriptionPlan), credited to AffQuota (requires withdrawal approval), with a configurable total count limit.
- Approach: added `InviterRewardAmount` field to `SubscriptionPlan`, `SubscriptionPurchaseCount` to `User`, `SubscriptionRebateCount` to `UserRebateSetting` and global config; new `ProcessSubscriptionRebate()` function (modeled after `ProcessTopUpRebate`) called async after `CompleteSubscriptionOrder`; new `AffRebateTypeSubscription = 3` constant; frontend admin UI for plan reward amount, global/per-inviter rebate count settings, and green "订阅返利" tag in AffTransfer.
- Decisions: reward is fixed USD amount (not percentage); converted to quota via `rewardAmountUSD * QuotaPerUnit`; `SubscriptionRebateCount` defaults to 0 (disabled); -1 means unlimited; per-inviter override via `UserRebateSetting`.
- Changed files: `common/constants.go`, `model/aff_rebate_log.go`, `model/option.go`, `model/user.go`, `model/user_rebate_setting.go`, `model/subscription.go`, `controller/subscription.go`, `web/src/types/api.ts`, `web/src/components/table/subscriptions/modals/AddEditSubscriptionModal.jsx`, `web/src/pages/RebateSettings/index.jsx`, `web/src/pages/Setting/Operation/SettingsCreditLimit.jsx`, `web/src/pages/AffTransfer/index.jsx`, 6 locale JSON files.
- Test results: `go build ./...` passed; `go test ./...` passed; `bun run build` passed.
- Follow-ups: manual verification — create plan with `inviter_reward_amount=1.00`, set `SubscriptionRebateCount=3`, purchase subscription as invited user, verify AffQuota increase and type=3 AffRebateLog record.

### 2026-03-18 — Site RPM snapshots + 30min trend (5s granularity)
- Goal: replace per-user 5s logs scanning with single-writer snapshots and show last-30min RPM trend (All + per-site).
- Approach: master-only background writer computes RPM via existing `model.GetSiteRPM(60)` every 5s (ts aligned to 5s) and upserts into `site_rpm_snapshots`; pruner keeps ~35min safety window; new admin history API returns range + since incremental series; frontend SiteRPM page switched to history endpoint and renders VChart line chart with 360-point ring buffer.
- Decisions: snapshots stored in main `DB` (not `LOG_DB`) for unified migration/query; total series uses `site_label="__ALL__"` and frontend maps it to `All`.
- Changed files: `model/site_rpm_snapshot.go`, `model/main.go`, `controller/analytics.go`, `router/api-router.go`, `main.go`, `web/src/pages/SiteRPM/index.jsx`, `ToDos.md`.
- Test results: `cd web && bun install && bun run build` passed; `go build ./...` passed; `go test ./...` passed.

### 2026-03-17 — Subscription plan promo highlights (multi-line)
- Goal: allow admins to configure multiple subscription selling points per plan and render them as a bullet list in `/console/topup`.
- Approach: add `promo_highlights` (newline-separated text) to `SubscriptionPlan`, validate max 5 non-empty lines on admin create/update, and include the field in `TranslateContent("plan", ...)` for non-zh locales.
- Decisions: display whenever `promo_highlights` is non-empty (no `upgrade_group` gating); empty means hidden (no default injection); backend enforces max 5 lines.
- Changed files: `model/subscription.go`, `controller/subscription.go`, `web/src/components/topup/SubscriptionPlansCard.jsx`, `web/src/components/table/subscriptions/modals/AddEditSubscriptionModal.jsx`, `web/src/types/api.ts`.
- Test results: `bun run build` passed (after `bun install`); `go test ./...` blocked in this worktree by unrelated compile errors (missing `web/dist` embed + missing `model.Is*IdAlreadyTaken`).

### 2026-03-16 — Invoice frontend MVP (user + admin pages)

### 2026-03-13 — Ticket attachment preview modal + safe presigned downloads
- Goal: replace direct attachment downloads with in-page preview modal, add explicit download button, enforce safe random filenames in presigned URLs, and display fixed disclaimer about ticket scope.
- Approach: backend extended presign endpoints to accept `disposition` query param (inline/attachment) and generate `Content-Disposition` headers with 12-char base62 random filenames + sanitized extensions via AWS SDK v2 response overrides; frontend replaced `window.open` with preview Modal showing image + download button, added disclaimer Banner near attachments, and wired i18n keys across 6 locales.
- Decisions: disposition defaults to inline, invalid values fallback to inline; random filename uses `crypto/rand` base62 (0-9A-Za-z) to prevent original filename leakage; extension validation allows only `/^\.[A-Za-z0-9]{1,10}$/`; preview modal and detail modal are sibling components to avoid JSX nesting issues; disclaimer uses simple wording per user preference.
- Changed files: `controller/ticket.go`, `controller/ticket_admin.go`, `service/ticket_service.go`, `service/ticket_storage/s3.go`, `web/src/hooks/ticket/useTicketUserData.js`, `web/src/hooks/ticket/useTicketAdminData.js`, `web/src/pages/TicketsUser/index.jsx`, `web/src/pages/TicketsAdmin/index.jsx`, 6 locale JSON files (`web/src/i18n/locales/{en,zh,fr,ja,ru,vi}.json`), `ToDos.md`, `CLAUDE.md`.
- Test results: `go test ./...` passed (all packages with tests); `bun run build` passed.
- Follow-ups: manual verification with `curl -I` on presigned URLs to confirm `Content-Disposition` headers and random filenames; browser testing of preview modal, download button, and disclaimer display.

### 2026-03-09 — Wallet topup view switch and subscription grouping UI
- Goal: add a page-level switch between subscription and recharge flows while making subscription browsing clearer with family tabs and folded history, without changing any billing or payment logic.
- Approach: kept the existing recharge/subscription props and modal handlers intact, replaced the two-column topup layout with a segmented single-surface view switch, split subscription history into active and expired sections, filtered plans by weekly/monthly/other duration families, and upgraded the popular badge into a ribbon treatment via topup theme styles.
- Changed files: `web/src/components/topup/index.jsx`, `web/src/components/topup/SubscriptionPlansCard.jsx`, `web/src/components/topup/topup-theme.css`, `CLAUDE.md`.
- Test results: pending verification.

### 2026-03-08 — Wallet /console/topup UI redesign
- Goal: redesign the user wallet management page at `/console/topup` into a cleaner, more premium layout without changing any existing business logic.
- Approach: kept all existing data fetching, payment, redemption, invitation, transfer, and subscription flows intact while restructuring the page into a summary hero, a primary subscription area, and a secondary recharge/invitation sidebar; refreshed the three topup subcomponents with a unified low-saturation card system and clearer information hierarchy.
- Decisions: scope stayed limited to the user-side wallet page (`/console/topup`), not the admin subscription page; reused existing modal/payment flows and formatting helpers instead of introducing new business abstractions; only changed UI/layout/presentation.
- Changed files: `web/src/components/topup/index.jsx`, `web/src/components/topup/RechargeCard.jsx`, `web/src/components/topup/SubscriptionPlansCard.jsx`, `web/src/components/topup/InvitationCard.jsx`, `CLAUDE.md`, `VERSIONS.md`.
- Test results: `cd /home/bigdata/lmy/CaMeL-api/web && bun run build` passed.
- Follow-ups: verify `/console/topup` in browser for subscription purchase, online recharge, redemption code, billing modal, invitation link copy, transfer flow, and responsive layout.

### 2026-03-08 — SmartCache frontend channel discount display alignment
- Goal: align usage-log SmartCache row display with the backend `channel_ratio < 1` savings semantics for cached requests only.
- Approach: kept the frontend savings helper aligned with backend row semantics by preferring logged row `quota/channel_ratio` reconstruction for channel discount and falling back to token-based recovery only when the logged quota is unavailable; updated usage-log input/cost call sites to pass row quota and switched the tooltip label to the existing `渠道优惠` locale key.
- Decisions: keep non-cached rows at zero savings even if `channel_ratio < 1`; input hint derives from `channelSavingsQuota / baseInputRatio` and rounds to the nearest token equivalent; `cache_ratio == 0` remains valid and only negative values are treated as invalid.
- Changed files: `web/src/helpers/render.jsx`, `web/src/components/table/usage-logs/UsageLogsColumnDefs.jsx`, `CLAUDE.md`, `VERSIONS.md`.
- Test results: `cd /home/bigdata/lmy/CaMeL-api/web && bun run build` passed.
- Follow-ups: verify in browser that cached discounted rows show the green hint, channel-discount tooltip label, and widened struck-through original cost.

### 2026-03-08 — SmartCache savings include channel discount
- Goal: extend backend SmartCache savings aggregation so cached requests also count `channel_ratio < 1` discount while leaving non-cached requests unchanged.
- Approach: replaced the `other`-only helper in `model/log.go` with a log-aware helper that reuses `quota`, `prompt_tokens`, `completion_tokens`, and `other` JSON; existing cache savings remains `cache_tokens * base_input_ratio * (1 - cache_ratio)`, and cached logs additionally include `full_quota_before_channel_discount * (1 - channel_ratio)` when `channel_ratio` is between 0 and 1.
- Decisions: keep the savings queries scoped to consume logs containing `cache_tokens`; only count channel discount when `cache_tokens > 0`; prefer reconstructing the pre-discount quota from logged `quota/channel_ratio`, with a token-based fallback if quota is zero.
- Changed files: `model/log.go`, `CLAUDE.md`, `VERSIONS.md`.
- Test results: `go build ./...` passed.
- Follow-ups: verify a cached request on a discounted channel shows combined SmartCache + channel savings in log stats and `/api/log/*/cache_savings` responses.

### 2026-03-08 — Channel-specific billing ratio (channel_ratio + model_ratio_override)
- Goal: allow admins to set per-channel billing multipliers and per-model ratio overrides.
- Approach: store `channel_ratio` (float64) and `model_ratio_override` (map[string]float64) in the channel `setting` JSON via `ChannelSettings` DTO; add `OriginalModelRatio` to `PriceData` for retry safety; apply overrides via `ApplyChannelBillingOverrides()` called after `InitChannelMeta()` in all 11 relay handlers (16 call sites); extend non-compatible settlement paths (`PostClaudeConsumeQuota`, `PostWssConsumeQuota`, `PostAudioConsumeQuota`) to apply `OtherRatios`; log `channel_ratio` and `model_ratio_override` in usage log `other` JSON.
- Decisions: `channel_ratio` default 0 means not active (equivalent to 1.0); `model_ratio_override` checked against `OriginModelName` (user-requested model); channel ratio uses `AddOtherRatio` mechanism; both fields admin-only, not exposed to users.
- Changed files: `dto/channel_settings.go`, `types/price_data.go`, `relay/helper/price.go`, `relay/compatible_handler.go`, `relay/claude_handler.go`, `relay/websocket.go`, `relay/gemini_handler.go`, `relay/responses_handler.go`, `relay/embedding_handler.go`, `relay/audio_handler.go`, `relay/image_handler.go`, `relay/rerank_handler.go`, `relay/relay_task.go`, `relay/mjproxy_handler.go`, `service/quota.go`, `service/log_info_generate.go`, `web/src/components/table/channels/modals/EditChannelModal.jsx`, 6 locale JSON files.
- Test results: `go build ./...` passed; `bun run build` passed.
- Follow-ups: verify in browser — edit channel → set channel_ratio=1.5 → send request → check log quota multiplied by 1.5; set model_ratio_override → verify override applied; confirm user side doesn't see these settings.

### 2026-03-08 — Configurable cache billing mode semantics
- Goal: merge the feature/calc worktree cache billing semantics work into main and complete the missing frontend channel settings UI.
- Approach: copied the backend worktree changes for cache billing mode helpers and settlement logic, then added a channel modal select to persist `cache_billing_mode` inside `setting` JSON with locale copy across all supported languages.
- Decisions: `auto` follows upstream semantics (`Anthropic => exclusive`, others => inclusive); `inclusive` means `prompt_tokens` already includes cached tokens so settlement subtracts them before weighted cache pricing is added back; `exclusive` means no cached-token subtraction. Consume logs now record both configured mode and effective settlement semantic.
- Changed files: `dto/channel_settings.go`, `service/cache_billing.go`, `relay/compatible_handler.go`, `service/quota.go`, `service/log_info_generate.go`, `web/src/components/table/channels/modals/EditChannelModal.jsx`, `web/src/i18n/locales/en.json`, `web/src/i18n/locales/zh.json`, `web/src/i18n/locales/fr.json`, `web/src/i18n/locales/ja.json`, `web/src/i18n/locales/ru.json`, `web/src/i18n/locales/vi.json`, `CLAUDE.md`, `VERSIONS.md`.
- Test results: pending verification (`go build ./...`, `bun run build`).
- Follow-ups: verify edit/save round-trip in the channel modal and validate inclusive/exclusive settlement against representative provider usage payloads.

### 2026-03-07 — Usage logs SmartCache savings alignment
- Goal: align usage log SmartCache savings display with backend stats and fix per-row original cost rendering.
- Approach: remove page-level savings aggregation from the logs hook, read `smartcache_savings_quota` from the existing stat payload in the actions bar, and centralize SmartCache savings calculation/3-decimal formatting in frontend helpers using the backend-equivalent formula `cache_tokens * model_ratio * effective_group_ratio * (1 - cache_ratio)`.
- Decisions: savings tag label switches between "本日已节约" and "所选时间已节约" based on the active date range; row cost keeps subscription deduction behavior while computing `savedQuota` from `record.other` with `user_group_ratio` preferred over `group_ratio`, then restores `originalQuota = record.quota + savedQuota`.
- Changed files: `web/src/hooks/usage-logs/useUsageLogsData.jsx`, `web/src/components/table/usage-logs/UsageLogsActions.jsx`, `web/src/components/table/usage-logs/UsageLogsColumnDefs.jsx`, `web/src/helpers/render.jsx`, 6 locale JSON files, `CLAUDE.md`, `VERSIONS.md`.
- Test results: `bun run build` passed.
- Follow-ups: verify savings tag wording and strikethrough original price in browser across today/custom date filters.

### 2026-03-07 — Dashboard SmartCache badge today-stat fix
- Goal: make the dashboard SmartCache badge reflect today's unified backend savings stat, stay visible whenever savings exist, and show 3-decimal precision.
- Approach: kept the existing `/api/log/self/cache_savings` endpoint but now request it with explicit start/end timestamps for the current day, then render the badge amount with `renderQuota(..., 3)` while preserving the existing SmartCache navigation click handler.
- Decisions: adapted conservatively to the current endpoint shape by only adding optional query params; kept badge visibility tied to successful savings payload plus `total_savings_quota > 0`; left the dedicated SmartCache page untouched because the requested scope was dashboard-only.
- Changed files: `web/src/hooks/dashboard/useDashboardData.js`, `web/src/components/dashboard/DashboardHeader.jsx`, `CLAUDE.md`, `VERSIONS.md`.
- Test results: `bun run build` passed.
- Follow-ups: verify in the browser that the dashboard badge appears for users with today's cache savings and still routes to `/console/smart-cache`.

### 2026-03-07 — SmartCache savings backend quota fix
- Goal: fix SmartCache savings to use the real per-log cached-input discount and expose the aggregate in log stats.
- Approach: replaced the old derived formula with a shared helper that parses log `other` JSON and computes `cache_tokens * base_input_ratio * (1 - cache_ratio)`, preferring `user_group_ratio` when present.
- Decisions: reuse the same helper for `/api/log/self/cache_savings`, `/api/log/cache_savings`, and `SumUsedQuota`; keep savings scoped to consume logs that actually record cache tokens; expose `smartcache_savings_quota` in admin/self log stats responses.
- Changed files: `model/log.go`, `controller/log.go`, `CLAUDE.md`, `VERSIONS.md`.
- Test results: `go build ./...` passed.
- Follow-ups: verify frontend consumers read the new stats field if needed.

### 2026-03-07 — Purchase analytics heatmap one-year view
- Goal: extend subscription heatmap to show one year forward from today with month labels, independent of date picker.
- Approach: backend increased max duration from 90 to 400 days; frontend uses fixed range (today -30 to +365) for heatmap API, fills missing dates, and renders month labels above columns.
- Decisions: heatmap range is now decoupled from the top date picker; frontend fills gaps with empty entries (subscription_count=0, is_future flag set correctly); month labels appear at first week of each month; cell size reduced to 11px/2px-gap to fit ~57 weeks.
- Changed files: `model/purchase_analytics.go`, `web/src/hooks/purchase-analytics/usePurchaseAnalyticsData.js`, `web/src/pages/PurchaseAnalytics/index.jsx`.
- Test results: go build ./... passed; bun run build passed.
- Follow-ups: verify heatmap renders correctly in browser with one-year range and month labels.

### 2026-03-07 — Purchase analytics data accuracy & UI overhaul
- Goal: fix three backend statistical accuracy issues (conversion funnel, referral analytics, DAU) and two frontend interaction changes (charts→tables, plan hover→heatmap filter).
- Backend changes:
  - GetConversionFunnel: total_users = users.status=1 (no time filter); paying_users = union distinct user_id from top_ups + subscription_orders; repeat_buyers = combined count >= 2 across both sources.
  - GetReferralAnalytics: uses users.inviter_id (not aff_rebate_logs); aggregates topup and subscription revenue separately by invitee with time filter on complete_time; combines by inviter in Go; batch loads usernames; sorts by revenue desc then count desc.
  - GetDAUTrend: total_active_users is true union distinct count per bucket via Go-side set merging.
  - GetSubscriptionHeatmap: added planID parameter with optional WHERE plan_id filter; controller reads plan_id query param.
- Frontend changes:
  - Replaced order type, payment method, and top spenders charts with paginated tables (10 rows) in all three tabs.
  - Added plan hover interaction: hovering a plan row in subscription tab triggers heatmap-only refresh for that plan; mouse leave restores all-plans view.
  - Heatmap title reflects hovered plan name or "All Plans".
  - Removed paymentPieSpec/orderBarSpec/topUsersSpec from charts hook; only trendSpec/dauSpec/registrationSpec remain.
  - Isolated heatmapPlanId from loadAllData deps to prevent full reload on hover.
- Changed files: `model/purchase_analytics.go`, `controller/purchase_analytics.go`, `web/src/pages/PurchaseAnalytics/index.jsx`, `web/src/hooks/purchase-analytics/usePurchaseAnalyticsData.js`, `web/src/hooks/purchase-analytics/usePurchaseAnalyticsCharts.js`.
- Test results: go build ./... passed; bun run build passed.
- Follow-ups: verify data accuracy against live DB; test plan hover interaction in browser.

### 2026-03-07 — Purchase analytics frontend marketing analytics
- Goal: add marketing analytics to the PurchaseAnalytics all-orders tab using the approved DAU, registrations, conversion, and referral API shapes.
- Approach: extend the existing purchase analytics data hook and chart hook with defensive defaults, then render the new all tab sections while leaving subscription and top-up analytics intact.
- Decisions: reused existing purchase analytics and affTransfer translation keys where available, fell back to plain table labels for missing marketing-specific headings, and paginated the referral leaderboard locally so rank stays correct across pages. Preserved existing heatmap, formatHeatmapAmount, top-spender pagination, and payment method tables in subscription/topup tabs.
- Changed files: `web/src/hooks/purchase-analytics/usePurchaseAnalyticsData.js`, `web/src/hooks/purchase-analytics/usePurchaseAnalyticsCharts.js`, `web/src/pages/PurchaseAnalytics/index.jsx`, `VERSIONS.md`.
- Test results: not run in this task.
- Follow-ups: verify the new charts against live backend payloads and run frontend lint/build if needed.

### 2026-03-07 — Purchase analytics frontend marketing analytics
- Goal: add marketing analytics to the PurchaseAnalytics all tab using the approved DAU, registrations, conversion, and referral API shapes.
- Approach: extend the purchase analytics data and chart hooks, then render a marketing analytics section in the all tab while keeping subscription and top-up analytics behavior unchanged.
- Decisions: used exact backend fields (`time_bucket`, `api_active_users`, `login_active_users`, `total_active_users`, `new_users`, `referred_users`, `total_users`, `paying_users`, `repeat_buyers`, `conversion_rate`, `repeat_rate`, `inviter`, `referred_count`, `referred_revenue`); referral leaderboard uses client-side pagination so rank stays correct; surfaced the registrations best-effort caveat inline.
- Changed files: `web/src/hooks/purchase-analytics/usePurchaseAnalyticsData.js`, `web/src/hooks/purchase-analytics/usePurchaseAnalyticsCharts.js`, `web/src/pages/PurchaseAnalytics/index.jsx`, `CLAUDE.md`, `VERSIONS.md`.
- Test results: not run in this task.
- Follow-ups: run frontend lint/build and verify charts against live backend data if needed.

### 2026-03-07 — Detect and retry empty upstream responses
- Goal: detect upstream LLM responses that return HTTP 200 but contain no actual content (empty choices, empty content arrays, structural-only streaming chunks) and trigger automatic retry on a different channel.
- Approach: add empty response checks in each provider handler's non-streaming and streaming paths, returning 502 errors with `ErrorCodeEmptyResponse` so the existing retry logic retries on a different channel.
- Changes:
  - **OpenAI non-stream** (`OpenaiHandler`): return error when `Choices` is empty.
  - **OpenAI stream** (`OaiStreamHandler`): after zero-chunk check, detect when chunks were received but no meaningful content (text/reasoning/tool_calls) was produced; parse `lastStreamData` to avoid false positives.
  - **Claude non-stream** (`HandleClaudeResponseData`): return error when `Content` is empty and `StopReason` is set (completed but empty).
  - **Claude stream** (`ClaudeStreamHandler`): added `HasToolUse` field to `ClaudeResponseInfo`; detect empty `ResponseText` with no tool use; only retry if nothing sent to client yet, else log warning.
  - **Gemini non-stream** (`GeminiChatHandler`): changed empty candidates status from 500→502 for retryability; removed direct `c.JSON()` write and return `newAPIError` so controller can retry.
  - **Gemini stream** (`geminiStreamHandler`): added zero-chunk check (`ReceivedResponseCount == 0`).
- Changed files: `relay/channel/openai/relay-openai.go`, `relay/channel/claude/relay-claude.go`, `relay/channel/gemini/relay-gemini.go`.
- Test results: `go build ./...` passed; `go test ./...` passed (all 4 test packages OK).
- Follow-ups: verify with live traffic; test tool-call-only responses don't false-positive; verify Gemini blocked-prompt responses still render correctly after removing direct `c.JSON()`.

### 2026-03-06 — Purchase analytics backend marketing endpoints
- Goal: add backend marketing analytics endpoints for DAU, registrations, conversion funnel, and referral analytics under the purchase analytics API.
- Approach: add query/model functions in `model/purchase_analytics.go`, expose handlers in `controller/purchase_analytics.go`, and register admin routes in `router/api-router.go`.
- Decisions: use best-effort proxy sources for registrations because `users` has no registration timestamp; `new_users` comes from system logs matching `新用户注册赠送%`, and `referred_users` comes from `aff_rebate_logs` register records. DAU combines API consume logs and login IP records, while referral revenue sums successful non-subscription top-ups from referred users.
- Changed files: `model/purchase_analytics.go`, `controller/purchase_analytics.go`, `router/api-router.go`, `CLAUDE.md`, `VERSIONS.md`.
- Test results: not run in this task.
- Follow-ups: frontend should consume the new endpoints and surface the registration caveat if exact registration counts are required.

### 2026-03-06 — Purchase analytics i18n additions
- Goal: add missing purchase analytics marketing, DAU, conversion, and referral translation keys across all supported locales.
- Approach: extend the existing `purchaseAnalytics.*` locale sections in `web/src/i18n/locales/{en,zh,fr,ja,ru,vi}.json` with the exact new keys requested by the frontend task.
- Decisions: kept key names identical across locales and used concise labels matching each locale's existing analytics wording.
- Changed files: `web/src/i18n/locales/en.json`, `web/src/i18n/locales/zh.json`, `web/src/i18n/locales/fr.json`, `web/src/i18n/locales/ja.json`, `web/src/i18n/locales/ru.json`, `web/src/i18n/locales/vi.json`.
- Test results: not run in this task.
- Follow-ups: wire these keys into the pending PurchaseAnalytics marketing UI once frontend task #4 lands.

### 2026-03-06 — Purchase analytics frontend fixes
- Goal: fix PurchaseAnalytics heatmap tooltip quota display and top spender ranking pagination behavior.
- Approach: convert heatmap quota values to display currency with `quota_per_unit`, and keep spender table page state so rank reflects the active page while resetting on tab changes.
- Decisions: reused existing `renderQuotaWithAmount` formatting and kept changes scoped to `web/src/pages/PurchaseAnalytics/index.jsx`.
- Changed files: `web/src/pages/PurchaseAnalytics/index.jsx`.
- Test results: not run in this task.
- Follow-ups: verify tooltip and ranking behavior in the browser if needed.

### 2026-03-07 — SmartCache savings display feature
- Goal: show SmartCache cache savings in dashboard header, usage logs, and a dedicated SmartCache info page.
- Approach: backend API aggregates savings from log `other` JSON; frontend displays savings in dashboard header (gradient badge), usage logs (strikethrough original price + savings tag), and a new SmartCache page.
- Backend changes:
  - `model/log.go`: added `CacheSavingsResult` struct, `GetUserCacheSavings`/`GetAllCacheSavings`/`getCacheSavings` functions (query logs with `type=2` and `cache_tokens`, parse JSON, compute `savings = cacheTokens * cacheRatio * modelRatio * groupRatio * 0.9`), and `getFloat64FromMap` helper.
  - `controller/log.go`: added `GetCacheSavingsSelf` (user) and `GetCacheSavingsStat` (admin) handlers.
  - `router/api-router.go`: registered `/self/cache_savings` (UserAuth) and `/cache_savings` (AdminAuth) routes.
- Frontend changes:
  - Dashboard header: added emerald gradient SmartCache badge with glow animation, linking to `/console/smart-cache`. Data fetched via `useDashboardData` hook calling `GET /api/log/self/cache_savings`.
  - Usage logs columns: removed `(creation)` from input column display; added strikethrough original price in cost column when cache savings exist.
  - Usage logs actions: added green savings tag next to TPM showing page-level savings.
  - SmartCache page: new `web/src/pages/SmartCache/index.jsx` with hero, how-it-works, savings explanation, user stats, and supported models sections.
  - App.jsx: added lazy import and `/console/smart-cache` PrivateRoute.
- i18n: added 17 SmartCache-related keys to all 6 locales (en, zh, fr, ja, ru, vi).
- Changed files: `model/log.go`, `controller/log.go`, `router/api-router.go`, `web/src/App.jsx`, `web/src/pages/SmartCache/index.jsx` (new), `web/src/components/dashboard/DashboardHeader.jsx`, `web/src/components/dashboard/index.jsx`, `web/src/hooks/dashboard/useDashboardData.js`, `web/src/components/table/usage-logs/UsageLogsActions.jsx`, `web/src/components/table/usage-logs/UsageLogsColumnDefs.jsx`, `web/src/hooks/usage-logs/useUsageLogsData.jsx`, 6 locale JSON files.
- Test results: `go build ./...` passed; `bun run build` passed.
- Follow-ups: verify in browser — dashboard badge, SmartCache page, usage log strikethrough prices and savings tag.
