# Topup Quota Delta - 契约变更说明

## Why

`amountUnits` 的旧隐式契约更接近 "供历史 top_ups.Amount / callback fallback 使用的兼容字段"，但回调路径一直把它当成统一的 USD 等价值去做 `amount_units * QuotaPerUnit`。

在 `CNY / CUSTOM` 展示模式下，这个假设不成立：

- `CNY` 模式里，用户输入的是人民币金额，不是 USD
- `CUSTOM` 模式里，用户输入的是自定义币金额，必须先按 `CustomCurrencyExchangeRate` 转成 USD

同时，前端 `web-next/src/components/topup/RechargeCard.tsx` 已经按 `custom_currency_exchange_rate` 预估 CUSTOM 的扫码金额，但后端 `controller/payment/topup.go:getPayMoney` 之前没有做同样的归一化。修复不能只改到账路径，必须让收费路径和到账路径都回到同一份 USD 等价值契约上。

## What Changed

- `controller/payment/topup.go:getPayMoney` 在 `CUSTOM` 模式下先执行 `amount / CustomCurrencyExchangeRate`，再乘 `Price`
- 新增 `setting/operation_setting.ComputeTopupQuotaDelta(amount int64) int64`，集中实现 `USD / CNY / TOKENS / CUSTOM` 四种展示模式的 quota 归一化
- `payment_orders.Metadata` 新增 `quota_delta`，作为 WeChat 路径成功回调的权威到账值
- `top_ups` 新增 `raw_quota` 列，作为 Epay / WeChat / 手动补单路径的持久化权威到账值
- `applyTopupSuccess`、`EpayNotify`、`ManualCompleteTopUp` 优先读取权威字段，只在旧订单或旧行没有新字段时才回退到 legacy 公式

## Backward Compat

- 老的 WeChat 订单 metadata 没有 `quota_delta` 时，`applyTopupSuccess` 回退到 `amount_units * QuotaPerUnit`
- 老的 `top_ups` 行 `raw_quota = 0` 时，`EpayNotify` 和 `ManualCompleteTopUp` 回退到 `Amount * QuotaPerUnit`
- 这些 fallback 会保留旧契约，因此只用于兼容 schema `2026-04-20.02` 上线前创建、上线后才完成的少量在途订单

## Out Of Scope

- Stripe `Recharge` 路径仍沿用 `Money * QuotaPerUnit`，其 discount-on-quota 语义单独处理
- Creem `RechargeCreem` 路径的 `Amount` 语义不同，不纳入这次统一
- Waffo 仍保留旧公式，后续单独收敛
