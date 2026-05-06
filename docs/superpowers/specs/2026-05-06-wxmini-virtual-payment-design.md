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
│  controller/payment/notify.go                                      │
│   └─ POST /api/payment/wechat/notify/:tid/topup（XML/JSON 双形态）│
│        ├─ 旧 wxpay v3 JSON+APIv3-Signature                        │
│        └─ 新 xpay XML event + pay_sig HMAC                        │
│  service/payment/wechat_xpay/                                      │
│   ├─ provider.go      实现 payment.Provider                        │
│   ├─ client.go        HMAC-SHA256 pay_sig 签名 + HTTP 调用         │
│   ├─ goods.go         CreateOrder（生成 OutTradeNo + 客户端入参）  │
│   ├─ notify.go        xpay_goods_deliver_notify 解析 + 验签        │
│   ├─ query.go         QueryOrder（对账用）                         │
│   └─ refund.go        Refund（仅 Android 走）                      │
│  model/                                                            │
│   ├─ tenant_payment_config.go：增 XpayEnabled / XpayAppKeyEnc /    │
│   │  XpayEnv 三个字段                                              │
│   └─ tenant_xpay_product.go（新表）：tier+platform → product_id   │
└────────────────────────────────────────────────────────────────────┘
```

## 5. 数据模型

### 5.1 `tenant_payment_configs` 增字段

```go
type TenantPaymentConfig struct {
    // ... 既有字段
    XpayEnabled    bool   `json:"xpay_enabled" gorm:"default:false"`
    XpayAppKeyEnc  string `json:"-" gorm:"type:text"`         // AES-256-GCM 加密
    XpayEnv        string `json:"xpay_env" gorm:"type:varchar(16);default:'prod'"` // 'sandbox' | 'prod'
}
```

- `XpayAppKeyEnc` 的明文是微信小程序后台开通虚拟支付后下发的 AppKey，用于计算 `pay_sig`（HMAC-SHA256）。复用现有的 AES-256-GCM 加密链路（`encField`/`decField`）。
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
6. **`ApplyPaymentSuccess` / 回调路由侧**：按 `order.Provider` 解发，而不是默认 wechat。当前 `controller/payment/notify.go` 路径上 `ValidateOutTradeNoRoute` 不依赖 provider 名，但 reconcile 路径（`service/payment/reconcile.go`）目前默认调 `Get("wechat")` —— 也要改成读 `order.Provider`。
7. **回归测试**：`service/payment/order_quota_test.go` 现有用例覆盖三种 form，要补 `xpay_goods` 形态的单测。

> 这一节不是后续 plan 的"可选优化"，是新增 provider 能跑起来的前置条件，必须和 §6.1-6.5 的代码一起进。

### 6.1 目录结构

```
service/payment/wechat_xpay/
├── provider.go     # 实现 payment.Provider，注册名 "wechat_xpay"
├── client.go       # HTTP 客户端 + pay_sig HMAC 签名
├── goods.go        # CreateOrder：生成下单参数
├── notify.go       # xpay_goods_deliver_notify XML 事件解析与验签
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

**session_key 落地（外部 review 补充点 2 验证后必须改）**：

当前 `service/wx_mini.go:309-351` `ExchangeWxMiniCode(tenantId, code) (openid string, err error)` 的返回值丢掉了 jscode2session 接口同时下发的 `session_key`。本设计要求改造：

```go
// service/wx_mini.go：扩展返回结构
type WxMiniSession struct {
    OpenId     string
    UnionId    string  // 已存在，未来 OA 联通用
    SessionKey string  // ← 新增
}

// 兼容旧调用方（控制器/auth/wx_mini.go:65、wx_mini_qr.go:166）：
//  - 保留 ExchangeWxMiniCode(tenantId, code) (openid, err) 作为薄封装
//  - 内部委托给新增的 ExchangeWxMiniSession(tenantId, code) (*WxMiniSession, err)
//  - 登录路径不需要 session_key，旧函数签名不动
//  - 支付路径调用新函数并把 session_key 写缓存
```

session_key 缓存：

| 维度 | 选择 |
|---|---|
| 后端 | Redis（沿用 `common.RedisEnabled` 路径，无 Redis 则进程内 sync.Map fallback，与 access_token 缓存同款） |
| Key | `wxmini:session_key:{tenantId}:{openid}` |
| Value | session_key 明文（不入库不入日志，仅缓存内驻留） |
| TTL | 7200s（与微信 session_key 寿命一致），**不**做主动续期；过期后下单接口返回 401，前端 catch 后重走 `wx.login` 拿新 code → 后端调 `/api/auth/wx_mini/login` 刷新 session_key 缓存 → 重试下单 |
| 失效触发 | 用户主动登出 / 解绑 / `errcode=40001` 时主动 `del` |
| 加密 | session_key 与 user.WeChatId（openid）有强敏感关联，**不**写 DB；缓存里也不要拼 plaintext 日志；如果 Redis 在共享集群中，需要按部署环境评估是否启用 Redis ACL 或单独命名空间 |

下单时序：

```
1. 前端走过 wx.login → /api/auth/wx_mini/login（已有路径）
   后端在该路径上把 session_key 写入缓存（同一次 jscode2session 拿到）
2. 前端调 /api/payment/wxmini/topup/xpay
3. 后端从缓存取 session_key
   ├─ 命中：算 signature，正常返回
   └─ miss/过期：返回 {error: "wxmini_session_expired"}，前端 catch 后重新走步骤 1
```

### 6.3 `Provider.CreateOrder`

完整流程（与 wxpay v3 的关键差异）：

```
[小程序前端]               [我们后端]                       [微信侧]
                                                            
  调 /topup/xpay  ───────►  CreateOrder：
                            ① 写 PaymentOrder(pending)
                            ② 序列化 signData
                            ③ paySig = HMAC(AppKey, "requestVirtualPayment"+"&"+signData)
                            ④ signature = HMAC(session_key, signData)
            ◄────  返回 {signData, paySig, signature, out_trade_no}
                            
  wx.requestVirtualPayment(
    {signData, paySig, signature}) ───────────────────────►  微信收到，
                                                              拉起 Apple Pay (iOS) 或 wxpay (Android)
                                                              
                                                              用户付款
                                                              
                            ◄──────────────────────────  POST /api/payment/wechat/notify/:tid/topup
                              VerifyAndParseNotify：       (xpay_goods_deliver_notify XML 事件)
                              ① 验 signature
                              ② 校验 OutTradeNo 与 PaymentOrder.TenantId
                              ③ applyTopupSuccess
                              
                            ──返回 {ErrCode:0,ErrMsg:"success"}──►
                              
  pollUntilPaid 看到 paid ◄── 状态查询接口
```

```go
func (p *xpayProvider) CreateOrder(ctx context.Context, req payment.CreateOrderRequest) (*payment.CreateOrderResponse, error) {
    // 与 wxpay v3 不同，xpay 不提前调微信下单接口。
    // 服务端只负责生成下发给客户端的 signData / paySig / signature 三件套；
    // 真正的下单由客户端 wx.requestVirtualPayment 触发，微信侧完成支付后
    // 反向 POST 到我们的 notify URL 推 deliver 事件。
    signData := xpaySignData{
        OutTradeNo: req.Order.OutTradeNo,
        ProductId:  metadata.XpayProductId,
        Quantity:   1,
        Env:        envCode(cfg.XpayEnv),  // 0=prod, 1=sandbox
        // ...
    }
    body, _ := json.Marshal(signData)
    paySig := calcPaySig("requestVirtualPayment", body, appKeyPlain)
    signature := calcSignature(body, sessionKey)
    return &payment.CreateOrderResponse{
        XpaySignData:  string(body),
        XpayPaySig:    paySig,
        XpaySignature: signature,
    }, nil
}
```

- `payment.CreateOrderResponse` 增字段 `XpaySignData / XpayPaySig / XpaySignature`。
- 本地 `payment_orders` 行在 `CreateOrder` 后即变成 `pending`，等 deliver_notify 推送过来才转 `paid`。
- session_key 来源：jscode2session 时由后端缓存（建议 Redis，TTL 跟随微信约定的 7200s 或更短），缓存 key 用 (tenant_id, openid)。

### 6.4 `Provider.VerifyAndParseNotify`

虚拟支付的回调事件是 XML 格式，结构与公众号事件类似：

```xml
<xml>
  <ToUserName><![CDATA[gh_xxx]]></ToUserName>
  <FromUserName><![CDATA[OPENID]]></FromUserName>
  <CreateTime>1700000000</CreateTime>
  <MsgType><![CDATA[event]]></MsgType>
  <Event><![CDATA[xpay_goods_deliver_notify]]></Event>
  <OpenId><![CDATA[OPENID]]></OpenId>
  <OutTradeNo><![CDATA[XXX]]></OutTradeNo>
  <Env>0</Env>
  <WeChatPayInfo>
    <MchOrderNo>...</MchOrderNo>
    <TransactionId>...</TransactionId>
    <PaidTime>1700000000</PaidTime>
  </WeChatPayInfo>
  <GoodsInfo>
    <ProductId>...</ProductId>
    <Quantity>1</Quantity>
    <OrigPrice>3000</OrigPrice>
    <ActualPrice>3000</ActualPrice>
    <Attach><![CDATA[...]]></Attach>
  </GoodsInfo>
</xml>
```

- 验签：query 参数中带 `signature` 字段（HMAC over body with AppKey），服务端按 AppKey 重新计算比对。
- 解析后产出 `payment.NotifyResult`，与 wxpay 共享下游 `applyTopupSuccess`。
- **响应**：返回 `{"ErrCode": 0, "ErrMsg": "success"}`，否则微信会重试。

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

`/api/payment/wechat/notify/:tid/:order_type` 既要兼容旧 wxpay v3（JSON + `Wechatpay-Signature` header），也要兼容新 xpay（XML + query 参数 `signature`）。在 controller 入口处按 `Content-Type` 和 body 起始字节判别：

- `application/json` 且 header 含 `Wechatpay-Serial` → 走 `wechat` provider 验签
- `application/xml` 或 body 以 `<xml>` 起始 → 走 `wechat_xpay` provider 验签

否则统一返回 400。

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
      signData: data.sign_data,    // 后端原样下发的 JSON 字符串
      paySig: data.pay_sig,        // 后端 HMAC(AppKey, ...) 算好
      signature: data.signature,   // 后端 HMAC(session_key, ...) 算好（不是微信侧自动注入）
      success: resolve,
      fail: (err) => reject(new Error(err.errMsg || '支付已取消')),
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
- pay_sig 计算使用的 body 必须与 HTTP 实际发送的 body 字节级一致；写好测试覆盖签名稳定性。
- 回调验签失败的请求一律返回 400 且不影响订单状态。
- 沙箱与正式环境的 AppKey 不可混用，`XpayEnv` 与 AppKey 必须绑定校验（DB 约束之外加 service 层校验）。
- iOS UA 校验作为防御层，但根本防线仍是道具价格在微信后台被强制写死，客户端伪造的 platform 参数最坏只能让 iOS 用户误付 android 价（这种情况下微信会按 product_id 收 android 价，平台不亏；只是用户在 iOS 上付了 Android 道具的钱，体验异常）。

## 12. 测试

### 12.1 单元测试

- `service/payment/wechat_xpay/client_test.go`：pay_sig 算法对照微信官方示例向量（uri=`/xpay/query_user_balance`、postBody=`{"openid":"xxx"...}`、appkey=`12345` → `c37809f27c6d7fd1837ad2500a04512b66b34fd793a39a385fade56dca89a4b5`）
- `notify_test.go`：xpay_goods_deliver_notify XML 解析 + 验签 + 重复推送幂等
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
