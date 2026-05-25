# 客户系统接入中转站 API

这组接口用于给客户系统接入专属租户：客户用户在客户系统登录后，可静默登录到本系统并获得稳定的 API Key。充值结算由租户管理员统一处理，用户侧不再自助充值。

## 环境变量

```env
PARTNER_API_TENANT_ID=7
PARTNER_API_CLIENT_ID=tenant_xxx
PARTNER_API_CLIENT_SECRET=change-me-to-a-long-random-secret

# 兼容旧接口 /api/partner/capabilities、/topups、/rebates
PARTNER_API_KEY=change-me-to-a-long-random-secret
```

- `PARTNER_API_TENANT_ID`：客户专属租户 ID。
- `PARTNER_API_CLIENT_ID`：客户系统标识。未配置时允许任意非空 `client_id`，但生产环境建议配置。
- `PARTNER_API_CLIENT_SECRET`：HMAC 签名密钥，只能放在客户服务端。
- `PARTNER_API_KEY`：兼容旧的 Bearer 鉴权接口；当 `PARTNER_API_CLIENT_SECRET` 为空时，也会作为签名密钥 fallback。

## 签名规则

签名算法：`HMAC-SHA256(client_secret, canonical_string)`，输出小写 hex。

- `timestamp` 允许 5 分钟窗口。
- `nonce` 一次性使用，重复请求会被拒绝。
- `external_user_id` 必须使用客户系统内稳定唯一的用户 ID。

## 静默登录并获取 API Key

```http
POST /api/partner/sso/exchange
Content-Type: application/json
```

请求体：

```json
{
  "client_id": "tenant_xxx",
  "external_user_id": "u_123456",
  "email": "user@example.com",
  "username": "user_123456",
  "display_name": "张三",
  "timestamp": 1779600000,
  "nonce": "random_string",
  "create_key": true,
  "key_name": "客户系统自动创建",
  "signature": "hmac_sha256_signature"
}
```

签名原文：

```text
client_id=tenant_xxx
external_user_id=u_123456
email=user@example.com
username=user_123456
timestamp=1779600000
nonce=random_string
```

成功响应：

```json
{
  "success": true,
  "data": {
    "tenant_id": 7,
    "user_id": 12345,
    "external_user_id": "u_123456",
    "login_url": "https://your-domain.com/api/partner/sso/login?ticket=one_time_ticket",
    "api_key": "sk-xxxxxx",
    "api_base": "https://your-domain.com/v1"
  }
}
```

说明：

- 首次调用会创建租户内普通用户，初始余额为 0。
- 每次登录成功都返回同一个 partner API Key。
- Key 默认不限制有效期、IP、每日额度和模型范围。

## 一次性 ticket 登录

```http
GET /api/partner/sso/login?ticket=one_time_ticket
```

- `ticket` 一次性使用，默认 60 秒有效。
- 可选 `redirect=/console`，只允许站内路径。

## 查询同步用户数据

```http
POST /api/partner/users/query
Content-Type: application/json
```

请求体：

```json
{
  "client_id": "tenant_xxx",
  "start_time": 1779513600,
  "end_time": 1779600000,
  "include_topups": true,
  "include_usage": true,
  "page": 1,
  "page_size": 100,
  "timestamp": 1779600000,
  "nonce": "random_string",
  "signature": "hmac_sha256_signature"
}
```

签名原文：

```text
client_id=tenant_xxx
external_user_ids=
start_time=1779513600
end_time=1779600000
include_topups=true
include_usage=true
page=1
page_size=100
timestamp=1779600000
nonce=random_string
```

`external_user_ids` 可不传或传空数组，表示同步该 `client_id` 下已绑定的全部用户；只有客户系统需要按指定用户过滤时才传，例如 `["u_123456","u_888888"]`。不传时签名原文仍保留 `external_user_ids=` 这一行，值为空。

响应字段包含：

- `quota`：当前余额。
- `used_quota`：历史累计消耗。
- `request_count`：历史请求次数。
- `api_key_count`：该用户 API Key 数量。
- `last_login_at`：最后登录时间。
- `period_topup_quota`：查询时间段内充值统计。
- `period_used_quota`：查询时间段内消耗统计。

同步频率由客户系统按自身需求决定，我方只提供开放接口。

## 模型调用

```http
POST /v1/chat/completions
Authorization: Bearer sk-xxxxxx
Content-Type: application/json
```

模型不做额外限制，平台开放的所有模型均可使用。实际可用性仍取决于用户余额、租户额度、平台渠道状态和模型状态。

## 充值结算口径

- 客户专属租户使用管理员统一结算。
- 用户侧自助充值可通过租户配置 `UserSelfTopUpEnabled=false` 关闭。
- 关闭后用户兑换码、在线充值、微信充值、Stripe、Creem、Waffo、小程序虚拟支付等用户侧充值接口都会拒绝。
- 管理员后台仍可查看、导出、补单和调整用户额度。
