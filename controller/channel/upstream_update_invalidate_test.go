package channel

import (
	"context"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/alicebob/miniredis/v2"
	"github.com/glebarez/sqlite"
	"github.com/go-redis/redis/v8"
	"gorm.io/gorm"
)

// setupTestDBForUpstream 在 model.DB 上初始化内存 SQLite 并迁移 Channel/Ability 表。
func setupTestDBForUpstream(t *testing.T) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	sqlDB, _ := db.DB()
	sqlDB.SetMaxOpenConns(1)

	prev := model.DB
	model.DB = db
	t.Cleanup(func() { model.DB = prev })

	if err := db.AutoMigrate(&model.Channel{}, &model.Ability{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
}

// setupRedisForUpstream 替换全局 RDB 为 miniredis 实例。
func setupRedisForUpstream(t *testing.T) {
	t.Helper()
	s := miniredis.RunT(t)
	prevRDB := common.RDB
	prevEnabled := common.RedisEnabled
	prevInstance := common.InstanceID
	common.RDB = redis.NewClient(&redis.Options{Addr: s.Addr()})
	common.RedisEnabled = true
	common.InstanceID = "test-upstream"
	t.Cleanup(func() {
		_ = common.RDB.Close()
		common.RDB = prevRDB
		common.RedisEnabled = prevEnabled
		common.InstanceID = prevInstance
	})
}

// TestUpdateChannelUpstreamModelSettings_DoesNotPublish 确认低层 helper 自身不会发
// 布 cache-invalidate 消息 — publish 只发生在其调用方。
func TestUpdateChannelUpstreamModelSettings_DoesNotPublish(t *testing.T) {
	setupTestDBForUpstream(t)
	setupRedisForUpstream(t)

	// 往 DB 插入一条 channel。
	ch := &model.Channel{Name: "helper-test", Type: 1, Key: "sk-x", Status: common.ChannelStatusEnabled, Models: "gpt-4"}
	if err := model.DB.Create(ch).Error; err != nil {
		t.Fatalf("create channel: %v", err)
	}

	sub := common.RDB.Subscribe(context.Background(), common.InvalidateChannel)
	defer sub.Close()
	redisCh := sub.Channel()
	// 等待 subscribe 握手完成
	time.Sleep(100 * time.Millisecond)

	settings := ch.GetOtherSettings()
	settings.UpstreamModelUpdateLastCheckTime = common.GetTimestamp()
	err := updateChannelUpstreamModelSettings(ch, settings, false)
	if err != nil {
		t.Fatalf("updateChannelUpstreamModelSettings: %v", err)
	}

	// helper 绝不应在此发布消息。
	select {
	case raw := <-redisCh:
		t.Fatalf("helper should NOT publish, got: %s", raw.Payload)
	case <-time.After(300 * time.Millisecond):
		// 预期路径：无消息
	}
}
