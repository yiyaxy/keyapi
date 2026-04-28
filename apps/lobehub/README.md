# LobeHub 二开说明

`apps/lobehub` 是基于 [lobe-chat](https://github.com/lobehub/lobe-chat) 二次开发的 AI 工具平台，对接自有 new-api 后端，去除官方认证跳转，支持通过 URL 参数动态注入用户 session key。

## 目录说明

```text
apps/lobehub/
├── src/                         # Next.js 应用源码
├── packages/                    # 项目内部 monorepo 包
│   ├── business/const/src/      # 品牌配置（BRANDING_NAME、ORG_NAME 等）
│   └── const/src/url.ts         # 全局 URL 常量
├── docker-compose/dev/          # 本地开发用 Docker 服务
│   ├── docker-compose.yml       # PostgreSQL / Redis / RustFS / SearXNG
│   └── .env                     # Docker 服务密码（本地自行创建）
├── .env                         # 应用环境变量（本地自行创建）
└── README.md
```

## 环境要求

- Node.js（版本见 `.nvmrc`，当前为 `lts/krypton`）
- pnpm 10.x
- Bun（部分构建脚本调用）
- Docker Desktop（启动本地数据库服务）

---

## 本地开发

### 第一步：安装依赖

```bash
cd apps/lobehub
pnpm install
```

### 第二步：创建 Docker 服务配置

在 `docker-compose/dev/` 目录下创建 `.env`（首次运行需手动创建）：

```bash
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

> 如果 6379 端口已被其他 Redis 占用，将 `docker-compose.yml` 中 Redis 的宿主端口改为 `6380:6379`，同时在应用 `.env` 中设置 `REDIS_URL=redis://localhost:6380`。

### 第三步：创建应用环境变量

在 `apps/lobehub/` 根目录创建 `.env`：

```bash
# ===== 应用地址 =====
APP_URL=http://localhost:3010

# ===== AI 接口（对接自有 new-api） =====
# fallback key（用户未携带 token 时使用）
OPENAI_API_KEY=<your-fallback-key>
# new-api OpenAI 兼容接口地址
OPENAI_PROXY_URL=https://<your-new-api-domain>/v1

# ===== Key Vaults 加密密钥（必填） =====
# 用 openssl rand -base64 32 生成
KEY_VAULTS_SECRET=<your-32-byte-base64-secret>

# ===== 数据库 =====
DATABASE_URL=postgresql://postgres:lobe_dev_password@localhost:5432/lobechat
DATABASE_DRIVER=node

# ===== Redis =====
REDIS_URL=redis://localhost:6380
REDIS_PREFIX=lobechat
REDIS_TLS=0

# ===== 其他 =====
TELEMETRY_DISABLED=1
ENABLED_CSP=0
```

### 第四步：启动依赖服务

```bash
pnpm dev:docker
```

该命令以 Docker 启动 PostgreSQL（5432）、Redis（6380）、RustFS（9000）、SearXNG（8180），并等待 PostgreSQL 健康检查通过后返回。

### 第五步：初始化数据库

**首次运行必须执行**，之后升级如有 schema 变更也需重新执行：

```bash
pnpm db:migrate
```

### 第六步：启动开发服务器

```bash
pnpm dev
```

启动后访问 [http://localhost:3010](http://localhost:3010)。

---

## 常用开发命令

| 命令 | 说明 |
|---|---|
| `pnpm dev` | 启动完整开发服务（Next.js + Vite SPA） |
| `pnpm dev:next` | 仅启动 Next.js 服务（端口 3010） |
| `pnpm dev:spa` | 仅启动 Vite SPA 服务（端口 9876） |
| `pnpm dev:docker` | 启动 Docker 依赖服务 |
| `pnpm dev:docker:down` | 停止 Docker 依赖服务 |
| `pnpm dev:docker:reset` | 清空数据并重置（**会清库**） |
| `pnpm db:migrate` | 运行数据库迁移 |
| `pnpm build` | 完整构建 |

---

## 二开改动说明

### 1. 去除官方认证跳转

文件：`src/libs/next/proxy/define-config.ts`

```ts
// 不启用账号体系，直接使用无认证的路由重写中间件
return { middleware: defaultMiddleware };
```

### 2. 品牌名替换

文件：`packages/business/const/src/branding.ts`

```ts
export const BRANDING_NAME = 'AI Tools';
export const ORG_NAME = 'AI Tools';
export const LOBE_CHAT_CLOUD = 'AI 工具广场';
```

### 3. 无感登录 + 动态 key 注入（应用广场跳转）

用户在 `web-next` 的应用广场点击「使用」时，自动完成登录并注入 API Key，全程无需手动注册或登录。

**完整流程：**

```
用户点击「使用」
  → web-next 生成 session token（sk-xxxx）
  → 跳转到 LobeHub /api/auth/token-login?token=sk-xxx&settings={keyVaults:{...}}
  → LobeHub 调用 new-api GET /api/app/whoami 验证 token、反查用户信息
  → 自动在 LobeHub 数据库 upsert 用户（id 为 newapi_<userId>）
  → 创建 BetterAuth session，写入 better-auth.session_token cookie
  → 重定向到 /?settings=... 注入 API Key
  → 用户直接进入聊天界面，已登录且 key 已就位
```

**关键文件：**

| 文件 | 作用 |
|---|---|
| `web-next/src/pages/AppMarketplace.tsx` | 生成 loginUrl 并跳转 |
| `src/app/(backend)/api/auth/token-login/route.ts` | 验证 token、自动建用户、创建 session |
| `controller/app/ai_app.go` → `WhoAmI` | new-api 端，用 sk-token 反查用户身份 |

**所需环境变量（`.env`）：**

```bash
NEW_API_BASE_URL=https://<your-new-api-domain>
```

**降级策略：** token 验证失败或 DB 异常时，仍正常跳转首页并携带 `?settings=`（key 仍有效，仅无 session 持久化）。

---

## 生产部署

### 环境要求

- Node.js + pnpm + Bun（同本地开发）
- PostgreSQL 17（推荐使用 `paradedb/paradedb:latest-pg17`）
- Redis 7
- 对象存储（RustFS 或兼容 S3 的服务）
- Nginx / Caddy 反向代理 + HTTPS

### 部署步骤

**1. 准备服务器依赖**

启动 PostgreSQL、Redis、对象存储服务（可用 `docker-compose/dev/docker-compose.yml` 改造为生产 compose）。

**2. 配置生产环境变量**

复制并修改 `.env`，关键修改项：

```bash
APP_URL=https://<your-domain>

# 生产密钥（必须重新生成，不能沿用开发密钥）
KEY_VAULTS_SECRET=<openssl rand -base64 32>

DATABASE_URL=postgresql://postgres:<strong-password>@<db-host>:5432/lobechat
REDIS_URL=redis://<redis-host>:6379

# S3 对象存储
S3_ACCESS_KEY_ID=<key>
S3_SECRET_ACCESS_KEY=<secret>
S3_ENDPOINT=https://<s3-endpoint>
S3_BUCKET=lobe
S3_ENABLE_PATH_STYLE=1
S3_SET_ACL=0

ENABLED_CSP=1
```

**3. 安装依赖并构建**

```bash
cd apps/lobehub
pnpm install --frozen-lockfile
pnpm build
```

**4. 运行数据库迁移**

```bash
pnpm db:migrate
```

**5. 启动服务**

```bash
node .next/standalone/server.js
```

或使用 PM2：

```bash
pm2 start .next/standalone/server.js --name lobehub -- --port 3010
```

**6. 配置反向代理**

Nginx 示例：

```nginx
server {
    listen 443 ssl;
    server_name <your-domain>;

    location / {
        proxy_pass http://127.0.0.1:3010;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## 语言资源

当前保留：

- `locales/zh-CN`（默认语言）
- `locales/en-US`
