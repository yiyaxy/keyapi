# AI Tools — LobeHub 二开文档

基于 [lobe-chat](https://github.com/lobehub/lobe-chat) 二次开发的 AI 工具平台。  
对接自有 **new-api** 后端，用户从应用广场跳转后自动登录，无需注册，无需手动输入 API Key。

---

## 目录

- [架构概览](#架构概览)
- [本地开发](#本地开发)
- [一键调试登录](#一键调试登录)
- [常用命令](#常用命令)
- [环境变量说明](#环境变量说明)
- [二开改动索引](#二开改动索引)
- [生产部署](#生产部署)
- [常见问题](#常见问题)

---

## 架构概览

```
用户浏览器
  │
  ├─ web-next（应用广场）
  │      │  点击「使用」→ 生成 sk-token
  │      └─ 跳转 /api/auth/token-login?token=sk-xxx&settings={keyVaults:{...}}
  │
  └─ LobeHub（本项目，apps/lobehub）
         │  验证 token → 反查 new-api 用户 → 自动建账号 → 创建 session
         └─ 重定向到 / 并注入 API Key，用户直接进入聊天界面
```

**服务依赖（本地 Docker）**

| 服务 | 端口 | 用途 |
|---|---|---|
| PostgreSQL | 5432 | 用户数据、会话、聊天记录 |
| Redis | 6380 | 会话缓存（避免与系统 Redis 冲突） |
| RustFS (S3) | 9000 | 文件/图片上传存储 |
| SearXNG | 8180 | AI 联网搜索 |

---

## 本地开发

### 前置要求

| 工具 | 版本 | 说明 |
|---|---|---|
| Node.js | 见 `.nvmrc`（lts/krypton） | 推荐 nvm 管理 |
| pnpm | 10.x | `npm i -g pnpm` |
| Bun | 最新版 | 部分构建脚本使用 |
| Docker Desktop | 最新版 | 启动本地基础服务 |

### 第一步：安装依赖

```bash
cd apps/lobehub
pnpm install
```

### 第二步：创建 Docker 服务配置

在 `docker-compose/dev/` 目录下创建 `.env`（**不提交到 git**）：

```ini
# docker-compose/dev/.env

LOBE_PORT=3210
RUSTFS_PORT=9000

LOBE_DB_NAME=lobechat
POSTGRES_PASSWORD=lobe_dev_password

RUSTFS_ACCESS_KEY=admin
RUSTFS_SECRET_KEY=lobe_dev_password

S3_ENDPOINT=http://localhost:9000
RUSTFS_LOBE_BUCKET=lobe
```

> **Redis 端口冲突**：如果 6379 被占用，已将 docker-compose.yml 中 Redis 映射改为 `6380:6379`，应用 `.env` 中对应设置 `REDIS_URL=redis://localhost:6380`。

### 第三步：创建应用环境变量

在 `apps/lobehub/` 根目录创建 `.env`（**不提交到 git**）：

```ini
# ── 应用地址 ──────────────────────────────────────
APP_URL=http://localhost:3010

# ── AI 接口（对接自有 new-api）────────────────────
# fallback key：用户未携带 token 直接访问时使用
OPENAI_API_KEY=<your-fallback-api-key>
# new-api 的 OpenAI 兼容接口（/v1 结尾，不带斜杠）
OPENAI_PROXY_URL=https://<your-new-api-domain>/v1
# new-api 根地址（token-login 反查用户身份用）
NEW_API_BASE_URL=https://<your-new-api-domain>

# 可选：限制可用模型，逗号分隔
# OPENAI_MODEL_LIST=gpt-4o,gpt-4o-mini,claude-3-5-sonnet-20241022

# ── 安全密钥 ──────────────────────────────────────
# 用于加密存储的 API Key，生成命令：openssl rand -base64 32
KEY_VAULTS_SECRET=<your-32-byte-base64-secret>

# ── 数据库 ────────────────────────────────────────
DATABASE_URL=postgresql://postgres:lobe_dev_password@localhost:5432/lobechat
DATABASE_DRIVER=node

# ── Redis ─────────────────────────────────────────
REDIS_URL=redis://localhost:6380
REDIS_PREFIX=lobechat
REDIS_TLS=0

# ── 本地开发专用：跳过 tRPC 认证 ─────────────────
# 生产环境绝对不能开启
ENABLE_MOCK_DEV_USER=1
MOCK_DEV_USER_ID=dev_local_user

# ── 其他 ──────────────────────────────────────────
TELEMETRY_DISABLED=1
ENABLED_CSP=0
```

### 第四步：启动基础服务

```bash
pnpm dev:docker
```

等待输出 `healthy` 后继续（首次拉镜像较慢，约 1~3 分钟）。

### 第五步：初始化数据库

**首次运行必须执行**，之后上游有 schema 变更时也需重跑：

```bash
pnpm db:migrate
```

### 第六步：启动开发服务器

```bash
pnpm dev
```

访问 [http://localhost:3010](http://localhost:3010)

---

## 一键调试登录

本地开发时没有真实的应用广场 token，使用专用接口快速创建测试账号并登录：

```
浏览器访问：http://localhost:3010/api/auth/dev-login
```

- 自动创建 `dev_local_user` 账号（`dev@local.dev`）
- 写入 30 天有效的 session cookie
- 重定向到首页，直接进入已登录状态

**退出**：在浏览器开发者工具 → Application → Cookies 中删除 `better-auth.session_token`。

> 此接口在 `NODE_ENV !== 'development'` 时直接返回 404，生产环境安全。

---

## 常用命令

| 命令 | 说明 |
|---|---|
| `pnpm dev` | 启动完整开发服务（Next.js 3010 + Vite SPA 9876） |
| `pnpm dev:next` | 仅启动 Next.js 服务 |
| `pnpm dev:spa` | 仅启动 Vite SPA 服务 |
| `pnpm dev:docker` | 启动所有 Docker 依赖服务 |
| `pnpm dev:docker:down` | 停止 Docker 依赖服务 |
| `pnpm dev:docker:reset` | ⚠️ 清空数据库并重置（**数据不可恢复**） |
| `pnpm db:migrate` | 运行数据库 schema 迁移 |
| `pnpm build` | 生产构建 |

---

## 环境变量说明

### 必填项

| 变量 | 说明 |
|---|---|
| `APP_URL` | 应用公网地址，生产填域名（含 `https://`） |
| `OPENAI_API_KEY` | 默认 fallback key，用于匿名访问 |
| `OPENAI_PROXY_URL` | new-api 的 OpenAI 兼容接口（`/v1` 结尾） |
| `NEW_API_BASE_URL` | new-api 根地址，token-login 反查用户用 |
| `KEY_VAULTS_SECRET` | AES 加密密钥，`openssl rand -base64 32` 生成，**生产环境切勿沿用开发密钥** |
| `DATABASE_URL` | PostgreSQL 连接串 |
| `REDIS_URL` | Redis 连接串 |

### 仅本地开发

| 变量 | 说明 |
|---|---|
| `ENABLE_MOCK_DEV_USER=1` | 跳过 tRPC 服务端认证，直接使用 mock 用户 |
| `MOCK_DEV_USER_ID` | mock 用户 ID，默认 `dev_local_user` |

### 可选项

| 变量 | 说明 |
|---|---|
| `OPENAI_MODEL_LIST` | 限制可用模型，逗号分隔 |
| `AUTH_SECRET` | BetterAuth 签名密钥（启用多用户认证时必填） |
| `S3_*` | 对象存储配置（生产启用文件上传时填写） |
| `ENABLED_CSP` | CSP 开关，嵌入 iframe 时设 `0` |
| `TELEMETRY_DISABLED` | 关闭官方遥测，建议始终设 `1` |

---

## 二开改动索引

以下是本项目相对上游 lobe-chat 的所有核心改动，方便合并上游更新时定向复查。

### 1. 去除官方认证跳转

**文件**：`src/libs/next/proxy/define-config.ts`（末尾）

```ts
// 不启用账号体系，直接使用无认证的路由重写中间件
return { middleware: defaultMiddleware };
```

上游默认返回 `betterAuthMiddleware`，会检查 session，未登录跳到 `app.lobehub.com` 认证。

---

### 2. 移除 tRPC 401 强制跳转登录页

**文件**：`src/libs/trpc/client/lambda.ts`

```ts
// 只有"之前有 session 现在失效"才跳 /signin
// 从未登录的用户（通过 ?settings= 带 key 进来）静默失败，不跳转
if (isSignedIn) {
  await logout();
  loginRequired.redirect();
}
```

上游对任何 401 都会触发 `loginRequired.redirect()`，导致直接访问的用户被强制跳转。

---

### 3. 品牌名替换

**文件**：`packages/business/const/src/branding.ts`（pnpm workspace 包，`pnpm install` 后仍保留）

```ts
export const BRANDING_NAME = 'AI Tools';
export const ORG_NAME = 'AI Tools';
export const LOBE_CHAT_CLOUD = 'AI 工具广场';
export const BRANDING_PROVIDER = 'custom';
// 社交链接、邮箱均已清空
```

---

### 4. 无感自动登录（token-login）

**新增文件**：`src/app/(backend)/api/auth/token-login/route.ts`

用户从应用广场跳转时携带 `sk-token`，此接口完成完整的登录流程：

```
GET /api/auth/token-login?token=sk-xxx&settings={"keyVaults":{"openai":{"apiKey":"sk-xxx"}}}

流程：
1. 调 new-api GET /api/app/whoami（Bearer sk-xxx）→ 获取用户 id/email
2. 以 newapi_<userId> 为 ID upsert LobeHub users 表
3. 在 auth_sessions 创建 30 天 session
4. 写 better-auth.session_token cookie
5. 302 重定向到 /?settings=...
```

降级：token 无效或 DB 异常时，跳转首页仍携带 `?settings=`，key 有效，仅无 session 持久化。

---

### 5. new-api 新增接口：WhoAmI

**文件**：`controller/app/ai_app.go`（`WhoAmI` 函数）  
**路由**：`GET /api/app/whoami`（使用 `TokenAuth` 中间件）

接收 `Authorization: Bearer sk-xxx`，通过 `token.UserId` 反查用户信息，返回：

```json
{ "id": 123, "username": "alice", "email": "alice@example.com", "display_name": "Alice" }
```

---

### 6. 应用广场跳转逻辑

**文件**：`web-next/src/pages/AppMarketplace.tsx`（`handleUse` 函数）

```ts
// 改动前：直接跳目标 URL 并注入 settings
url.searchParams.set('settings', JSON.stringify(settings));
window.location.href = url.toString();

// 改动后：先经过 token-login 完成自动登录，再注入 settings
const loginUrl = new URL('/api/auth/token-login', app.target_url);
loginUrl.searchParams.set('token', key);
loginUrl.searchParams.set('settings', JSON.stringify(settings));
window.location.href = loginUrl.toString();
```

---

### 7. 本地开发快速登录接口

**新增文件**：`src/app/(backend)/api/auth/dev-login/route.ts`

`GET /api/auth/dev-login`，仅 `NODE_ENV=development` 时可用，一键创建测试账号并写入 session cookie。

---

## 生产部署

### 基础设施要求

| 服务 | 推荐版本 |
|---|---|
| PostgreSQL | 17，推荐 `paradedb/paradedb:latest-pg17` |
| Redis | 7+ |
| 对象存储 | RustFS 或任意 S3 兼容服务 |
| 反向代理 | Nginx / Caddy（需配置 HTTPS） |
| Node.js | 与 `.nvmrc` 一致 |

### 部署步骤

**1. 准备环境变量**

基于开发 `.env` 修改，以下几项**必须**替换：

```ini
APP_URL=https://your-domain.com

# 生产密钥，重新生成，不能用开发的
KEY_VAULTS_SECRET=<openssl rand -base64 32>
AUTH_SECRET=<openssl rand -base64 32>

DATABASE_URL=postgresql://postgres:<strong-password>@<db-host>:5432/lobechat
REDIS_URL=redis://<redis-host>:6379

# 对象存储
S3_ACCESS_KEY_ID=<key>
S3_SECRET_ACCESS_KEY=<secret>
S3_ENDPOINT=https://<s3-endpoint>
S3_BUCKET=lobe
S3_ENABLE_PATH_STYLE=1
S3_SET_ACL=0

# 生产关闭 mock 和遥测
ENABLE_MOCK_DEV_USER=   # 留空或删除此行
TELEMETRY_DISABLED=1
ENABLED_CSP=1
```

**2. 构建**

```bash
cd apps/lobehub
pnpm install --frozen-lockfile
pnpm build
```

**3. 数据库迁移**

```bash
pnpm db:migrate
```

**4. 启动服务**

```bash
# 直接启动
node .next/standalone/server.js

# 或 PM2 托管
pm2 start .next/standalone/server.js --name lobehub -- --port 3010
pm2 save
```

**5. Nginx 反向代理**

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    # SSL 证书配置（acme.sh / certbot 自动申请）
    ssl_certificate     /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # 上传文件大小限制（按需调整）
    client_max_body_size 50m;

    location / {
        proxy_pass         http://127.0.0.1:3010;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }
}

server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$host$request_uri;
}
```

---

## 常见问题

**Q：启动报 `KEY_VAULTS_SECRET is not set`**  
A：检查 `apps/lobehub/.env` 是否存在且包含 `KEY_VAULTS_SECRET`，重启 dev server。

**Q：启动报 `DATABASE_URL is not set correctly`**  
A：先执行 `pnpm dev:docker` 确认 PostgreSQL 容器启动，再确认 `.env` 中的密码与 `docker-compose/dev/.env` 的 `POSTGRES_PASSWORD` 一致。

**Q：`pnpm dev:docker` 报端口占用（Redis 6379）**  
A：已将 Redis 宿主端口改为 6380，如果仍有冲突执行 `docker ps` 找到占用容器并停止，或修改 `docker-compose/dev/docker-compose.yml` 换其他端口并同步更新 `REDIS_URL`。

**Q：访问页面一直跳转到 `/signin`**  
A：
1. 确认 `.env` 中 `ENABLE_MOCK_DEV_USER=1`（本地开发）
2. 先访问 `http://localhost:3010/api/auth/dev-login` 建立 session
3. 重启 dev server 使环境变量生效

**Q：应用广场跳转后 AI 不响应**  
A：检查 `OPENAI_PROXY_URL` 是否可访问，确认 `NEW_API_BASE_URL` 指向的 new-api 已部署 `WhoAmI` 接口（`GET /api/app/whoami`）。

**Q：合并上游 lobe-chat 更新后功能异常**  
A：优先检查[二开改动索引](#二开改动索引)中列出的 7 个文件，这些是最容易被覆盖的改动点。

---

## 项目结构（关键路径）

```text
apps/lobehub/
├── src/
│   ├── app/
│   │   └── (backend)/api/auth/
│   │       ├── [...all]/route.ts          # BetterAuth 主路由
│   │       ├── token-login/route.ts       # ★ 自动登录接口（二开新增）
│   │       └── dev-login/route.ts         # ★ 本地开发快速登录（二开新增）
│   ├── libs/
│   │   ├── next/proxy/define-config.ts    # ★ 中间件配置（已改为无认证）
│   │   └── trpc/client/lambda.ts          # ★ tRPC 客户端（已移除 401 强跳）
│   └── layout/AuthProvider/              # BetterAuth / NoAuth 选择器
├── packages/
│   ├── business/const/src/branding.ts    # ★ 品牌配置（已替换）
│   └── const/src/url.ts                  # 全局 URL 常量
├── docker-compose/dev/
│   ├── docker-compose.yml                # 本地服务编排
│   └── .env                              # ★ 本地密码（不提交 git）
├── .env                                  # ★ 应用配置（不提交 git）
├── .env.example.development              # 官方开发环境示例，供参考
└── .nvmrc                                # Node.js 版本
```

> ★ 标注的文件是本项目相对上游的改动点或新增文件。
