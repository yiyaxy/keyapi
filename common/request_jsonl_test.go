package common

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWriteRequestJSONLByIDWritesStructuredEvent(t *testing.T) {
	t.Setenv("REQUEST_JSONL_DEBUG", "true")
	dir := t.TempDir()
	t.Setenv("REQUEST_JSONL_DIR", dir)

	WriteRequestJSONLByID("HTTP-test/abc", "stage.one", map[string]any{
		"body": RequestJSONLRawJSON([]byte(`{"ok":true}`)),
		"long": strings.Repeat("x", requestJSONLStringLimit+1),
	})

	data, err := os.ReadFile(filepath.Join(dir, "HTTP-test_abc.jsonl"))
	if err != nil {
		t.Fatalf("read jsonl: %v", err)
	}
	lines := strings.Split(strings.TrimSpace(string(data)), "\n")
	if len(lines) != 1 {
		t.Fatalf("lines = %d, want 1", len(lines))
	}
	var event map[string]any
	if err := json.Unmarshal([]byte(lines[0]), &event); err != nil {
		t.Fatalf("unmarshal jsonl line: %v", err)
	}
	if event["request_id"] != "HTTP-test/abc" || event["stage"] != "stage.one" {
		t.Fatalf("unexpected event: %#v", event)
	}
	body := event["data"].(map[string]any)["body"].(map[string]any)
	if body["ok"] != true {
		t.Fatalf("raw json was not embedded: %#v", body)
	}
}
