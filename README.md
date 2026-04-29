# New API 项目说明

New API 是一套面向多租户、分销商和模型服务分发的系统。项目包含 Go 后端、Web 管理端、小程序端，以及 `apps/` 目录下的独立应用。

本文档面向开发和部署人员，说明项目结构、核心功能、开发启动、构建部署和排查方法。面向分销商和租户用户的使用说明请查看 `UserReadme.md`。

## 核心功能

- 多租户管理：租户、用户、余额、API Key、平台模型和配置独立管理。
- 模型分发：支持文本大语言模型、图片模型、视频模型，模型列表可从后台接口动态获取。
- 用户等级：不同等级可配置不同充值返利、邀请返利和折扣规则。
- 充值和兑换：支持动态控制微信支付开关，保留统一的充值/兑换入口。
- 分销邀请：支持邀请关系、下级管理、拉新奖励和上级充值返利。
- 小程序端：登录、协议授权、充值兑换、API Key、签到、用户等级、分享拉新、我的下级等能力。
- 管理端：配置租户、用户、模型、价格、等级、返利、支付、公告和业务参数。
- LobeHub 独立应用：提供对话、图片生成、视频生成入口，接入本项目的模型网关。

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
├── apps/                   # 独立应用，每个子项目有自己的 README.md
├── docs/                   # 项目补充文档
├── docker-compose.yml      # Docker Compose 部署配置
├── .env.example            # 后端环境变量示例
├── UserReadme.md           # 给最终用户/分销商看的使用文档
└── README.md               # 当前开发与部署说明
```

## 子项目说明

主仓库里的后端、`web-next`、`wxapp` 是当前系统的核心组成部分。

`apps/` 下的项目是独立项目，不和主系统共用开发命令。进入对应目录后，按该项目自己的 `README.md` 操作。

| 路径 | 说明 |
| --- | --- |
| `apps/lobehub/` | 独立的 LobeHub 前端应用，已接入 New API 模型网关，支持对话、图片生成、视频生成 |
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

## Web 管理端

`web-next` 是管理后台，用于租户、用户、Key、模型、用户等级、邀请码、返利、充值、兑换、支付等后台能力。

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

## 小程序端

`wxapp` 是用户侧小程序端，包含登录、用户服务协议、隐私政策、余额、充值兑换、API Key、签到、用户等级、分享拉新、我的下级等功能。

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

## LobeHub 应用

`apps/lobehub` 是独立前端应用，已按当前业务做了以下调整：

- 默认中文界面，仅保留中文和英文资源。
- 默认对接 New API 的 OpenAI-compatible 网关。
- 首页主入口区分为 `AI 对话`、`图片生成`、`视频生成`，方便新用户理解。
- `/image` 图片生成页使用后台支持的图片模型。
- `/video` 视频生成页使用后台支持的视频模型。
- 对话、图片、视频输入框已做收窄和居中，避免界面过宽。
- 模型展示名做了小白友好化，例如 `gemini-3.1-flash-image-preview` 展示为 `Nano Banana 2`。

### 模型接口配置

LobeHub 的模型列表优先从 pricing 接口读取：

```env
OPENAI_PROXY_URL=https://token.cymoon.cn/v1
MODEL_PRICING_URL=https://token.cymoon.cn/api/pricing
DEFAULT_AGENT_CONFIG=model=gpt-5.5;provider=openai;
```

`MODEL_PRICING_URL` 返回的数据中：

- `data[].model_name` 是模型名称。
- `supported_endpoint_types` 包含 `openai`、`gemini`、`anthropic` 的模型会作为对话模型展示。
- `supported_endpoint_types` 包含 `image-generation` 的模型会作为图片模型展示。
- 视频模型按 LobeHub 视频模型能力读取，后续如果后台增加视频 endpoint 类型，可继续扩展。

如果不配置 `MODEL_PRICING_URL`，系统会尝试从 `OPENAI_PROXY_URL` 推导 `/api/pricing` 地址。

开发启动：

```bash
cd apps/lobehub
pnpm install
pnpm dev
```

具体命令和部署方式以 `apps/lobehub/README.md` 为准。

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

- `.env` 已配置正式数据库，不使用本地测试库。
- 后端服务能正常访问健康接口和核心 API。
- `web-next` 构建通过，管理端可登录并访问租户配置。
- `wxapp` 构建通过，小程序登录、协议授权、充值兑换、API Key、分享拉新页面可用。
- 微信支付开关、回调地址、商户配置与当前租户一致。
- 用户等级、充值赠送、邀请返利、拉新奖励上限已配置。
- 模型服务的 `baseUrl`、模型名称、Key 已配置。
- LobeHub 的 `OPENAI_PROXY_URL`、`MODEL_PRICING_URL`、`DEFAULT_AGENT_CONFIG` 已配置。
- `/image` 和 `/video` 页面只展示后台支持的模型。
- 日志目录、上传目录、数据库备份策略已准备。

## 常用排查

- 后端启动失败：优先检查 `.env`、数据库连接、端口占用。
- 管理端请求失败：检查 API 地址、反向代理和浏览器控制台错误。
- 小程序接口失败：检查 `wxapp` 请求地址、小程序合法域名和登录态。
- 支付失败：检查微信支付配置、证书、回调地址和租户支付开关。
- 模型调用失败：检查模型服务地址、模型名称、Key、余额和网络连通性。
- LobeHub 模型列表不对：检查 `MODEL_PRICING_URL` 是否可访问，以及 pricing 接口中的 `supported_endpoint_types`。
- 图片/视频页面模型不对：重启 `apps/lobehub` 服务，并强刷浏览器缓存。
