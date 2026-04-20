# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CaMeL-api is a next-generation LLM gateway and AI asset management system. It provides a unified relay proxy for 40+ AI model providers (OpenAI, Claude, Gemini, DeepSeek, etc.) with user/token/quota management, billing, and a React dashboard.

**Go module path:** `github.com/QuantumNous/new-api`

## Build & Run Commands

### Backend (Go 1.22.4)
```bash
# Go binary location on this machine
"/c/Program Files/Go/bin/go.exe" build ./model/... ./controller/... ./middleware/... ./service/... ./router/... ./relay/...

# Full build requires web/dist (frontend build output). For backend-only work, use package-specific builds above.
go build -ldflags "-s -w -X 'github.com/QuantumNous/new-api/common.Version=$(cat VERSION)'" -o new-api

# Run dev server
go run main.go

# Run tests
go test ./...
go test ./common/...          # single package
go test ./unit_test/ -run TestTenant -v   # tenant isolation tests
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
docker build --no-cache -t camel-api:v2.6.MMDD .
docker save camel-api:v2.6.MMDD | gzip > camel-api_v2.6.MMDD.tar.gz
bash scripts/deploy-test.sh camel-api_v2.6.MMDD.tar.gz
```

**Version format:** `v2.6.MMDD` (e.g., v2.6.0222 for Feb 22)

## Architecture

### Request Flow
```
Client → Gin Router → TenantResolve → Middleware (auth, rate-limit, CORS) → Controller → Service → Model/Relay → Provider API
```

### Key Layers

| Layer | Directory | Purpose |
|-------|-----------|---------|
| **Entry** | `main.go` | Init sequence: env → logger → DB → Redis → i18n → OAuth → router → server |
| **Router** | `router/` | `api-router.go` (`/api/*`), `relay-router.go` (`/v1/*` OpenAI-compatible), `web-router.go` (frontend) |
| **Middleware** | `middleware/` | Tenant resolution, auth (session/token/API key), rate limiting, CORS |
| **Controller** | `controller/` | HTTP handlers for users, tokens, channels, billing, OAuth, relay |
| **Service** | `service/` | Business logic: billing, quota, channel selection, token counting |
| **Model** | `model/` | GORM entities + DB operations + caching. Supports SQLite/MySQL/PostgreSQL |
| **Relay** | `relay/` | LLM provider integration. `relay/channel/` has per-provider adaptors |
| **DTO** | `dto/` | Request/response data transfer objects for each provider format |
| **Common** | `common/` | Shared utilities, constants, Redis client, rate limiter, env config |
| **Settings** | `setting/` | Config modules: pricing ratios, model settings, performance tuning |

### Relay System (core feature)
- `relay/relay_adaptor.go` — main adaptor that routes to provider-specific handlers
- `relay/channel/` — per-provider implementations (openai, claude, gemini, ali, baidu, aws, etc.)
- Format handlers: `compatible_handler.go` (OpenAI), `claude_handler.go`, `gemini_handler.go`
- Channel selection: `service/channel_select.go` (weighted random, priority-based, tenant-scoped)

### Frontend
- React 18 + Vite + Semi Design UI + Tailwind CSS
- Source in `web/src/`, built output embedded into Go binary via `//go:embed web/dist`
- i18n via i18next (6 locales: en, zh, fr, ja, ru, vi)

## Multi-Tenant Architecture (Phase 1)

The system is being converted to SaaS multi-tenancy. Phase 1 establishes tenant isolation for the core relay hot path.

### Tenant-Scoped Tables (Phase 1)
`users`, `tokens`, `channels`, `abilities`, `logs` — all have `tenant_id` column (default: 1).

### Platform-Global Tables
`options`, `subscription_plans`, static model/provider metadata, setup tables.

### Key Files
| File | Purpose |
|------|---------|
| `model/tenant.go` | Tenant model, DefaultTenantId=1, slug/id lookup with cache |
| `model/tenant_scope.go` | `TenantIDFromContext()`, `TenantDB()`, `TenantLOGDB()`, `ApplyTenantScope()`, `BypassTenant()`, GORM callbacks |
| `middleware/tenant.go` | `TenantResolve()` middleware, `GetTenantId()` helper |

### Tenant Request Flow
1. `TenantResolve` reads `X-Tenant-Id` header or subdomain, sets `tenant_id` in both `gin.Context` and `c.Request.Context()`
2. Auth middleware validates session/access-token/API-token belongs to resolved tenant
3. Model helpers read tenant from context via `TenantIDFromContext(ctx)`
4. Channel cache keys are `tenantId:group` composite format
5. Log writes include `tenant_id` via `RecordLogCtx(c, ...)` or `RecordLogWithTenant(tenantId, ...)`

### Tenant-Aware Coding Patterns
```go
// In controller (has gin.Context):
tenantId := middleware.GetTenantId(c)
model.RecordLogCtx(c, userId, model.LogTypeSystem, "...")
model.GetGroupEnabledModels(group, tenantId)
model.SumUsedQuota(..., tenantId)

// In model (has context.Context from c.Request.Context()):
tenantId := TenantIDFromContext(ctx)
q = q.Where("tenant_id = ?", tenantId)

// For migrations/bootstrap/super-admin (bypass tenant):
model.WithTenantBypass(db).Create(&record)
```

### GORM Callback Contract
- **Create**: auto-fill `tenant_id` from context, then **fail-closed** if still 0 (blocks insert)
- **Query/Update/Delete**: warn-only (logs when tenant-scoped table accessed without `tenant_id` in WHERE)
- Callbacks do NOT cover `DB.Raw()`, `DB.Exec()`, or `DB.Table()` paths — those must be explicitly scoped

## Key Patterns

### Sidebar Module Visibility
When adding new sidebar items, register the module in `web/src/hooks/common/useSidebar.js` → `DEFAULT_ADMIN_CONFIG`:
```javascript
admin: {
  newModule: true,  // Must add this or isModuleVisible() returns false
}
```
Required config points: `routerMap`, `adminItems`/`financeItems`, `render.jsx` → `getLucideIcon()`, `DEFAULT_ADMIN_CONFIG`.

### Provider Type Constants
Defined in `constant/` — each channel type has a numeric constant used throughout routing and relay logic.

### Database Models
GORM with optional Redis caching; cache sync runs on configurable interval (`SYNC_FREQUENCY`). New models added to `model/main.go` → `migrateDB()`.

### Middleware Chain
- API routes: `TenantResolve` → `GlobalAPIRateLimit` → gzip
- Relay routes: `TenantResolve` → `TokenAuth` → CORS → decompression
- Relay auto-detects provider format via headers (e.g., `x-api-key` + `anthropic-version` → Claude)

## Important Rules (from AGENTS.md)

1. **JSON**: Use `common.Marshal/Unmarshal/DecodeJson` — never import `encoding/json` directly in business code.
2. **DB Compatibility**: All code must work on SQLite, MySQL, and PostgreSQL simultaneously. Use `commonGroupCol`/`commonKeyCol` for reserved words. Use `commonTrueVal`/`commonFalseVal` for booleans.
3. **Frontend**: Use `bun` as package manager (not npm/yarn/pnpm).
4. **Upstream DTOs**: Optional scalar fields must use pointer types with `omitempty` to preserve explicit zero values.
5. **Protected Info**: Never modify/remove references to the project name or organization identity.

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
- `unit_test/tenant_test.go` — tenant resolution, context propagation, struct field tests

New unit tests should go under `unit_test/` at project root.

## Frontend Type Definitions

Centralized TypeScript types matching backend Go models are in `web/src/types/`:
- `api.ts` — All API response types (User, Token, Log, Message, Subscription, Channel, etc.)
- `index.ts` — Re-exports API types + frontend-specific UI types

Key type mappings: Go `int64` → TS `number`, Go `*string` → TS `string | undefined`, Go `gorm.DeletedAt` → omitted.

When adding new backend models, update `web/src/types/api.ts` accordingly.

## Task Log

See [VERSIONS.md](./VERSIONS.md) for detailed change history.
