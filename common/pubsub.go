package common

import (
	"context"
	"encoding/json"
	"time"
)

const InvalidateChannel = "keyapi:cache:invalidate"

type InvalidateMessage struct {
	Type       string `json:"type"`        // "option" | "channel_full" | "tenant_routing" | "tenant_option" | "tenant_plan"
	Key        string `json:"key"`         // option key, tenant id, "<tid>:<optKey>", or empty for channel_full
	InstanceID string `json:"instance_id"` // publisher's process UUID
	Ts         int64  `json:"ts"`          // unix seconds, for logging only
}

func jsonMarshal(v any) ([]byte, error) { return json.Marshal(v) }

// PublishInvalidate broadcasts a cache-invalidate message.
// No-op when Redis is disabled (single-instance mode).
// If msg.InstanceID is empty, it is auto-filled from the global common.InstanceID;
// callers that want to simulate other instances (e.g. tests) can set it explicitly.
// If msg.Ts is 0, it is auto-filled with current unix seconds.
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
