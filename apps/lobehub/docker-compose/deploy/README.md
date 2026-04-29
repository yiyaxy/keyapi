# LobeHub + keyapi 集成部署文档

把 LobeHub（基于 [lobehub/lobehub](https://github.com/lobehub/lobe-chat) fork）作为 keyapi 应用广场里的一个 AI 应用部署，
打通登录态：用户在 keyapi 任意租户登录后，从应用广场点"立即使用"，**自动登录到 LobeHub**，
LLM 调用计费正确归属到该租户。

## 目录

- [架构](#架构)
- [前置要求](#前置要求)
- [域名规划](#域名规划)
- [部署步骤](#部署步骤)
- [验证 SSO](#验证-sso)
- [常见问题](#常见问题)
- [运维](#运维)

---

## 架构

```
┌────────────────────────┐         ┌─────────────────────────────────┐
│ tenantA.cymoon.cn      │  浏览器 │ lob.cymoon.cn                   │
│ tenantB.cymoon.cn      ├────────►│ （LobeHub 共享一个域名）        │
│ ...                    │         │                                 │
│ （keyapi 子域名／租户） │         │ Next.js + BetterAuth + Postgres │
└──────────┬─────────────┘         └────────────────┬────────────────┘
           │                                        │
           │ 应用广场点"立即使用"                   │ token-login route
           │ POST /api/app/{slug}/session           │ Bearer sk-token
           │   ↓                                    ↓
           │ 生成 sk-token (TenantId=A,            ┌─────────────────┐
           │   UserId=alice, AppId=lobe)           │ api.cymoon.cn   │
           │                                       │ /api/app/whoami │
           │ window.location ───────────────────►  │ 返回 user/tenant│
           │   {lobehub}/api/auth/token-login      │                 │
           │     ?token=sk-...&settings=...        │ keyapi backend  │
           │                                       └─────────────────┘
           │
           ▼
   1. LobeHub 调 whoami 验证
   2. upsert user `newapi_${id}`
   3. 创建 BetterAuth session + 写 cookie
   4. 重定向到 / （带 settings → keyVaults）
   5. 用户在 LobeHub 用 sk-token 调 LLM
      （sk-token 同时是身份凭证 + LLM API key）

S3：
   lobe.cymoon.cn ───► RustFS（容器内） ───► s3.cymoon.cn (可被浏览器访问)
   头像/聊天图片必须走 s3.cymoon.cn 这个公网域名，不能直连容器
```

**关键点：**
- **keyapi 多租户用子域名识别**（`xxx.cymoon.cn` → `TenantResolve` 解析 `xxx` 当 slug）
- **LobeHub 单域名**，所有租户用户共享一个 LobeHub 实例
- **`api.cymoon.cn` 单独子域名给 LobeHub server-side 调 whoami 用**，避开租户 slug 撞车（`api` 在 `middleware/tenant.go:49` 显式 skip）
- **同一把 sk-token** 既用于 BetterAuth session 创建，又写入 keyVaults 当 LLM API key

---

## 前置要求

### 服务器

- Linux（Debian/Ubuntu/CentOS 都行）
- ≥ 4 核 CPU、≥ 8GB RAM、≥ 50GB 磁盘（构建期间需要 8-10GB 临时空间）
- Docker 25+ 和 Docker Compose v2
- OpenResty / nginx（已有）

### 域名 & 证书

- 主域名 `cymoon.cn` 通配证书（`*.cymoon.cn`）—— 你已有 `/data/service/openresty/conf/cert/fullcymoon.pem`
- DNS 配 A 记录：
  - `lob.cymoon.cn` → 服务器 IP
  - `s3.cymoon.cn` → 服务器 IP
  - `api.cymoon.cn` → 服务器 IP
  - 各租户 `*.cymoon.cn` → 服务器 IP（已有）

### keyapi 已部署

- keyapi 主进程在跑，监听 `127.0.0.1:3000`（默认）
- 可以正常处理租户子域名

---

## 域名规划

| 域名 | 用途 | 反代到 |
|---|---|---|
| `tenantX.cymoon.cn` | keyapi 各租户前端 / API | keyapi:3000 |
| `api.cymoon.cn` | keyapi API 网关（给 LobeHub 调） | keyapi:3000 |
| `lob.cymoon.cn` | LobeHub 用户访问 | lobehub 容器:3210 |
| `s3.cymoon.cn` | RustFS 公开访问（图片/文件） | rustfs 容器:9000 |

> ⚠️ **`api.cymoon.cn` 不能用 `token.cymoon.cn`** —— `token` 可能撞租户 slug，导致 keyapi `TenantResolve` 把请求错误归属到该租户后，`TokenAuth` 的 cross-check 会拒绝整个请求（403）。
> `api` / `www` 在 `middleware/tenant.go:49` 显式 skip，是安全的。

---

## 部署步骤

### 1. 克隆代码 & 准备 .env

```bash
cd /data/service/key-api/keyapi/apps/lobehub/docker-compose/deploy

cp .env.zh-CN.example .env
vim .env
```

`.env` 必填项：

```bash
# 端口（避免和 keyapi 现有服务冲突）
LOBE_PORT=13210
RUSTFS_PORT=19000
RUSTFS_ADMIN_PORT=19001

# 公网 URL
APP_URL=https://lob.cymoon.cn          # LobeHub 用户访问的公网地址
INTERNAL_APP_URL=http://lobe:3210      # 容器间内部地址
NEW_API_BASE_URL=https://api.cymoon.cn # LobeHub server-side 调 keyapi 的入口
S3_ENDPOINT=https://s3.cymoon.cn       # 浏览器侧访问 S3 的地址

# 鉴权密钥（首次部署用 openssl rand -base64 32 生成）
KEY_VAULTS_SECRET=<32 字节 base64>
AUTH_SECRET=<32 字节 base64>

# 数据库
LOBE_DB_NAME=lobechat
POSTGRES_PASSWORD=<强密码>
DATABASE_URL=postgresql://postgres:<URL编码后的密码>@postgresql:5432/lobechat

# RustFS（S3 兼容存储）
RUSTFS_LOBE_BUCKET=lobe
RUSTFS_ACCESS_KEY=<生成>
RUSTFS_SECRET_KEY=<生成>
```

> ⚠️ `POSTGRES_PASSWORD` 里的特殊字符（`!@#$` 等）在 `DATABASE_URL` 里**必须 URL 编码**：
> - `!` → `%21`
> - `@` → `%40`
> - `#` → `%23`
> 比如密码 `Lobe_Wsg440295!Strong` → `DATABASE_URL=...:Lobe_Wsg440295%21Strong@...`

### 2. 配置 nginx

把这三个配置放到 OpenResty 的 conf.d 目录（路径按你的部署）：

```bash
cp nginx/lob.cymoon.cn.conf /data/service/openresty/nginx/conf/conf.d/
cp nginx/s3.cymoon.cn.conf  /data/service/openresty/nginx/conf/conf.d/
cp nginx/api.cymoon.cn.conf /data/service/openresty/nginx/conf/conf.d/

# 测试 + 重载
op test && op reload
```

如果 nginx test 报"日志目录不存在"，要么建目录：
```bash
mkdir -p /data/service/openresty/logs
```
要么用 `#` 注释掉配置里的 `access_log` / `error_log` 行（已默认注释）。

### 3. 构建 LobeHub 镜像

**首次构建耗时 30-60 分钟**（依赖巨多，pnpm install + Next.js build），后续增量构建 5-10 分钟。

```bash
cd /data/service/key-api/keyapi/apps/lobehub/docker-compose/deploy

# 后台构建，关 SSH 也不影响
nohup docker compose build lobe > /tmp/lobe-build.log 2>&1 &

# 看进度
tail -f /tmp/lobe-build.log

# 完成判断：日志末尾有 "naming to docker.io/keyapi/lobehub:latest"
docker images | grep keyapi/lobehub
```

`USE_CN_MIRROR=true`（已默认开启）会让 npm registry / sentry-cli / ffmpeg-static / sharp / chromium / electron / nodejs 全部走国内镜像（npmmirror）。

### 4. 启动所有服务

```bash
docker compose up -d
docker compose ps    # 全部 Up，postgres 显示 healthy
docker compose logs lobe -f    # 看到 "Ready in xxxms" 即就绪
```

启动顺序（compose 自动处理）：
1. postgresql (paradedb) — 内置 pg_search 全文检索
2. redis
3. rustfs + rustfs-init（建 bucket、设权限）
4. searxng
5. **lobe**（依赖前面全部 healthy 才启）

### 5. 在 keyapi 后台上架 LobeHub 应用

用**平台超管账号**登录任意租户后台 → 进 "AI 应用管理" 页 → 新建：

| 字段 | 值 |
|---|---|
| 应用名称 | LobeHub |
| Slug | `lobehub` |
| 应用地址 (TargetUrl) | `https://lob.cymoon.cn` |
| **可见范围 (Scope)** | **平台共享** |
| 状态 | 已上架 |
| Session TTL | `86400`（24h） |
| 默认分组 | 留空（继承用户分组） |

**Scope 选"平台共享"**：所有租户都能在自己的应用广场看到。
不勾的话只有当前租户能看到，其他租户没有 LobeHub 入口。

---

## 验证 SSO

### 端到端

1. 浏览器开 `https://tenantA.cymoon.cn`（任意非 token 租户）
2. 登录账号
3. 进 `/apps`（应用广场）
4. 点 LobeHub 卡片的 "立即使用"
5. 自动跳到 `https://lob.cymoon.cn`，**无需再登录**直接进工作台
6. 试着发一条消息，能拿到模型响应 = 整个链路通

### 手动测试 whoami（出问题时排查）

从 marketplace 浏览器 Network 面板拿到一个新鲜的 sk-token：

```bash
TOKEN="sk-从浏览器复制的"

# 容器里手动调一次
docker compose exec lobe sh -c "wget -qO- -S \
  --header='Authorization: Bearer $TOKEN' \
  '${NEW_API_BASE_URL}/api/app/whoami' 2>&1"
```

期待返回：
```json
{"success":true,"data":{"id":42,"username":"alice","email":"...","tenant_id":7}}
```

---

## 常见问题

### 1. 点击 "立即使用" 跳转到 `https://0.0.0.0:3210/...`

**原因**：`APP_URL` 环境变量没设或没传到容器，`token-login` 用 `request.url` 拿到内部监听地址。

**修法**：
```bash
docker compose exec lobe printenv APP_URL    # 应该是 https://lob.cymoon.cn
```
没有就检查 `.env`，重启容器：`docker compose up -d --force-recreate lobe`。

### 2. 跳到 `lob.cymoon.cn/signin?callbackUrl=...`（要求注册）

**原因**：`token-login` 调 whoami 失败，没创建 session。

**排查**：
```bash
docker compose logs lobe --tail 200 | grep -i 'token-login'
```

可能看到的报错：

| 报错 | 原因 |
|---|---|
| `whoami HTTP 403 ... token does not belong to this tenant` | **`NEW_API_BASE_URL` 撞租户 slug** —— 比如设成了 `https://token.cymoon.cn` 但有租户 slug=`token` |
| `whoami HTTP 401 invalid token` | sk-token 过期了（默认 24h），重新点"立即使用"拿新 token |
| `whoami fetch failed: ENOTFOUND` / `ECONNREFUSED` | 容器解析不到 `api.cymoon.cn` 或 nginx 没起 |
| `NEW_API_BASE_URL is not set` | `.env` 里这个变量缺了 |

### 3. Docker build 卡在 ffmpeg-static 下载

**原因**：默认从 GitHub Releases 拉，国内慢。

**修法**：Dockerfile 已经在 `USE_CN_MIRROR=true` 时设 `FFMPEG_BINARIES_URL` 走 npmmirror。如果还慢，看 `apps/lobehub/Dockerfile:79-92`，可以加更多镜像变量。

### 4. 启动报 `connection refused on postgresql:5432`

**原因**：postgres 没起或 healthcheck 还没通过。

```bash
docker compose ps postgresql      # 看 STATUS = healthy 才行
docker compose logs postgresql --tail 30
```

paradedb 镜像首次启动要建 `pg_search` 扩展，5-10 秒可能就好了，再 `docker compose up -d lobe`。

### 5. keyapi 这边 SQL 一直报 `tls error: server refused TLS connection`

**和 LobeHub 无关** —— keyapi 主库连阿里云 RDS 时 TLS 模式不对。在 keyapi 的 `.env` / `SQL_DSN` 里把 `?sslmode=require` 改成 `?sslmode=disable`（内网连），或者去阿里云 RDS 控制台开 SSL（公网必须开）。

### 6. 改了 LobeHub 源码，怎么生效

```bash
cd /data/service/key-api/keyapi
git pull   # 或本地直接改

cd apps/lobehub/docker-compose/deploy
docker compose build lobe   # 增量构建 5-10 分钟
docker compose up -d --force-recreate lobe
```

---

## 运维

### 数据库备份

`scripts/` 目录有现成的备份恢复脚本，参考 `scripts/README.md`：

```bash
# 一次性手动备份
./scripts/backup-lobe-db.sh

# cron 每天凌晨 3 点自动备份
0 3 * * * /data/service/key-api/keyapi/apps/lobehub/docker-compose/deploy/scripts/backup-lobe-db.sh \
  >> /var/log/lobe-backup.log 2>&1
```

阿里云 OSS 异地备份：把 `backup-lobe-db.sh` 里 `OSS_BUCKET` 填成你的桶路径，并装 ossutil。

### 数据库远程访问（DBeaver / Navicat）

postgres 只绑 `127.0.0.1:15432`，外网连不上。本地连法（**SSH 隧道**）：

```bash
ssh -L 15432:127.0.0.1:15432 root@<服务器 IP>
# 然后客户端连 localhost:15432
```

### 升级 LobeHub 上游版本

```bash
cd /data/service/key-api/keyapi
git pull   # 拉最新 fork 上游

cd apps/lobehub/docker-compose/deploy
docker compose build --no-cache lobe   # 完整重建（30-60 分钟）
docker compose up -d --force-recreate lobe

# 数据库迁移由容器内 startServer.js 自动执行，看日志确认：
docker compose logs lobe -f | grep migration
```

### 监控

容器健康：
```bash
docker compose ps
docker stats --no-stream
```

LobeHub 错误日志：
```bash
docker compose logs lobe -f --tail 100
```

keyapi 这边 sk-token 用量按 app_id 在 `logs` 表里有记录，可以做按应用的计费/统计。

### 资源占用参考

| 服务 | 空闲 RAM | 满载 RAM |
|---|---|---|
| lobe (Next.js) | ~400MB | ~1-2GB |
| postgresql (paradedb) | ~50MB | ~500MB-2GB |
| redis | ~5MB | ~50MB |
| rustfs | ~30MB | ~200MB |
| searxng | ~100MB | ~300MB |

总计建议留 8GB 给整套 LobeHub 服务。

---

## 涉及代码索引

| 功能 | 文件 |
|---|---|
| AiApp Scope 字段 + 跨租户查询 | `model/ai_app.go` |
| 平台 scope 鉴权 / 跨租户保护 | `controller/app/ai_app.go` |
| 租户识别 + 子域名解析 + skip 列表 | `middleware/tenant.go` |
| sk-token tenant cross-check | `middleware/auth.go:32-51` |
| token-login SSO 入口 | `apps/lobehub/src/app/(backend)/api/auth/token-login/route.ts` |
| 应用广场前端 | `web-next/src/pages/AppMarketplace.tsx`、`web-next/src/pages/AiAppsAdmin.tsx` |
| 应用广场跳转逻辑 | `web-next/src/pages/AppMarketplace.tsx:24-49` |
