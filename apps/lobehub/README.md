# LobeHub 应用说明

`apps/lobehub` 是一个独立的前端应用项目，不依赖主系统的 `web-next`、`wxapp` 开发命令。默认语言为中文，仅保留中文和英文资源。

## 目录说明

```text
apps/lobehub/
├── src/                    # Web 应用源码
├── locales/                # Web 语言资源，仅保留 zh-CN 与 en-US
├── packages/               # 项目内部包
├── apps/desktop/           # 桌面端相关代码
├── public/                 # 静态资源
├── package.json            # 项目脚本
└── README.md               # 当前说明
```

## 环境要求

- Node.js 按 `.nvmrc` 配置，当前为 `lts/krypton`
- pnpm 10.x，项目 `package.json` 中已声明 `packageManager`
- Bun，部分构建脚本会调用 `bun run`

## 本地开发

```bash
cd apps/lobehub
pnpm install
pnpm dev
```

常用开发命令：

```bash
pnpm dev:next       # Next 开发服务
pnpm dev:spa        # SPA 开发服务
pnpm dev:desktop    # 桌面端开发
```

## 构建

```bash
cd apps/lobehub
pnpm install
pnpm build
```

如果只需要构建指定形态：

```bash
pnpm build:spa
pnpm build:next
pnpm desktop:build:all
```

## 部署说明

该项目按独立应用部署。构建前请先确认环境变量、模型服务地址、登录方式、数据库和文件存储等配置。

常见部署流程：

1. 在服务器安装 Node.js 与 pnpm。
2. 进入 `apps/lobehub`。
3. 安装依赖并执行构建。
4. 使用项目实际需要的运行方式启动服务，例如 Next 服务、静态 SPA 或桌面端打包产物。
5. 使用 Nginx/Caddy 做域名、HTTPS 和反向代理。

## 语言资源

当前仅保留：

- `locales/zh-CN`
- `locales/en-US`
- `apps/desktop/resources/locales/zh-CN`
- `apps/desktop/resources/locales/en`

默认语言为 `zh-CN`。如需新增语言，需要同步更新语言枚举、语言选项、运行时加载逻辑和桌面端资源。
