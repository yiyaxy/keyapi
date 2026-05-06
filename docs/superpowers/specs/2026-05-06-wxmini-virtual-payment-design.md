# 小程序虚拟支付 2.0 接入设计

- 创建日期：2026-05-06
- 状态：待实现（spec → plan → impl）
- 主负责：sg
- 依赖：现有多租户微信支付 v3 实现（`docs/superpowers/specs/2026-04-17-wechat-pay-multi-tenant-design.md`）

## 1. 背景与触发

微信小程序平台规则将"虚拟商品"销售强制纳入"小程序虚拟支付 2.0"框架。本项目销售的 `quota`（用于调用 AI 模型的额度）属于典型的虚拟商品，因此小程序内现有的普通微信支付 JSAPI（`wx.requestPayment` + 商户号 v3 API）路径**不再合规**：

- iOS 端：用户在小程序内购买虚拟商品**强制**经 Apple 支付，标准费率 17%（含腾讯服务费，2026 年腾讯部分限免），最低 1 元，要求 iOS 15+ / 微信 8.0.68+。
- Android 端：仍使用微信支付，但必须经"虚拟支付 2.0"框架（道具直购或代币模式），通过专用服务端接口（`xpay/goods/*`）和专用客户端 API（`wx.requestVirtualPayment`）。

继续使用普通 wxpay JSAPI 卖虚拟商品会导致小程序审核被驳回 / 上线后下架。

## 2. 目标与非目标

### 目标
- 小程序（`wxapp/`）内**完全切换**到虚拟支付 2.0，下掉普通 wxpay JSAPI 调用。
- 后端新增独立的 `wechat_xpay` provider，与现有 `wechat` provider 平级，互不干扰。
- iOS / Android 双端均通过虚拟支付下单，但走**分端定价**：iOS 道具加价以覆盖 Apple 17% 抽成。
- 多租户支持：每租户独立的小程序 AppID 各自开通虚拟支付、各自配道具，凭据隔离存储。
- 复用现有 `payment_orders` / `payment_refunds` / 对账机制，最小化数据模型改动。

### 非目标（本次不做）
- **Web/H5 端 wxpay** 保留现状不动，与本次改造无关。
- **续期支付（sub / TenantPlan 续费）**：小程序当前没有 sub 入口（仅在 web/PC 后台），本次不动。
- **代币模式**（米大师 coin）：本次只走"道具直购"路径。代币模式留作未来选项。
- **多档位自定义金额**：取消小程序里的"自定义金额输入框"，只保留固定档位。
- **iOS 主动退款**：苹果不允许商户主动发起 iOS 订单退款，本期 UI 上明示"iOS 订单退款请联系 Apple 客服"。
- **道具配置自动同步到微信后台**：本期人工在微信小程序后台录入道具，后端只存映射；后续可加自动化。

## 3. 关键决策（已与产品对齐）

| 决策点 | 选择 | 理由 |
|---|---|---|
| 接入范围 | iOS + Android 全端切，小程序内不再走 wxpay JSAPI | 合规底线 |
| 商品形态 | 道具直购（goods），非代币 | 与现有"档位充值"UI 1:1 映射，余额仍由本系统 DB 管理，对账简单 |
| Web/H5 wxpay | 保留现状 | 不在小程序内，不受新规约束 |
| iOS 抽成 | 道具分端 + 加价转嫁 | 商业可持续，行业通行做法 |
| 后端架构 | 新增独立 `wechat_xpay` provider | 签名/接口/回调与 v3 完全不同栈，独立干净 |
| 切换策略 | 激进切换（前端一刀切 + 后端 wxpay 老接口保留 7 天兜底老版小程序） | 用户量小，回滚成本可控 |
| 自定义金额 | 取消 | 道具直购模式价格写死在微信后台，不能动态传值 |
| 续期 (sub) | 不改 | 小程序无入口 |

## 4. 总体架构

```
┌────────────────────────────────────────────────────────────────────┐
│ wxapp（小程序前端）                                                │
│  - redeem/index.vue：档位 UI（含 ios/android 双价签）              │
│  - services/api.js：createWxMiniXpayOrder(tier, platform)          │
│  - 调用 wx.requestVirtualPayment（替代 uni.requestPayment）        │
└────────────────────┬───────────────────────────────────────────────┘
                     │ HTTPS
┌────────────────────▼───────────────────────────────────────────────┐
│ Backend Go                                                         │
│  controller/payment/wxmini_xpay.go                                 │
│   ├─ POST /api/payment/wxmini/topup/xpay  下单                     │
│   └─ GET  /api/payment/wxmini/topup/tiers 档位列表                 │
│  controller/payment/notify.go        (旧路径不动)                  │
│   └─ POST /api/payment/wechat/notify/:tid/:order_type              │
│         wxpay v3 JSON + Wechatpay-Signature                        │
│  controller/payment/xpay_notify.go   (新增)                        │
│   └─ POST /api/payment/wechat/xpay_notify/:tid/:order_type         │
│         xpay JSON {EventType, Event, Payload, PayEventSig}         │
│  service/payment/wechat_xpay/                                      │
│   ├─ provider.go      实现 payment.Provider                        │
│   ├─ client.go        pay_sig / pay_event_sig HMAC + HTTP 调用     │
│   ├─ goods.go         CreateOrder（生成下单四件套）                │
│   ├─ notify.go        JSON envelope 解析 + pay_event_sig 验签      │
│   ├─ query.go         QueryOrder（对账用）                         │
│   └─ refund.go        Refund（仅 Android 走）                      │
│  model/                                                            │
│   ├─ tenant_payment_config.go：增 XpayEnabled / XpayAppKeyEnc /    │
│   │  XpayEnv / XpayOfferId 四个字段                                │
│   └─ tenant_xpay_product.go（新表）：tier+platform → product_id   │
└────────────────────────────────────────────────────────────────────┘
```

## 5. 数据模型

### 5.1 `tenant_payment_configs` 增字段

```go
type TenantPaymentConfig struct {
    // ... 既有字段
    XpayEnabled   bool   `json:"xpay_enabled" gorm:"default:false"`
    XpayOfferId   string `json:"xpay_offer_id" gorm:"type:varchar(64)"`
    XpayEnv       string `json:"xpay_env" gorm:"type:varchar(16);default:'prod'"` // 'sandbox' | 'prod'
    XpayAppKeyEnc string `json:"-" gorm:"type:text"`                              // AES-256-GCM 加密
}
```

- `XpayAppKeyEnc` 明文是小程序后台开通虚拟支付后下发的 AppKey，同时用于计算客户端 `pay_sig` 与回调 `pay_event_sig`（都是 HMAC-SHA256）。复用现有的 AES-256-GCM 加密链路（`encField`/`decField`）。
- `XpayOfferId` 是开通虚拟支付时分配的 OfferId，写入 signData 顶层。**不**敏感，明文存。
- `XpayEnv` 控制走 `https://api.weixin.qq.com/xpay/...`（prod）还是 `https://api.weixin.qq.com/xpay/sandbox/...`（sandbox）。注意：**iOS 不支持 sandbox**，仅现网；切 sandbox 时 iOS 路径要拒绝下单。
- 与登录、wxpay v3 共用同一行配置（`provider="wechat"`），不另立新 row。

### 5.2 新表 `tenant_xpay_products`

```go
type TenantXpayProduct struct {
    Id         int    `gorm:"primaryKey"`
    TenantId   int    `gorm:"uniqueIndex:idx_tenant_tier_platform;not null"`
    TierCode   string `gorm:"uniqueIndex:idx_tenant_tier_platform;type:varchar(32)"` // 逻辑档位标识，如 "tier_30"
    Platform   string `gorm:"uniqueIndex:idx_tenant_tier_platform;type:varchar(8)"`  // 'android' | 'ios'
    ProductId  string `gorm:"type:varchar(64);not null"`        // 微信后台配置后回填
    PriceCents int64  `gorm:"not null"`                         // 与微信后台一致，单位分
    QuotaDelta int64  `gorm:"not null"`                         // 支付成功后到账的 quota
    Enabled    bool   `gorm:"default:true"`
    SortOrder  int    `gorm:"default:0"`                        // 档位列表展示顺序
    CreatedAt  int64  `gorm:"autoCreateTime"`
    UpdatedAt  int64  `gorm:"autoUpdateTime"`
}
```

- 一个档位 = 两行（android + ios），UI 渲染时按 tier_code 聚合。
- `ProductId` 在微信后台配置后由运营回填，未回填时 `Enabled=false` 不可选。
- `QuotaDelta` 是支付成功时到账的**基础 quota**，等级赠送 / `top_up_bonus_percent` 沿用现有的 `model.GetUserLevelTopUpBonusPreview` 逻辑。
- 注册为 tenant-scoped（参考 `tenant_scope.go`）。

### 5.3 `payment_orders` 沿用，metadata 扩展

无 schema 变更。但需要：

- **`model/payment_order.go`** 新增常量 `PaymentProductFormXpayGoods = "xpay_goods"`，与既有 `Native/H5/Jsapi` 平级。
- **`payment_orders.Provider`** 字段值新增 `"wechat_xpay"`（既有 row 仍为 `"wechat"`）。`Provider` 字段在落 row 时按 product_form 决定（见 §6.0），不再硬编码。

新增 metadata 字段：

```json
{
  "amount_units": 30,
  "quota_delta": 30000,
  "base_quota_delta": 30000,
  "bonus_quota_delta": 3000,
  "top_up_bonus_percent": 10,
  "user_level_id": 2,
  "user_level_name": "VIP",
  "xpay_tier_code": "tier_30",
  "xpay_platform": "android",
  "xpay_product_id": "tier_30_android"
}
```

回调成功时按既有 `applyTopupSuccess` 的读取规则注入 quota，新字段仅作审计与对账。

## 6. 后端：`service/payment/wechat_xpay/`

### 6.0 与既有 `createOrder` 衔接（**必须改 service/payment/order.go**）

外部 review 指出：当前 `service/payment/order.go:130-187` 是这样：

```go
switch a.ProductForm {
case model.PaymentProductFormNative,
    model.PaymentProductFormH5,
    model.PaymentProductFormJsapi:
default:
    return nil, nil, fmt.Errorf("unknown product form: %s", a.ProductForm)
}
// ...
order := &model.PaymentOrder{
    Provider:    "wechat",       // ← 硬编码
    // ...
}
provider, ok := Get("wechat")    // ← 硬编码
```

直接增加新 provider 不会被这个路径选中，新单仍会落到老的 `wechat` v3 provider 上，回调链路也对不上。本设计**必须**包含以下改动：

1. **product_form 白名单扩**：switch 加上 `model.PaymentProductFormXpayGoods` 分支。
2. **openid 校验扩**：xpay_goods 同样需要 openid（用 wxapp 用户绑定的 openid 落 metadata，便于 reconcile 时按用户筛单）。
3. **provider 名称按 form 路由**（新建一个 helper 而不是分散 if/else）：

```go
// service/payment/order.go
func providerNameForForm(form string) string {
    switch form {
    case model.PaymentProductFormXpayGoods:
        return "wechat_xpay"
    default:
        return "wechat"
    }
}
```

4. **PaymentOrder.Provider 不再硬编码** —— 改为 `Provider: providerNameForForm(a.ProductForm)`。
5. **`Get(...)` 也用 helper** —— `Get(providerNameForForm(a.ProductForm))`。
6. **回调路由**：`controller/payment/notify.go` 按 `Content-Type` / body 形态分流（详见 §7.3），与 provider 名解耦。`ValidateOutTradeNoRoute` 不依赖 provider，无需改动。
7. **Reconcile sweep（外部 review P2 修正）**：`service/payment/reconcile.go:51` 当前是

   ```go
   var reconcileProviders = []string{"wechat"}
   ```

   `ListPendingPaymentOrdersForReconcile(providerName, ...)` 按 provider 名反向拉单，硬编码只扫 `"wechat"` 表示 xpay 订单丢回调后**永远停在 pending**，不会被 QueryOrder 自愈。必须二选一改：

   - **最简**：`reconcileProviders = []string{"wechat", "wechat_xpay"}`
   - **更稳**：运行时从 `registry` 列举所有已注册 provider 名（这样未来再加 alipay/stripe 不必再回头改）

   本设计采用"最简"方案以减少行为面，未来再加 provider 时如果常忘记同步这个数组，再切到运行时枚举。
8. **回归测试**：`service/payment/order_quota_test.go` 现有用例覆盖三种 form，要补 `xpay_goods` 形态的单测；`reconcile_test.go`（如未存在则新增）覆盖 xpay sweep 链路。

> 这一节不是后续 plan 的"可选优化"，是新增 provider 能跑起来的前置条件，必须和 §6.1-6.5 的代码一起进。

> **§6 主链路契约 guardrail（实施前必读）**
>
> §6.2-§6.4 / §8.1 描述的 `wx.requestVirtualPayment` 入参形态、signData 字段集合、回调载荷、签名原文与 ACK 响应均依据外部 review 引用的腾讯虚拟支付公开文档（截至 2026-05），关键约定：
>
> | 维度 | 当前 spec 取值 |
> |---|---|
> | 客户端 mode | `short_series_goods` |
> | signData 字段 | `offerId / buyQuantity / env / currencyType / productId / goodsPrice / outTradeNo / attach` |
> | pay_sig | `HMAC-SHA256(AppKey, "requestVirtualPayment" + "&" + signData)` |
> | signature | `HMAC-SHA256(session_key, signData)` |
> | 回调 envelope | `{ EventType, Event, Payload, PayEventSig }`（顶层大写驼峰） |
> | EventType 取值 | `TRANSACTION.SUCCESS` / `TRANSACTION.PAYERROR` 等支付**结果**类型，**不是**事件名 |
> | Event 取值 | `xpay_goods_deliver_notify` 等**事件名**，决定 Payload 解析器 |
> | pay_event_sig | `HMAC-SHA256(AppKey, Event + "&" + Payload)`（Payload 必须取顶层 envelope 解析后的字符串原值） |
> | 回调 ACK | `{ "returnCode": 0, "returnMessage": "OK", "data": "OK", "requestId": "..." }`（小写驼峰，`data="OK"` 是关键） |
>
> **实施 plan 开始前必须用当时微信官方开放文档 / 后台沙箱实际回调样例复核：字段名、大小写、签名原文拼装顺序、Content-Type、HTTP 响应格式、EventType 完整状态枚举。**
>
> 任何字段名 / 签名规则 / 取值与本文不一致时，**以届时活文档为准**，并回写 spec 修订记录，不静默偏离。本 spec 经过三轮外部 review 修订（2026-05-06、改 1：路径硬编码 / signature 自洽，改 2：mode/signData/JSON 回调，改 3：EventType 语义/ACK 格式）；如果实施时仍发现不符，按相同流程修订并 commit。

### 6.1 目录结构

```
service/payment/wechat_xpay/
├── provider.go     # 实现 payment.Provider，注册名 "wechat_xpay"
├── client.go       # HTTP 客户端 + pay_sig / pay_event_sig HMAC 签名
├── goods.go        # CreateOrder：生成 wx.requestVirtualPayment 入参三件套
├── notify.go       # JSON {EventType, Event, Payload, PayEventSig} 解析与验签
├── query.go        # QueryOrder：xpay/goods/query_order
├── refund.go       # Refund：xpay/goods/refund（Android 限定）
└── client_test.go
```

### 6.2 签名（pay_sig，HMAC-SHA256）

```go
// signMsg = uri + "&" + postBody，uri 不含 query
// pay_sig = hex(HMAC_SHA256(appKey, signMsg))
func calcPaySig(uri string, postBody []byte, appKey []byte) string {
    msg := append([]byte(uri+"&"), postBody...)
    mac := hmac.New(sha256.New, appKey)
    mac.Write(msg)
    return hex.EncodeToString(mac.Sum(nil))
}
```

- `uri` 取请求 path 部分（如 `/xpay/goods/place_order`），不含 `?` 及之后。
- **特殊值**：客户端调用 `wx.requestVirtualPayment` 时，签名所用 `uri` **固定为字符串 `requestVirtualPayment`**（无 `/` 前缀，非 HTTP 路径）。这是微信文档里明确的特例。
- `postBody` 必须与实际 HTTP body / signData JSON 字节级一致，否则签名失败。所有出参先 `json.Marshal` 一次得到字节流，签完直接发送，**不要再次序列化**。
- 客户端登录态 `signature` = HMAC-SHA256(session_key, postBody)，由服务端算好下发给客户端，客户端在 `wx.requestVirtualPayment` 入参里透传。

**session_key 落地（外部 review 补充点 2 修正后已自洽）**：

当前 `service/wx_mini.go:309-351` `ExchangeWxMiniCode(tenantId, code) (openid string, err error)` 丢掉了 jscode2session 同时下发的 `session_key`。仅扩字段不改 caller 会出现"登录路径不写缓存 → 下单永远 cache miss → 前端反复 wxmini_session_expired"，所以要一次到位：

```go
// service/wx_mini.go：返回结构扩展为 *WxMiniSession
type WxMiniSession struct {
    OpenId     string
    UnionId    string
    SessionKey string  // ← 新增
}

// 主函数改造（不留向后兼容薄封装，避免漏写缓存）：
//   ExchangeWxMiniSession(tenantId, code) (*WxMiniSession, error)
//
// 同时更新所有 3 处既有调用方（同一 PR）：
//   1) controller/auth/wx_mini.go:65       —— 登录路径，必须写 session_key 缓存
//   2) controller/auth/wx_mini_qr.go:166   —— 扫码登录路径，必须写 session_key 缓存
//   3) 新增 controller/payment/wxmini_xpay.go —— 仅读缓存，不直调 jscode2session
```

任何走 `wx.login` 的入口（含登录、扫码确认）都必须把 `SessionKey` 写到缓存；不存在"登录路径不需要 session_key"的例外，否则下单链路会拿不到 session_key 就走废。下单接口本身不会主动调 jscode2session（避免一次操作消耗两次微信侧 quota，也避免登录态被刷新）。

session_key 缓存：

| 维度 | 选择 |
|---|---|
| 后端 | Redis（沿用 `common.RedisEnabled` 路径，无 Redis 则进程内 sync.Map fallback，与 access_token 缓存同款） |
| Key | `wxmini:session_key:{tenantId}:{openid}` |
| Value | session_key 明文（不入库不入日志，仅缓存内驻留） |
| TTL | 7200s（与微信 session_key 寿命一致），**不**做主动续期；过期后下单接口返回 `wxmini_session_expired`，前端 catch 后重走 `wx.login` 拿新 code → 后端 `/api/auth/wx_mini/login` 刷新 session_key 缓存 → 重试下单 |
| 失效触发 | 用户主动登出 / 解绑 / 任何对微信 API 调用收到 `errcode=40001 / 42001` 时主动 `del` |
| 加密 | session_key 与 openid 有强敏感关联，**不**写 DB；缓存里也不要拼 plaintext 日志；如果 Redis 在共享集群中，按部署环境评估是否启用 Redis ACL 或单独命名空间 |

下单时序：

```
1. 前端 wx.login → /api/auth/wx_mini/login
   后端 ExchangeWxMiniSession 拿 (openid, session_key)
   把 session_key 写入缓存（key = wxmini:session_key:{tid}:{openid}）
2. 前端调 /api/payment/wxmini/topup/xpay
3. 后端按 (tid, 当前用户 openid) 从缓存读 session_key
   ├─ 命中：算 signature，正常返回 sign_data / pay_sig / signature
   └─ miss/过期：返回 {error: "wxmini_session_expired"}，前端走 wx.login 后重试
```

### 6.3 `Provider.CreateOrder`

完整流程（与 wxpay v3 的关键差异）：

```
[小程序前端]               [我们后端]                            [微信侧]

  调 /topup/xpay  ───────►  CreateOrder：
                            ① 写 PaymentOrder(pending)
                            ② 按档位组装 signData（字段见下表）并 json.Marshal
                            ③ paySig = HMAC-SHA256(AppKey, "requestVirtualPayment"+"&"+signData)
                            ④ signature = HMAC-SHA256(session_key, signData)
            ◄────  返回 {sign_data, pay_sig, signature, order:{out_trade_no}}

  wx.requestVirtualPayment({
    mode: 'short_series_goods',          ← 顶层 mode 必填
    signData, paySig, signature,
  }) ──────────────────────────────────────────────────────────► 微信侧拉起：
                                                                  iOS → Apple 支付
                                                                  Android → 微信支付

                                                                  用户付款

                            ◄──────────────────────────  POST {notify_url}
                              VerifyAndParseNotify：       JSON {EventType, Event, Payload, PayEventSig}
                              ① pay_event_sig 验签
                              ② 按 envelope.Event 选 Payload 解析器
                              ③ 按 envelope.EventType 决定订单转态：
                                   TRANSACTION.SUCCESS  → ApplyPaymentSuccess
                                   TRANSACTION.PAYERROR → MarkOrderClosed
                              ④ ValidateOutTradeNoRoute 防御租户错单

                            ──返回 {returnCode:0, returnMessage:"OK", data:"OK", requestId}──►

  pollUntilPaid 看到 paid ◄── 状态查询接口
```

#### signData 字段（按腾讯虚拟支付公开文档）

| 字段 | 类型 | 取值 | 说明 |
|---|---|---|---|
| `offerId` | string | 微信小程序后台开通虚拟支付时分配的 OfferId | 与 AppId 绑定，租户开通后录入 `tenant_payment_configs.xpay_offer_id`（**新增字段**） |
| `buyQuantity` | int | 1 | 道具直购单次固定为 1 |
| `env` | int | `0` 正式 / `1` 沙箱 | 与 `XpayEnv` 对齐 |
| `currencyType` | string | `"CNY"` | |
| `productId` | string | 微信后台配置的道具 ID | 来自 `tenant_xpay_products.product_id`，按 `(tier_code, platform)` 选 |
| `goodsPrice` | int | 单位分 | 与微信后台道具价一致；服务端取 `tenant_xpay_products.price_cents` 写入 |
| `outTradeNo` | string | 本地订单号 | `model.BuildOutTradeNo` 产物 |
| `attach` | string | 自定义透传 | 推荐放 `tier_code|platform|user_id`，回调原样回来便于补救 |

> 字段名拼写、大小写、是否必填以**实施时的活文档**为准（见 §6 顶部 guardrail）。

> `tenant_payment_configs.XpayOfferId` 在 §5.1 已加。

#### 代码骨架

```go
type xpaySignData struct {
    OfferId      string `json:"offerId"`
    BuyQuantity  int    `json:"buyQuantity"`
    Env          int    `json:"env"`
    CurrencyType string `json:"currencyType"`
    ProductId    string `json:"productId"`
    GoodsPrice   int64  `json:"goodsPrice"`
    OutTradeNo   string `json:"outTradeNo"`
    Attach       string `json:"attach"`
}

func (p *xpayProvider) CreateOrder(ctx context.Context, req payment.CreateOrderRequest) (*payment.CreateOrderResponse, error) {
    // 与 wxpay v3 不同，xpay 不提前调微信下单接口。
    // 服务端只生成 wx.requestVirtualPayment 入参四件套（mode 由前端写死，
    // 服务端下发其余三件：sign_data / pay_sig / signature）。

    sd := xpaySignData{
        OfferId:      cfg.XpayOfferId,
        BuyQuantity:  1,
        Env:          envCode(cfg.XpayEnv),  // 0 = prod, 1 = sandbox
        CurrencyType: "CNY",
        ProductId:    productRow.ProductId,
        GoodsPrice:   productRow.PriceCents,
        OutTradeNo:   req.Order.OutTradeNo,
        Attach:       buildAttach(productRow.TierCode, productRow.Platform, req.Order.UserId),
    }

    body, err := json.Marshal(sd)
    if err != nil { return nil, err }

    paySig    := calcPaySig("requestVirtualPayment", body, appKeyPlain)
    signature := calcSignature(body, sessionKey)

    return &payment.CreateOrderResponse{
        XpaySignData:  string(body),
        XpayPaySig:    paySig,
        XpaySignature: signature,
    }, nil
}
```

- `payment.CreateOrderResponse` 增字段 `XpaySignData / XpayPaySig / XpaySignature`。
- 序列化字节流必须与签名输入字节级一致，`sign_data` 直接以 `string(body)` 透传，避免 controller 层再次 marshal。
- 本地 `payment_orders` 行在 `CreateOrder` 后即 `pending`，等 deliver 回调推过来才转 `paid`。
- session_key 来源见 §6.2 末尾时序图。

### 6.4 `Provider.VerifyAndParseNotify`

虚拟支付 2.0 的回调是 **JSON**，结构（以道具直购成功事件为例）：

```json
{
  "EventType": "TRANSACTION.SUCCESS",
  "Event":     "xpay_goods_deliver_notify",
  "Payload":   "<JSON 字符串原文，作为整体参与签名>",
  "PayEventSig": "<HMAC-SHA256(AppKey, Event + '&' + Payload) 十六进制>"
}
```

**`EventType` 与 `Event` 不是同义字段，必须分别使用**：

| 字段 | 含义 | 取值（按腾讯活文档） |
|---|---|---|
| `EventType` | 支付**结果**类型，决定订单状态 | `TRANSACTION.SUCCESS` 成功 / `TRANSACTION.PAYERROR` 失败 / 其他状态见活文档 |
| `Event` | 触发回调的**事件名**，决定 Payload 的业务结构 | 道具直购成功后回调用 `xpay_goods_deliver_notify`；代币模式用 `xpay_coin_pay_notify` 等 |

判定支付成功**只看 `EventType == "TRANSACTION.SUCCESS"`**；`Event` 仅用于路由 Payload 解析器（goods / coin / refund 不同业务）和拼装 `pay_event_sig` 的签名输入。把成功判定挂到 `Event` 上是错的，会把失败 / 退款回调当成功处理。

`Payload` 是被微信侧 `json.Marshal` 后又作为字符串塞进顶层包裹的 JSON 字符串，里面含订单交付明细，典型字段集合（**实施前以活文档为准**）：

```json
{
  "OpenId": "...",
  "OutTradeNo": "...",
  "Env": 0,
  "WeChatPayInfo": {
    "MchOrderNo": "...",
    "TransactionId": "...",
    "PaidTime": 1700000000
  },
  "GoodsInfo": {
    "ProductId": "...",
    "Quantity": 1,
    "OrigPrice": 3000,
    "ActualPrice": 3000,
    "Attach": "tier_30|android|123"
  }
}
```

**验签算法**（`pay_event_sig`）：

```go
// signMsg = Event + "&" + Payload （Payload 取顶层包裹里的字符串原文，不是再次序列化的结果）
// pay_event_sig = hex(HMAC_SHA256(AppKey, signMsg))
func verifyPayEventSig(event, payload, gotSig string, appKey []byte) bool {
    mac := hmac.New(sha256.New, appKey)
    mac.Write([]byte(event))
    mac.Write([]byte("&"))
    mac.Write([]byte(payload))
    want := hex.EncodeToString(mac.Sum(nil))
    return hmac.Equal([]byte(want), []byte(gotSig))
}
```

实现要点：

- `Payload` 必须取顶层 JSON 解码后的**字符串原值**做签名输入；如果先把 Payload 解成 struct 再 marshal 回来，字节大概率不一致，会验签失败。建议用一次扁平解析：

  ```go
  var envelope struct {
      EventType   string `json:"EventType"`
      Event       string `json:"Event"`
      Payload     string `json:"Payload"`     // ← 拿原始字符串
      PayEventSig string `json:"PayEventSig"`
  }
  if err := json.Unmarshal(rawBody, &envelope); err != nil { ... }
  // 用 envelope.Payload + envelope.Event 算签名
  // 验签通过后再按 envelope.Event 路由 Payload 解析器
  ```

- 抽象分层（与既有 wxpay v3 路径一致，不破坏 Provider 接口）：
  - **`provider.VerifyAndParseNotify`** 只做"验签 + envelope/Payload 解析"，输出标准 `payment.NotifyResult`：
    - `OutTradeNo / TransactionId / PaidAt` 来自 Payload
    - `Success = (envelope.EventType == "TRANSACTION.SUCCESS")`
    - `RawState = envelope.EventType` 原文（透传给 controller）
  - **`controller/payment/xpay_notify.go`** 拿到 `NotifyResult` 后按 `Success / RawState` 决策：
    - `Success=true` → `ApplyPaymentSuccess`（既有路径）
    - `Success=false` 且 `RawState` 是活文档列出的明确失败 / 取消状态（如 `TRANSACTION.PAYERROR`）→ `MarkOrderClosed`，记 last_error
    - `Success=false` 且 `RawState` 未知 → 不改订单状态，仅记日志 + 仍按规范返回 `data="OK"` 阻止重试，让 reconcile sweep 继续兜底
- 业务 Payload 解析按 `envelope.Event` 路由：道具直购走 `GoodsInfo`、代币模式（未来）走 `CoinInfo`、退款走对应 RefundInfo。`Event` 与 `EventType` 是正交维度，不要混用。
- **响应**（按腾讯虚拟支付 callback 文档规范）：HTTP 200 + JSON

  ```json
  {
    "returnCode":    0,
    "returnMessage": "OK",
    "data":          "OK",
    "requestId":     "<原样回传请求里的 requestId，没有则生成一个>"
  }
  ```

  `data == "OK"` 是微信侧判定回调被业务侧消费成功的关键字段；`returnCode != 0` 或 `data != "OK"` 都会触发重试。**不要**沿用既有 wxpay v3 的 `{"code":"SUCCESS"}` 或本 spec 旧版本里的 `{"ErrCode":0,"ErrMsg":"success"}`，那两套都不是虚拟支付 callback 的协议。
- **幂等**：同一 `OutTradeNo` 微信侧最多重试若干次，依赖 `MarkOrderPaid` 的 pending→paid 单向 flip 保证只会成功记账一次（既有逻辑，无需新增）。重试时仍按上面响应规范返回 `data="OK"`，避免无谓重发。
- **大小写敏感**：顶层 `EventType / Event / Payload / PayEventSig` 是大写驼峰，响应字段 `returnCode / returnMessage / data / requestId` 是小写驼峰。两组命名风格不同，**实施时打一份原始 body 到日志（脱敏后）逐字段比对活文档**。

### 6.5 `Provider.QueryOrder` & `Provider.Refund`

- `QueryOrder`：调 `xpay/goods/query_order`，按 OutTradeNo 查询订单状态，对账（reconcile）使用。
- `Refund`：调 `xpay/goods/refund`，**仅 Android 订单**。如订单 metadata 里的 platform=ios，直接返回错误 `"iOS 订单不支持商户退款"`。

## 7. 控制器与 API

### 7.1 新增小程序专用控制器：`controller/payment/wxmini_xpay.go`

```go
// GET /api/payment/wxmini/topup/tiers?platform=ios|android
// 返回当前租户的档位列表
type TierResponse struct {
    Tiers []TierItem `json:"tiers"`
}
type TierItem struct {
    TierCode      string `json:"tier_code"`
    PriceCents    int64  `json:"price_cents"`
    QuotaPreview  model.TopUpBonusPreview `json:"quota_preview"`
    DisplayPrice  string `json:"display_price"`  // "¥30.00"
    BadgeText     string `json:"badge_text,omitempty"` // "iOS 含 Apple 服务费"
}

// POST /api/payment/wxmini/topup/xpay
// 入参：{ tier_code, platform }（platform 由客户端探测，服务端二次校验 UA）
// 出参：{
//   order:         { out_trade_no },
//   sign_data:     "<JSON 字符串，与 paySig/signature 计算时字节级一致>",
//   pay_sig:       "<HMAC-SHA256(AppKey, 'requestVirtualPayment&'+sign_data)>",
//   signature:     "<HMAC-SHA256(session_key, sign_data)>",
//   quota_preview: { ... }
// }
// 错误码：
//   "wxmini_session_expired" → 前端走 wx.login 刷新 session 后重试
//   "tier_not_found" / "tier_disabled" → 档位非法
//   "platform_mismatch"  → UA 与请求 platform 不一致
```

- `platform` 接收客户端值后**用 User-Agent 二次校验**：含 `iPhone OS` 强制为 ios，含 `Android` 强制为 android。客户端撒谎的话以 UA 为准（防止用户用 iOS 模拟器或改包获取低价档）。
- `quota_preview` 复用 `model.GetUserLevelTopUpBonusPreview`，让前端展示等级赠送预览。

### 7.2 旧 wxpay JSAPI 接口

- `POST /api/payment/wxmini/topup/jsapi`（小程序专用别名，如果已存在）：保留 7 天兜底老版小程序，期间继续工作；7 天后下线。
- 服务端响应 header 中加 `X-Deprecated: virtual-pay-rollout`，便于监控老路径调用量趋势。

### 7.3 回调路由分流

xpay 与 wxpay v3 都是 JSON，但**载荷结构、签名 header / 字段、响应体规范都不同**。为减少入口判别错误的风险，**给 xpay 单独 path**，而不是塞进现有 `/api/payment/wechat/notify`：

| 路径 | provider | 触发条件 |
|---|---|---|
| `POST /api/payment/wechat/notify/:tid/:order_type` | `wechat` (v3) | header `Wechatpay-Signature` + JSON body 含 `resource.ciphertext` |
| `POST /api/payment/wechat/xpay_notify/:tid/:order_type` （新增） | `wechat_xpay` | JSON body 顶层含 `EventType` / `PayEventSig` |

理由：

- 两条路径职责单一，验签算法、解密路径、响应体格式都互不混淆，不需要写 fragile 的形态嗅探。
- `notify_url` 在创建订单时由 `controller/payment/wechat.go:buildNotifyUrl` 拼出绝对 URL；新增 xpay 路径只需要新增一个 helper（或复用既有的，传不同 path 后缀）。
- 老版小程序兜底窗口（§7.2）期间，老 wxpay 回调仍走老路径，互不影响。

入口控制器：

- 老路径 `notify.go` 不动。
- 新增 `controller/payment/xpay_notify.go`：读 raw body → 调 `wechat_xpay` provider 的 `VerifyAndParseNotify`（内部用 `cfg.XpayAppKeyEnc` 解密 + 验 `pay_event_sig`）→ `ValidateOutTradeNoRoute` → 按 `NotifyResult.Success` / `RawState` 决策 `ApplyPaymentSuccess` 或 `MarkOrderClosed` → 返回 §6.4 规范的 `{returnCode:0, returnMessage:"OK", data:"OK", requestId}`。验签失败 / route 校验失败 → 返回 `data` 非 `"OK"` 的错误体。
- 路由注册放在 `router/api-router.go` 既有 payment 路由组旁。

## 8. 小程序前端

### 8.1 `wxapp/src/pages/redeem/index.vue` 改造

- **删除**自定义金额输入框（`customInput` 相关）。
- **删除**预设金额数组 PRESETS，改为从后端 `/topup/tiers` 拉取。
- 档位 UI 增加 platform 切换提示，但**实际平台由 `uni.getSystemInfo` 探测**自动决定，UI 上只展示当前平台的价格 + 一个小角标"iOS 含 Apple 服务费"（仅 iOS 显示）。
- `doPay()` 重写：

```js
async function doPay() {
  const platform = getSystemPlatform()  // 'ios' | 'android'
  const data = await createWxMiniXpayOrder(currentTier.value, platform)
  if (data?.quota_preview) topupPreview.value = data.quota_preview

  await new Promise((resolve, reject) => {
    wx.requestVirtualPayment({
      mode: 'short_series_goods',  // ← 顶层 mode 必填，标识道具直购模式
      signData: data.sign_data,    // 后端原样下发的 JSON 字符串
      paySig: data.pay_sig,        // 后端 HMAC(AppKey, 'requestVirtualPayment&'+sign_data)
      signature: data.signature,   // 后端 HMAC(session_key, sign_data)
      success: resolve,
      fail: (err) => {
        // session 过期由后端 wxmini_session_expired 已经拦了一道；这里仅处理
        // 客户端基础库 / 用户取消等错误，常见 errMsg 包括 'cancel' / 'fail'
        reject(new Error(err.errMsg || '支付已取消'))
      },
    })
  })

  // 后续 pollUntilPaid 沿用
}
```

- `pollUntilPaid` 沿用，等 deliver_notify 写入 `payment_orders.status='paid'`。

### 8.2 `wxapp/src/services/api.js`

```js
export const getXpayTiers = (platform) =>
  request({ url: `/api/payment/wxmini/topup/tiers`, data: { platform } })

export const createWxMiniXpayOrder = (tierCode, platform) =>
  request({ url: `/api/payment/wxmini/topup/xpay`, method: 'POST',
            data: { tier_code: tierCode, platform } })
```

- 移除原 `createWechatTopupJsapi` 的小程序内引用，但**保留 export** 7 天，避免老版小程序代码引用断裂（同 7.2 后端兜底）。

### 8.3 客户端版本要求提示

- iOS 用户：检测 iOS 版本 < 15 或微信版本 < 8.0.68，UI 上提示"请升级 iOS 至 15 以上 / 微信至 8.0.68 以上后再充值"。

## 9. 后台运营（web-next）

### 9.1 租户管理员视角："虚拟支付配置"页

- 启用虚拟支付开关（写 `XpayEnabled`）
- 录入 AppKey（写 `XpayAppKeyEnc`）
- 选择环境（sandbox / prod）

### 9.2 道具档位管理页

- 列表展示 tier_code + platform → product_id / price / quota_delta
- 新增档位时按 tier_code 自动生成 android + ios 两行，要求运营手动填写 product_id（在微信小程序后台配完后回填）
- 提供 quota 预览，按 quota_display_type 显示
- 校验：同 tier 内 price_cents(ios) >= price_cents(android)（合理性提醒，不强制）

### 9.3 上线前 checklist（运营文档）

```
□ 微信小程序后台 → 虚拟支付 → 已开通
□ 道具列表已配置（每档 android / ios 两份）
□ AppKey 已下发并录入后台
□ 通过 sandbox 完成 Android 全链路验证（沙箱 / 1 元真单）
□ iOS 仅现网测试（找一台真机走真单 + 退款联系 Apple）
□ 后端配置 XpayEnabled=true
□ 发布小程序新版本至开发版 → 体验版 → 灰度 → 全量
```

## 10. 切换策略与回滚

### 10.1 上线节奏

1. **D-7**：后端代码合入主干，`XpayEnabled` 默认关，旧 wxpay 路径不变
2. **D-3**：内测租户开启 `XpayEnabled=true`，体验版小程序验证全链路
3. **D-1**：所有租户配置就绪，运营完成道具录入
4. **D-Day**：发布小程序新版本（前端去掉旧 wxpay JSAPI 调用）+ 后端开启全量 `XpayEnabled`
5. **D+7**：下线后端旧 `topup/jsapi` 接口，删除 wxapp 内残留 import

### 10.2 兼容窗口

- 后端 `topup/jsapi` 老接口在 D-Day 后**继续保留 7 天**，让客户端老版本（24-72h 缓存 + 极少数手动停留旧版的用户）能正常充值。
- 这 7 天内监控老接口调用量，下降到接近 0 才下线。
- 老接口下线后不立即删除代码，保留 30 天再清理（紧急回滚的退路）。

### 10.3 回滚预案

- 风险事件 1：xpay 下单大面积失败 → 后端临时把 `XpayEnabled` 关掉，前端档位列表接口改返 410 + 错误码，提示用户"暂时维护，请稍后再试"。**不能回退到 wxpay**（小程序新版本里已经没有这条调用了）。
- 风险事件 2：deliver_notify 解析错位导致 quota 没到账 → 走对账流程（`reconcile`），手动跑 `QueryOrder` 修复；不影响新订单。
- 风险事件 3：发现严重违规风险 → 走小程序紧急下架，新版用户无法充值，老版用户走老接口（7 天兜底窗口的核心价值）。

## 11. 安全

- AppKey 与现有 PrivateKey/Apiv3Key 走相同加密链路（AES-256-GCM + HKDF）。
- platform 字段的服务端 UA 二次校验（防止用户撒谎拿低价档）。
- pay_sig / signature / pay_event_sig 三处签名输入的字节流必须与实际传输的 body 字节级一致：sign_data 一旦由 `json.Marshal` 产出就**透传**，不要在 controller / 前端中间层再 unmarshal-remarshal；回调侧的 Payload 必须取顶层 envelope 解析后的字符串原值参与签名。
- 回调验签失败的请求一律返回 400 且不影响订单状态。
- 沙箱与正式环境的 AppKey 不可混用，`XpayEnv` 与 AppKey 必须绑定校验（DB 约束之外加 service 层校验）。
- iOS UA 校验作为防御层，但根本防线仍是道具价格在微信后台被强制写死，客户端伪造的 platform 参数最坏只能让 iOS 用户误付 android 价（这种情况下微信会按 product_id 收 android 价，平台不亏；只是用户在 iOS 上付了 Android 道具的钱，体验异常）。

## 12. 测试

### 12.1 单元测试

- `service/payment/wechat_xpay/client_test.go`：
  - `pay_sig` 算法对照微信官方示例向量（uri=`/xpay/query_user_balance`、postBody=`{"openid":"xxx"...}`、appkey=`12345` → `c37809f27c6d7fd1837ad2500a04512b66b34fd793a39a385fade56dca89a4b5`）
  - `pay_event_sig` 算法对照活文档示例向量（实施时取一份 sandbox 真实回调样例固化为黄金向量）
  - `signature` 算法对照微信文档示例（session_key=`9hAb/NEYUlkaMBEsmFgzig==`、postBody=`{"openid":"xxx"...}` → `089d9e8dc5d308977360c4b79ec600a93d736802802a807d634192328032f6c7`）
- `notify_test.go`：
  - JSON envelope 解析，`envelope.Payload` 必须以字符串原值参与签名（用 raw bytes 比对）
  - pay_event_sig 验签（正例 + 篡改 Payload 反例 + 篡改 Event 反例 + AppKey 不匹配反例）
  - `EventType` 路由测试：`TRANSACTION.SUCCESS` → ApplyPaymentSuccess、`TRANSACTION.PAYERROR` → MarkOrderClosed、未知值 → 不动状态仅记日志
  - 重复推送幂等：同一 OutTradeNo 二次回调返回 `data=OK` 且不重复加 quota
  - ACK 响应格式：成功 / 验签失败 / EventType 未知 三种分支返回的 JSON 字段名、值（`returnCode/returnMessage/data/requestId`）逐字段断言
- `goods_test.go`：CreateOrder 字段映射 + tier 不存在 / platform 非法 / 租户未开通虚拟支付 等错误路径
- `provider_test.go`：注册名、TestCredentials（HEAD /xpay/ping 之类的轻量探活）
- `controller/payment/wxmini_xpay_test.go`：tier 列表 + 下单 + UA 二次校验路径

### 12.2 集成

- 用 sandbox 跑 Android 完整链路（创建订单 → 客户端 wx.requestVirtualPayment → deliver_notify → quota 到账 → query_order 对账）
- iOS 现网真机最小金额（1 元）跑一次 + 联系 Apple 退款流程演练

### 12.3 监控

- Prometheus 指标增加：
  - `xpay_create_order_total{tenant, platform, result}`
  - `xpay_notify_total{tenant, event, verify}`
  - `xpay_pay_sig_mismatch_total`
- 接入告警：5 分钟内 `xpay_pay_sig_mismatch_total` > 5 触发 P0

## 13. 范围外（未来工作）

- 代币模式（米大师 coin）：如需做用户钱包 / 余额双向流通再考虑
- 道具配置 API 自动同步（虚拟支付 2.0 提供了 product 配置接口，本期人工配，未来再做自动化）
- 续期支付（sub）若未来要进小程序入口，按相同模式扩展（道具 product_id 改为周期型）
- 跨租户的 AppKey 共享（当前每租户独立 AppID，未来若做平台型小程序需另行设计）
