# 渠道稳定性提升方案（现状校准版）

面向 `keyapi` 的“用户无感”稳定性设计与落地路径。

日期：2026-04-24
校准日期：2026-04-27

## 文档目的

- 在现有多渠道中转基础上，把“可用”升级成“稳定、可切换、低感知、可灰度”的渠道体系。
- 优先复用仓库现有的 `priority`、`weight`、`retry`、`auto-disable`、`monitor`、`channel affinity` 能力，避免重复建设。
- 先处理最容易让用户察觉的问题，再推进数据层冷却状态、健康度反哺选路和亲和池治理。

## 执行摘要

- 当前仓库已经具备多渠道选择、分组重试、自动禁用、渠道监控和会话亲和能力。
- 方案重点不是“新增会话粘性”，而是把已有亲和机制纳入稳定性治理：补 TTL 策略、命中率指标、fallback 后的粘性衰减和异常观测。
- 建议按“重试可感知问题先修、错误分类再收敛、冷却状态后落地、健康分反哺选路、亲和池治理增强”的顺序推进。
- 所有阶段都必须从第一天开始挂 `feature flag` 和租户灰度开关，不能等到最后才做灰度。
- 所有阶段上线后都必须执行回滚演练：上线后 `7` 天内至少关闭一次对应 `feature flag`，确认旧路径仍可正常承载流量。
- 截至 `2026-04-27`，阶段零、阶段一、阶段二和阶段三已经有部分代码落地；后续执行时应先补齐缺口，而不是按原计划重复实现。

## 当前代码校准（2026-04-27）

### 已落地

- 稳定性开关已经存在：`ChannelStabilityStreamBoundaryEnabled`、`ChannelStabilityErrorClassificationEnabled`、`ChannelStabilityCooldownEnabled`、`ChannelStabilityHealthScoreEnabled`、`ChannelStabilityAffinityGovernanceEnabled` 已接入全局 option 与租户配置读取。
- 流式边界已经部分落地：`controller/relay.go` 会在已发送流式内容后停止重试；`relay/common/relay_info.go` 已记录建链、首 token、首 token 超时等状态；`relay/channel/api_request.go` 已接入按模型族配置的首 token timeout。
- 错误分类基础已经落地：`types/channel_error_class.go` 已提供 `normal / transient / scheduled_cooldown / auth_refresh / permanent` 五类枚举和 `ChannelErrorHints`。
- 冷却基础已经落地：`channels` 表已有 `cooldown_until`、`cooldown_reason`、`cooldown_count`、`last_cooldown_at` 字段；`model/channel_cooldown.go` 已支持 Redis 实时态、DB 回退、冷却过滤、warm-up 权重恢复和计数升级。
- `scheduled_cooldown` 的通用链路已经落地：`RelayErrorHandler` 会解析 `Retry-After` / reset header 并写入 `ChannelErrorHints.RetryAfter`，`HandleChannelAnomaly` 会按精确恢复时刻设置 `cooldown_until`，同时保留 `10s` 下限、`6h` 上限和与指数退避取大的防呆规则。

### 仍需补齐

- 仍需排查各 adaptor 在 `DoResponse` 内自行构造错误的路径；如果这些路径绕过 `RelayErrorHandler`，还需要补 `ChannelErrorHints.RetryAfter` 的传递。
- 监控状态命名需要统一：当前代码使用 `normal / degraded / abnormal`，文档和前端展示不能再写成 `normal / degraded / error`。
- 健康分反哺选路和亲和治理开关已经预留，但核心策略仍需实现。

## 1. 现状与差距

现有仓库已经不是“单上游直连”模式，而是具备一定弹性的多渠道中转。其核心支点如下。

### 渠道选路

- 当前实现：按 `group / priority / weight` 选路。
- 关键文件：`service/channel_select.go`、`model/channel_cache.go`。
- 当前短板：选路仍以静态配置为主，尚未接入实时健康分。

### 重试策略

- 当前实现：已有 `retry`、`skip-retry`、分组链路切换和 `channel_chain` 诊断日志。
- 关键文件：`controller/relay.go`。
- 当前短板：流式请求的中间态需要更细约束，尤其是“建链成功到首 token 未到”的静默窗口。

### 异常摘除

- 当前实现：已有 `auto-disable` 与自动恢复钩子。
- 关键文件：`service/channel.go`。
- 当前短板：`429 / 5xx / timeout` 这类短期抖动不应该直接等同于永久故障，需要先进入冷却态。

### 渠道监控

- 当前实现：`model/channel_monitor.go` 已有 `classifyChannelHealth`、`buildGroupHealth`，可输出 `normal / degraded / abnormal` 等健康分类，并聚合可用率。
- 关键文件：`model/channel_monitor.go`。
- 当前短板：监控结果目前更多用于展示，真正缺的是“反哺选路”的打分函数和耦合策略。

### 会话亲和

- 当前实现：`service/channel_affinity.go` 已经有完整机制，包括 `GetPreferredChannelByAffinity`、`MarkChannelAffinityUsed`、`RecordChannelAffinity`、`ShouldSkipRetryAfterChannelAffinityFailure`、`ObserveChannelAffinityUsageCacheByRelayFormat`。
- 关键文件：`service/channel_affinity.go`。
- 当前短板：不是“新增会话粘性”，而是补亲和池治理和可观测性，包括 TTL 策略、命中率指标、跨渠道 fallback 后的粘性衰减。

## 2. 目标架构

### 分层渠道池

现阶段不新建独立“池”抽象，继续复用现有 `group` 与 group chain 承担池化职责。文档中的“主池 / 备池 / 保底池”是对现有分组链路的治理命名：

- 主池：当前业务默认优先命中的高质量 group。
- 备池：主池不可用或健康分下降后切入的同能力 group。
- 保底池：成本较高或体验略弱但可救急的兜底 group。

实施上优先通过配置约定和文档治理完成映射，不在本方案内新增一套池表或路由抽象，避免扩大改造面。

### 流式重试边界

流式请求要区分三个阶段：

- 建链失败：可以静默切换。
- 建链成功但首 token 未到：在首 token 超时阈值内可以静默切换，默认阈值可取 `10s`。
- 首 token 已返回：不再静默跨渠道切换，避免用户看到风格、上下文或输出中断的突变。

首 token 超时阈值必须按模型族可配。普通模型可默认 `10s`；思考类或 reasoning 模型，例如 `o1`、`gpt-5 thinking`、`deepseek-r1`，应放宽到 `30s` 或更长。阈值建议与该模型族的典型首 token 延迟挂钩，而不是写死成全局常量。

### 软熔断优先

`429 / 5xx / timeout` 先进入 `cooldown`，`401 / invalid key / account disabled / quota exhausted` 才进入硬禁用。

### 健康度加权

最终选路不应只看静态 `weight`。建议引入健康分：

```text
effective_score = configured_weight_score * health_score * latency_score * penalty_score
```

需要明确四个设计点：

- 打分窗口：优先用 `5min` 窗口做快速降权，用 `15min` 窗口做恢复判断，避免短抖动造成频繁震荡。
- 冷启动渠道：不默认满分，也不默认低分；建议给组内中位数或保守基准分，直到样本量达标。
- 权重叠加：避免简单乘法把低权重渠道直接打到近似清零，可设置最小保底分或使用平滑函数。
- 跨池保护：健康分在当前池内计算和排序，不把主池抖动惩罚直接传染给备池或保底池。主池不设下限，允许彻底降权退出选路；备池建议健康分下限为 `0.3`；保底池建议健康分下限为 `0.5`，避免故障扩散时被历史低流量样本进一步压死。

### 亲和池治理

已有 affinity 机制继续保留，但要补治理能力：

- TTL 策略：不同模型、不同租户可以有不同亲和有效期。
- 命中率指标：观察亲和命中、亲和失效、亲和 fallback 的比例。
- 粘性衰减：当亲和渠道触发跨渠道 fallback 后，降低该亲和关系的优先级，而不是继续强粘。

### 监控反哺路由

监控不只展示，而是直接参与渠道打分、池健康判断和告警。

## 3. 分阶段落地路径

### 所有阶段通用纪律

- 每个阶段都必须挂 `feature flag`，支持租户级灰度、全局关闭和快速回退。
- 每个阶段上线后 `7` 天内必须完成一次关闭对应 `feature flag` 的生产演练，确认旧路径仍可正常承载流量。
- 演练结果要记录到上线记录或运维日志中，包括关闭时间、恢复时间、影响范围和验证结论。

### 阶段零：灰度与回退前置

- 目标：所有稳定性策略从第一步开始可灰度、可关闭、可回滚。
- 主要改动：加租户级或全局 `feature flag`，覆盖流式重试边界、错误分类、冷却策略和健康分选路。
- 当前状态：全局 option 和租户级读取已经存在，后续重点是补齐上线演练记录和运维回退流程。
- 优先落点：`model/option.go`、`setting`、租户配置相关服务。
- 验收重点：任一新策略都能按租户启停，出现回归时可立即回退到旧选路逻辑。

### 阶段一：先修用户最容易感知的重试边界

- 目标：消除流式中途跨渠道切换导致的用户可感知异常。
- 主要改动：扩展现有 `skip-retry` 或上下文标记，明确流式请求的三个阶段。
- 建议顺序：先做“首 token 后禁切”，再做“首 token 超时阈值内可静默切换”。首 token 阈值必须按模型族配置，reasoning 模型不能套用普通模型的 `10s` 默认值。
- 当前状态：首 token 后禁切已经接入 `controller/relay.go` 的重试循环；首 token timeout 已按模型族配置并记录到 `RelayInfo`，后续要继续验证各流式 handler 是否都正确标记首包/首 token。
- 优先落点：`controller/relay.go`、各流式 handler 的首包/首 token 记录点。
- 验收重点：首 token 已返回后不再跨渠道切换；建链成功但首 token 超过模型族阈值仍未到时，可以触发可重试错误并静默 fallback。

### 阶段二：细化错误分类

- 目标：区分短期抖动和永久不可用，避免错误禁用渠道。
- 主要改动：在 `ShouldDisableChannel` 和重试判定中拆分错误类型。
- 当前状态：五类错误枚举、`ShouldDisableChannel` 分流、`ChannelErrorHints` 携带、通用响应头解析和精确冷却时长计算已经落地；仍需排查绕过 `RelayErrorHandler` 的 adaptor 错误路径。
- 分类维度（`types/channel_error_class.go`）统一使用五类枚举，避免后续功能扩展时再做一次拆分：
    - `normal`：未识别的业务错误，不影响渠道状态。
    - `transient`：短期抖动，走"重试 + 冷却候选"，由阶段三决定是否写入 `cooldown`。
    - `scheduled_cooldown`：上游响应头已经给出精确恢复时刻（`Retry-After`、Anthropic `anthropic-ratelimit-unified-reset`、OpenAI `x-ratelimit-reset-*` 等），选路层必须按该时刻冷却，不能走自适应退避。
    - `auth_refresh`：凭证可刷新错误（OAuth access token 过期等），必须触发刷新流程而不是冷却/禁用。
    - `permanent`：`401 / invalid key / account disabled / quota exhausted / oauth_invalid_grant` 等，走硬禁用。
- 过渡态：当 `ChannelStabilityCooldownEnabled` 关闭时，`transient / scheduled_cooldown` 都只走"重试 + 不触发 auto-disable"，不写入冷却态；冷却开关打开后，`transient` 走指数退避，`scheduled_cooldown` 走精确时刻冷却。
- 关键不变式：`scheduled_cooldown` 只能由 `transient` 类经过 `ChannelErrorHints` 提升得到；`permanent` 和 `auth_refresh` 不受 hints 影响，避免"永久错误被误判为按时恢复"。
- 优先落点：`types/channel_error_class.go`、`service/channel.go`、`controller/relay.go`、各 adaptor 的 `DoResponse` 或 `HandleError`（负责解析响应头填 hints）。
- 验收重点：短期上游抖动不会直接触发永久禁用；永久凭证或额度类错误能快速摘除；带 `Retry-After` 的 `429` 能路由到 `scheduled_cooldown` 并携带精确恢复时刻。

### 阶段二点五：OAuth 凭证稳定性

本阶段是 `docs/superpowers/plans/2026-04-24-claude-oauth-channel-pool.md` 的稳定性侧配套，专门处理订阅号池（Claude OAuth / Codex OAuth / 其他 OAuth 渠道）相较普通 API Key 渠道多出的三类脆弱性。它位于阶段二和阶段三之间：必须在冷却状态落地前把凭证刷新和请求改写稳定下来，否则冷却逻辑会把"刷新一下就能恢复的渠道"误判成上游抖动。

- 目标：让 OAuth 类渠道的 access/refresh token 生命周期和请求指纹保持稳定，避免出现"并发刷新打废 refresh token"、"5 小时窗口被当成普通 5xx 退避"、"同账号跨 IP 打风控"这三类低级失稳。
- 主要改动：
    - 在 `service/` 下新增按 `account_id`（或 `channel_id`）的凭证刷新协调器，使用 `golang.org/x/sync/singleflight.Group` 合并并发刷新请求；同一时刻同账号的刷新必须串行。
    - Refresh token 存储改成 CAS 更新（带 `version` 或 `updated_at` 条件），避免旧刷新流程的返回值覆盖新 token。对会轮换 refresh token 的上游，丢失新 token 可能导致整号失效。
    - 新增"凭证健康巡检"后台任务，在 `access_token.expires_at - 5min` 主动刷新；刷新失败走阶段二的 `oauth_refresh_failed → transient`，连续失败走 `oauth_invalid_grant → permanent`。
    - 在渠道模型层追加 `egress_proxy_url`（或复用已有 proxy 字段），调度时确保同一 OAuth 账号的请求走相同出口 IP，降低跨地域出口跳变造成的风控风险。
    - 请求改写层只使用上游授权方式明确允许的 OAuth / SDK 参数；不要伪装官方客户端身份、UA 或 system prompt。若必须兼容特定 OAuth 客户端形态，应先确认授权边界和 header contract，并把版本兼容策略写入配置而不是硬编码。
- 长窗口限流的处理：OAuth 账号的 `429` 可能带精确 reset 时刻。adaptor 在 `DoResponse` / `HandleError` 时解析 `Retry-After` 或供应商 reset header，填入 `ChannelErrorHints.RetryAfter`，错误分类器会自动把 `transient` 提升为 `scheduled_cooldown`。阶段三的冷却调度看到 `scheduled_cooldown` 时直接使用该时刻，不走指数退避。
- 优先落点：`service/claude_credential_refresh.go`、`service/claude_credential_refresh_task.go`、`service/claude_oauth_rate_limit.go`、`relay/channel/claude/oauth_headers.go`、`relay/channel/claude/oauth_errors.go`、`model/channel.go`（出口代理字段）。
- 验收重点：
    - 模拟同账号 10 并发触发刷新，Anthropic refresh 接口只收到一次请求，refresh token 正确轮换，无账号失效。
    - 模拟上游返回 `429 + Retry-After` 或供应商 reset header，错误分类结果为 `scheduled_cooldown`，`reason` 中含 `retry_after=`。
    - 刷新接口返回 `invalid_grant` 时，渠道被标记为 `permanent` 并告警，不再继续重试。
    - 同一 OAuth 账号的请求在监控中看到单一出口 IP，不出现跨国跳变。

### 阶段三：完善冷却状态

- 目标：让短期异常渠道临时退出选路，过期后可恢复观察。
- 当前状态：基础冷却态已经采用“Redis 实时态 + DB 审计/回退”的方案，`channel_cache` 选路已能过滤冷却渠道并在过期后按 warm-up 恢复权重。
- 待补齐：排查特殊 adaptor 的 hints 链路是否绕过通用 `RelayErrorHandler`，并补充相关供应商 reset header 的覆盖测试。
- 数据层方案背景：
- 方案 A：在 `channels` 表加 `cooldown_until`、`cooldown_reason`、`cooldown_count` 字段。
- 方案 B：使用 Redis key，例如 `channel:cooldown:{channel_id}`，过期自动恢复。
- 方案 C：DB 记录审计，Redis 负责实时选路过滤。
- 推荐：选路实时态走 Redis，审计和后台展示落 DB，避免频繁写表；无 Redis 环境下回退 DB 字段。
- 缓存配合：`channel_cache` 仍负责基础渠道信息，冷却态用独立快速查询或轻量缓存叠加，不建议把短 TTL 冷却状态塞进全量重载缓存。
- 冷却时长来源分两类，由阶段二的错误分类器决定，不能混用：
    - 来源 A：`scheduled_cooldown`（上游精确时刻）。直接使用 `ChannelErrorHints.RetryAfter` 作为 `cooldown_until`，不走指数退避。典型场景是长窗口限流、标准 `Retry-After`、供应商 reset header，或任何明确告诉你"何时可用"的上游。
    - 来源 B：`transient`（自适应退避）。没有 reset 提示的 5xx/timeout/连接类错误，首次 `30s`，每次重入翻倍，封顶 `5min`。
- 两类来源的防呆规则：
    - `scheduled_cooldown` 使用的 `RetryAfter` 必须做上下限夹逼：下限 `10s`（防止上游发出过小值造成空转），上限 `6h`（防御异常/伪造响应头），超过上限按上限截断并记录 `reason=retry_after_clamped`。
    - 同一渠道如果短时间内连续命中 `scheduled_cooldown`，`cooldown_count` 照常递增，走升级规则；但这种 "被精确告知仍反复失败" 的情况要单独打点，方便区分"上游明确限流" vs "上游 reset header 不可信"。
    - `transient` 的自适应退避要和 `scheduled_cooldown` 的显式时刻 `MAX` 取大，避免被小 `Retry-After` 值回退掉已经累积的退避进度。
- 恢复算法：冷却过期后进入 warm-up 窗口，先给目标权重的 `10%`，每 `30s` 翻倍，直到恢复满权重；如果 warm-up 期间再次触发短期故障，重新进入冷却并增加 `cooldown_count`。
- 升级规则：`cooldown_count` 达到可配上限后升级为 `auto-disable`，建议默认上限为 `5` 次，避免长期 flap 的渠道在冷却和 warm-up 之间反复消耗资源。
- 优先落点：`model/channel.go`、`model/channel_cache.go`、`service/channel.go`、Redis cache service。
- 验收重点：冷却期内渠道不参与选路；冷却过期后按 warm-up 逐步恢复；状态在监控页可见。

### 阶段四：健康度反哺选路

- 目标：让系统在报错前主动降权，而不是等失败后才切换。
- 当前状态：`ChannelStabilityHealthScoreEnabled` 开关已预留，`channel_monitor` 已能给出 `normal / degraded / abnormal`，但健康分尚未反哺 `service/channel_select.go`。
- 主要改动：把 `normal / degraded / abnormal`、成功率、延迟、错误率转成选路分。
- 工程难点：窗口选择、冷启动分数、分数与现有 `weight` 的叠加方式。
- 建议策略：`5min` 快速惩罚，`15min` 平滑恢复；冷启动使用组内中位数；有效分设置下限，避免低配置权重渠道被完全饿死。
- 优先落点：`model/channel_monitor.go`、`model/channel_cache.go`、`service/channel_select.go`。
- 验收重点：高错误率或高延迟渠道自然降权；健康恢复后可逐步回流。

### 阶段五：亲和池治理与可观测性增强

- 目标：增强已有 affinity 机制，而不是重做会话粘性。
- 主要改动：补 TTL 策略、命中率指标、fallback 后粘性衰减和异常诊断。
- 当前状态：亲和选择、记录、失败后跳过重试等机制已存在；治理开关已预留，但 TTL 分层、命中率指标和 fallback 衰减仍需实现。
- 衰减算法：不建议一次 fallback 就清空 affinity。推荐使用指数衰减：同一亲和关系每次因健康或重试失败触发 fallback，剩余 TTL 减半；最近 `30min` 窗口内累计失败达到 `3` 次后清除该 affinity，并记录清除原因。
- 优先落点：`service/channel_affinity.go`、日志生成服务、监控接口。
- 验收重点：能看到亲和命中率、失效率、fallback 后衰减次数；异常亲和不会长期把请求粘到不健康渠道。

## 4. 量化 SLO 与验收标准

### 用户侧稳定性

- 主渠道 `5xx` 抖动期，用户侧 `P99` 延迟不超过基线的 `1.5x`。
- 跨渠道重试成功率 = 触发重试的请求中最终成功的比例，不低于 `95%`。
- 流式请求首 token 后跨渠道静默切换次数为 `0`。

### 冷却策略质量

- `cooldown` 误伤率不高于 `10%`。误伤定义：被冷却渠道下一次探活立即恢复正常。
- 永久错误摘除延迟不超过 `1min`，例如 `invalid key`、`account disabled`、`quota exhausted`。
- 冷却过期后恢复流量必须渐进，不一次性回到原始权重。

### 选路质量

- `degraded` 渠道在健康分生效后流量占比明显下降。
- 冷启动渠道在样本量不足前不抢占主池流量。
- 健康恢复后，渠道流量可在一个观察窗口内逐步回归。

### 可观测性

- 日志可回溯 `channel_chain`、最终失败原因、`upstream request id`、是否命中 affinity、是否触发 cooldown。
- 监控页能看到 `normal / degraded / abnormal / cooldown / disabled` 状态。
- 运营指标至少包括 `cooldown_until`、`5min_success_rate`、`15min_success_rate`、`p95_latency`、`429_rate`、`affinity_hit_rate`、`affinity_decay_count`、`affinity_evict_reason`、`fallback_success_rate`。

## 5. 风险与建议

### 模型混池过宽

- 风险：不同上游虽然接口兼容，但回答风格、上下文长度、工具支持差异明显。
- 建议：先做别名池治理，再做无感切换。

### 冷却状态设计过重

- 风险：如果每次短抖动都写 DB，可能带来额外锁竞争和 DBA 审核成本。
- 建议：实时态优先 Redis，DB 存审计和展示字段；无 Redis 时提供 DB fallback。

### 健康分与权重叠加不当

- 风险：简单乘法会让低权重渠道被长期饿死，也可能让冷启动渠道误抢流量。
- 建议：使用平滑函数、最小保底分和样本量门槛。

### 灰度不足

- 风险：动态路由一旦全量上线，回退难度大。
- 建议：灰度贯穿所有阶段。阶段一改重试逻辑时就必须挂 `feature flag`，不能等到最后。

## 最终建议

下一步不要重复做已经落地的阶段零到阶段三基础能力，而是先把剩余缺口补齐：第一，验证所有流式 handler 都正确标记首 token / 首内容，确保首 token 后不会跨渠道静默切换；第二，排查绕过 `RelayErrorHandler` 的 adaptor 错误路径，补齐 `ChannelErrorHints.RetryAfter` 传递和供应商 reset header 测试；第三，补 OAuth 凭证刷新协调、CAS 更新和出口一致性，避免可刷新错误污染冷却调度。等这些缺口稳定后，再把 `channel_monitor` 的 `normal / degraded / abnormal` 接入选路打分。已有 `channel_affinity` 不应作为新增阶段排期，而应作为后续 TTL 治理、fallback 衰减和可观测性增强的基础。
