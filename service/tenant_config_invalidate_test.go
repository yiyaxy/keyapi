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
	prevRDB := common.RDB
	prevEnabled := common.RedisEnabled
	prevInstance := common.InstanceID
	common.RDB = redis.NewClient(&redis.Options{Addr: s.Addr()})
	common.RedisEnabled = true
	common.InstanceID = "test-instance"
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
