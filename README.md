# New API

New API 是一款开源的接口管理和分发系统。本项目包含了后端服务、Web 端管理面板（`web-next`），以及独立的人工智能应用 `noterx`（该应用将作为独立的 AI 模块被加载到 PC 页面中）。

## 项目结构

- **后端代码**：处理所有的核心业务逻辑和 API 分发（基于 Go 语言）。
- **`web-next/`**：Web 端管理面板，基于 React + Vite 开发（纯前端 SPA 项目）。
- **`noterx/`**：独立的 AI 应用，将打包或独立加载入 PC 端页面。
- **`docs/`**：项目相关文档说明。

## 运行与部署

### 1. 运行环境准备
- Go 1.25.0 或以上版本
- Node.js 18+ (用于前端和 `noterx` 项目)
- 数据库 (支持 MySQL, PostgreSQL, SQLite)
- Redis (可选，用于缓存优化)

### 2. 本地运行开发

#### 后端服务
1. 复制环境变量文件：
   ```bash
   cp .env.example .env
   ```
2. 按照实际情况修改 `.env` 中的数据库配置等信息。
3. 安装依赖并启动服务：
   ```bash
   go mod download
   go run main.go
   ```

#### Web 管理端 (`web-next`)
1. 进入前端目录并安装依赖：
   ```bash
   cd web-next
   npm install
   ```
2. 启动开发服务器：
   ```bash
   npm run dev
   ```

#### 独立的 AI 应用 (`noterx`)
`noterx` 是一个独立的 AI 应用。
1. 进入 `noterx` 目录：
   ```bash
   cd noterx
   npm install
   ```
2. 启动或构建：
   ```bash
   npm run dev
   # 构建到生产环境
   npm run build
   ```

### 3. Docker 部署
本项目提供了 `docker-compose.yml`，可以快速部署。

1. 确保服务器已安装 Docker 和 Docker Compose。
2. 运行部署命令：
   ```bash
   docker-compose up -d
   ```
   该命令会在后台拉取并运行整个服务集群。

## 许可证
详情请查看 `LICENSE` 文件。
