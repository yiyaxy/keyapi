# 当地运营平台对接接口

这组接口用于给外部运营平台同步本系统里的用户 TOKEN 购买记录、分销返利记录，以及查询当前可对接的工具能力。

## 环境变量

```env
PARTNER_API_KEY=change-me-to-a-long-random-secret
PARTNER_API_TENANT_ID=1
```

- `PARTNER_API_KEY`：外部平台访问 `/api/partner/*` 时使用的密钥，支持用逗号配置多个。
- `PARTNER_API_TENANT_ID`：可选。配置后该密钥只允许访问这个租户的数据；不配置时，请求必须带 `X-Tenant-Id`。

## 鉴权

外部平台请求时任选一种方式带密钥：

```http
Authorization: Bearer <PARTNER_API_KEY>
```

或：

```http
X-Partner-Token: <PARTNER_API_KEY>
```

## 能力查询

```http
GET /api/partner/capabilities
```

返回当前租户的额度显示方式、可拉取的数据接口，以及可配合使用的工具入口，例如 OpenAI-compatible `/v1`、图片生成、视频生成等。

## TOKEN 购买记录

```http
GET /api/partner/topups?p=1&page_size=20&status=success&since=1710000000
```

常用查询参数：

- `p`：页码，默认 1。
- `page_size`：每页数量，最大 100。
- `status`：订单状态，如 `success`、`pending`、`expired`。
- `since` / `until`：Unix 秒级时间戳。
- `time_field`：`complete_time` 或 `create_time`，默认 `complete_time`。
- `user_id`：按用户 ID 过滤。
- `trade_no`：按订单号精确查询。
- `keyword`：按订单号、用户名、显示名模糊查询。

返回字段包括用户 ID、用户名、订单号、支付方式、订单状态、创建/完成时间、购买额度等。

## 返利记录

```http
GET /api/partner/rebates?p=1&page_size=20&type=2&since=1710000000
```

常用查询参数：

- `type`：返利类型，`1` 注册/绑定奖励，`2` 充值返利，`3` 订阅返利。
- `user_id`：返利获得者用户 ID。
- `invitee_id`：被邀请用户 ID。
- `since` / `until`：Unix 秒级时间戳，按返利记录创建时间过滤。

返回字段包括返利获得者、被邀请用户、返利类型、返利额度和备注。
