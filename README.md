# New API 项目说明

New API 是一套面向多租户、分销和模型服务分发的系统。项目包含 Go 后端、Web 管理端、小程序端，以及 `apps/` 目录下的若干独立应用。

本文档面向开发和部署人员，说明仓库结构、开发流程、构建方式和上线注意事项。面向分销商/租户用户的使用文档请看 `UserReadme.md`。

## 目录结构

```text
.
├── main.go                 # Go 后端入口
├── controller/             # HTTP 控制器
├── model/                  # 数据模型与数据库逻辑
├── router/                 # API 路由
├── service/                # 业务服务
├── web-next/               # Web 管理端，React + Vite
├── wxapp/                  # 小程序端，uni-app
├── apps/                   # 独立应用，每个子项目都有自己的 README.md
├── docs/                   # 项目补充文档
├── docker-compose.yml      # Docker Compose 部署配置
├── .env.example            # 后端环境变量示例
└── UserReadme.md           # 给最终用户/分销商看的使用说明
```

## 子项目说明

主仓库里的后端、`web-next`、`wxapp` 是当前系统的核心组成部分。

`apps/` 下的项目是独立项目，不和主系统共用开发命令。进入对应目录后按该项目自己的 `README.md` 操作。

| 路径 | 说明 |
| --- | --- |
| `apps/lobehub/` | 独立的 LobeHub 前端应用，默认中文，只保留中文和英文语言资源 |
| `apps/noterx/` | 独立的内容诊断应用，包含 FastAPI 后端和 React 前端 |

## 环境要求

- Go 1.25 或兼容版本
- Node.js 18+，用于 `web-next` 和 `wxapp`
- MySQL / PostgreSQL / SQLite，按 `.env` 配置选择
- Redis 可选，用于缓存、队列或限流相关能力
- Docker 和 Docker Compose 可选，用于服务器部署

## 后端开发

1. 复制环境变量文件：

```bash
cp .env.example .env
```

2. 修改 `.env` 中的数据库、Redis、模型服务、支付、登录等配置。

3. 启动后端：

```bash
go mod download
go run main.go
```

4. 运行测试：

```bash
go test ./...
```

## Web 管理端开发

`web-next` 是管理后台，用于租户、用户、Key、模型、兑换码、返利、支付等后台能力。

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

构建产物默认输出到 `web-next/dist`。

## 小程序端开发

`wxapp` 是用户侧小程序端，用于登录、查看额度、充值/兑换、API Key、邀请、订单、个人中心等功能。

```bash
cd wxapp
npm install
npm run dev:mp-weixin
```

构建微信小程序：

```bash
npm run build:mp-weixin
```

构建产物位于 `wxapp/dist/build/mp-weixin`，使用微信开发者工具打开该目录进行预览和上传。

## apps 独立项目开发

`apps/` 下的项目独立维护，依赖、启动方式、部署方式以各自目录内的 `README.md` 为准。

```bash
cd apps/lobehub
# 查看 apps/lobehub/README.md

cd apps/noterx
# 查看 apps/noterx/README.md
```

主系统开发时，不需要同时启动 `apps/` 下的所有项目。

## 构建与部署

### 方式一：直接部署

适合已有服务器环境。

1. 在服务器准备 Go、Node.js、数据库和可选 Redis。
2. 配置根目录 `.env`。
3. 构建管理端：

```bash
cd web-next
npm install
npm run build
```

4. 构建小程序端：

```bash
cd wxapp
npm install
npm run build:mp-weixin
```

5. 回到根目录构建后端：

```bash
go build -o new-api main.go
```

6. 使用 systemd、Supervisor 或容器运行后端进程，并由 Nginx/Caddy 反向代理到后端服务。

### 方式二：Docker Compose 部署

适合希望统一管理服务的环境。

```bash
cp .env.example .env
# 修改 .env
docker compose up -d
```

更新代码后重新构建：

```bash
docker compose up -d --build
```

## 上线检查

- `.env` 已配置正式数据库，不使用本地测试库
- 后端服务能正常访问健康接口和核心 API
- `web-next` 构建通过，管理端能登录并访问租户配置
- `wxapp` 构建通过，小程序登录、隐私协议、充值/兑换、API Key 页面可用
- 微信支付开关、回调地址、商户配置与当前租户一致
- 模型服务的 `baseUrl`、模型名称、Key 已配置
- 日志目录、上传目录、数据库备份策略已准备

## 常用排查

- 后端启动失败：优先检查 `.env`、数据库连接、端口占用
- 管理端请求失败：检查 API 地址、反向代理和浏览器控制台错误
- 小程序接口失败：检查 `wxapp` 请求地址、小程序合法域名和登录态
- 支付失败：检查微信支付配置、证书、回调地址和租户支付开关
- 模型调用失败：检查模型服务地址、模型名称、Key、余额和网络连通性
