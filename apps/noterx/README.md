# NoteRx 应用说明

`apps/noterx` 是一个独立的内容诊断应用，包含 FastAPI 后端和 React 前端。它不和主系统共用启动命令，开发和部署时请在本目录内操作。

## 目录说明

```text
apps/noterx/
├── backend/                # FastAPI 后端
├── frontend/               # React + Vite 前端
├── data/                   # 本地数据
├── docs/                   # 项目补充文档
├── scripts/                # 数据和研究脚本
├── .env.example            # 环境变量示例
└── README.md               # 当前说明
```

## 环境要求

- Python 3.11+
- Node.js 18+
- npm

## 后端开发

```bash
cd apps/noterx/backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

复制并配置环境变量：

```bash
copy ..\.env.example .env
```

启动 API：

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

接口文档默认地址：

```text
http://localhost:8000/docs
```

## 前端开发

```bash
cd apps/noterx/frontend
npm install
npm run dev
```

前端默认通过 Vite 代理访问后端。需要修改后端地址时，在 `frontend/.env` 中设置：

```env
VITE_API_PROXY_TARGET=http://localhost:8000
```

## 构建

前端构建：

```bash
cd apps/noterx/frontend
npm run build
```

后端生产运行：

```bash
cd apps/noterx/backend
venv\Scripts\activate
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

## 部署说明

常见部署方式：

1. 在服务器安装 Python、Node.js、Nginx/Caddy。
2. 配置 `backend/.env`，填写模型服务地址、API Key、模型名称等。
3. 构建 `frontend`，将静态产物交给 Web 服务或后端静态服务处理。
4. 使用 systemd/Supervisor 运行 FastAPI。
5. 使用 Nginx/Caddy 配置域名、HTTPS 和 `/api` 反向代理。

## 常用排查

- 前端无法连接 API：确认后端已启动，且 `VITE_API_PROXY_TARGET` 指向正确端口
- 模型调用失败：检查 `OPENAI_API_KEY`、`OPENAI_BASE_URL`、模型名称和网络
- 视频/图片分析异常：检查上传大小、公网回调地址和后端日志
- 生产访问 404：确认前端路由 fallback 或反向代理配置正确
