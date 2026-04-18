# web-next

new-api 前端重写版。目标替代 `web/`（React 18 + Semi）；过渡期两者并存。

## Stack

Vite 6 · React 19 · TypeScript 5 strict · Tailwind 3 · shadcn/Radix（待加） · TanStack Query · react-router v7 · react-i18next（zh / en）· Lucide

## Design source

所有 token、排印、color、spacing 均来自 `../design_file/`。**不要在本目录内重定义 token。**
详见项目根 `.impeccable.md` 与 `design_file/README.md`。

## Dev

```bash
cd web-next
bun install
bun run dev   # http://localhost:4928
```

后端必须在 `localhost:3000` 启动（`go run main.go`），Vite 代理 `/api`、`/pg`、`/v1` 到后端。

## Scripts

| Script | Purpose |
|---|---|
| `bun run dev` | 开发服务器（端口 4928） |
| `bun run build` | 产出 `dist/` |
| `bun run typecheck` | 纯类型检查，无输出 |
| `bun run preview` | 预览 build 结果 |
| `bun run lint` | prettier check |

## 目录约定

```
web-next/
├── src/
│   ├── main.tsx              # 入口
│   ├── App.tsx               # 根组件 + i18n / query client / router
│   ├── index.css             # @import design_file tokens + tailwind
│   ├── routes.tsx            # 路由表
│   ├── pages/                # 页面级组件
│   ├── components/
│   │   ├── ui/               # shadcn primitives（按需 add）
│   │   ├── layout/           # Sidebar / Topbar / Shell
│   │   └── …                 # 业务组件
│   ├── lib/
│   │   ├── utils.ts          # cn() helper
│   │   └── api.ts            # axios 实例 + tenant headers
│   ├── hooks/                # 自定义 hooks
│   └── i18n/                 # { index, zh.json, en.json }
└── public/
```
