package chat_history

import (
	"testing"
	"time"
)

func TestObjectKey_Shape(t *testing.T) {
	now := time.Date(2026, 5, 5, 17, 30, 0, 0, time.UTC)
	got := ObjectKey(42, "req_abc123", now)
	want := "chat-history/42/2026-05/req_abc123.json.gz"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestObjectKey_SanitizesRequestID(t *testing.T) {
	now := time.Date(2026, 5, 5, 0, 0, 0, 0, time.UTC)
	cases := []struct {
		in  string
		key string
	}{
		// Slashes would split the key and create stray directories; dots could
		// collapse to ".." in some viewers; spaces and control chars are not
		// safe across all S3-compatible backends — drop them all.
		{"req/with/slash", "reqwithslash"},
		{"req.with.dot", "reqwithdot"},
		{"req with space", "reqwithspace"},
		{"  trim me  ", "trimme"},
		{"req-id_OK-1", "req-id_OK-1"},
	}
	for _, tc := range cases {
		t.Run(tc.in, func(t *testing.T) {
			got := ObjectKey(1, tc.in, now)
			want := "chat-history/1/2026-05/" + tc.key + ".json.gz"
			if got != want {
				t.Errorf("got %q want %q", got, want)
			}
		})
	}
}

func TestObjectKey_EmptyRequestIDFallsBackToTimestamp(t *testing.T) {
	now := time.Date(2026, 5, 5, 0, 0, 0, 0, time.UTC)
	got := ObjectKey(1, "   ", now)
	wantPrefix := "chat-history/1/2026-05/"
	if len(got) <= len(wantPrefix) || got[:len(wantPrefix)] != wantPrefix {
		t.Fatalf("expected fallback key under %q, got %q", wantPrefix, got)
	}
	if got[len(got)-8:] != ".json.gz" {
		t.Fatalf("expected .json.gz suffix, got %q", got)
	}
}
