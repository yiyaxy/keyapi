# New API 项目说明

New API 是一套面向多租户、渠道分发和 OpenAI-compatible 模型调用的中转站系统。项目包含 Go 后端、`web-next` 管理端、`wxapp` 小程序端，以及 `apps/` 下的独立应用。

这份文档面向开发、部署和运维人员，重点说明本仓库的本地开发、构建验证和服务器 `dist/` 离线打包部署方式。面向租户用户、分销商和普通用户的使用说明请看 [UserReadme.md](UserReadme.md)。

## 项目结构

```text
.
|-- main.go                  # Go 后端入口
|-- controller/              # HTTP 控制器
|-- model/                   # 数据模型、数据库访问和迁移
|-- router/                  # API 路由
|-- service/                 # 业务服务
|-- web-next/                # Web 管理端，React + Vite
|-- wxapp/                   # 小程序端，uni-app
|-- apps/                    # 独立子应用，每个子目录按自己的 README 部署
|-- docs/                    # 补充文档
|-- docker-compose.yml       # Docker Compose 参考配置
|-- Dockerfile               # 容器镜像参考构建文件
|-- .env.example             # 后端环境变量示例
|-- build.ps1                # Windows 一键打包脚本，输出 dist/
|-- new-api.service          # systemd 服务示例
|-- README.md                # 当前文档
`-- UserReadme.md            # 面向最终用户的说明
```

## 环境要求

- Go 1.25 或兼容版本。
- Node.js 18+，用于 `web-next` 和 `wxapp`。
- Bun 可选；仓库的 Dockerfile 使用 Bun 构建前端，本地也可以使用 `npm`。
- PostgreSQL / MySQL / SQLite，按 `.env` 中的 `SQL_DSN` 配置选择。
- Redis 可选，用于缓存、队列或限流相关能力。
- Linux 服务器推荐使用 systemd 管理后端进程。

## 本地开发

### 1. 后端

```bash
cp .env.example .env
# 修改 .env 中的数据库、Redis、模型服务、支付、登录等配置

go mod download
go run main.go --port 3000
```

常用验证命令：

```bash
go test ./model ./middleware ./controller/partner ./controller/payment ./controller/user
```

### 2. Web 管理端

```bash
cd web-next
npm install
npm run dev
```

常用命令：

```bash
npm run typecheck
npm run build
npm run preview
```

构建产物输出到 `web-next/dist`。后端启动时会读取该目录作为管理端静态资源。

### 3. 小程序端

```bash
cd wxapp
npm install
npm run dev:mp-weixin
```

构建微信小程序：

```bash
npm run build:mp-weixin
```

产物位于 `wxapp/dist/build/mp-weixin`，用微信开发者工具打开该目录预览和上传。

### 4. apps 独立项目

`apps/` 下的项目独立维护，不和主系统共用构建命令。进入对应目录后按该项目自己的 README 操作。

```bash
cd apps/lobehub
# 查看 apps/lobehub/README.md

cd apps/noterx
# 查看 apps/noterx/README.md
```

## 生产部署推荐：`build.ps1` 离线包

推荐在本地或 CI 机器上完成编译，把部署产物统一放进根目录 `dist/`，再上传到服务器。这样服务器不需要安装 Go、Node.js，也不需要在生产机上拉取前端依赖。

当前仓库已提供 `build.ps1`，这是 Windows 环境下的主打包入口：

```powershell
.\build.ps1                  # 默认构建 linux/amd64
.\build.ps1 -Arch arm64      # 构建 ARM64 Linux 服务器产物
.\build.ps1 -SkipWeb         # 跳过前端构建，复用已有 web-next/dist
```

脚本会检查 Go、Node.js/npm，构建 `web-next`，再交叉编译 Linux 后端二进制。`-SkipWeb` 只适合前端没有变化且 `web-next/dist/index.html` 已存在的场景。

### 产物目录约定

```text
dist/
|-- new-api                  # Linux 可执行文件
|-- .env.example             # 环境变量模板，部署后复制为 .env
```

注意：`build.ps1` 当前只把后端二进制和 `.env.example` 复制到根目录 `dist/`，前端静态资源仍保留在源码目录的 `web-next/dist`。如果你只上传 `dist/new-api`，服务器上还需要同步 `web-next/dist`，否则后端无法正确提供管理端页面。

推荐上传内容：

```text
dist/new-api
dist/.env.example
web-next/dist/
new-api.service              # 可选，使用 systemd 时上传
```

### Windows PowerShell 打包命令

在仓库根目录执行：

```powershell
.\build.ps1
```

ARM64 服务器：

```powershell
.\build.ps1 -Arch arm64
```

前端没有变化、只重编后端：

```powershell
.\build.ps1 -SkipWeb
```

### Linux / macOS 等价打包命令

没有 PowerShell 时，可在仓库根目录手动执行等价流程：

```bash
rm -rf dist
mkdir -p dist

cd web-next
npm install
npm run build
cd ..

GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o dist/new-api main.go

cp .env.example dist/.env.example
```

如果服务器是 ARM64，把 `GOARCH=amd64` 改成 `GOARCH=arm64`。

### 上传和部署

服务器示例目录：`/data/service/key-api/keyapi`

```bash
mkdir -p /data/service/key-api/keyapi

# 示例：从本机上传
ssh user@server 'mkdir -p /data/service/key-api/keyapi/web-next'
scp dist/new-api dist/.env.example user@server:/data/service/key-api/keyapi/
scp -r web-next/dist user@server:/data/service/key-api/keyapi/web-next/
scp new-api.service user@server:/data/service/key-api/keyapi/

cd /data/service/key-api/keyapi

cp .env.example .env
# 修改 .env：数据库、Redis、SESSION_SECRET、SERVER_ADDRESS、支付、SMTP、Partner API 等生产配置

chmod +x new-api
mkdir -p logs data
```

如果使用 systemd：

```bash
cp new-api.service /etc/systemd/system/new-api.service
systemctl daemon-reload
systemctl enable new-api
systemctl restart new-api
systemctl status new-api
```

`new-api.service` 中默认目录是 `/data/service/key-api/keyapi`。如果你的部署目录不同，需要同步修改：

- `WorkingDirectory`
- `EnvironmentFile`
- `ExecStart`
- `--log-dir`

服务启动后验证：

```bash
curl http://127.0.0.1:3000/api/status
```

再通过 Nginx 或 Caddy 反向代理到 `127.0.0.1:3000`。

## Docker Compose 部署

Docker Compose 适合一台机器上同时管理后端、PostgreSQL 和 Redis：

```bash
cp .env.example .env
# 修改 .env
docker compose up -d --build
```

注意事项：

- `docker-compose.yml` 中 `environment` 会覆盖 `env_file: .env` 里的同名变量。
- 生产环境必须修改 PostgreSQL 默认密码、`SESSION_SECRET`、数据库地址和公开域名。
- 当前 Dockerfile 是参考文件；如果本地仓库缺少 `VERSION` 或 `frontend_v2` 目录，优先使用上面的 `build.ps1` / `dist/` 离线包方式，或先同步 Dockerfile 所需资源。

## 关键配置

常见生产环境变量：

```env
SQL_DSN=postgresql://user:password@host:5432/new-api
REDIS_CONN_STRING=redis://127.0.0.1:6379
SESSION_SECRET=change-me-to-a-long-random-string
SERVER_ADDRESS=https://your-domain.com
```

客户系统对接专属租户时，还需要：

```env
PARTNER_API_TENANT_ID=33
PARTNER_API_CLIENT_ID=tenant_33
PARTNER_API_CLIENT_SECRET=change-me-to-a-long-random-secret
PARTNER_API_KEY=change-me-to-a-long-random-secret
```

如果租户用户不允许自助充值，需要在租户配置中设置：

```text
UserSelfTopUpEnabled=false
```

## 上线检查

- `.env` 已连接正式数据库，不使用本地测试库。
- `SESSION_SECRET` 已设置为生产随机值。
- `SERVER_ADDRESS` 已设置为正式访问域名。
- `web-next/dist` 已随 `dist/new-api` 一起部署到服务器的 `web-next/dist`。
- 后端 `/api/status` 返回 `success=true`。
- 管理端可登录，租户、用户、渠道、模型、支付和 SMTP 配置可访问。
- Redis、数据库、日志目录和数据目录权限正常。
- Nginx/Caddy 反向代理、HTTPS 证书和回调域名已配置。
- 支付、邮件、Partner API 等外部能力已按生产参数验证。
- 已准备数据库备份和回滚方案。

## 常用排查

- 后端启动失败：先看 `.env`、数据库连接、端口占用和 `logs/`。
- 管理端白屏或 404：检查 `web-next/dist` 是否在部署目录内，以及反向代理是否转发到后端。
- 接口跨域或域名异常：检查 `SERVER_ADDRESS`、Nginx/Caddy 配置和浏览器控制台。
- 支付失败：检查租户支付配置、证书、回调地址和用户自助充值开关。
- 邮件失败：检查租户 SMTP 配置；租户未配置时按系统配置兜底。
- 模型调用失败：检查渠道状态、模型名称、Key、用户余额和租户额度。
- Partner API 签名失败：检查 `client_id`、`client_secret`、UTC 秒级 `timestamp`、一次性 `nonce` 和 canonical string 字段顺序。
