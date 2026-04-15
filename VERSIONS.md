# VERSIONS.md

Detailed change history for CaMeL-api. For architecture and build instructions, see [CLAUDE.md](./CLAUDE.md).

## v2.6.0329 (2026-03-29): 票通支付宝乐企联用支付信息接入（方案二：直接开具传入支付信息版）

- **目标**：在蓝字开票时支持 `invIssueChannel=5`（支付宝乐企联用）和 `paymentList` 支付信息列表，满足票通接口 2.9 的乐企联用要求。
- **改动范围**：
  - `model/invoice_item.go`：`InvoiceItem` 新增 4 个字段 `PaymentCode`、`TradeNoThirdParty`、`SubMchid`、`Account`
  - `dto/invoice.go`：`InvoiceApplicationDetailItem` 追加 4 字段；新增 `InvoiceAdminSetItemPaymentInfoRequest` DTO
  - `controller/invoice.go`：`buildDetailResponse` 映射 4 个新字段
  - `service/invoice_provider/piaotong_client.go`：新增 `PaymentItem` 结构体；`IssueBlueInvoice` 方法新增 `invIssueChannel` 和 `paymentList` 参数
  - `service/invoice_issue_service.go`：`piaoTongBlueInvoiceRequest` 新增 `InvIssueChannel`/`PaymentList`；新增 `buildPaymentListFromItems` 辅助函数；`IssueInvoiceByPiaoTong` 透传新参数
  - `service/invoice_service.go`：新增 `SetInvoiceItemPaymentInfo` 函数
  - `controller/invoice_admin.go`：新增 `InvoiceAdminSetItemPaymentInfo` controller
  - `router/api-router.go`：新增 `POST /applications/:id/items/:item_id/payment_info` 路由
  - 前端 6 个 locale JSON：新增 6 个 invoice key
  - `web/src/hooks/invoice/useInvoiceAdminData.js`：新增 `setItemPaymentInfo` hook
  - `web/src/pages/InvoiceAdmin/index.jsx`：订单明细表新增支付信息列（含橙色缺失标签和编辑按钮）；新增支付信息编辑弹窗
- **设计决策**：自动检测——只要任意 item 填写了支付信息，`buildValidatedPiaoTongInvoiceRequest` 自动设置 `invIssueChannel=5` 并构建 `paymentList`；普通开票不受影响。
- **测试结果**：`go build ./...` ✅；`bun run build` ✅

## v2.6.0308e (2026-03-08): Wallet /console/topup UI redesign

**Goal:** 在不改任何业务逻辑的前提下，重做用户侧钱包页 `/console/topup` 的界面结构与视觉层级，让订阅、充值、邀请奖励更简洁、更高级、更清晰。

**Approach:** 保留原有数据请求、在线充值、Stripe/Creem 支付、兑换码、账单弹窗、邀请返利划转、订阅购买与偏好更新逻辑，仅重构页面信息架构与卡片视觉；首页增加钱包总览区，主体改为订阅主区 + 充值/邀请侧栏，并统一三个 topup 子组件的留白、边框、圆角和 CTA 风格。

**Changed Files:**
| File | Changes |
|------|---------|
| `web/src/components/topup/index.jsx` | 重组 `/console/topup` 页面布局，新增钱包总览区并整理订阅主区与右侧操作区 |
| `web/src/components/topup/RechargeCard.jsx` | 重做充值卡的信息层级、金额输入区、支付方式区、兑换码区和账单入口样式 |
| `web/src/components/topup/SubscriptionPlansCard.jsx` | 重做订阅状态摘要、套餐卡片、扣费策略区和轻量说明区样式 |
| `web/src/components/topup/InvitationCard.jsx` | 重做邀请奖励摘要、邀请链接区、划转入口和规则说明区样式 |
| `CLAUDE.md` | 记录本次钱包页 UI 重构 |

**Decisions:**
- 只改用户侧 `/console/topup`，不动后台 `/console/subscription`
- 只改 UI / 布局 / 信息呈现，不改接口、支付流程和业务逻辑
- 继续复用现有 modal、支付方法分流和订阅格式化 helper

**Verification:** `cd /home/bigdata/lmy/CaMeL-api/web && bun run build` passed.

---

## v2.6.0308d (2026-03-08): SmartCache frontend channel discount display alignment

**Goal:** 让 usage logs 单行 SmartCache 节约展示对齐后端新增的 `channel_ratio < 1` 渠道折扣口径，并且仍然只在 `cache_tokens > 0` 时显示节约。

**Approach:** 让 `getSmartCacheSavingsQuota()` 优先使用日志行的已记录 `quota / channel_ratio` 还原渠道折扣前金额，仅在 logged quota 不可用时回退到 token 公式；输入列和花费列都显式传入 `record.quota`，并将 tooltip 文案切到现有 `渠道优惠` 多语言 key。

**Changed Files:**
| File | Changes |
|------|---------|
| `web/src/helpers/render.jsx` | SmartCache savings helper 新增 quota 入参，允许 `cache_ratio == 0`，并按后端一致顺序优先走 `quota/channel_ratio` 再回退 token 重建 |
| `web/src/components/table/usage-logs/UsageLogsColumnDefs.jsx` | 输入列/花费列调用 helper 时传入 `record.quota`，渠道折扣 tooltip 改用 `渠道优惠` |
| `CLAUDE.md` | 更新任务记录 |

**Verification:** `cd /home/bigdata/lmy/CaMeL-api/web && bun run build` passed.

---

## v2.6.0308c (2026-03-08): SmartCache savings include channel discount

**Goal:** 让 SmartCache savings 后端统计在 `cache_tokens > 0` 的请求上额外计入 `channel_ratio < 1` 带来的渠道折扣收益，并保持现有缓存节约口径不变。

**Approach:** 将 `model/log.go` 中仅依赖 `other` JSON 的 helper 改为读取整条日志；保留原有 `cache_tokens * base_input_ratio * (1 - cache_ratio)` 缓存节约计算，并在缓存命中日志上追加 `full_quota_before_channel_discount * (1 - channel_ratio)` 渠道折扣节约，聚合入口继续复用 `getCacheSavings` 与 `sumSmartCacheSavingsQuotaFromQuery`。

**Changed Files:**
| File | Changes |
|------|---------|
| `model/log.go` | savings 查询改为读取 `quota/prompt_tokens/completion_tokens/other`；新增 log-aware SmartCache helper；缓存命中时追加 `channel_ratio < 1` 的渠道折扣节约 |
| `CLAUDE.md` | 记录本次后端 SmartCache 统计修正 |

**Verification:** `go build ./...` passed.

---

## v2.6.0308b (2026-03-08): Channel-specific billing ratio

**Goal:** 为每个渠道支持专属计费倍率 (`channel_ratio`) 和模型倍率覆盖 (`model_ratio_override`)，仅管理员可见。

**Approach:** DTO 新增两个字段存入 `setting` JSON；`PriceData` 新增 `OriginalModelRatio` 支持重试时还原；`ApplyChannelBillingOverrides()` 在所有 11 个 relay handler 的 `InitChannelMeta` 后调用；Claude/WSS/Audio 结算路径补齐 `OtherRatios` 乘积；日志记录 channel_ratio 和 model_ratio_override。

**Changed Files:**
| File | Changes |
|------|---------|
| `dto/channel_settings.go` | 新增 `ChannelRatio float64` 和 `ModelRatioOverride map[string]float64` 字段 |
| `types/price_data.go` | 新增 `OriginalModelRatio float64` 字段 |
| `relay/helper/price.go` | `ModelPriceHelper` 设置 `OriginalModelRatio`；新增 `ApplyChannelBillingOverrides()` 函数 |
| `relay/*.go` (11 files) | 在 `InitChannelMeta` 后注入 `ApplyChannelBillingOverrides` 调用（16 处） |
| `service/quota.go` | `PostClaudeConsumeQuota`/`PostWssConsumeQuota`/`PostAudioConsumeQuota` 补齐 OtherRatios 应用 |
| `service/log_info_generate.go` | 4 个 GenerateXxxOtherInfo 函数记录 channel_ratio 和 model_ratio_override |
| `web/.../EditChannelModal.jsx` | 新增 channel_ratio InputNumber 和 model_ratio_override TextArea |
| `web/src/i18n/locales/*.json` (6 files) | 新增 6 个翻译 key（渠道计费倍率、说明、模型倍率覆盖、说明、示例） |

**Build:** `go build ./...` ✅ | `bun run build` ✅

---

## v2.6.0308a (2026-03-08): Configurable cache billing mode semantics

**Goal:** 合并 feature/calc worktree 的缓存计费语义改动到 main，并补齐渠道编辑弹窗里缺失的前端配置入口。

**Approach:** 后端直接合并 worktree 中的 Go 改动：新增 `cache_billing_mode` 配置类型与语义 helper，并在兼容计费路径、Claude/OpenRouter 计费路径和日志元数据里统一复用；前端在 `EditChannelModal.jsx` 中新增 cache billing mode 下拉框，将值持久化到 `setting` JSON，并补充 6 个语言包文案。

**Changed Files:**
| File | Changes |
|------|---------|
| `dto/channel_settings.go` | 新增 `CacheBillingMode` 类型、`auto/inclusive/exclusive` 常量和 `ChannelSettings.CacheBillingMode` 字段 |
| `service/cache_billing.go` | 新增 effective mode / semantic 解析和 `ShouldSubtractCachedTokens` helper |
| `relay/compatible_handler.go` | 改为按生效语义决定是否先从基础输入 tokens 中扣减 cached tokens，并把最终语义写入 consume log `other` |
| `service/quota.go` | Claude/OpenRouter 结算逻辑改为复用共享 helper，避免硬编码渠道类型语义 |
| `service/log_info_generate.go` | 日志 `other` 新增 `cache_billing_mode` 与 `cache_billing_semantic` |
| `web/src/components/table/channels/modals/EditChannelModal.jsx` | 新增 cache billing mode 选择框，并接入编辑回填、保存和重置流程 |
| `web/src/i18n/locales/{en,zh,fr,ja,ru,vi}.json` | 新增 cache billing mode 文案 |
| `CLAUDE.md` | 记录合并结果 |

**Rules:**
- `auto`：Anthropic 按 `exclusive`，其他渠道按 `inclusive`
- `inclusive`：`prompt_tokens` 已包含 cache tokens，结算时先减去 cache tokens，再按缓存倍率加回
- `exclusive`：`prompt_tokens` 不包含 cache tokens，结算时不减去 cache tokens

**Verification:** pending (`go build ./...`, `bun run build`).

---

## v2.6.0307g (2026-03-07): Usage logs SmartCache savings alignment

**Goal:** 修正 usage logs 的 SmartCache 节约展示口径，使顶部标签对齐后端统计字段，并修复单行原价展示。

**Approach:** 删除前端按页聚合的节约计算，顶部标签直接读取 stat 接口返回的 `smartcache_savings_quota`；单行花费改为按后端同口径从 `record.other` 计算 `savedQuota = cache_tokens * model_ratio * effective_group_ratio * (1 - cache_ratio)`（优先 `user_group_ratio`），再用 `actualQuota + savedQuota` 还原原价，并统一复用 3 位小数的 SmartCache 格式化。

**Changed Files:**
| File | Changes |
|------|---------|
| `web/src/hooks/usage-logs/useUsageLogsData.jsx` | 移除 page-level savings 聚合与透传 |
| `web/src/components/table/usage-logs/UsageLogsActions.jsx` | SmartCache 标签改读 `stat.smartcache_savings_quota`，按 today/自定义时间范围切换文案 |
| `web/src/components/table/usage-logs/UsageLogsColumnDefs.jsx` | 单行花费改为 `actualQuota / savedQuota / originalQuota` 计算，保留订阅抵扣逻辑 |
| `web/src/helpers/render.jsx` | 新增 `getSmartCacheSavingsQuota` 和 `renderSmartCacheQuota` helper |
| `web/src/i18n/locales/{en,zh,fr,ja,ru,vi}.json` | 新增"本日已节约 / 所选时间已节约"翻译 |
| `CLAUDE.md` | 记录任务 |

**Verification:** `bun run build` passed.

---

## v2.6.0307f (2026-03-07): Dashboard SmartCache badge today-stat fix

**Goal:** Dashboard SmartCache badge 改为使用当日时间范围请求后端 savings 统计，并以 3 位小数显示金额。

**Frontend Changes:**
- `useDashboardData.js` — `getUserData` 中 cache_savings API 请求新增 `start_timestamp`/`end_timestamp` 参数（当日 00:00:00 到 23:59:59），确保 badge 仅反映今日节约
- `DashboardHeader.jsx` — `renderQuota` 调用改为 3 位小数 (`renderQuota(quota, 3)`)

**Changed Files:**
| File | Changes |
|------|---------|
| `web/src/hooks/dashboard/useDashboardData.js` | cache_savings API 加当日时间戳参数 |
| `web/src/components/dashboard/DashboardHeader.jsx` | renderQuota 改为 3 位小数 |
| `CLAUDE.md` | 记录本次修复 |

**Verification:** `bun run build` passed.

---

## v2.6.0307e (2026-03-07): SmartCache savings backend quota fix

**Goal:** 修正 SmartCache savings 统计口径，改为按每条日志的真实缓存输入优惠差额计算，并将该汇总并入日志统计接口。

**Approach:** 在 `model/log.go` 中新增共享 helper，解析 consume log 的 `other` JSON，按 `cache_tokens * base_input_ratio * (1 - cache_ratio)` 计算 savings；优先使用 `user_group_ratio`，否则回退 `group_ratio`。`/api/log/self/cache_savings`、`/api/log/cache_savings` 与 `SumUsedQuota` 统一复用该 helper。

**Changed Files:**
| File | Changes |
|------|---------|
| `model/log.go` | 新增 SmartCache savings 共享计算 helper；`GetUserCacheSavings`/`GetAllCacheSavings` 复用共享逻辑；`Stat` 新增 `smartcache_savings_quota`；`SumUsedQuota` 聚合该字段 |
| `controller/log.go` | admin/self 日志统计响应新增 `smartcache_savings_quota` |
| `CLAUDE.md` | 记录本次 SmartCache 后端修复 |

**Verification:** `go build ./...` passed.

---

## v2.6.0307d (2026-03-07): Purchase analytics heatmap one-year view

**Goal:** 热力图扩展到显示未来一年，增加月份标签，且不受上方时间筛选器影响。

**Backend Changes:**
- `model/purchase_analytics.go:816` — 最大范围从 90 天提升到 400 天，支持前端请求一年范围

**Frontend Changes:**
- `usePurchaseAnalyticsData.js` — 热力图 API 使用固定范围（今天 -30 到 +365 天），不再使用 date picker 的 timeRange
- `PurchaseAnalytics/index.jsx` — HeatmapCalendar 组件填充完整日期范围（-30 到 +365 天），在热力图顶部显示月份标签（Jan, Feb...），cell size 缩小到 11px/2px-gap 以适应 ~57 周宽度

**Changed Files:**
| File | Changes |
|------|---------|
| `model/purchase_analytics.go` | maxDuration 从 90 天改为 400 天 |
| `web/src/hooks/purchase-analytics/usePurchaseAnalyticsData.js` | 新增 getHeatmapRange() 固定范围函数；loadAllData 和 loadHeatmapOnly 使用固定范围 |
| `web/src/pages/PurchaseAnalytics/index.jsx` | HeatmapCalendar 填充完整日期、渲染月份标签、调整 cell size |

**Verification:** go build ./... passed; bun run build passed.

---

## v2.6.0307c (2026-03-07): Purchase analytics data accuracy & UI overhaul

**Goal:** 修正三个后端统计口径（转化漏斗、邀请排行、DAU），并将前端三个分析区从图表改为表格，新增套餐 hover 联动热力图。

**Backend Changes:**
| Function | Fix |
|----------|-----|
| `GetConversionFunnel` | total_users 改为 users.status=1（无时间过滤）；paying_users 合并 top_ups + subscription_orders 去重；repeat_buyers 为两表合计 >= 2 |
| `GetReferralAnalytics` | 改用 users.inviter_id 聚合被邀请人数；分别聚合 topup/subscription 收入（按 complete_time 过滤）；Go 侧按 inviter 合并；批量加载用户名 |
| `GetDAUTrend` | total_active_users 改为真正 union distinct（Go 侧 set 合并） |
| `GetSubscriptionHeatmap` | 新增 planID 参数，controller 读取 plan_id query param |

**Frontend Changes:**
| Change | Detail |
|--------|--------|
| 图表→表格 | 订单类型、支付方式、消费排行在 all/subscription/topup 三个 tab 均改为分页表格（每页 10 行） |
| 套餐 hover | 订阅明细表 hover 某行时热力图切换为该套餐数据；移出恢复全量 |
| Charts hook | 删除 paymentPieSpec/orderBarSpec/topUsersSpec，仅保留 trendSpec/dauSpec/registrationSpec |
| Data hook | heatmap API 加 plan_id 参数；heatmapPlanId 变化仅刷新热力图不触发全量刷新 |

**Changed Files:**
| File | Changes |
|------|---------|
| `model/purchase_analytics.go` | 重写 GetConversionFunnel、GetReferralAnalytics；修正 GetDAUTrend；GetSubscriptionHeatmap 加 planID |
| `controller/purchase_analytics.go` | GetSubscriptionHeatmap 读取 plan_id |
| `web/src/pages/PurchaseAnalytics/index.jsx` | 三个分析区改表格；套餐 hover 联动热力图 |
| `web/src/hooks/purchase-analytics/usePurchaseAnalyticsData.js` | heatmap plan_id 参数；独立刷新逻辑 |
| `web/src/hooks/purchase-analytics/usePurchaseAnalyticsCharts.js` | 删除三个图表 spec |

**Verification:** go build ./... passed; bun run build passed.

---

## v2.6.0307b (2026-03-07): Purchase analytics backend fixes

**Goal:** 修复转化漏斗、邀请分析、DAU 趋势和订阅热力图后端逻辑。

**Approach:** Go 侧去重合并 top_ups + subscription_orders 计算转化漏斗（total_users 用 users.status=1 无时间过滤）；邀请分析改用 users.inviter_id 聚合被邀请人数，按 complete_time 过滤订单收入；按桶收集用户 ID 集合计算真实 union distinct DAU；热力图新增 plan_id 可选过滤。

**Changed Files:**
| File | Changes |
|------|---------|
| `model/purchase_analytics.go` | 重写 GetConversionFunnel（total_users 用 status=1，paying/repeat 合并两表去重）、GetReferralAnalytics（改用 users.inviter_id 聚合，按 complete_time 过滤收入）、GetDAUTrend（真实 union distinct）、GetSubscriptionHeatmap（新增 planID 参数） |
| `controller/purchase_analytics.go` | GetSubscriptionHeatmap 读取 plan_id 查询参数并传递 |

**Notes:**
- go build ./model/... ./controller/... 编译通过。

---

## v2.6.0307a (2026-03-07): Purchase analytics marketing frontend completion

**Goal:** 完成 PurchaseAnalytics all tab 的营销分析接入，展示 DAU、注册趋势、转化漏斗和邀请榜单，并保持现有分析页行为稳定。

**Approach:** 在现有 purchase analytics hook 中补充营销接口请求和状态，新增 DAU/注册图表 spec，并在 all tab 渲染营销分析区块与邀请榜单分页排名。

**Changed Files:**
| File | Changes |
|------|---------|
| `web/src/hooks/purchase-analytics/usePurchaseAnalyticsData.js` | 新增 `dau`、`registrations`、`conversion`、`referral` 状态和对应 API 请求，按当前时间范围与 granularity 取数 |
| `web/src/hooks/purchase-analytics/usePurchaseAnalyticsCharts.js` | 新增 `dauSpec`、`registrationSpec`，使用后端精确字段渲染图表 |
| `web/src/pages/PurchaseAnalytics/index.jsx` | 在 all tab 新增营销分析区块、注册 best-effort 提示、转化漏斗卡片、邀请榜单，并保持分页 rank 正确 |
| `CLAUDE.md` | 记录本次实现的目标、方案、决策和后续事项 |

**Notes:**
- 注册趋势仍是 best-effort 统计，来源于注册赠送日志和邀请注册日志。
- 本次未运行前端构建；从代码层面看未引入明显的 build blocker。

---

## v2.6.0307 (2026-03-07): Purchase analytics marketing frontend

**Goal:** 在 PurchaseAnalytics 的 all tab 中补充营销分析模块，展示 DAU、注册趋势、转化漏斗和邀请榜单，并保持现有购买分析不变。

**Approach:** 扩展现有数据 hook 和图表 hook，对新接口提供空数据默认值，在 all tab 中新增图表和表格区块；邀请榜单使用本地分页以保证跨页排名连续正确。

**Changed Files:**
| File | Changes |
|------|---------|
| `web/src/hooks/purchase-analytics/usePurchaseAnalyticsData.js` | 新增 DAU、注册、转化、邀请榜单数据请求和 defensive defaults；默认 tab 切到 `all` |
| `web/src/hooks/purchase-analytics/usePurchaseAnalyticsCharts.js` | 新增 `dauSpec` 和 `registrationSpec` 图表配置导出 |
| `web/src/pages/PurchaseAnalytics/index.jsx` | 新增 all tab 总览卡片、DAU/注册图、转化漏斗、邀请排行榜，并修正榜单分页排名 |
| `CLAUDE.md` | 记录本次任务目标、方法、决策和后续事项 |

**Notes:**
- 仅使用已批准的营销分析 API 形状：`/dau`、`/registrations`、`/conversion`、`/referral`
- 未新增 locale key，缺失营销标签使用现有 key 或英文 plain labels
- 未运行前端 lint/build，建议联调时验证图表和表格字段

---

## v2.6.0306e (2026-03-06): PurchaseAnalytics 后端营销分析端点

**Goal:** 为 PurchaseAnalytics 补齐后端营销分析能力，支持 DAU、注册趋势、转化漏斗和邀请分析数据。

**Approach:** 在 `model/purchase_analytics.go` 中新增 4 个聚合查询，在 `controller/purchase_analytics.go` 暴露对应 handler，并在 `router/api-router.go` 注册 admin analytics 路由。

**Changed Files:**
| File | Changes |
|------|---------|
| `model/purchase_analytics.go` | 新增 `GetDAUTrend`、`GetRegistrationTrend`、`GetConversionFunnel`、`GetReferralAnalytics` 及对应 DTO |
| `controller/purchase_analytics.go` | 新增 4 个 PurchaseAnalytics handler |
| `router/api-router.go` | 注册 `/api/analytics/purchase/dau`、`/purchase/registrations`、`/purchase/conversion`、`/purchase/referral` |
| `CLAUDE.md` | 记录本次后端营销分析实现与 caveat |

**New API Endpoints:**
- `GET /api/analytics/purchase/dau` — DAU 趋势（API 活跃 / 登录活跃 / 汇总）
- `GET /api/analytics/purchase/registrations` — 注册趋势（最佳努力统计）
- `GET /api/analytics/purchase/conversion` — 转化漏斗（总用户 / 付费用户 / 复购用户）
- `GET /api/analytics/purchase/referral` — 邀请分析（邀请人数 / 邀请收入）

**Caveats:**
- `users` 表没有注册时间字段，`new_users` 依赖 `logs.type=4` 且 `content LIKE '新用户注册赠送%'` 的注册赠送日志，因此总注册数属于 best-effort 统计。
- `referred_users` 来自 `aff_rebate_logs` 的注册邀请记录。
- 当前 `total_active_users` 以 API 活跃和登录活跃的分桶结果合并，属于近似汇总而非两来源去重后的精确并集。

---

## v2.6.0306d (2026-03-06): PurchaseAnalytics 营销分析多语言补充

**Goal:** 为 PurchaseAnalytics 即将接入的营销分析模块补齐 DAU、注册、转化、邀请相关 i18n 文案。

**Approach:** 在 6 个 locale 文件的 `purchaseAnalytics.*` 区域中追加统一 key，并按现有分析页文案风格提供自然翻译。

**Changed Files:**
| File | Changes |
|------|---------|
| `web/src/i18n/locales/en.json` | 新增营销分析、DAU、注册趋势、转化漏斗、邀请分析等 19 个 `purchaseAnalytics` 翻译 key |
| `web/src/i18n/locales/zh.json` | 新增营销分析、DAU、注册趋势、转化漏斗、邀请分析等 19 个 `purchaseAnalytics` 翻译 key |
| `web/src/i18n/locales/fr.json` | 新增营销分析、DAU、注册趋势、转化漏斗、邀请分析等 19 个 `purchaseAnalytics` 翻译 key |
| `web/src/i18n/locales/ja.json` | 新增营销分析、DAU、注册趋势、转化漏斗、邀请分析等 19 个 `purchaseAnalytics` 翻译 key |
| `web/src/i18n/locales/ru.json` | 新增营销分析、DAU、注册趋势、转化漏斗、邀请分析等 19 个 `purchaseAnalytics` 翻译 key |
| `web/src/i18n/locales/vi.json` | 新增营销分析、DAU、注册趋势、转化漏斗、邀请分析等 19 个 `purchaseAnalytics` 翻译 key |

---

## v2.6.0306c (2026-03-06): PurchaseAnalytics 前端显示修复

**Goal:** 修复 PurchaseAnalytics 热力图 tooltip 金额显示，以及消费排行分页后的序号错误。

**Approach:** 热力图 tooltip 通过 `quota_per_unit` 将 quota 转成金额后复用现有货币格式化；消费排行表维护独立分页状态，并在切换 tab 时重置页码。

**Changed Files:**
| File | Changes |
|------|---------|
| `web/src/pages/PurchaseAnalytics/index.jsx` | 热力图 tooltip 改为金额显示；消费排行序号按分页偏移计算；切换 tab 时重置排行页码 |

---

## v2.6.0306b (2026-03-06): 返利 UI 同步 & 管理 UX 改进

**Goal:** 让邀请页面展示用户实际生效的返利参数（而非全局默认值），改善管理端返现设置的邀请人选择体验，更新返利文案，并从可见奖励日志中移除被邀请人身份信息。

**Approach:** 在 `/api/user/self` 响应中暴露 effective 返利字段，前端从 userState 读取；管理端复用 `/api/user/search` 实现实时搜索选择邀请人；修改 RecordLog 文本移除被邀请人信息。

**Changed Files:**
| File | Changes |
|------|---------|
| `controller/user.go` | GetSelf 新增 4 个 effective 返利字段 |
| `model/topup.go` | ProcessTopUpRebate 的 RecordLog 移除被邀请人 ID/用户名 |
| `web/src/components/topup/index.jsx` | InvitationCard props 改用 userState effective 值（带 fallback） |
| `web/src/components/topup/InvitationCard.jsx` | 更新 5 处返利文案，统一使用"充值返利"措辞 |
| `web/src/hooks/rebate-settings/useRebateSettingsData.js` | 新增 searchUsers 函数（300ms 防抖，调用 /api/user/search） |
| `web/src/pages/RebateSettings/index.jsx` | 邀请人字段改为 Select 远程搜索，编辑时禁用并预填标签，表格列显示 username (#id) |
| `web/src/pages/Setting/Operation/SettingsCreditLimit.jsx` | 更新 2 处管理端返利提示文案 |
| `web/src/i18n/locales/{zh,en,ja,fr,ru,vi}.json` | 更新/新增返利相关翻译 key |

**No new API endpoints.** Reuses existing `GET /api/user/search` and `model.GetEffectiveRebateSetting`.

---

## v2.6.0306 (2026-03-06): 个性化邀请返现设置

**Goal:** 支持针对不同邀请人设置不同的返现参数（邀请人奖励、被邀请人奖励、充值返利比例、返利次数），并提供独立的管理页面。

**Approach:** 独立表 `user_rebate_settings`，覆盖设置挂在邀请人身上。无自定义设置时使用全局默认值。

**Changed Files:**
| File | Changes |
|------|---------|
| `model/user_rebate_setting.go` | **新建** — UserRebateSetting 模型 + CRUD + GetEffectiveRebateSetting |
| `model/main.go` | migrateDB/migrateDBFast 注册 UserRebateSetting |
| `model/user.go` | inviteUser 改签名接受 registerReward, Insert 用 effective 设置 |
| `model/topup.go` | ProcessTopUpRebate 用 effective 设置替代全局变量 |
| `controller/user_rebate_setting.go` | **新建** — 5个 admin API handler |
| `router/api-router.go` | 注册 `/api/user_rebate_setting/*` 路由（AdminAuth） |
| `web/src/hooks/rebate-settings/useRebateSettingsData.js` | **新建** — 数据获取 + CRUD Hook |
| `web/src/pages/RebateSettings/index.jsx` | **新建** — 管理页面（表格 + SideSheet 编辑） |
| `web/src/App.jsx` | lazy import + AdminRoute `/console/rebate-settings` |
| `web/src/components/layout/SiderBar.jsx` | routerMap + adminItems 添加"返现设置" |
| `web/src/helpers/render.jsx` | getLucideIcon 添加 `rebateSettings` → `Percent` |
| `web/src/hooks/common/useSidebar.js` | DEFAULT_ADMIN_CONFIG 添加 `rebateSettings: true` |
| `web/src/types/api.ts` | 新增 UserRebateSetting interface |
| `web/src/i18n/locales/{zh,en,ja,fr,ru,vi}.json` | 添加返现设置相关翻译 |

**New API Endpoints:**
- `GET /api/user_rebate_setting/` — 设置列表（分页 + 搜索）
- `GET /api/user_rebate_setting/:id` — 获取用户有效设置
- `POST /api/user_rebate_setting/` — 创建设置
- `PUT /api/user_rebate_setting/` — 更新设置
- `DELETE /api/user_rebate_setting/:id` — 删除设置（恢复全局）

---

## v2.6.0225 (2026-02-24): CSRF 修复 - Logout 端点

**Goal:** 修复 `/api/user/logout` 的 CSRF 漏洞，将前端调用从 GET 改为 POST。

**Changed Files:**
| File | Changes |
|------|---------|
| `frontend_v2/components/Settings.tsx` | `handleRevokeSessions` 改用 `API.post('/api/user/logout')` 替代 `API.get()` |

**Backend TODO:**
- [ ] **CRITICAL SECURITY FIX REQUIRED:** `router/api-router.go` line 63 需要将 `userRoute.GET("/logout", controller.Logout)` 改为 `userRoute.POST("/logout", controller.Logout)`
- [ ] 原因：GET 请求容易受到 CSRF 攻击（恶意网站可通过 `<img>` 标签或链接触发登出），POST 请求需要 CSRF token 保护
- [ ] `controller/user.go` 的 `Logout` 函数无需修改（已经是 HTTP method 无关的实现）

---

## v2.6.0225b (2026-02-25): TypeScript 类型定义 & Plans.tsx 安全修复

**Goal:** 集中管理前端 TypeScript 类型定义，修复 Plans.tsx 支付表单注入漏洞。

**Changed Files:**
| File | Changes |
|------|---------|
| `web/src/types/api.ts` | **新建** — 所有后端模型的 TS 类型：User, Token, Log, Message, Subscription, Channel, TopUp, Redemption, ModelPrice + 工具类型 ApiResponse, PaginatedResponse, PageInfo, SearchParams |
| `web/src/types/index.ts` | **新建** — 重导出 API 类型 + 前端专用 UI 类型 |
| `web/src/pages/Plans/Plans.tsx` | `submitPaymentForm()` 新增安全验证：URL 白名单（仅 https:// 或 / 开头）、参数白名单、可疑参数拦截 |

---

## v2.6.0225a (2026-02-24): ModelSquare 定价公式文档 & Dashboard 内存泄漏修复

**Goal:** 记录 ModelSquare 定价公式的 `* 2` 乘数逻辑，修复 Dashboard 导出图表的内存泄漏。

**Changed Files:**
| File | Changes |
|------|---------|
| `web/src/pages/ModelSquare/ModelSquare.tsx` | `getModelPriceView()` 添加详细注释说明 `* 2` 乘数：backend model_ratio=1 代表 $0.002/1K tokens，转换为 $/1M tokens 需要 model_ratio * $2 |
| `web/src/pages/Dashboard/Dashboard.tsx` | `handleExportChart()` 添加 `URL.revokeObjectURL()` 清理 blob URL，防止内存泄漏 |

---

## v2.6.0224 (2026-02-22): Prompt 替换规则功能

**Goal:** 实现提示词替换功能，支持 4 种规则类型，支持全局规则和按渠道覆盖。

**Rule Types:**
- Type 1（整条替换）：最后一条 user 消息包含触发词则替换整条
- Type 2（关键词替换）：所有 user 消息做 strings.ReplaceAll
- Type 3（回复替换）：对 LLM 回复内容做关键词替换，支持流式/非流式
- Type 4（AI改写）：检测回复中的关键词，调用另一个 LLM 用自定义 prompt 改写

**Changed Files:**
| File | Changes |
|------|---------|
| `model/prompt_rule.go` | **新建** — PromptRule 模型 + 内存缓存 + CRUD + 渠道规则筛选 |
| `controller/prompt_rule.go` | **新建** — 管理员 CRUD 接口 |
| `service/prompt_replace.go` | **新建** — ApplyPromptRules + ApplyResponseContentRules + ApplyResponseRewriteRules |
| `router/api-router.go` | 注册 `/api/prompt_rule/*` 路由（AdminAuth） |
| `model/main.go` | migrateDB/migrateDBFast 添加 PromptRule + LoadPromptRuleCache |
| `controller/relay.go` | 在 request 解析后调用全局规则（channelId=0） |
| `relay/compatible_handler.go` | 在 DeepCopy 后调用渠道级规则 |
| `relay/channel/openai/relay-openai.go` | 非流式/流式回复替换和 AI 改写 |
| `relay/channel/openai/helper.go` | Claude/Gemini 格式回复替换 |
| `web/src/hooks/prompt-rule/usePromptRuleData.js` | **新建** — 数据获取 + CRUD Hook |
| `web/src/pages/PromptRule/index.jsx` | **新建** — 管理页面（表格 + Modal） |
| `web/src/App.jsx` | lazy import + AdminRoute `/console/prompt-rule` |
| `web/src/components/layout/SiderBar.jsx` | routerMap + adminItems 添加"提示词替换" |
| `web/src/helpers/render.jsx` | getLucideIcon 添加 `promptRule` → `Replace` |
| `web/src/hooks/common/useSidebar.js` | DEFAULT_ADMIN_CONFIG 添加 `promptRule: true` |
| `web/src/i18n/locales/{zh,en,ja,fr,ru,vi}.json` | 添加提示词替换相关翻译 |

**New API Endpoints:**
- `GET /api/prompt_rule/` — 规则列表（分页 + 搜索）
- `POST /api/prompt_rule/` — 创建规则
- `PUT /api/prompt_rule/` — 更新规则
- `DELETE /api/prompt_rule/:id` — 删除规则

---

## v2.6.0220 (2026-02-20)

Previous stable release.

---

## v2.6.0218 (2026-02-18): 翻译系统全面优化

**Goal:** 解决翻译系统三大性能问题：前端重复请求、后端逐条 LLM 调用、保存时全量清缓存

**Approach:**
1. 前端翻译缓存 + 请求去重（同一 URL 并发只发一次）
2. 后端批量合并翻译（N 条内容合并为 1-2 次 LLM 调用）
3. 精准缓存失效（SourceHash 校验，内容不变则不重新翻译）
4. 稳定 contentId（基于内容 hash，不受排序变化影响）

**Changed Files:**
| File | Changes |
|------|---------|
| `web/src/helpers/translationCache.js` | **新建** — 模块级内存缓存 + Promise 去重 |
| `web/src/hooks/dashboard/useDashboardData.js` | `loadTranslatedConsole` 改用 `fetchTranslation` |
| `web/src/components/layout/NoticeModal.jsx` | `loadTranslatedAnnouncements` 改用 `fetchTranslation` |
| `model/content_translation.go` | +`SourceHash` 字段；`SaveContentTranslation` 同时更新 hash |
| `service/translate.go` | +`computeSourceHash()`；`TranslateContent` 加 hash 校验；新增 `TranslateContentBatchMerged()` 批量合并翻译 |
| `controller/console_translate.go` | 重写：`stableContentId()` 基于内容 hash；改用 `TranslateContentBatchMerged` 替代并发逐条翻译 |
| `model/option.go` | 删除 `DeleteContentTranslationsByType` 调用（hash 校验自动处理过期） |

---

## v2.6.0217 (2026-02-17): 全面 i18n 硬编码中文翻译

**Goal:** 将所有前端 showError/showSuccess/showInfo/showWarning 中的硬编码中文字符串替换为 `t()` 包裹

**Changed Files:**
| File | Changes |
|------|---------|
| `web/src/components/settings/*.jsx` | 刷新失败等消息 → `t()` |
| `web/src/components/auth/LoginForm.jsx` | ~15 处登录/Turnstile/Passkey → `t()` |
| `web/src/components/auth/RegisterForm.jsx` | ~10 处注册/验证码 → `t()` |
| `web/src/hooks/channels/useChannelsData.jsx` | 更新成功 + 验证 → `t()` |
| `web/src/i18n/locales/{zh,en,ja,fr,ru,vi}.json` | +50 个 i18n key |

---

## v2.6.0215 (2026-02-15): 测试环境部署脚本

**Goal:** 创建一键部署脚本，自动化 Docker 镜像上传和部署到测试服务器 `***REDACTED_IP***`

**Changed Files:**
| File | Changes |
|------|---------|
| `scripts/deploy-test.sh` | **新建** — 测试环境一键部署脚本 |

**使用方法:**
```bash
./scripts/deploy-test.sh camel-api_v2.6.0215.tar.gz
```

---

## v2.6.0209 (2026-02-09): 站内消息模块

**Goal:** 实现管理员向用户发送站内消息的功能，支持定向消息和广播消息

**Changed Files:**
| File | Changes |
|------|---------|
| `model/message.go` | **新建** — Message、MessageReadStatus 模型 |
| `controller/message.go` | **新建** — 管理员和用户消息 HTTP 处理器 |
| `web/src/pages/Message/index.jsx` | **新建** — 管理员消息管理页面 |
| `web/src/pages/Inbox/index.jsx` | **新建** — 用户收件箱页面 |

**New API Endpoints:**
- `POST /api/message/admin/` — 创建消息
- `GET /api/message/admin/` — 消息列表
- `GET /api/message/inbox` — 用户收件箱
- `GET /api/message/unread_count` — 未读数量

---

## v2.6.0209 (2026-02-09): 管理员订单管理页面

**Goal:** 新建独立的管理员订单管理页面，整合充值订单和订阅订单

**New API Endpoints:**
- `GET /api/purchase/topup` — 充值订单列表
- `POST /api/purchase/topup/complete` — 充值订单补单
- `GET /api/purchase/subscription` — 订阅订单列表
- `POST /api/purchase/subscription/complete` — 订阅订单补单

---

## v2.6.0209 (2026-02-09): 用户选择当前消耗套餐

**Goal:** 让用户可以指定一个"首选订阅"，请求优先从该订阅扣费

**Changed Files:**
| File | Changes |
|------|---------|
| `dto/user_settings.go` | 新增 `PreferredSubscriptionId int` 字段 |
| `model/subscription.go` | `PreConsumeUserSubscription` 新增 `preferredSubId` 参数 |
| `service/billing.go` | 传递首选订阅 ID |

---

## v2.6.0209 (2026-02-09): 将"本站IP"改为"本站标签"

**Goal:** 用可读的站点标签替代原始 IP 地址来标识请求来源

**Environment Variable:** `SITE_LABEL`

---

## v2.6.0208 (2026-02-08): 管理员数据分析面板

**Goal:** 新建独立的管理员分析页面，提供按渠道/模型/用户维度的数据可视化

**New API Endpoints:**
- `GET /api/analytics/channel` — 按渠道聚合
- `GET /api/analytics/model` — 按模型聚合
- `GET /api/analytics/user` — 按用户聚合

---

## v2.6.0208 (2026-02-08): 使用日志记录上游站点IP

**Goal:** 在使用日志中记录请求连接的上游渠道站点 URL 和实际连接的 IP 地址

**Changed Files:**
| File | Changes |
|------|---------|
| `relay/common/relay_info.go` | RelayInfo 新增 `UpstreamAddress` 字段 |
| `relay/channel/api_request.go` | doRequest 中用 httptrace 捕获远端 IP |

---

## v2.6.0208 (2026-02-08): 订阅套餐优化

**Goal:** 根据重置周期动态显示额度标签 + 订阅订单支持待支付记录和管理员补单

---

## v2.6.0206 (2026-02-06): 邀请者充值返利功能

**Goal:** 实现被邀请者充值时给邀请者返利的功能

**Environment Variables:**
- `TopUpRebateCount` — 返利次数
- `TopUpRebatePercent` — 返利百分比
