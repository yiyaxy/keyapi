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

// publishRaw publishes a JSON-marshalled message directly via RDB.Publish.
// Used to simulate "another instance" without going through PublishInvalidate
// (which would auto-fill InstanceID from the global).
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
