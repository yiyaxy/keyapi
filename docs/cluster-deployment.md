# 多副本部署验收清单

## 起环境

```bash
docker compose -f docker-compose.cluster.yml up --build
```

两个实例：
- http://localhost:3001 (instance-1)
- http://localhost:3002 (instance-2)

> 首次启动会跑 DB migration，等 instance-1 / instance-2 日志各出现一次 "instance id: <uuid>" 后再开始验收。

## 验收用例

### 用例 1：OptionMap 实时同步
1. 在 http://localhost:3001 后台改 `Notice` 为 "from-instance-1"
2. **预期**：< 1 秒内 http://localhost:3002 的首页公告变成 "from-instance-1"
3. **回归对比**（可选）：把 `REDIS_CONN_STRING` 注释掉重启，重复步骤 1，预期 instance-2 直到 60s 才同步

### 用例 2：渠道新增/禁用实时生效
1. 在 instance-1 新建一个 OpenAI 渠道，绑定模型 `gpt-test`
2. **预期**：< 1 秒内 instance-2 用 `gpt-test` 发请求能命中新渠道
3. 在 instance-1 禁用该渠道
4. **预期**：< 1 秒内 instance-2 用 `gpt-test` 请求返回"无可用渠道"

### 用例 3：租户路由模式切换
1. 在 instance-1 把租户 X 的 `platform_channel_mode` 改为 `only_private`（合法值见 `model/tenant_option.go:94-97`：`private_priority` / `platform_priority` / `only_private` / `only_platform`）
2. **预期**：< 1 秒内 instance-2 对租户 X 的请求只命中私有渠道

### 用例 3b：渠道 auto-failover（review #2 覆盖回归）
1. 用 instance-2 触发足够多失败请求让某渠道被 auto-disable（可以临时改 `ChannelDisableThreshold` 让阈值很低）
2. **预期**：instance-1 在 < 1 秒内也将该渠道视为不可用（不再路由）
3. 验证日志：instance-1 日志出现 `cache invalidate subscriber ... channel_full` 事件

### 用例 3c：租户级 option 覆盖（review #1 覆盖回归）
1. 在 instance-1 用租户管理员账号改租户 X 的某个可覆盖 option（例如 `ChannelDisableThreshold`）
2. **预期**：instance-2 上租户 X 的请求 < 1 秒内开始用新阈值（通过观察 `service.GetConfig` 行为或日志）

### 用例 4：Redis 故障降级
1. `docker compose -f docker-compose.cluster.yml stop redis`
2. **预期**：两个实例不崩，日志报 Redis 错误，本地缓存仍可用，但实时同步失效（回退到 60s 兜底）
3. 启动 redis：`docker compose start redis`
4. **预期**：订阅 goroutine 自动重连（go-redis Subscribe 有内置重试），实时同步恢复

### 用例 5：自己的广播不会触发自己 reload
1. tail instance-1 的日志：`docker compose logs -f keyapi-1`
2. 在 instance-1 改 `Notice`
3. **预期**：instance-1 日志**不**出现 `invalidate option reload Notice`；instance-2 日志**会**出现 `invalidate option reload: Notice`

## 已知不在此次范围内的限制
- 渠道全量缓存收到失效后是**全表重建**，不是增量。渠道 > 5000 时建议把 invalidate 频率限流（暂不实现，YAGNI）
- 跨实例统计/排行榜仍是 DB 实时聚合，不受本次改造影响
- Token 预扣 / 限流 / cooldown 改造前已经走 Redis 共享，不受影响
