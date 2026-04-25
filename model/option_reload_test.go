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

func TestReloadOption_RefreshesOptionMapFromDB(t *testing.T) {
	// Migrate Option table — TestMain doesn't include it
	if err := DB.AutoMigrate(&Option{}); err != nil {
		t.Fatalf("migrate Option: %v", err)
	}
	t.Cleanup(func() { DB.Exec("DELETE FROM options") })

	// Initialize OptionMap if nil
	common.OptionMapRWMutex.Lock()
	if common.OptionMap == nil {
		common.OptionMap = make(map[string]string)
	}
	common.OptionMapRWMutex.Unlock()

	// 写一条 Option 到 DB（绕过 UpdateOption，避免触发后续的 publish 副作用）
	if err := DB.Save(&Option{Key: "SystemName", Value: "first"}).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	common.OptionMapRWMutex.Lock()
	common.OptionMap["SystemName"] = "first"
	common.OptionMapRWMutex.Unlock()

	// 模拟另一实例改了 DB
	if err := DB.Model(&Option{}).Where("`key` = ?", "SystemName").Update("value", "second").Error; err != nil {
		t.Fatalf("update: %v", err)
	}

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

func TestUpdateOption_PublishesInvalidate(t *testing.T) {
	if err := DB.AutoMigrate(&Option{}); err != nil {
		t.Fatalf("migrate Option: %v", err)
	}
	t.Cleanup(func() { DB.Exec("DELETE FROM options") })

	// Initialize OptionMap if nil
	common.OptionMapRWMutex.Lock()
	if common.OptionMap == nil {
		common.OptionMap = make(map[string]string)
	}
	common.OptionMapRWMutex.Unlock()

	s := miniredis.RunT(t)
	prevRDB := common.RDB
	prevEnabled := common.RedisEnabled
	prevInstance := common.InstanceID
	common.RDB = redis.NewClient(&redis.Options{Addr: s.Addr()})
	common.RedisEnabled = true
	common.InstanceID = "publisher-instance"
	t.Cleanup(func() {
		_ = common.RDB.Close()
		common.RDB = prevRDB
		common.RedisEnabled = prevEnabled
		common.InstanceID = prevInstance
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
