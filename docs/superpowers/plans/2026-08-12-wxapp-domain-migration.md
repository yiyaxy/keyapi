# 微信小程序接口域名迁移实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让微信小程序生产包直接访问 `https://token.mooschh.com`，不再依赖旧域名跳转。

**Architecture:** 保留现有 UniApp 请求封装和扫码登录流程，只修改 API 基础地址与 H5 聊天入口。增加一个针对微信小程序生产构建产物的检查脚本，确保产物包含新域名且不包含旧域名。

**Tech Stack:** UniApp、Vue 3、Node.js、pnpm、微信小程序生产构建

## Global Constraints

- API 基础地址必须是 `https://token.mooschh.com`。
- H5 聊天地址必须是 `https://token.mooschh.com/m/chat`。
- 生产构建产物不得包含 `token.cymoon.cn`。
- 不修改后端接口、数据库、微信 AppID、登录流程或服务器配置。

---

### Task 1: 生产构建域名回归检查

**Files:**
- Create: `wxapp/scripts/check-production-domain.mjs`
- Modify: `wxapp/package.json`

**Interfaces:**
- Consumes: `wxapp/dist/build/mp-weixin` 微信小程序生产构建产物。
- Produces: `npm run test:production-domain`，成功时退出码为 0，域名错误时退出码非 0。

- [ ] **Step 1: 编写构建产物检查脚本**

```js
import { readdir, readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const outputDir = fileURLToPath(new URL('../dist/build/mp-weixin/', import.meta.url))
const textExtensions = new Set(['.js', '.json', '.wxml', '.wxss', '.html'])
const oldHost = 'token.cymoon.cn'
const newHost = 'token.mooschh.com'

async function collectTextFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await collectTextFiles(path))
    else if (textExtensions.has(extname(entry.name))) files.push(path)
  }
  return files
}

const files = await collectTextFiles(outputDir)
const contents = await Promise.all(files.map((file) => readFile(file, 'utf8')))
if (contents.some((content) => content.includes(oldHost))) {
  throw new Error(`生产构建仍包含旧域名：${oldHost}`)
}
if (!contents.some((content) => content.includes(newHost))) {
  throw new Error(`生产构建缺少新域名：${newHost}`)
}
console.log(`生产构建域名检查通过：${newHost}`)
```

- [ ] **Step 2: 注册回归命令**

在 `wxapp/package.json` 的 `scripts` 中增加：

```json
"test:production-domain": "uni build -p mp-weixin && node scripts/check-production-domain.mjs"
```

- [ ] **Step 3: 运行检查并确认旧代码失败**

Run: `npm run test:production-domain`

Expected: FAIL，错误包含 `生产构建仍包含旧域名：token.cymoon.cn`。

### Task 2: 切换小程序生产域名

**Files:**
- Modify: `wxapp/src/config/env.js:2`
- Modify: `wxapp/src/pages/apps/index.vue:159`

**Interfaces:**
- Consumes: 现有 `env.basePath` 请求入口和 `H5_CHAT_URL` 页面入口。
- Produces: API 请求访问 `https://token.mooschh.com`，聊天入口访问 `https://token.mooschh.com/m/chat`。

- [ ] **Step 1: 修改 API 基础地址**

```js
basePath: 'https://token.mooschh.com',
```

- [ ] **Step 2: 修改 H5 聊天地址**

```js
const H5_CHAT_URL = 'https://token.mooschh.com/m/chat'
```

- [ ] **Step 3: 运行域名回归检查**

Run: `npm run test:production-domain`

Expected: PASS，输出包含 `生产构建域名检查通过：token.mooschh.com`。

- [ ] **Step 4: 检查代码差异和格式**

Run: `git diff --check && git diff -- wxapp/package.json wxapp/scripts/check-production-domain.mjs wxapp/src/config/env.js wxapp/src/pages/apps/index.vue`

Expected: `git diff --check` 无输出，差异只包含计划内文件。

- [ ] **Step 5: 提交实现**

```bash
git add docs/superpowers/plans/2026-08-12-wxapp-domain-migration.md wxapp/package.json wxapp/scripts/check-production-domain.mjs wxapp/src/config/env.js wxapp/src/pages/apps/index.vue
git commit -m "fix(wxapp): 切换小程序生产域名"
```
