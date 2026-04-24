package common

import (
	"context"
	"testing"
	"time"
)

func TestRelayInfoStreamStageTransitionsForwardOnly(t *testing.T) {
	start := time.Now()
	info := &RelayInfo{
		IsStream:  true,
		StartTime: start,
	}

	if got := info.CurrentStreamStage(); got != StreamStagePreConnect {
		t.Fatalf("initial stage = %d, want %d", got, StreamStagePreConnect)
	}

	info.MarkStreamConnected(time.Second, nil)
	if got := info.CurrentStreamStage(); got != StreamStageConnectedNoToken {
		t.Fatalf("connected stage = %d, want %d", got, StreamStageConnectedNoToken)
	}

	info.MarkFirstStreamContent()
	if got := info.CurrentStreamStage(); got != StreamStageTokenReceived {
		t.Fatalf("token stage = %d, want %d", got, StreamStageTokenReceived)
	}
	if !info.HasStreamContent() {
		t.Fatalf("expected stream content after MarkFirstStreamContent")
	}

	info.MarkStreamConnected(time.Second, nil)
	if got := info.CurrentStreamStage(); got != StreamStageTokenReceived {
		t.Fatalf("stage regressed to %d", got)
	}
	if latency := info.FirstTokenLatencyMs(); latency < 0 {
		t.Fatalf("first token latency = %d, want non-negative", latency)
	}
}

func TestRelayInfoFirstTokenTimeoutCancelsRequest(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	info := &RelayInfo{IsStream: true}
	info.MarkStreamConnected(10*time.Millisecond, cancel)

	select {
	case <-ctx.Done():
	case <-time.After(time.Second):
		t.Fatalf("first token timeout did not cancel context")
	}
	if !info.StreamFirstTokenTimedOut() {
		t.Fatalf("expected first token timeout flag")
	}
}

func TestRelayInfoFirstStreamContentStopsTimeout(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	info := &RelayInfo{IsStream: true}
	info.MarkStreamConnected(50*time.Millisecond, cancel)
	info.MarkFirstStreamContent()

	select {
	case <-ctx.Done():
		t.Fatalf("context cancelled after first stream content")
	case <-time.After(100 * time.Millisecond):
	}
	if info.StreamFirstTokenTimedOut() {
		t.Fatalf("unexpected first token timeout")
	}
}

func TestRelayInfoStopFirstTokenTimerReleasesStreamCancel(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())

	info := &RelayInfo{IsStream: true}
	info.MarkStreamConnected(time.Second, cancel)
	info.StopFirstTokenTimer()

	select {
	case <-ctx.Done():
	case <-time.After(time.Second):
		t.Fatalf("expected StopFirstTokenTimer to release stream cancel")
	}
	if info.StreamFirstTokenTimedOut() {
		t.Fatalf("cleanup cancel must not mark first token timeout")
	}
}
