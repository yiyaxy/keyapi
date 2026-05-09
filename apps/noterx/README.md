# NoteRx 部署说明

`apps/noterx` 是一个独立的内容诊断应用，包含：

- `backend/`：FastAPI 后端，负责截图识别、笔记诊断、历史记录和静态前端托管。
- `frontend/`：React + Vite 前端，生产构建后输出到 `frontend/dist`。
- `data/`：本地 baseline、研究数据和运行数据。

当前版本已经按 `apps/lobehub` 的方式接入 `web-next` 应用广场：用户从应用广场点击 NoteRx 后，`web-next` 会为用户生成临时 session token，NoteRx 保存到浏览器 `sessionStorage`，之后每次诊断请求都会把该 token 作为 `X-LLM-API-Key` 发给 NoteRx 后端。后端再用这个用户 token 调用 new-api 的 OpenAI-compatible `/v1` 网关，不再默认使用项目 `.env` 里的大模型 Key。

## 部署架构

推荐生产架构：

```text
用户浏览器
  |
  | 1. 打开 web-next 应用广场
  v
web-next / new-api 主站
  |
  | 2. POST /api/app/noterx/session 生成用户临时 sk-token
  | 3. 同域部署时跳转 /noterx?token=...
  |    跨域部署时 POST https://noterx.example.com/api/auth/token-login
  v
NoteRx FastAPI
  |
  | 4. 303 跳转 /noterx?token=sk-xxx&llm_base_url=https://new-api.example.com/v1
  v
NoteRx 前端
  |
  | 5. 调用 /noterx/api/diagnose 或 /noterx/api/diagnose-stream，并带 X-LLM-API-Key: sk-xxx
  v
NoteRx 后端 -> new-api /v1 -> 上游模型
```

## 环境要求

- Python 3.11+
- Node.js 18+
- npm
- Nginx 或 Caddy
- 一个已部署可访问的 new-api 主站，例如 `https://token.example.com`

Windows 本地开发可以使用 `backend/venv/Scripts/python.exe`；Linux 生产环境建议使用系统 Python 或 pyenv。

## 本地开发

启动后端：

```bash
cd apps/noterx/backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Windows PowerShell：

```powershell
cd apps/noterx/backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

启动前端：

```bash
cd apps/noterx/frontend
npm install
npm run dev
```

前端开发服务默认把 `/api` 代理到 `http://localhost:8000`。如果后端端口不同，在 `apps/noterx/frontend/.env` 设置：

```env
VITE_API_PROXY_TARGET=http://localhost:8001
```

本地直接测试用户 token 链路：

```text
http://localhost:5173/noterx?token=sk-your-new-api-token&llm_base_url=http://localhost:3000/v1
```

## 生产环境变量

生产部署时，`backend/.env` 可以从 `../.env.example` 复制后精简：

```bash
cd apps/noterx
cp .env.example backend/.env
```

关键配置：

```env
# new-api 的 OpenAI-compatible 网关。web-next 正常跳转时也会通过 URL 传入 llm_base_url。
OPENAI_BASE_URL=https://token.example.com/v1

# 生产默认不要填 OPENAI_API_KEY，让 NoteRx 使用用户自己的 session token。
OPENAI_API_KEY=

# 只有本地调试或临时兜底时才打开。生产建议保持 0 或不设置。
NOTERX_ALLOW_ENV_LLM_KEY=0

# 模型名按你的 new-api 后台支持情况填写。
LLM_MODEL=gpt-5.5
LLM_MODEL_FAST=gpt-5.5
LLM_MODEL_PRO=gpt-5.5
LLM_MODEL_OMNI=gpt-5.5

# 如果使用视频理解，必须配置为公网可访问的 NoteRx HTTPS 域名。
MIMO_VIDEO_PUBLIC_BASE_URL=https://noterx.example.com
TEMP_VIDEO_SIGNING_KEY=change-to-a-long-random-secret
```

说明：

- `OPENAI_API_KEY` 不再是生产主路径。用户从应用广场进入时会使用用户自己的 key。
- 如果你手动访问 NoteRx，没有经过应用广场且没有 `?token=`，大模型调用会失败，这是预期行为。
- 如果确实要允许 `.env` Key 兜底，设置 `NOTERX_ALLOW_ENV_LLM_KEY=1` 并填写 `OPENAI_API_KEY`。

## 构建 NoteRx

构建前端：

```bash
cd apps/noterx/frontend
npm install
npm run build
```

构建完成后会生成：

```text
apps/noterx/frontend/dist
```

FastAPI 会自动托管这个目录：

- `/noterx`：NoteRx 主应用
- `/noterx/assets/*`：前端静态资源
- `/assets/*`：前端静态资源
- `/noterx/api/*`：NoteRx 后端 API，同域嵌入到 web-next 时使用，避免和主站 `/api/*` 冲突
- `/api/*`：后端 API，独立域名部署兼容入口
- `/api/auth/token-login`：跨域应用广场免登录桥接入口

## Linux 单机部署

以下示例假设部署目录为 `/opt/noterx`，域名为 `https://noterx.example.com`。

1. 上传代码：

```bash
sudo mkdir -p /opt/noterx
sudo chown -R $USER:$USER /opt/noterx
rsync -av apps/noterx/ /opt/noterx/
```

2. 安装后端依赖：

```bash
cd /opt/noterx/backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

3. 配置环境变量：

```bash
cp /opt/noterx/.env.example /opt/noterx/backend/.env
vim /opt/noterx/backend/.env
```

4. 构建前端：

```bash
cd /opt/noterx/frontend
npm install
npm run build
```

5. 创建 systemd 服务：

```ini
# /etc/systemd/system/noterx.service
[Unit]
Description=NoteRx FastAPI
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/noterx/backend
EnvironmentFile=/opt/noterx/backend/.env
ExecStart=/opt/noterx/backend/venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

启动服务：

```bash
sudo systemctl daemon-reload
sudo systemctl enable noterx
sudo systemctl restart noterx
sudo systemctl status noterx --no-pager -l
```

6. 配置 Nginx：

```nginx
server {
    listen 80;
    server_name noterx.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name noterx.example.com;

    ssl_certificate /etc/letsencrypt/live/noterx.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/noterx.example.com/privkey.pem;

    client_max_body_size 300m;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
    }
}
```

重载 Nginx：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

如果和 `web-next` 共用同一个域名，例如 `https://lob.cymoon.cn/noterx`，需要在主站 Nginx 中把 `/noterx` 优先转发到 NoteRx 后端，并放在主站 `/` 或 `/api` 规则之前：

```nginx
location ^~ /noterx/ {
    proxy_pass http://127.0.0.1:8000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 600s;
    proxy_send_timeout 600s;
    proxy_buffering off;
}
```

NoteRx 前端会请求 `/noterx/api/diagnose-stream`。如果浏览器里仍然看到 `https://你的域名/api/diagnose-stream`，说明没有发布新的前端构建产物。

## 接入 web-next 应用广场

NoteRx 服务部署好后，在 new-api 的 `web-next` 管理后台配置应用：

主站侧前置要求：

- new-api 后端已经部署，并且公网可以访问 `/api/app/:slug/session`、`/api/app/whoami` 和 `/v1`。
- `web-next` 使用当前代码重新构建发布，因为启动 NoteRx 时需要把 `llm_base_url=https://你的主站/v1` 一起带过去。
- NoteRx 的应用 `slug` 或 `target_url` 中需要包含 `noterx`，web-next 会据此识别并附加 `llm_base_url`。

重建主站前端：

```bash
cd web-next
npm install
npm run build
```

如果你的生产部署由 Go 后端托管 `web-next/dist`，构建完成后按主站原有流程重启 new-api 服务；如果由 Nginx 单独托管静态文件，则把新的 `web-next/dist` 发布到对应目录。

1. 登录管理后台。
2. 进入 `应用广场管理`，路径通常是 `/admin/ai-apps`。
3. 新建或编辑 NoteRx 应用。
4. 推荐配置：

```text
名称：NoteRx / 薯柒
Slug：noterx
应用地址：https://noterx.example.com/noterx
状态：上架
默认分组：按你的模型渠道分组填写，可留空继承用户分组
Session Token TTL：86400
访客额度：0 表示必须登录；大于 0 表示允许访客体验
```

用户从 `/apps` 或移动端应用广场点击 NoteRx 时，web-next 会：

- 调用 `/api/app/noterx/session` 生成当前用户的临时 token。
- 跳转到 `https://noterx.example.com/api/auth/token-login`。
- NoteRx 保存 token 并进入 `/noterx`。
- 后续诊断请求使用用户自己的 token 计费和记录日志。

## 更新部署

更新代码后：

```bash
cd /opt/noterx
git pull

cd /opt/noterx/frontend
npm install
npm run build

cd /opt/noterx/backend
source venv/bin/activate
pip install -r requirements.txt

sudo systemctl restart noterx
sudo systemctl reload nginx
```

如果只是前端样式或页面改动，通常重新 `npm run build` 后重启 `noterx` 即可。

## 验证清单

上线后按顺序检查：

```bash
curl -I https://noterx.example.com/noterx
ASSET_JS=$(grep -o '/noterx/assets/[^"]*\.js' /opt/noterx/frontend/dist/index.html | head -n 1)
curl -I "https://noterx.example.com${ASSET_JS}"
curl https://noterx.example.com/noterx/api/health
```

浏览器检查：

- 访问 `https://noterx.example.com/noterx` 能看到 NoteRx 页面。
- `/noterx/assets/*.js` 的响应头应是 `application/javascript` 或 `text/javascript`，不能是 `text/html`。
- `/noterx/api/diagnose-stream` 应由 NoteRx 后端处理，不能落到主站 `/api`；如果请求仍是 `/api/diagnose-stream`，说明前端还没有重新构建发布。
- 直接访问时页面会提示需要从应用广场进入，这是正常的。
- 从 web-next `/apps` 点击 NoteRx 后，地址栏短暂出现 token，然后前端会清理 URL。
- 发起诊断时，NoteRx 后端日志不应再依赖 `OPENAI_API_KEY`。
- new-api 后台日志能看到该用户 token 的模型调用记录。

## 常见问题

### 从应用广场点击后没有进入 NoteRx

检查 `target_url` 是否填成了：

```text
https://noterx.example.com/noterx
```

不要填 `/api/auth/token-login`，web-next 会自动拼接 token-login 入口。

### 诊断时报 API Key 无效

优先检查：

- web-next 是否能正常生成 `/api/app/noterx/session` token。
- NoteRx 前端请求是否带了 `X-LLM-API-Key`。
- `llm_base_url` 是否指向 new-api 的 `/v1`，例如 `https://token.example.com/v1`。
- new-api 中该用户 token 是否过期、禁用或余额不足。

### 直接打开 NoteRx 不能调用模型

这是预期行为。生产环境默认不读 `.env` 里的项目 Key。需要从 web-next 应用广场进入，或者本地调试时手动追加：

```text
https://noterx.example.com/noterx?token=sk-xxx&llm_base_url=https://token.example.com/v1
```

### 需要保留 `.env` Key 兜底

只建议本地调试使用：

```env
NOTERX_ALLOW_ENV_LLM_KEY=1
OPENAI_API_KEY=sk-xxx
OPENAI_BASE_URL=https://token.example.com/v1
```

### 视频分析失败

视频理解通常要求模型服务能访问 NoteRx 暂存视频 URL。请确认：

```env
MIMO_VIDEO_PUBLIC_BASE_URL=https://noterx.example.com
TEMP_VIDEO_SIGNING_KEY=change-to-a-long-random-secret
```

并确认 Nginx `client_max_body_size` 足够大，`proxy_read_timeout` 不低于 600 秒。
