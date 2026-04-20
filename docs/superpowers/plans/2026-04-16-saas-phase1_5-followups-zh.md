# SaaS Phase 1.5 / Phase 2 欠账清单（中文）

> 这份文档只记录已经明确识别、但没有纳入 Phase 1 强制验收范围的后续项。  
> 它不是重新开一个大路线图，而是给下一步实现提供一个简短、清晰的收尾列表。

---

## 1. 文档目标

记录 Phase 1 完成后仍然保留的技术欠账，避免后续重复审计、重复发现。

这些项大致分为两类：

- **Phase 1.5**：建议尽快补齐，但不阻断本轮 Phase 1 验收
- **Phase 2**：明确属于下一阶段租户化或商业化范围

---

## 2. Phase 1.5 建议优先处理

### 2.1 日志 helper 继续 tenant-first 化

当前已经完成：

- controller 层主要 `RecordLog()` 调用已改为 `RecordLogCtx(...)`
- 用户注册/邀请链路的 model 内日志已改为 `RecordLogWithTenant(...)`

仍建议继续收口：

- `RecordTopUpLog(...)`
- `RecordTaskBillingLog(...)`

建议改造方向：

- 统一改成 tenant-aware API
- 尽量避免继续保留默认写入 `DefaultTenantId` 的日志 helper

### 2.2 财务/订阅链路剩余日志归属

当前已处理一部分：

- `subscription.go` 中已有 `user.TenantId` 的记录点已切到 `RecordLogWithTenant(...)`
- `topup.go` 中已有 `user.TenantId` 的记录点已切到 `RecordLogWithTenant(...)`

仍保留的典型欠账：

- 某些对象当前没有 `TenantId` 字段，只能暂时按 `DefaultTenantId` 记录
- 这些地方应在相关表正式租户化后一起收口

### 2.3 Guardrail 可靠性增强

当前状态：

- `Create` callback 已 fail-closed
- `Query/Update/Delete` callback 仍是 `warn-only`

后续建议：

- 改成更可靠的作用域检查机制
- 不要过度依赖 `db.Statement.SQL.String()` 的启发式判断
- 在更强 guardrail 落地前，继续依赖显式 tenant-aware helper

### 2.4 DB 集成级 tenant 测试补齐

当前已有：

- context 传播测试
- 结构字段存在性测试
- 基础 middleware 行为测试

建议补的测试：

- 非默认租户 token 鉴权
- 非默认租户 channel selection
- 非默认租户 log 查询
- migration/backfill 的真实 DB 行为

---

## 3. 明确归入 Phase 2 的内容

### 3.1 剩余业务表租户化

包括但不限于：

- `topup`
- `subscription*`
- `redemption`
- `ticket*`
- `invoice*`
- `aff_*`
- `message*`

### 3.2 财务和客服链路完整 tenant 化

包括：

- 充值
- 订阅
- 返利
- 发票
- 工单
- 账单统计

### 3.3 更完整的租户日志与报表一致性

包括：

- 历史统计接口继续审计
- 财务和订阅事件日志统一 tenant 归属
- 平台视角与租户视角报表边界分离

---

## 4. 外部阻塞项

### 4.1 Root build 仍受前端产物缺失影响

当前状态：

- backend package builds are green
- root `go build ./...` 仍被 `main.go` 对 `web/dist` 的依赖阻塞

这不属于本轮 backend tenant-isolation 逻辑错误，但会影响“仓库根构建全绿”的 CI 体验。

建议：

- 单独补前端构建产物
- 或调整 root build / CI 流程

---

## 5. 下一步建议顺序

建议按下面顺序推进：

1. 先收 `RecordTopUpLog` / `RecordTaskBillingLog` 的 tenant-aware API
2. 再补 DB 集成级 tenant 测试
3. 再进入 `topup/subscription/invoice/ticket` 的正式 Phase 2 租户化
4. 最后把 guardrail 从 warn-only 逐步收紧

---

## 6. 关联文档

- Phase 1 实施文档：
  [2026-04-16-saas-multi-tenancy-phase1.md](</D:/top/keyapi/docs/superpowers/plans/2026-04-16-saas-multi-tenancy-phase1.md:1>)

- 总路线图：
  [2026-04-16-saas-full-roadmap-zh.md](</D:/top/keyapi/docs/superpowers/plans/2026-04-16-saas-full-roadmap-zh.md:1>)
