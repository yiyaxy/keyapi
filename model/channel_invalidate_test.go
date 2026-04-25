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

// setupTestRedisForChannel pins MemoryCacheEnabled=false because UpdateChannelStatus
// (and related channel writes) check common.MemoryCacheEnabled and may early-return
// when CacheGetChannel(channelId) returns nil — skipping the DB write and publish.
// See model/channel.go:901-907. Restoring via t.Cleanup avoids polluting other tests.
func setupTestRedisForChannel(t *testing.T) {
	t.Helper()
	s := miniredis.RunT(t)
	prevRDB := common.RDB
	prevEnabled := common.RedisEnabled
	prevInstance := common.InstanceID
	prevMemoryCache := common.MemoryCacheEnabled
	common.RDB = redis.NewClient(&redis.Options{Addr: s.Addr()})
	common.RedisEnabled = true
	common.InstanceID = "test-instance"
	common.MemoryCacheEnabled = false
	t.Cleanup(func() {
		_ = common.RDB.Close()
		common.RDB = prevRDB
		common.RedisEnabled = prevEnabled
		common.InstanceID = prevInstance
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
	setupTestRedisForChannel(t)
	t.Cleanup(func() {
		DB.Exec("DELETE FROM channels")
		DB.Exec("DELETE FROM abilities")
	})

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
	setupTestRedisForChannel(t)
	t.Cleanup(func() {
		DB.Exec("DELETE FROM channels")
		DB.Exec("DELETE FROM abilities")
	})

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
	setupTestRedisForChannel(t)
	t.Cleanup(func() {
		DB.Exec("DELETE FROM channels")
		DB.Exec("DELETE FROM abilities")
	})

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
