# 多实例部署缓存一致性改造（Redis Pub/Sub）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 OptionMap、全量渠道缓存（`channelsIDM` / `group2model2channels`）、租户路由缓存（`tenantMode` / `tenantDisabledChannel`）在多副本之间秒级同步，消除"改了配置只在改的那个实例生效"和"新增/删除渠道最多 60s 延迟"两个核心一致性坑。

**Architecture:** 在已有的 `common.RDB`（go-redis v8）之上加一条 **Redis Pub/Sub 失效广播通道**。任何写本地缓存的操作（`UpdateOption` / `Channel.Insert/Update/Delete` / `InvalidateTenantRoutingCache`）在写完 DB / 本地内存后，向通道 `keyapi:cache:invalidate` 发一条 JSON 失效消息；所有实例启动一个订阅 goroutine，收到非自己发出的消息后调用对应的本地 reload 函数。原有的 `SyncChannelCache(60s)` / `SyncOptions(60s)` 周期性兜底保留，作为消息丢失时的最终一致性。

**Tech Stack:** Go 1.21+ / go-redis v8 / google/uuid v1.6 / miniredis（新增 dev 依赖，用于单测 Pub/Sub）/ docker-compose（双副本验收）

**Non-goals（明确不做）:**
1. 不引入 etcd / consul / nacos 等独立配置中心 — Redis 已是必需依赖，不增加运维成本
2. 不动 Token 预扣逻辑 — `RedisHIncrBy` 已是原子，多实例并发安全；async DB 回刷是单实例就存在的问题，不属于"多实例引入的回归"
3. 不动 channel cooldown / 限流 / 用户额度 — 这些已经走 Redis 共享，本身就是多实例正确的
4. 不动 health score / 排行榜 — 直接查 DB 实时算，无缓存
5. 不重写定时同步 — 60s 全量同步保留作为兜底，pub/sub 是"快路径"

---

## 文件结构

**新增文件：**
- `common/instance.go` — 进程级实例 ID（UUID，启动时生成一次）
- `common/pubsub.go` — `PublishInvalidate(payload)` / `SubscribeInvalidate(handler)` 抽象，包装 `RDB.Publish` / `RDB.Subscribe`
- `common/pubsub_test.go` — 用 miniredis 验证发布/订阅 + 自己忽略自己消息
- `service/cache_invalidator.go` — 启动订阅 goroutine、根据 message.Type 路由到 `model.ReloadOption / model.ReloadChannelCache / model.ReloadTenantRoutingCache`
- `service/cache_invalidator_test.go` — 集成测试：发一条消息后能触发对应 reload
- `docker-compose.cluster.yml` — 双副本 + Redis + MySQL 验收用环境

**修改文件：**
- `model/option.go` — `UpdateOption` 写库后调用 `common.PublishInvalidate({Type:"option", Key:key})`；新增 `ReloadOption(key)` 单 key 重读 DB
- `model/channel.go` — 所有"完整逻辑操作"在显式成功路径末尾 publish（**不**用 defer，因为 defer 会在 abilities 联动失败/早退路径上误广播）：
  - `(*Channel).Insert/Update/Delete` —— 改造成"channel 写成功 → abilities 写成功 → publish → return nil"的显式串接，任一步失败即 return 不广播
  - `UpdateChannelStatus` —— 重构：把 `UpdateAbilityStatus` 从 defer 移到 inline，只在 channel 写成功 + 真有状态变化时末尾 publish
  - `EnableChannelByTag` / `DisableChannelByTag` —— `UpdateAbilityStatusByTag` 成功后再 publish
  - `EditChannelByTag` / `DeleteChannelByStatus` / `BatchInsertChannels` / `BatchInsertChannelsBypass`（如有）/ `BatchDeleteChannels` / `BatchSetChannelTag` / `BatchSetChannelTagForTenant` —— 各自完整流程末尾（事务路径在 `tx.Commit()` 之后）publish
  - **不**在 `Save` / `SaveWithoutKey` / `tx.Create` 等低层 helper 加 publish — 那会在 channels/abilities 半更新时广播，peer reload 到不一致状态
- `model/channel_cache.go` — `InvalidateTenantRoutingCache` 内部加 `common.PublishInvalidate({Type:"tenant_routing", Key:tid})`；新增 `ReloadChannelCache()`（和 `InitChannelCache` 同实现，提供语义化别名）
- `service/tenant_config.go` — `InvalidateTenantOptionCacheKey` 末尾加 `common.PublishInvalidate({Type:"tenant_option", Key:"<tid>:<key>"})`
- `controller/channel/upstream_update.go` — **不**在 helper `updateChannelUpstreamModelSettings`（:330）内 publish。改在调用方的"完整流程成功路径"末尾 publish：`checkAndPersistChannelUpstreamModelUpdates`（:341）和 `:741` 那个 apply 函数，都要在 helper 写完 + （如果 modelsChanged）`channel.UpdateAbilities(nil)` 成功之后才 publish
- `service/codex_credential_refresh.go` — :94 写 `key` 后追加 publish（保留 :99 的 `InitChannelCache` 调用）
- `controller/codex/oauth.go` — :216 写 `key` 后追加 publish（保留 :220 的 `InitChannelCache` 调用）
- `controller/codex/usage.go` — :94 token 自动刷新写 `key` 后追加 publish（保留 :95 的 `InitChannelCache` 调用）
- `main.go` — `InitResources()` 早期调 `common.InitInstanceID()`；启动期挂订阅 goroutine（`trace.GoJob("cacheinvalsub", service.StartCacheInvalidator)`）
- `go.mod` / `go.sum` — 新增 `github.com/alicebob/miniredis/v2` 测试依赖

> **关键约束（避免循环依赖）：** `model` 包不能 import `service` 包。所以 publish 函数放在 **`common` 包**，由 `service` 在订阅侧反过来调 `model` / 调本包私有缓存。`model.*` 写路径调 `common.PublishInvalidate(...)`，永不调 `service.*`。

---

## 消息协议

Pub/Sub 通道名：`keyapi:cache:invalidate`

JSON 消息格式（all fields 必填）：

```json
{
  "type": "option | channel_full | tenant_routing | tenant_option",
  "key":  "Notice | (空) | 12 | 12:custom_key_name",
  "instance_id": "uuid-of-publisher",
  "ts": 1745568000
}
```

- `type=option`：`key` 是 OptionMap 的 key（例如 `"Notice"`、`"ModelRatio"`）
- `type=channel_full`：`key` 留空，触发全量 `ReloadChannelCache()`（懒得做增量，渠道总数通常 < 1000，全量重建一次 < 200ms）
- `type=tenant_routing`：`key` 是 `tenantId` 的字符串
- `type=tenant_option`：`key` 格式 `"<tenantId>:<optionKey>"`，对应 `service.tenantOptionCache` 的 cache key（见 `service/tenant_config.go:14`）。订阅方解析后**直接操作 `tenantOptionCache.Delete(...)`**（即 `modelReloader.InvalidateTenantOptionKey` 的实现），**绝不能调对外的 `service.InvalidateTenantOptionCacheKey`** — 后者会再 publish 一次，N 个 peer 互相反弹会形成网状放大。这条铁律对所有 type 都适用：订阅 handler 调的 reload 函数**必须不 publish**。
- `instance_id`：发布方进程 UUID。订阅方收到后若 `instance_id == common.InstanceID` 则丢弃（避免自己处理自己的广播）
- `ts`：unix 秒，仅供日志/排障，订阅方不验证

---

## Phase 1 — Pub/Sub 基础设施

### Task 1: 进程实例 ID

**Files:**
- Create: `common/instance.go`
- Create: `common/instance_test.go`
- Modify: `main.go`（在 `InitResources()` 里 `logger.SetupLogger()` 之后调 `common.InitInstanceID()`）

- [ ] **Step 1：写失败测试**

`common/instance_test.go`:
```go
package common

import (
	"testing"

	"github.com/google/uuid"
)

func TestInitInstanceID_GeneratesValidUUID(t *testing.T) {
	InstanceID = ""
	InitInstanceID()
	if InstanceID == "" {
		t.Fatal("InstanceID should be non-empty after InitInstanceID")
	}
	if _, err := uuid.Parse(InstanceID); err != nil {
		t.Fatalf("InstanceID should be a valid UUID, got %q: %v", InstanceID, err)
	}
}

func TestInitInstanceID_Idempotent(t *testing.T) {
	InstanceID = ""
	InitInstanceID()
	first := InstanceID
	InitInstanceID()
	if InstanceID != first {
		t.Fatalf("InitInstanceID should be idempotent, got %q then %q", first, InstanceID)
	}
}
```

- [ ] **Step 2：跑测试确认失败**

```bash
go test ./common -run TestInitInstanceID -v
```
预期：FAIL，提示 `undefined: InstanceID` / `undefined: InitInstanceID`

- [ ] **Step 3：实现**

`common/instance.go`:
```go
package common

import "github.com/google/uuid"

// InstanceID is the per-process UUID used to distinguish
// pub/sub broadcasts originating from this instance vs. peers.
// Set once at startup by InitInstanceID; never mutated afterwards.
var InstanceID string

func InitInstanceID() {
	if InstanceID != "" {
		return
	}
	InstanceID = uuid.NewString()
	SysLog("instance id: " + InstanceID)
}
```

- [ ] **Step 4：在主程序启动序列里挂上**

打开 `main.go:300 InitResources`，在 `logger.SetupLogger()` 之后、`ratio_setting.InitRatioSettings()` 之前（约 `main.go:313` 之后）插入一行：
```go
	logger.SetupLogger()

	common.InitInstanceID() // ← 新增

	// Initialize model settings
	ratio_setting.InitRatioSettings()
```

> **为什么放这里**：`InitInstanceID()` 内部调 `SysLog`，必须在 `logger.SetupLogger()` 之后；同时它要在订阅 goroutine 启动（`StartCacheInvalidator`）之前完成，所以放 `InitResources` 早期最稳妥。`common/init.go` 里只有 `InitEnv()` 和 `initConstantEnv()`，没有 `Init()` / `SetupLogger()`，原计划描述错误，已修正。

- [ ] **Step 5：跑测试确认通过**

```bash
go test ./common -run TestInitInstanceID -v
```
预期：PASS

- [ ] **Step 6：commit**

```bash
git add common/instance.go common/instance_test.go main.go
git commit -m "feat(common): 新增进程级实例 ID 用于 Pub/Sub 去重"
```

---

### Task 2: 引入 miniredis 测试依赖

**Files:**
- Modify: `go.mod` / `go.sum`

- [ ] **Step 1：拉依赖**

```bash
go get github.com/alicebob/miniredis/v2@latest
go mod tidy
```

- [ ] **Step 2：验证可 import**

写一个临时探针 `common/_miniredis_probe_test.go`（文件名以 `_` 开头，下个 task 删除）：
```go
package common

import (
	"testing"

	"github.com/alicebob/miniredis/v2"
)

func TestMiniredisProbe(t *testing.T) {
	s := miniredis.RunT(t)
	if s.Addr() == "" {
		t.Fatal("miniredis should give an address")
	}
}
```

```bash
go test ./common -run TestMiniredisProbe -v
```
预期：PASS

- [ ] **Step 3：删除探针文件**

```bash
rm common/_miniredis_probe_test.go
```

- [ ] **Step 4：commit**

```bash
git add go.mod go.sum
git commit -m "build: 新增 miniredis 测试依赖（用于 Pub/Sub 单测）"
```

---

### Task 3: Pub/Sub 抽象层

**Files:**
- Create: `common/pubsub.go`
- Create: `common/pubsub_test.go`

- [ ] **Step 1：写失败测试**

`common/pubsub_test.go`:
```go
package common

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/go-redis/redis/v8"
)

func setupTestRedis(t *testing.T) {
	t.Helper()
	s := miniredis.RunT(t)
	RDB = redis.NewClient(&redis.Options{Addr: s.Addr()})
	RedisEnabled = true
	t.Cleanup(func() {
		_ = RDB.Close()
		RDB = nil
		RedisEnabled = false
	})
}

func TestPublishInvalidate_SelfMessageIgnored(t *testing.T) {
	setupTestRedis(t)
	InstanceID = "instance-A" // 一次性设置，subscriber 启动后绝不再改

	received := make(chan InvalidateMessage, 4)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go SubscribeInvalidate(ctx, func(msg InvalidateMessage) {
		received <- msg
	})
	time.Sleep(100 * time.Millisecond) // 等订阅 ready，确保 selfID 已被 capture

	// 发"自己"的消息（PublishInvalidate 不传 InstanceID 时会用全局 common.InstanceID="instance-A"，应被 selfID 命中后跳过）
	if err := PublishInvalidate(InvalidateMessage{Type: "option", Key: "Notice"}); err != nil {
		t.Fatalf("publish: %v", err)
	}

	// 模拟另一个实例的消息（应收到）—— 直接在 msg 里填 InstanceID，不动全局
	peerMsg := InvalidateMessage{Type: "option", Key: "SystemName", InstanceID: "instance-B", Ts: time.Now().Unix()}
	publishRaw(t, peerMsg)

	select {
	case got := <-received:
		if got.InstanceID != "instance-B" {
			t.Fatalf("should only receive peer message, got %+v", got)
		}
		if got.Key != "SystemName" {
			t.Fatalf("expected key=SystemName, got %q", got.Key)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("never received peer message within 2s")
	}

	// 确认自己的消息没漏过来
	select {
	case extra := <-received:
		t.Fatalf("unexpected extra message: %+v", extra)
	case <-time.After(200 * time.Millisecond):
	}
}

func publishRaw(t *testing.T, msg InvalidateMessage) {
	t.Helper()
	payload := mustJSON(t, msg)
	if err := RDB.Publish(context.Background(), InvalidateChannel, payload).Err(); err != nil {
		t.Fatalf("raw publish: %v", err)
	}
}

func mustJSON(t *testing.T, v any) string {
	t.Helper()
	b, err := jsonMarshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}
```

- [ ] **Step 2：跑测试确认失败**

```bash
go test ./common -run TestPublishInvalidate -v
```
预期：FAIL — 一堆未定义符号

- [ ] **Step 3：实现 pubsub.go**

`common/pubsub.go`:
```go
package common

import (
	"context"
	"encoding/json"
	"time"
)

const InvalidateChannel = "keyapi:cache:invalidate"

type InvalidateMessage struct {
	Type       string `json:"type"`        // "option" | "channel_full" | "tenant_routing" | "tenant_option"
	Key        string `json:"key"`         // option key, tenant id, "<tid>:<optKey>", or empty for channel_full
	InstanceID string `json:"instance_id"` // publisher's process UUID
	Ts         int64  `json:"ts"`          // unix seconds, for logging only
}

func jsonMarshal(v any) ([]byte, error) { return json.Marshal(v) }

// PublishInvalidate broadcasts a cache-invalidate message.
// No-op when Redis is disabled (single-instance mode).
func PublishInvalidate(msg InvalidateMessage) error {
	if !RedisEnabled || RDB == nil {
		return nil
	}
	if msg.InstanceID == "" {
		msg.InstanceID = InstanceID
	}
	if msg.Ts == 0 {
		msg.Ts = time.Now().Unix()
	}
	payload, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	return RDB.Publish(context.Background(), InvalidateChannel, payload).Err()
}

// SubscribeInvalidate runs a blocking subscriber loop.
// Self-originated messages (InstanceID == this process) are skipped.
// The handler is invoked synchronously per message — keep it fast or fan out internally.
// Returns when ctx is cancelled.
//
// selfID is captured once at start. We deliberately do NOT re-read InstanceID
// per message: in production it's set once at startup and never changes,
// but tests mutate it to simulate peer publishers, and that would race with
// the goroutine read. Snapshotting once is both safe and correct.
func SubscribeInvalidate(ctx context.Context, handler func(InvalidateMessage)) {
	if !RedisEnabled || RDB == nil {
		SysLog("Pub/Sub subscriber not started: Redis disabled")
		return
	}
	selfID := InstanceID
	sub := RDB.Subscribe(ctx, InvalidateChannel)
	defer sub.Close()
	ch := sub.Channel()
	SysLog("cache invalidate subscriber started on " + InvalidateChannel + " (selfID=" + selfID + ")")
	for {
		select {
		case <-ctx.Done():
			return
		case raw, ok := <-ch:
			if !ok {
				return
			}
			var msg InvalidateMessage
			if err := json.Unmarshal([]byte(raw.Payload), &msg); err != nil {
				SysLog("invalidate: bad payload: " + err.Error())
				continue
			}
			if msg.InstanceID == selfID {
				continue // 自己发的，跳过
			}
			handler(msg)
		}
	}
}
```

- [ ] **Step 4：跑测试确认通过**

```bash
go test ./common -run TestPublishInvalidate -v
```
预期：PASS

- [ ] **Step 5：补一个端到端 round-trip 测试**

追加到 `common/pubsub_test.go`：
```go
func TestPublishInvalidate_RoundTrip(t *testing.T) {
	setupTestRedis(t)
	InstanceID = "instance-A" // 一次性设置，subscriber 启动后绝不再改

	received := make(chan InvalidateMessage, 1)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go SubscribeInvalidate(ctx, func(m InvalidateMessage) { received <- m })
	time.Sleep(100 * time.Millisecond)

	// 模拟另一实例：直接在 msg 里填 InstanceID，不动全局变量（避免 race）
	if err := PublishInvalidate(InvalidateMessage{Type: "channel_full", InstanceID: "instance-B"}); err != nil {
		t.Fatalf("publish: %v", err)
	}

	select {
	case got := <-received:
		if got.Type != "channel_full" {
			t.Fatalf("unexpected msg: %+v", got)
		}
		if got.InstanceID != "instance-B" {
			t.Fatalf("expected instance-B, got %q", got.InstanceID)
		}
		if got.Ts == 0 {
			t.Fatal("Ts should be auto-filled")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("did not receive within 2s")
	}
}
```

```bash
go test ./common -run TestPublishInvalidate -v
```
预期：PASS（两个测试都过）

- [ ] **Step 6：commit**

```bash
git add common/pubsub.go common/pubsub_test.go
git commit -m "feat(common): 新增 Redis Pub/Sub 缓存失效广播抽象"
```

---

## Phase 2 — OptionMap 即时同步

### Task 4: ReloadOption 单 key 重读

**Files:**
- Modify: `model/option.go`（追加新函数 `ReloadOption`）
- Create: `model/option_reload_test.go`

- [ ] **Step 1：写失败测试**

`model/option_reload_test.go`:
```go
package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
)

func TestReloadOption_RefreshesOptionMapFromDB(t *testing.T) {
	setupTestDB(t) // 复用项目已有的测试 DB 工具，找不到就用 sqlite in-memory

	// 写一条 Option 到 DB（绕过 UpdateOption，避免触发 publish）
	DB.Save(&Option{Key: "SystemName", Value: "first"})
	common.OptionMapRWMutex.Lock()
	common.OptionMap["SystemName"] = "first"
	common.OptionMapRWMutex.Unlock()

	// 模拟另一实例改了 DB
	DB.Model(&Option{}).Where("`key` = ?", "SystemName").Update("value", "second")

	if err := ReloadOption("SystemName"); err != nil {
		t.Fatalf("reload: %v", err)
	}

	common.OptionMapRWMutex.RLock()
	got := common.OptionMap["SystemName"]
	common.OptionMapRWMutex.RUnlock()
	if got != "second" {
		t.Fatalf("OptionMap should be reloaded to 'second', got %q", got)
	}
}
```

> **如果 `setupTestDB` 在项目里不存在**：先 grep `func setup.*DB|TestMain` 在 `model/` 下找现有约定；若仍无，临时在 `model/option_reload_test.go` 顶部加一个 `setupTestDB(t)` 用 `sqlite.Open(":memory:")` 起 GORM 并 `DB.AutoMigrate(&Option{})`。

- [ ] **Step 2：跑测试确认失败**

```bash
go test ./model -run TestReloadOption -v
```
预期：FAIL — `undefined: ReloadOption`

- [ ] **Step 3：实现**

在 `model/option.go` 末尾追加：
```go
// ReloadOption re-reads a single option from DB and applies it via updateOptionMap.
// Used by the cache-invalidate subscriber when a peer instance updates an option.
func ReloadOption(key string) error {
	var opt Option
	err := DB.Where("`key` = ?", key).First(&opt).Error
	if err != nil {
		return err
	}
	return updateOptionMap(opt.Key, opt.Value)
}
```

- [ ] **Step 4：跑测试确认通过**

```bash
go test ./model -run TestReloadOption -v
```
预期：PASS

- [ ] **Step 5：commit**

```bash
git add model/option.go model/option_reload_test.go
git commit -m "feat(model): 新增 ReloadOption 单 key 重读用于 Pub/Sub 失效"
```

---

### Task 5: UpdateOption 改造，写库后广播

**Files:**
- Modify: `model/option.go:235-249`（`UpdateOption` 函数）
- Modify: `model/option_reload_test.go`（追加广播测试）

- [ ] **Step 1：写失败测试**

追加到 `model/option_reload_test.go`：
```go
import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/alicebob/miniredis/v2"
	"github.com/go-redis/redis/v8"
)

func TestUpdateOption_PublishesInvalidate(t *testing.T) {
	setupTestDB(t)
	s := miniredis.RunT(t)
	common.RDB = redis.NewClient(&redis.Options{Addr: s.Addr()})
	common.RedisEnabled = true
	common.InstanceID = "publisher-instance"
	t.Cleanup(func() {
		_ = common.RDB.Close()
		common.RDB = nil
		common.RedisEnabled = false
	})

	sub := common.RDB.Subscribe(context.Background(), common.InvalidateChannel)
	defer sub.Close()
	ch := sub.Channel()
	time.Sleep(100 * time.Millisecond)

	if err := UpdateOption("Notice", "hello-cluster"); err != nil {
		t.Fatalf("update: %v", err)
	}

	select {
	case raw := <-ch:
		var msg common.InvalidateMessage
		if err := json.Unmarshal([]byte(raw.Payload), &msg); err != nil {
			t.Fatalf("bad payload: %v", err)
		}
		if msg.Type != "option" || msg.Key != "Notice" {
			t.Fatalf("unexpected msg: %+v", msg)
		}
		if msg.InstanceID != "publisher-instance" {
			t.Fatalf("expected publisher instance id, got %q", msg.InstanceID)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("UpdateOption did not publish invalidate within 2s")
	}
}
```

- [ ] **Step 2：跑测试确认失败**

```bash
go test ./model -run TestUpdateOption_PublishesInvalidate -v
```
预期：FAIL — 没收到消息

- [ ] **Step 3：改 `UpdateOption`（同时修复原代码忽略 DB 错误的隐患）**

找到 `model/option.go:235`，替换为：
```go
func UpdateOption(key string, value string) error {
	// 原代码忽略了 FirstOrCreate / Save 的错误，单实例下没人发现；
	// 多实例 + Pub/Sub 后果会放大：本机内存已是新值，但 peer 收到广播去 DB
	// reload 拿到的还是旧值，状态分叉。所以必须严格按 "DB 写成功 → 内存写成功 → publish" 顺序。
	option := Option{Key: key}
	if err := DB.FirstOrCreate(&option, Option{Key: key}).Error; err != nil {
		return err
	}
	option.Value = value
	if err := DB.Save(&option).Error; err != nil {
		return err
	}
	if err := updateOptionMap(key, value); err != nil {
		return err
	}
	// 通知集群其他实例从 DB reload 该 key。RedisEnabled=false 时是 no-op。
	_ = common.PublishInvalidate(common.InvalidateMessage{
		Type: "option",
		Key:  key,
	})
	return nil
}
```

- [ ] **Step 4：跑测试确认通过**

```bash
go test ./model -run TestUpdateOption -v
```
预期：PASS

- [ ] **Step 5：commit**

```bash
git add model/option.go model/option_reload_test.go
git commit -m "feat(model): UpdateOption 写库后广播 cache invalidate"
```

---

## Phase 3 — 全量渠道缓存即时刷新

### Task 6: 渠道写操作广播失效

**Files:**
- Modify: `model/channel.go:715`（`Insert`）、`:725`（`Update`）、`:807`（`Delete`）
- Create: `model/channel_invalidate_test.go`

- [ ] **Step 1：写失败测试**

`model/channel_invalidate_test.go`:
```go
package model

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/alicebob/miniredis/v2"
	"github.com/go-redis/redis/v8"
)

func setupTestRedisForChannel(t *testing.T) {
	t.Helper()
	s := miniredis.RunT(t)
	common.RDB = redis.NewClient(&redis.Options{Addr: s.Addr()})
	common.RedisEnabled = true
	common.InstanceID = "test-instance"
	// Pin MemoryCacheEnabled=false：UpdateChannelStatus 在 MemoryCacheEnabled=true 且
	// CacheGetChannel(channelId) 返回 nil 时会直接 return false（model/channel.go:901-907），
	// 跳过 DB 写和 publish。我们不想 InitChannelCache 测试桩，直接禁用内存缓存让逻辑走 DB 路径。
	// 用 t.Cleanup 保存并恢复原值，避免污染其他测试。
	prevMemoryCache := common.MemoryCacheEnabled
	common.MemoryCacheEnabled = false
	t.Cleanup(func() {
		_ = common.RDB.Close()
		common.RDB = nil
		common.RedisEnabled = false
		common.MemoryCacheEnabled = prevMemoryCache
	})
}

func waitForChannelInvalidate(t *testing.T, ch <-chan *redis.Message, timeout time.Duration) common.InvalidateMessage {
	t.Helper()
	select {
	case raw := <-ch:
		var msg common.InvalidateMessage
		if err := json.Unmarshal([]byte(raw.Payload), &msg); err != nil {
			t.Fatalf("bad payload: %v", err)
		}
		if msg.Type != "channel_full" {
			t.Fatalf("expected type=channel_full, got %+v", msg)
		}
		return msg
	case <-time.After(timeout):
		t.Fatal("did not receive channel invalidate")
	}
	return common.InvalidateMessage{}
}

func TestChannelInsert_PublishesInvalidate(t *testing.T) {
	setupTestDB(t)
	setupTestRedisForChannel(t)

	sub := common.RDB.Subscribe(context.Background(), common.InvalidateChannel)
	defer sub.Close()
	ch := sub.Channel()
	time.Sleep(100 * time.Millisecond)

	c := &Channel{Name: "test-ch", Type: 1, Key: "sk-x", Status: common.ChannelStatusEnabled, Models: "gpt-4"}
	if err := c.Insert(); err != nil {
		t.Fatalf("insert: %v", err)
	}
	waitForChannelInvalidate(t, ch, 2*time.Second)
}

func TestChannelUpdate_PublishesInvalidate(t *testing.T) {
	setupTestDB(t)
	setupTestRedisForChannel(t)

	c := &Channel{Name: "test-ch", Type: 1, Key: "sk-x", Status: common.ChannelStatusEnabled, Models: "gpt-4"}
	if err := c.Insert(); err != nil {
		t.Fatalf("seed insert: %v", err)
	}

	sub := common.RDB.Subscribe(context.Background(), common.InvalidateChannel)
	defer sub.Close()
	ch := sub.Channel()
	time.Sleep(100 * time.Millisecond)

	c.Name = "renamed"
	if err := c.Update(); err != nil {
		t.Fatalf("update: %v", err)
	}
	waitForChannelInvalidate(t, ch, 2*time.Second)
}

func TestChannelDelete_PublishesInvalidate(t *testing.T) {
	setupTestDB(t)
	setupTestRedisForChannel(t)

	c := &Channel{Name: "test-ch", Type: 1, Key: "sk-x", Status: common.ChannelStatusEnabled, Models: "gpt-4"}
	if err := c.Insert(); err != nil {
		t.Fatalf("seed: %v", err)
	}

	sub := common.RDB.Subscribe(context.Background(), common.InvalidateChannel)
	defer sub.Close()
	ch := sub.Channel()
	time.Sleep(100 * time.Millisecond)

	if err := c.Delete(); err != nil {
		t.Fatalf("delete: %v", err)
	}
	waitForChannelInvalidate(t, ch, 2*time.Second)
}
```

- [ ] **Step 2：跑测试确认失败**

```bash
go test ./model -run TestChannel.*PublishesInvalidate -v
```
预期：3 个测试全 FAIL（超时未收到消息）

- [ ] **Step 3：在 Insert / Update / Delete 的成功路径末尾显式 publish（不要用 defer）**

> **为什么不能 defer**：这三个方法都是两步写：
> - `Insert`（:715-723）：先 `DB.Create(channel)`，再 `channel.AddAbilities(nil)`
> - `Update`（:725-775）：先 `q.Updates(channel)`，再 `channel.UpdateAbilities(nil)`
> - `Delete`（:807-824）：先 `db.Delete(&Channel{})`，再 `channel.DeleteAbilities()`
>
> 如果第二步失败，DB 是半更新状态（channels 写了 abilities 没写，或反之）。defer 会无差别 publish，peer reload 后看到的是不一致的快照。**正确做法是只在两步都成功后 publish**。

`model/channel.go:715` `Insert()` 替换为：
```go
func (channel *Channel) Insert() error {
	if err := DB.Create(channel).Error; err != nil {
		return err
	}
	if err := channel.AddAbilities(nil); err != nil {
		return err
	}
	_ = common.PublishInvalidate(common.InvalidateMessage{Type: "channel_full"})
	return nil
}
```

`model/channel.go:725` `Update()` 末尾（line 768-774 区域）改为：
```go
	if err := q.Updates(channel).Error; err != nil {
		return err
	}
	DB.Model(&Channel{}).First(channel, "id = ? AND tenant_id = ?", channel.Id, channel.TenantId)
	if err := channel.UpdateAbilities(nil); err != nil {
		return err
	}
	_ = common.PublishInvalidate(common.InvalidateMessage{Type: "channel_full"})
	return nil
```

`model/channel.go:807` `Delete()` 末尾改为：
```go
	if err := db.Delete(&Channel{}).Error; err != nil {
		return err
	}
	if err := channel.DeleteAbilities(); err != nil {
		return err
	}
	_ = common.PublishInvalidate(common.InvalidateMessage{Type: "channel_full"})
	return nil
```

- [ ] **Step 4：跑测试确认通过**

```bash
go test ./model -run TestChannel.*PublishesInvalidate -v
```
预期：3 个测试 PASS

- [ ] **Step 5：commit**

```bash
git add model/channel.go model/channel_invalidate_test.go
git commit -m "feat(model): Channel Insert/Update/Delete 后广播缓存失效"
```

---

### Task 7a: 覆盖结构体方法之外的渠道写路径（auto-failover / 批量 SQL）

`(*Channel).Insert/Update/Delete` 三个 hook 不够：
- `model/channel.go:900 UpdateChannelStatus`（auto-disable / failover 走这条）调的是 `channel.SaveWithoutKey()`（`:355`），不是 `Update()`
- `EnableChannelByTag` / `DisableChannelByTag` 等用裸 `DB.Model(&Channel{}).Where(...).Update(...)` 直接打 SQL，完全绕过结构体方法
- `(*Channel).Save()` 在 `channel.go:1182, 1204` 被调（健康检查后保存等）

**Files:**
- **审计（不修改）**：`model/channel.go` `Save()` / `SaveWithoutKey()` `:355` 等低层 helper —— 仅作为 grep 起点定位调用方，**绝不**在这些 helper 内部加 publish（否则会在 abilities 半更新时广播）
- Modify: `model/channel.go` 的"完整逻辑操作"函数：`UpdateChannelStatus` `:900`、`EnableChannelByTag` `:975`、`DisableChannelByTag` `:988`、`EditChannelByTag` `:1001`、`DeleteChannelByStatus` `:1088`、`BatchInsertChannels` `:589`、`BatchInsertChannelsBypass` `:595`、`BatchDeleteChannels` `:631`、`BatchSetChannelTag` `:1249`、`BatchSetChannelTagForTenant` `:1284`
- Modify: `model/channel_invalidate_test.go`（追加 UpdateChannelStatus / EnableChannelByTag / BatchInsertChannels 测试）

- [ ] **Step 1：先 grep 列出所有渠道写路径（注意：要扫整个仓库，不只是 model/）**

跨包直接写 `model.Channel` 的路径很多，必须一次扫干净，否则会留下"某个写路径只有写的实例缓存对，peer 还是旧"的暗坑。

用 Grep 工具至少跑这 6 条 pattern（whole-repo，不要限 glob）：
1. `\.Save(WithoutKey)?\(\)` — `(*Channel).Save / SaveWithoutKey` 调用方
2. `DB\.Model\(&(model\.)?Channel\{\}\).*\.Update` — 裸 SQL UPDATE（`model.DB.Model(&model.Channel{})` 在 controller / service 里也算）
3. `\.UpdateAbilities\(` — abilities 表写入（`controller/channel/upstream_update.go:383` 等）
4. `(DB|tx)\.Delete\(&(model\.)?Channel\{` — 删除路径
5. `(DB|tx)\.Create\(&(model\.)?Channel\{|\.Insert\(\)` — 新增路径
6. `model\.InitChannelCache\(\)` — 已有的"我自己刚写完手动重建本地缓存"调用点（每一处都意味着 peer 也得 invalidate）

**已知必须打补丁的跨包写点（不完全列表，以 grep 结果为准）**：
- `controller/channel/upstream_update.go:338` `updateChannelUpstreamModelSettings` — 写 `models` / `settings`
- `controller/channel/upstream_update.go:383` `channel.UpdateAbilities(nil)` — abilities 表变更
- `service/codex_credential_refresh.go:94` — 写 `key`，紧跟 `model.InitChannelCache()`（peer 必须也 reload）
- `controller/codex/oauth.go:216` — 同上

把 grep 结果汇总成清单，每一条都要在 Step 5 加 publish。

- [ ] **Step 2：写失败测试 — UpdateChannelStatus 必须广播**

追加到 `model/channel_invalidate_test.go`:
```go
func TestUpdateChannelStatus_PublishesInvalidate(t *testing.T) {
	setupTestDB(t)
	setupTestRedisForChannel(t)

	c := &Channel{Name: "test-ch", Type: 1, Key: "sk-x", Status: common.ChannelStatusEnabled, Models: "gpt-4"}
	if err := c.Insert(); err != nil {
		t.Fatalf("seed: %v", err)
	}

	sub := common.RDB.Subscribe(context.Background(), common.InvalidateChannel)
	defer sub.Close()
	ch := sub.Channel()
	time.Sleep(100 * time.Millisecond)

	// 模拟 auto-failover 把渠道置为 AutoDisabled
	UpdateChannelStatus(c.Id, "", common.ChannelStatusAutoDisabled, "test-failover")

	waitForChannelInvalidate(t, ch, 2*time.Second)
}

func TestBatchInsertChannels_PublishesInvalidate(t *testing.T) {
	setupTestDB(t)
	setupTestRedisForChannel(t)

	sub := common.RDB.Subscribe(context.Background(), common.InvalidateChannel)
	defer sub.Close()
	ch := sub.Channel()
	time.Sleep(100 * time.Millisecond)

	// 注意：BatchInsertChannels 签名是 []Channel（值切片），不是 []*Channel —— 见 model/channel.go:589
	channels := []Channel{
		{Name: "batch-1", Type: 1, Key: "sk-1", Status: common.ChannelStatusEnabled, Models: "gpt-4"},
		{Name: "batch-2", Type: 1, Key: "sk-2", Status: common.ChannelStatusEnabled, Models: "gpt-4"},
	}
	if err := BatchInsertChannels(channels); err != nil { // 真实"新建渠道"路径走的是这个，不是 (*Channel).Insert
		t.Fatalf("BatchInsertChannels: %v", err)
	}
	waitForChannelInvalidate(t, ch, 2*time.Second)
}

func TestEnableChannelByTag_PublishesInvalidate(t *testing.T) {
	setupTestDB(t)
	setupTestRedisForChannel(t)

	tag := "demo" // Channel.Tag 是 *string（model/channel.go:61），不能直接传字符串字面量
	c := &Channel{Name: "tagged", Type: 1, Key: "sk-x", Status: common.ChannelStatusManuallyDisabled, Models: "gpt-4", Tag: &tag, TenantId: 1}
	if err := c.Insert(); err != nil {
		t.Fatalf("seed: %v", err)
	}

	sub := common.RDB.Subscribe(context.Background(), common.InvalidateChannel)
	defer sub.Close()
	ch := sub.Channel()
	time.Sleep(100 * time.Millisecond)

	if err := EnableChannelByTag("demo", 1); err != nil {
		t.Fatalf("EnableChannelByTag: %v", err)
	}
	waitForChannelInvalidate(t, ch, 2*time.Second)
}
```

- [ ] **Step 3：跑测试确认失败**

```bash
go test ./model -run "TestUpdateChannelStatus_PublishesInvalidate|TestEnableChannelByTag_PublishesInvalidate|TestBatchInsertChannels_PublishesInvalidate" -v
```
预期：3 个测试全 FAIL（超时未收到消息）

- [ ] **Step 4：核心规则确立 —— "publish 只在完整逻辑操作末尾"**

> **铁律（推翻上一版的 SaveWithoutKey defer 思路）**：很多渠道写操作是"两段式"：先写 channels 表，再写 abilities 表（或反过来）。如果在低层 helper（`SaveWithoutKey` / `Save` / `tx.Create(&chunk)`）里 publish，peer 会在中间状态 reload，拿到 channels 是新的、abilities 还是旧的（或反之）。
>
> 因此本计划**不**在 `Save` / `SaveWithoutKey` / `tx.Create` 等低层方法里加 defer publish。Publish 一律放在**完整逻辑操作的出口**，即调用方在所有 channels + abilities 都成功之后。
>
> `(*Channel).Insert/Update/Delete` 这三个公开方法虽然本身**就是**"完整操作"（内部已联动 abilities，且不会被嵌套调用 — `UpdateChannelStatus` 走 `SaveWithoutKey`、`BatchInsertChannels` 走 `tx.Create`），但**仍然不能用 defer publish**：因为它们每个都是两步（channels write + abilities write），如果第二步失败，defer 会无差别广播半更新状态。所以 Task 6 已经把它们改成显式两步成功路径，本铁律对全部渠道写路径**无例外**适用。

**本 Task 7a 不再修改 `(*Channel).Save()` / `SaveWithoutKey()` 自身**，而是在所有调用它们 + 后续还要写 abilities 的高层函数末尾显式 publish。

- [ ] **Step 5：在所有"完整逻辑操作"末尾追加显式 publish**

> **三条铁律**：
> 1. **必须在事务 commit 成功之后**（事务中 publish，peer 读到的是未提交快照之外的旧数据）
> 2. **必须在所有相关写都完成之后**（包括 channels 表 + abilities 表 + 任何后置 UpdateAbility* 调用）
> 3. **不要 `defer` 在函数顶部**（错误路径也会广播，peer 白 reload 一次；更糟的是某些 `defer` 包裹的后置写还没完成）

**模板 A — 单步非事务 UPDATE**（如简单的 `DB.Model(&Channel{}).Update(...)` 不带 abilities 联动）：
```go
	if err := DB.Model(&Channel{}).Where(...).Update(...).Error; err != nil {
		return err
	}
	_ = common.PublishInvalidate(common.InvalidateMessage{Type: "channel_full"})
	return nil
```

**模板 B — 多步：channels 写 + abilities 写**（如 `EnableChannelByTag`）：
```go
	if err := DB.Model(&Channel{}).Where(...).Update(...).Error; err != nil {
		return err
	}
	if err := UpdateAbilityStatusByTag(tag, true, tenantId); err != nil {
		return err
	}
	_ = common.PublishInvalidate(common.InvalidateMessage{Type: "channel_full"})
	return nil
```

**模板 C — 事务路径**（如 `BatchSetChannelTag` / `BatchInsertChannels`）：必须 `tx.Commit()` 成功之后：
```go
	if err := tx.Commit().Error; err != nil {
		return err
	}
	_ = common.PublishInvalidate(common.InvalidateMessage{Type: "channel_full"})
	return nil
```

**模板 D — `UpdateChannelStatus` 重构（必须把 abilities 从 defer 里挪出来，改为内联，才能精确控制 publish 时机）**：

原代码（model/channel.go:900-973）有几个问题让 publish 难以正确插入：
- abilities 更新放在 defer 里，且只 SysLog 不传播错误 → defer publish 无法判断 ability 是否成功
- 多个 early return（`GetChannelById` 失败、`channel.Status == status` 无变更、`SaveWithoutKey` 失败）都会触发 defer
- 如果 publish 用 defer，无变更 / 失败 / 部分成功的情况都会广播，peer 白 reload 或读到不一致

**正确改法**：把 abilities 写从 defer 移到 inline，放在 `SaveWithoutKey()` 成功之后；publish 紧跟在 abilities 写之后，全在显式成功路径上：

```go
func UpdateChannelStatus(channelId int, usingKey string, status int, reason string) bool {
	if common.MemoryCacheEnabled {
		// ... 现有 channelStatusLock / CacheUpdateChannelStatus 逻辑保持不变 ...
	}

	channel, err := GetChannelById(channelId, true)
	if err != nil {
		return false
	}
	loadedTenantId := channel.TenantId
	if channel.Status == status {
		return false // 无实际变更，不 publish
	}

	shouldUpdateAbilities := false
	if channel.ChannelInfo.IsMultiKey {
		beforeStatus := channel.Status
		pollingLock := GetChannelPollingLock(channelId)
		pollingLock.Lock()
		handlerMultiKeyUpdate(channel, usingKey, status, reason)
		pollingLock.Unlock()
		if beforeStatus != channel.Status {
			shouldUpdateAbilities = true
		}
	} else {
		info := channel.GetOtherInfo()
		info["status_reason"] = reason
		info["status_time"] = common.GetTimestamp()
		channel.SetOtherInfo(info)
		channel.Status = status
		shouldUpdateAbilities = true
	}

	if err := channel.SaveWithoutKey(); err != nil {
		common.SysLog(fmt.Sprintf("failed to update channel status: channel_id=%d, status=%d, error=%v", channel.Id, status, err))
		return false // SaveWithoutKey 失败，channel 没写成功，不 publish
	}

	if shouldUpdateAbilities {
		if err := UpdateAbilityStatus(loadedTenantId, channelId, status == common.ChannelStatusEnabled); err != nil {
			common.SysLog(fmt.Sprintf("failed to update ability status: channel_id=%d, error=%v", channelId, err))
			// 这里有个权衡：channel 已写成功 abilities 没写。要不要 publish？
			// 选 publish：peer 至少和本机一致（都是 channels 新 / abilities 旧）。
			// 选不 publish：peer 暂时是 channels 旧 / abilities 旧，等 60s 兜底。
			// 选 publish — 一致性 over 完美性，与原代码"abilities 失败只 SysLog 不影响返回"语义对齐。
		}
	}

	_ = common.PublishInvalidate(common.InvalidateMessage{Type: "channel_full"})
	return true
}
```

**改动总结**：
- 删除原有 `defer func() { if shouldUpdateAbilities { UpdateAbilityStatus(...) } }()` 块
- 把 `UpdateAbilityStatus` 调用 inline 到 `SaveWithoutKey` 成功之后
- 在 `return true` 之前显式 publish
- 行为与原代码一致：abilities 失败仍只记录日志（不影响返回值）；本计划在此基础上保证 publish 只在"channel 写成功 + 真有状态变化"时发生

**逐条要改的写路径（grep 结果对照）**：

*model 包内 — 完整列表*：
- `(*Channel).Insert/Update/Delete` —— **Task 6 已处理**，改造为显式两步成功路径（`channel write → abilities write → publish → return nil`），任一步失败即 return 不广播。**不**用 defer
- `UpdateChannelStatus`（:900）—— 模板 D：重构函数，把 `UpdateAbilityStatus` 从原 defer 中**移除**改为 inline，放在 `SaveWithoutKey()` 成功之后；publish 紧跟在 abilities 调用之后。所有早退路径（`GetChannelById` 失败 / `Status==status` 无变更 / `SaveWithoutKey` 失败）都不 publish
- `EnableChannelByTag`（:975）—— 模板 B（UPDATE channels → UpdateAbilityStatusByTag → publish）
- `DisableChannelByTag`（:988）—— 模板 B
- `EditChannelByTag`（:1001）—— 检查函数体，按需用模板 B 或 C
- `DeleteChannelByStatus`（:1088）—— 模板 A
- `BatchInsertChannels`（:600）—— 模板 C，在 `return tx.Commit().Error` 改写为 "if err...return; publish; return nil"
- `BatchInsertChannelsBypass`（如存在，搜函数定义）—— 同上
- `BatchDeleteChannels`（:631）—— 模板 C
- `BatchSetChannelTag`（:1249）—— 模板 C
- `BatchSetChannelTagForTenant`（:1284）—— 模板 C

*跨包写（model 包之外，必须在调用点显式 publish）*：
- `controller/channel/upstream_update.go` `updateChannelUpstreamModelSettings`（:330）—— **不在 helper 内 publish**。该函数有两个调用方：
  - `:803` 调用方：先调 helper 写 settings/models，再 if `modelsChanged` 调 `channel.UpdateAbilities(nil)`。Publish 必须在 `UpdateAbilities` 之后（如果 modelsChanged）或 helper 返回之后（如果 !modelsChanged）。
  - `:379` 同样模式。
  - **正确做法**：在调用方（`checkAndPersistChannelUpstreamModelUpdates` :341 和 `:741` 那个函数）的成功 return 路径之前 publish。Helper 自己**不**publish。
- `service/codex_credential_refresh.go:94` —— 模板 A，写 key 之后 publish；保留 :99 的 `InitChannelCache` 调用
- `controller/codex/oauth.go:216` —— 模板 A，同上；保留 :220 的 `InitChannelCache` 调用
- `controller/codex/usage.go:94` —— 模板 A，同上；保留 :95 的 `InitChannelCache` 调用
- 第 1 步 grep 出来的其他裸 `DB.Model(&Channel{}).Update(...)` / `tx.Commit()` 路径

> **本机 reload vs peer 广播是两件事**：订阅者用 `selfID` 拦自己的广播，所以**本机不会被自己的广播触发 reload**。因此凡是已有 `model.InitChannelCache()` 的调用点（如 codex 三处），**保留这一行**作为本机刷新；**追加** `common.PublishInvalidate({Type:"channel_full"})` 给 peer 刷新。原本没有 InitChannelCache 调用的，按业务判断本机是否需要即时一致性，需要就补一行 `model.InitChannelCache()`。

- [ ] **Step 6：跑测试确认通过 + 跑全量渠道测试避免回归**

```bash
go test ./model -run "TestChannel|TestUpdateChannelStatus|TestEnableChannelByTag|TestBatchInsertChannels" -v
```
预期：PASS

- [ ] **Step 7：跨包写路径加 publish + 配套测试**

对 File Structure 列出的 5 个跨包写点逐一处理：
- `controller/channel/upstream_update.go`（:338, :383 函数末尾）
- `service/codex_credential_refresh.go`（:94 写 key 后）
- `controller/codex/oauth.go`（:216 写 key 后）
- `controller/codex/usage.go`（:94 token 自动刷新后写 key）

**测试**：在对应包下新建 `*_invalidate_test.go`，复用本 task Step 2 里的 `setupTestRedisForChannel` + miniredis 模板，给每条跨包写路径写一个"调函数后能在频道上收到 channel_full"的测试。

> **铁律：测试必须覆盖"完整逻辑操作"，不能只测低层 helper**。`updateChannelUpstreamModelSettings` 这种 helper 按规则**不发** publish（见 Step 5：publish 在调用方 `UpdateAbilities` 之后）。如果给 helper 写"调用后收到广播"的测试，会逼实现者把 publish 放回 helper —— 重新引入"广播早于 abilities 写入"的时序 bug。

跨包测试至少要包括：
- `controller/channel/upstream_update_invalidate_test.go` → 验证**调用方**（`checkAndPersistChannelUpstreamModelUpdates` :341 / `:741` 那个完整流程函数）的成功路径触发广播。如果这两个函数需要 fake 上游 HTTP 响应才能跑：用 `httptest.Server` 起一个返回固定 model 列表的桩，让 `force=true` 走完整路径。**不要**测 helper。
- `service/codex_credential_refresh_invalidate_test.go` → 验证 refresh 完整流程后能收到广播
- `controller/codex/oauth_invalidate_test.go` / `usage_invalidate_test.go` → 验证 OAuth callback / usage refresh 后能收到广播

```bash
go test ./controller/channel ./service ./controller/codex -run "Invalidate" -v
```
预期：PASS

- [ ] **Step 8：commit**

```bash
git add model/channel.go model/channel_invalidate_test.go \
        controller/channel/upstream_update.go controller/channel/upstream_update_invalidate_test.go \
        service/codex_credential_refresh.go service/codex_credential_refresh_invalidate_test.go \
        controller/codex/oauth.go controller/codex/usage.go
git commit -m "feat: 覆盖 SaveWithoutKey / 裸 SQL / 跨包渠道写路径的失效广播"
```

---

### Task 7: ReloadChannelCache 语义化别名

**Files:**
- Modify: `model/channel_cache.go`（追加 `ReloadChannelCache`）

- [ ] **Step 1：实现（无需新测试，下一个 Task 的订阅集成测试会覆盖）**

在 `model/channel_cache.go:86`（`InitChannelCache` 之后）追加：
```go
// ReloadChannelCache rebuilds the global channel cache from DB.
// Same implementation as InitChannelCache; provided as a semantic alias
// for cache-invalidate subscriber call sites.
func ReloadChannelCache() {
	InitChannelCache()
}
```

- [ ] **Step 2：编译通过**

```bash
go build ./...
```
预期：no errors

- [ ] **Step 3：commit**

```bash
git add model/channel_cache.go
git commit -m "feat(model): 新增 ReloadChannelCache 别名供 Pub/Sub 订阅使用"
```

---

## Phase 4 — 租户路由缓存即时同步

### Task 8: InvalidateTenantRoutingCache 改造

**Files:**
- Modify: `model/channel_cache.go:46-48`
- Modify: `model/channel_invalidate_test.go`（追加 tenant routing 测试）

- [ ] **Step 1：写失败测试**

追加到 `model/channel_invalidate_test.go`：
```go
func TestInvalidateTenantRoutingCache_PublishesInvalidate(t *testing.T) {
	setupTestDB(t)
	setupTestRedisForChannel(t)

	sub := common.RDB.Subscribe(context.Background(), common.InvalidateChannel)
	defer sub.Close()
	ch := sub.Channel()
	time.Sleep(100 * time.Millisecond)

	InvalidateTenantRoutingCache(42)

	select {
	case raw := <-ch:
		var msg common.InvalidateMessage
		_ = json.Unmarshal([]byte(raw.Payload), &msg)
		if msg.Type != "tenant_routing" || msg.Key != "42" {
			t.Fatalf("unexpected msg: %+v", msg)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("did not receive tenant routing invalidate")
	}
}
```

- [ ] **Step 2：跑测试确认失败**

```bash
go test ./model -run TestInvalidateTenantRoutingCache_PublishesInvalidate -v
```
预期：FAIL

- [ ] **Step 3：改 `InvalidateTenantRoutingCache`**

`model/channel_cache.go:46-48` 替换为：
```go
// InvalidateTenantRoutingCache refreshes the cache for a single tenant
// AND broadcasts to peer instances so they reload too.
func InvalidateTenantRoutingCache(tenantId int) {
	ReloadTenantRoutingCache(tenantId)
	_ = common.PublishInvalidate(common.InvalidateMessage{
		Type: "tenant_routing",
		Key:  strconv.Itoa(tenantId),
	})
}
```

文件顶部 `import` 区追加 `"strconv"`（如果尚未导入）。

- [ ] **Step 4：跑测试确认通过**

```bash
go test ./model -run TestInvalidateTenantRoutingCache -v
```
预期：PASS

- [ ] **Step 5：commit**

```bash
git add model/channel_cache.go model/channel_invalidate_test.go
git commit -m "feat(model): 租户路由缓存失效同步广播到集群"
```

---

### Task 8b: 租户级 Option 覆盖缓存（service.tenantOptionCache）

`service/tenant_config.go:14` 有一个 `sync.Map` 缓存租户级 option 覆盖（`tenant_options` 表），由 `controller/tenant/config.go:79` 在 `UpdateTenantConfig` 后调 `service.InvalidateTenantOptionCacheKey` 失效 — **但只失效本机**。多实例下租户改了自己的覆盖，其他实例继续返回旧值或旧的 miss-cache。

**Files:**
- Modify: `service/tenant_config.go`：在 `InvalidateTenantOptionCacheKey` 末尾发广播
- Modify: `service/cache_invalidator.go`：dispatch 新增 `tenant_option` case
- Create: `service/tenant_config_invalidate_test.go`

> **YAGNI**：grep 确认 `InvalidateTenantOptionCache(tenantId)`（清整租户）当前**无人调用**，只 `InvalidateTenantOptionCacheKey` 有人用。所以本次只支持 key 级失效；将来需要再加。

- [ ] **Step 1：写失败测试**

`service/tenant_config_invalidate_test.go`:
```go
package service

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/alicebob/miniredis/v2"
	"github.com/go-redis/redis/v8"
)

func TestInvalidateTenantOptionCacheKey_PublishesInvalidate(t *testing.T) {
	s := miniredis.RunT(t)
	common.RDB = redis.NewClient(&redis.Options{Addr: s.Addr()})
	common.RedisEnabled = true
	common.InstanceID = "test-instance"
	t.Cleanup(func() { _ = common.RDB.Close(); common.RDB = nil; common.RedisEnabled = false })

	sub := common.RDB.Subscribe(context.Background(), common.InvalidateChannel)
	defer sub.Close()
	ch := sub.Channel()
	time.Sleep(100 * time.Millisecond)

	InvalidateTenantOptionCacheKey(42, "ChannelDisableThreshold")

	select {
	case raw := <-ch:
		var msg common.InvalidateMessage
		_ = json.Unmarshal([]byte(raw.Payload), &msg)
		if msg.Type != "tenant_option" || msg.Key != "42:ChannelDisableThreshold" {
			t.Fatalf("unexpected msg: %+v", msg)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("did not receive tenant_option invalidate")
	}
}
```

- [ ] **Step 2：跑测试确认失败**

```bash
go test ./service -run TestInvalidateTenantOptionCacheKey_PublishesInvalidate -v
```
预期：FAIL — 没收到广播

- [ ] **Step 3：改 `InvalidateTenantOptionCacheKey`**

`service/tenant_config.go:101-103` 替换为：
```go
// InvalidateTenantOptionCacheKey removes a single cached entry for a tenant+key pair
// AND broadcasts to peer instances so they evict their copies too.
func InvalidateTenantOptionCacheKey(tenantId int, key string) {
	tenantOptionCache.Delete(cacheKey(tenantId, key))
	_ = common.PublishInvalidate(common.InvalidateMessage{
		Type: "tenant_option",
		Key:  cacheKey(tenantId, key), // "<tenantId>:<optionKey>"
	})
}
```

- [ ] **Step 4：跑测试确认通过**

```bash
go test ./service -run TestInvalidateTenantOptionCacheKey -v
```
预期：PASS

- [ ] **Step 5：commit（dispatch 在 Task 9 一起处理）**

```bash
git add service/tenant_config.go service/tenant_config_invalidate_test.go
git commit -m "feat(service): 租户 option 覆盖缓存失效同步广播到集群"
```

---

## Phase 5 — 订阅者：把消息接住并触发本地 reload

### Task 9: cache_invalidator service

**Files:**
- Create: `service/cache_invalidator.go`
- Create: `service/cache_invalidator_test.go`

- [ ] **Step 1：写失败测试**

`service/cache_invalidator_test.go`:
```go
package service

import (
	"context"
	"strconv"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/alicebob/miniredis/v2"
	"github.com/go-redis/redis/v8"
)

type fakeReloader struct {
	option         atomic.Int32
	channelFull    atomic.Int32
	tenantRouting  atomic.Int32
	tenantOption   atomic.Int32
	lastOptionKey  atomic.Value // string
	lastTenantKey  atomic.Value // string
	lastTenantOpt  atomic.Value // string "<tid>:<key>"
}

func (f *fakeReloader) ReloadOption(key string) error {
	f.option.Add(1)
	f.lastOptionKey.Store(key)
	return nil
}
func (f *fakeReloader) ReloadChannelCache() { f.channelFull.Add(1) }
func (f *fakeReloader) ReloadTenantRoutingCache(tenantId int) {
	f.tenantRouting.Add(1)
	f.lastTenantKey.Store(strconv.Itoa(tenantId))
}
func (f *fakeReloader) InvalidateTenantOptionKey(tenantId int, key string) {
	f.tenantOption.Add(1)
	f.lastTenantOpt.Store(strconv.Itoa(tenantId) + ":" + key)
}

func TestStartCacheInvalidator_DispatchesByType(t *testing.T) {
	s := miniredis.RunT(t)
	common.RDB = redis.NewClient(&redis.Options{Addr: s.Addr()})
	common.RedisEnabled = true
	common.InstanceID = "subscriber-instance"
	t.Cleanup(func() { _ = common.RDB.Close(); common.RDB = nil; common.RedisEnabled = false })

	r := &fakeReloader{}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go startCacheInvalidatorWith(ctx, r)
	time.Sleep(100 * time.Millisecond)

	// 模拟其他实例发送
	publishAs(t, "peer-A", common.InvalidateMessage{Type: "option", Key: "Notice"})
	publishAs(t, "peer-A", common.InvalidateMessage{Type: "channel_full"})
	publishAs(t, "peer-A", common.InvalidateMessage{Type: "tenant_routing", Key: "7"})
	publishAs(t, "peer-A", common.InvalidateMessage{Type: "tenant_option", Key: "42:ChannelDisableThreshold"})
	// 自己的消息（应忽略）
	publishAs(t, "subscriber-instance", common.InvalidateMessage{Type: "option", Key: "ShouldIgnore"})

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if r.option.Load() == 1 && r.channelFull.Load() == 1 && r.tenantRouting.Load() == 1 && r.tenantOption.Load() == 1 {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if r.option.Load() != 1 {
		t.Errorf("option reload count = %d, want 1", r.option.Load())
	}
	if r.channelFull.Load() != 1 {
		t.Errorf("channel_full reload count = %d, want 1", r.channelFull.Load())
	}
	if r.tenantRouting.Load() != 1 {
		t.Errorf("tenant_routing reload count = %d, want 1", r.tenantRouting.Load())
	}
	if r.tenantOption.Load() != 1 {
		t.Errorf("tenant_option reload count = %d, want 1", r.tenantOption.Load())
	}
	if got := r.lastOptionKey.Load(); got != "Notice" {
		t.Errorf("last option key = %v, want Notice", got)
	}
	if got := r.lastTenantOpt.Load(); got != "42:ChannelDisableThreshold" {
		t.Errorf("last tenant_option key = %v, want 42:ChannelDisableThreshold", got)
	}
}

// publishAs 显式在 msg 里填 InstanceID，避免改全局 common.InstanceID 造成 race。
func publishAs(t *testing.T, instanceID string, msg common.InvalidateMessage) {
	t.Helper()
	msg.InstanceID = instanceID
	if err := common.PublishInvalidate(msg); err != nil {
		t.Fatalf("publish: %v", err)
	}
}
```

- [ ] **Step 2：跑测试确认失败**

```bash
go test ./service -run TestStartCacheInvalidator -v
```
预期：FAIL — `startCacheInvalidatorWith` 未定义

- [ ] **Step 3：实现**

`service/cache_invalidator.go`:
```go
package service

import (
	"context"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

// CacheReloader is the dependency surface needed by the invalidate subscriber.
// Defining it as an interface lets tests swap in a fake without spinning up GORM.
type CacheReloader interface {
	ReloadOption(key string) error
	ReloadChannelCache()
	ReloadTenantRoutingCache(tenantId int)
	InvalidateTenantOptionKey(tenantId int, key string)
}

type modelReloader struct{}

func (modelReloader) ReloadOption(key string) error    { return model.ReloadOption(key) }
func (modelReloader) ReloadChannelCache()              { model.ReloadChannelCache() }
func (modelReloader) ReloadTenantRoutingCache(id int)  { model.ReloadTenantRoutingCache(id) }
func (modelReloader) InvalidateTenantOptionKey(tenantId int, key string) {
	// 注意：这里是同包内调，但为防止订阅 handler 自己又广播一遍造成回环，
	// 直接操作底层的 tenantOptionCache，不走 InvalidateTenantOptionCacheKey。
	tenantOptionCache.Delete(cacheKey(tenantId, key))
}

// StartCacheInvalidator runs the subscriber loop in the current goroutine.
// Wire from main: trace.GoJob("cacheinvalsub", service.StartCacheInvalidator)
func StartCacheInvalidator() {
	startCacheInvalidatorWith(context.Background(), modelReloader{})
}

func startCacheInvalidatorWith(ctx context.Context, r CacheReloader) {
	common.SubscribeInvalidate(ctx, func(msg common.InvalidateMessage) {
		switch msg.Type {
		case "option":
			if err := r.ReloadOption(msg.Key); err != nil {
				common.SysLog("invalidate option reload failed: " + msg.Key + ": " + err.Error())
				return
			}
			common.SysLog("invalidate option reload: " + msg.Key)
		case "channel_full":
			r.ReloadChannelCache()
			common.SysLog("invalidate channel_full reload")
		case "tenant_routing":
			id, err := strconv.Atoi(msg.Key)
			if err != nil {
				common.SysLog("invalidate: bad tenant id: " + msg.Key)
				return
			}
			r.ReloadTenantRoutingCache(id)
			common.SysLog("invalidate tenant_routing reload: " + msg.Key)
		case "tenant_option":
			// key 格式 "<tenantId>:<optionKey>"
			parts := strings.SplitN(msg.Key, ":", 2)
			if len(parts) != 2 {
				common.SysLog("invalidate: bad tenant_option key: " + msg.Key)
				return
			}
			tid, err := strconv.Atoi(parts[0])
			if err != nil {
				common.SysLog("invalidate: bad tenant_option tenant id: " + msg.Key)
				return
			}
			r.InvalidateTenantOptionKey(tid, parts[1])
			common.SysLog("invalidate tenant_option evict: " + msg.Key)
		default:
			common.SysLog("invalidate: unknown type: " + msg.Type)
		}
	})
}
```

文件顶部 import 区追加 `"strings"`。

> **避免回环的关键设计**：`modelReloader.InvalidateTenantOptionKey` 直接 `tenantOptionCache.Delete(...)` 而不是调对外的 `InvalidateTenantOptionCacheKey` — 后者会触发广播，导致 peer 收到自己的反弹消息。订阅侧的 `selfID` 拦截会拦住自己的，但**别的 peer 也会收到然后又广播一次**，形成网状放大。直接操作底层 `sync.Map` 切断这个反馈环。同样的原则后续如果给 `option` / `channel` / `tenant_routing` 加新代码时也要遵守 — 订阅 handler 里调的 reload 函数**不能**再 publish。当前 `model.ReloadOption` / `ReloadChannelCache` / `ReloadTenantRoutingCache` 三个都不广播（只读 DB），符合要求。

- [ ] **Step 4：跑测试确认通过**

```bash
go test ./service -run TestStartCacheInvalidator -v
```
预期：PASS

- [ ] **Step 5：commit**

```bash
git add service/cache_invalidator.go service/cache_invalidator_test.go
git commit -m "feat(service): 新增 cache invalidator 订阅者按 type 路由 reload"
```

---

### Task 10: 主程序启动订阅 goroutine

**Files:**
- Modify: `main.go`（在 `MemoryCacheEnabled` 块附近启动）

- [ ] **Step 1：找到挂载点**

打开 `main.go:101-103`，定位现有的：
```go
trace.GoJob("chcachesync", func() {
    model.SyncChannelCache(common.SyncFrequency)
})
```

- [ ] **Step 2：在其后追加订阅 goroutine**

替换为：
```go
trace.GoJob("chcachesync", func() {
    model.SyncChannelCache(common.SyncFrequency)
})

if common.RedisEnabled {
    trace.GoJob("cacheinvalsub", service.StartCacheInvalidator)
}
```

- [ ] **Step 3：编译 + 启动 smoke check**

```bash
go build -o bin/keyapi.exe .
```
预期：编译通过

启动一次（用本地 Redis 或 docker-compose）：
```bash
./bin/keyapi.exe
```
预期日志中能看到：
- `instance id: <uuid>`
- `cache invalidate subscriber started on keyapi:cache:invalidate`

`Ctrl+C` 退出。

- [ ] **Step 4：commit**

```bash
git add main.go
git commit -m "feat(main): 启动时挂载 cache invalidate 订阅 goroutine"
```

---

## Phase 6 — 多副本端到端验收

### Task 11: docker-compose 验收环境

**Files:**
- Create: `docker-compose.cluster.yml`
- Create: `docs/cluster-deployment.md`

- [ ] **Step 1：写 compose 文件**

`docker-compose.cluster.yml`:
```yaml
version: "3.8"
services:
  mysql:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: root
      MYSQL_DATABASE: keyapi
    ports: ["3306:3306"]
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost", "-uroot", "-proot"]
      interval: 5s
      retries: 20

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      retries: 10

  keyapi-1: &keyapi
    build: .
    depends_on:
      mysql: { condition: service_healthy }
      redis: { condition: service_healthy }
    environment:
      SQL_DSN: root:root@tcp(mysql:3306)/keyapi?charset=utf8mb4&parseTime=true
      REDIS_CONN_STRING: redis://redis:6379/0
      MEMORY_CACHE_ENABLED: "true"
      SYNC_FREQUENCY: "60"
      SESSION_SECRET: dev-cluster-secret
      PORT: "3000"
    ports: ["3001:3000"]

  keyapi-2:
    <<: *keyapi
    ports: ["3002:3000"]
```

- [ ] **Step 2：写验收手册**

`docs/cluster-deployment.md`:
````markdown
# 多副本部署验收清单

## 环境
```bash
docker compose -f docker-compose.cluster.yml up --build
```

两个实例分别：http://localhost:3001  http://localhost:3002

## 验收用例

### 用例 1：OptionMap 实时同步
1. 在 http://localhost:3001 后台改 `Notice` 为 "from-instance-1"
2. **预期**：< 1 秒内 http://localhost:3002 的首页公告变成 "from-instance-1"
3. **回归对比**：将 `REDIS_CONN_STRING` 注释掉重启，重复步骤 1，预期 instance-2 直到 60s 才同步

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
1. tail instance-1 的日志 `docker compose logs -f keyapi-1`
2. 在 instance-1 改 `Notice`
3. **预期**：instance-1 日志不出现 `option reload` 行；instance-2 日志出现 `option reload Notice`

## 已知不在此次范围内的限制
- 渠道全量缓存收到失效后是**全表重建**，不是增量。渠道 > 5000 时建议把 invalidate 频率限流（暂不实现，YAGNI）
- 跨实例统计/排行榜仍是 DB 实时聚合，不受本次改造影响
- Token 预扣 / 限流 / cooldown 改造前已经走 Redis 共享，不受影响
````

- [ ] **Step 3：commit**

```bash
git add docker-compose.cluster.yml docs/cluster-deployment.md
git commit -m "docs: 多副本验收 docker-compose 与手动测试清单"
```

---

### Task 12: 走一遍验收清单 + 收尾

- [ ] **Step 1：执行 `docs/cluster-deployment.md` 全部手动验收用例**

按文档逐条手工跑（包括 1、2、3、3b、3c、4、5 — 不要漏 review 引入的回归用例）。每条记录"通过 / 失败 + 现象"。

- [ ] **Step 2：跑全量单测 + race detector**

```bash
go test -race ./common ./model ./service ./controller/channel ./controller/codex -v
```
预期：全 PASS

- [ ] **Step 3：跑 vet**

```bash
go vet ./...
```
预期：no diagnostics

- [ ] **Step 4：如果全部手动验收用例（含 3b/3c）全过，merge dev**

```bash
git checkout dev
git merge --no-ff <feature-branch>
```

如果有用例未过，回到对应 task 修复 → 重跑。**不要带着已知失败合并。**

---

## 自查（spec 覆盖性）

| 原始风险（来自上一轮分析 / code review） | 由哪个 Task 解决 |
|---|---|
| OptionMap 改完别的实例不知道（🔴 高） | Task 4 + 5 + 9 |
| OptionMap DB 写失败仍 publish 导致状态分叉（review #4） | Task 5 step 3 修订（严格按 DB→内存→publish 顺序） |
| 新增/删除渠道最多 60s 延迟（🔴 高） | Task 6 + 7 + 9 |
| auto-failover / 批量 SQL 改渠道状态绕过 Insert/Update/Delete（review #2） | Task 7a（覆盖 SaveWithoutKey、EnableChannelByTag 等裸 SQL 路径） |
| 租户路由 60s 延迟（🟡 中） | Task 8 + 9 |
| 租户级 option 覆盖缓存只本地失效（review #1） | Task 8b + 9（dispatch 新增 tenant_option type） |
| 测试 race：mutating common.InstanceID（review #3） | Task 1/3/9 测试改为显式 msg.InstanceID + SubscribeInvalidate 内捕获 selfID |
| Init 挂载位置错误（review #5） | Task 1 step 4 修正：挂在 main.go InitResources（logger 之后） |
| Token 预扣并发竞争（🟡 中） | **不在范围**（理由见 Non-goals 第 2 条） |
| Cooldown 状态 | 已经走 Redis，无需改 |
| 用量日志 | 直接落 DB，无需改 |
| 限流计数 | 已经走 Redis，无需改 |
| Redis 挂掉的降级 | Task 11 用例 4 验证 |
| 自己消息回环 | Task 3 测试覆盖 + Task 11 用例 5 验证 |
| 订阅 handler 回环放大（peer reload → 又 publish → 再 reload） | Task 9 实现说明强制 reload 函数不准 publish；当前 4 个 reload 函数都不广播 |
| `Channel.Tag` 是 `*string`，测试 `Tag:"demo"` 编译失败（review2 #1） | Task 7a 测试改用 `tag:="demo"; Tag:&tag` |
| 事务路径在 commit 之前发广播 → peer 读到旧数据（review2 #2） | Task 7a Step 5 加"模板 B：必须 commit 之后再 publish"铁律，列出 BatchSetChannelTag/BatchSetChannelTagForTenant 路径 |
| Task 1 commit 命令 stage 错文件（review2 #3） | Task 1 Step 6 改为 `git add common/instance.go common/instance_test.go main.go` |
| 验收用例 3 用了不存在的 `private_only`（review2 #4） | 改为 `only_private`，并在文档里列出全部合法值 |
| File Structure 头部仍写 `service.Publish*` 误导实现者（review2 #5） | "修改文件" 节全部改为 `common.PublishInvalidate(...)`，并补全所有要改的渠道写路径清单 |
| Task 7a grep 范围只在 model/，漏掉 controller/service 跨包直接写 `model.Channel`（review3 #1） | Step 1 grep 扩展到全仓库 6 条 pattern；Step 5 列出 4 个已知跨包写点；Step 7 新增跨包测试 |
| 协议描述说订阅方调 `service.InvalidateTenantOptionCacheKey`（会回环）（review3 #2） | 协议节明确写"必须直接 `tenantOptionCache.Delete`，不准调对外 publish 函数"，铁律对所有 type 适用 |
| Task 1 Files 节 Modify 写 common/init.go，与 Step + commit 不一致（review3 #3） | Files 改为 `Modify: main.go` |
| 漏掉 `controller/codex/usage.go:94` token 自动刷新写 key（review4 #1） | 加进 File Structure / Task 7a 已知点 / Task 7a Step 8 commit 清单 |
| 验收要求 instance-2 出现 `option reload Notice` 日志，但 dispatch 只打失败日志（review4 #2） | Task 9 dispatch 4 个 case 全部加成功日志（option/channel_full/tenant_routing/tenant_option） |
| Task 12 写"执行用例 1-5"，漏掉 3b/3c 回归用例（review4 #3） | 改为"执行全部手动验收用例（包括 1、2、3、3b、3c、4、5）" |
| `SaveWithoutKey` defer publish 早于 `UpdateAbilityStatus`（review5 #1） | 推翻"低层 defer"思路；新规则：publish 只在完整逻辑操作末尾的显式成功路径。`EnableChannelByTag/DisableChannelByTag` 用模板 B（`UpdateAbilityStatusByTag` 之后才 publish）。`UpdateChannelStatus` 重构成 inline abilities + 末尾 publish（review6 #2 进一步细化） |
| 真实"新增渠道"走 `BatchInsertChannels` / `tx.Create(&chunk)` 不走 `(*Channel).Insert`（review5 #2） | 列入 Step 5 模板 C，commit 后 publish；新增 `TestBatchInsertChannels_PublishesInvalidate` 单测覆盖手动验收用例 2 的真实路径 |
| `updateChannelUpstreamModelSettings` helper publish 早于 `UpdateAbilities`（review5 #3） | helper 内**不** publish；调用方（`checkAndPersistChannelUpstreamModelUpdates` :341 和 :741 函数）在 `UpdateAbilities` 之后再 publish |
| Task 12 race 命令缺 `controller/channel` / `controller/codex`（review5 #4） | 命令补全包列表 |
| Task 6 Insert/Update/Delete 顶层 defer 仍会广播半更新状态（review6 #1） | 推翻"defer"思路；Step 3 改为显式两步成功路径：`DB.Create→AddAbilities→publish`，任一失败即 return 不广播 |
| `UpdateChannelStatus` 模板 D 用 defer 仍会无条件广播（无变更/失败也发）（review6 #2） | 推翻模板 D 的 defer 思路；改为重构函数：把 `UpdateAbilityStatus` 从 defer 移到 inline，`SaveWithoutKey` 失败 / 无变更早退路径都不 publish；只在显式成功路径末尾 publish |
| `BatchInsertChannels` 测试用 `[]*Channel` 编译不过（review6 #3） | 改为 `[]Channel`，注释明示签名出处 model/channel.go:589 |
| Step 7 测试要求覆盖 `updateChannelUpstreamModelSettings` helper，与"helper 不发广播"规则矛盾（review6 #4） | 测试改为覆盖**调用方**（`checkAndPersistChannelUpstreamModelUpdates` 等完整流程函数）的成功路径，并明示"不要测 helper" |
| 文件结构 line 32 仍写"Insert/Update/Delete 方法体顶部 defer publish"（review7 #1） | 全段改写为"显式两步成功路径"，列出每个完整操作及"不在低层 helper publish"铁律 |
| 路径清单 line 1069 / 自查表 line 1784 仍残留"模板 D 加 publish defer"说法（review7 #2） | 全部改为"删除 ability defer，inline 后再 publish"；自查表行同步更新 |
| 文件结构 line 35 写"updateChannelUpstreamModelSettings 写后追加 publish"，与正文"helper 不 publish"矛盾（review7 #3） | 改为"helper 不 publish，调用方 `UpdateAbilities` 之后才 publish" |
| Step 3 red-test 命令缺 `TestBatchInsertChannels_PublishesInvalidate`，无法确认真实新建路径先红后绿（review7 #4） | 命令补上该测试 |
| Step 4 段尾仍残留"Task 6 的 defer 在这三个方法里是安全的"误导句（review8 #1） | 改为"仍然不能用 defer：每个都是两步，第二步失败时 defer 会广播半更新状态。Task 6 已改为显式两步成功路径。本铁律对全部渠道写路径**无例外**适用" |
| Task 7a Files 节把 `Save` / `SaveWithoutKey` 列为 Modify 目标（review8 #2） | 改为"**审计（不修改）**"，只作为 grep 起点定位调用方；Modify 列表改为完整逻辑操作函数清单 |
| Task 12 Step 4 仍写"如果用例 1-5 全过"（review8 #3） | 改为"如果全部手动验收用例（含 3b/3c）全过" |
| `TestUpdateChannelStatus_PublishesInvalidate` 没固定 `MemoryCacheEnabled`，受测试顺序污染时会因 `CacheGetChannel` 返回 nil 提前 return false，跳过 publish 看似"通过"实则错误（review9） | `setupTestRedisForChannel` 内固定 `common.MemoryCacheEnabled = false`，并在 `t.Cleanup` 里恢复；所有用该 helper 的渠道写测试统一受益 |

---

## 后续可选优化（**本计划不做**，仅记录）

1. **渠道增量失效**：如果未来渠道数量 > 5000 / 全量重建 > 1s，把消息扩展为 `{type:"channel_one", key:"<channel_id>"}`，订阅方做局部更新而不是 `InitChannelCache`
2. **Pub/Sub → Streams**：如果需要"实例重启后补未消费消息"的语义，换成 Redis Streams + consumer group。当前 60s 兜底足够，YAGNI
3. **指标埋点**：给 `cacheinvalsub` 加 prometheus counter（messages_received / reload_failures），方便观察
