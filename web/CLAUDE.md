# keyapi/web — Claude 工作手册

## 项目性质

React 18 + Vite 的 **AI 网关 / API Key 管理 SaaS** 前端，多租户、计费、渠道、playground 全在一个后台。
默认语言 **zh**；所有新增文案必须走 `react-i18next`，不得硬编码中文到组件。

## Tech Stack（必须遵守）

- 主组件库 **@douyinfe/semi-ui**；次组件库 antd 6（仅兜底，**新页面不得引入**）
- 图标：`@douyinfe/semi-icons` / `lucide-react` / `@lobehub/icons`
- 图表：`@visactor/react-vchart` + Semi theme（双主题自动跟随）
- Tailwind 3：色值 / 圆角均绑到 Semi CSS variables（`tailwind.config.js`），**禁止 `#xxxxxx` 硬编码**
- 字体栈：`Lato, 'Helvetica Neue', Arial, 'Microsoft YaHei', sans-serif`
- 包管理：`bun`（lockfile 为 `bun.lock`）
- Lint / format：`bun run lint`、`bun run eslint`

## 常用命令

```bash
bun run dev          # Vite dev server
bun run build        # 生产构建
bun run lint         # prettier check
bun run lint:fix     # prettier write
bun run eslint       # ESLint
bun run i18n:extract # i18next key 抽取
bun run i18n:sync    # 多语言同步
```

## 目录约定

```
src/
  components/
    auth/ common/ dashboard/ layout/ model-deployments/
    platform/ playground/ settings/ setup/ table/ tenant/ topup/
  pages/           # 路由级页面，一个目录一个页面
  context/ contexts/
  helpers/ hooks/ services/ types/
  i18n/            # 多语言资源
```

新组件先检查 `components/common` 是否已封装；能用 Semi 组件绝不自造。

## Import 细节（历史踩坑）

- `TextArea` 必须从 `@douyinfe/semi-ui` 顶层命名导入；**不能**从 `Input` 解构（提交 `2736428` 已修）
- 支付相关从 `services/payment` 走，命名统一 `Provider`，不要用旧的 `PaymentProvider`（提交 `f49ecea`）

---

## Design Context

### Users

核心画像：**最终付费用户**（开发者型个人买家或小团队管理员）。
典型任务：
- 注册 → 首次充值 / 订阅
- 查余额、消耗明细、账单
- 申请 / 下载开发票
- 开 API key、看日志、跑 playground

心态：花真金白银买 LLM 额度，对**价格透明度**、**支付反馈**、**余额准确性**高度敏感；被 OpenAI / Anthropic 后台训练过眼睛。

JTBD：
1. 60 秒内看懂"剩多少 / 花了多少 / 下一笔何时扣"
2. 一键完成充值、切换订阅、开票
3. 拿到可用的 API key 与最小可跑接入片段

### Brand Personality

**技术 · 锐利 · 现代。**

- 像 developer tool，不像"企业管理系统"
- 文案短促、动词优先、不用客服话术（禁"尊敬的用户""亲"）
- 数字大于文字 —— 余额 / 消耗 / 价格是视觉主角
- 英文术语保留（API Key / Token / Quota / Playground），不强行翻译
- 情绪目标：**"这钱花得放心、花得专业"**。信心 > 热情；克制 > 讨好。

### Aesthetic Direction

**想像它**（参考系）：
- OpenAI Platform（platform.openai.com）
- Anthropic Console（console.anthropic.com）

**绝不要像**（反参考）：
- 花哨 Web3 渐变 / 玻璃拟态满屏浮动
- 传统 SaaS 后台：彩虹 tag、卡通图标、拥挤顶栏
- 国风管理系统：大红大金、报表堆叠、icon 尺寸混乱

主题：
- **明暗双主题跟随系统**（明为默认）
- **品牌主色在双主题下感知一致**：对比度 ≥ 4.5:1（文字）/ ≥ 3:1（大元素）
- VChart 调色盘走 Semi `data-0..19` 语义色，禁止自配 hex

视觉语言：
- 圆角：小 / 中为主（`--semi-border-radius-small` / `medium`）
- 留白节奏：12 / 16 / 24 三档
- 分层靠 `bg-0 → bg-1 → bg-2` 背景色 + 边框，**不堆阴影**
- 主色仅用于主 CTA、关键数字、选中态 —— 一屏一个主色按钮

Typography：
- 数字用 tabular-nums（金额、token、用量务必列对齐）
- Heading 字重 600，不要 700+
- 代码 `source-code-pro, Menlo, Monaco, Consolas`

### Design Principles（每条都是硬约束）

1. **Money is the hero.** 余额 / 消耗 / 价格最大字号 + 最粗字重 + tabular-nums。
2. **Token over hex.** 所有颜色 / 圆角 / 间距走 Semi variables 或 Tailwind 映射；禁 `#xxxxxx` 硬编码、禁内联 `style` 写死色值。
3. **One primary per screen.** 每个视图仅一个主色 CTA，其余降级 tertiary / text。
4. **Density with air.** 高密度数据 + 稳定留白节奏（12/16/24）+ 层级背景；不靠边框堆叠分层。
5. **Dual-theme parity.** 任何新组件必须明暗双主题对比度达标；图表用 data-n 语义色。
6. **i18n by default.** 文案进 `react-i18next`；zh 为源；术语表保留英文。
7. **Semi first, custom last.** 能用 Semi 就不自造；自造前先翻 `components/common`。

> 本 Design Context 与 `.impeccable.md` 同步；修改需两处一起改。
