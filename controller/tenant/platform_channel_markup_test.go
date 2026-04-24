package tenant

import (
	"bytes"
	"encoding/json"
	"testing"
)

func TestUpsertReq_EnabledDefaultsToTrueWhenOmitted(t *testing.T) {
	raw := []byte(`{"channel_id": 42, "markup_ratio": 1.5}`)
	var req upsertMarkupReq
	if err := json.NewDecoder(bytes.NewReader(raw)).Decode(&req); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if req.Enabled != nil {
		t.Fatalf("omitted enabled should decode to nil, got %v", *req.Enabled)
	}
	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}
	if !enabled {
		t.Fatalf("default should be enabled=true")
	}
}

func TestUpsertReq_EnabledFalseExplicit(t *testing.T) {
	raw := []byte(`{"channel_id": 42, "markup_ratio": 1.5, "enabled": false}`)
	var req upsertMarkupReq
	if err := json.NewDecoder(bytes.NewReader(raw)).Decode(&req); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if req.Enabled == nil || *req.Enabled != false {
		t.Fatalf("explicit false should decode to &false")
	}
}
