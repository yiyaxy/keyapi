package chat_history

import (
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"encoding/json"
	"io"
	"strings"
	"testing"
)

func TestBuildPayload_JSONStaysParsed(t *testing.T) {
	body := []byte(`{"model":"gpt-4","messages":[{"role":"user","content":"hi"}]}`)
	got := buildPayload(body, "application/json; charset=utf-8")

	if got.Bytes != len(body) {
		t.Errorf("Bytes: got %d want %d", got.Bytes, len(body))
	}
	if len(got.Body) == 0 {
		t.Fatal("Body should be set for JSON content")
	}
	if got.BodyText != "" || got.BodyBase64 != "" {
		t.Errorf("only Body should be set for JSON; got text=%q base64=%q", got.BodyText, got.BodyBase64)
	}
	// Ensure round-trip parses to the original shape.
	var parsed map[string]any
	if err := json.Unmarshal(got.Body, &parsed); err != nil {
		t.Fatalf("Body is not valid JSON: %v", err)
	}
	if parsed["model"] != "gpt-4" {
		t.Errorf("model field lost: %v", parsed["model"])
	}
}

func TestBuildPayload_SSEKeptAsText(t *testing.T) {
	body := []byte("data: {\"id\":\"x\"}\n\ndata: [DONE]\n\n")
	got := buildPayload(body, "text/event-stream")

	if got.BodyText == "" {
		t.Fatal("BodyText should be set for SSE")
	}
	if got.Body != nil {
		t.Errorf("Body should be nil for non-JSON content, got %s", string(got.Body))
	}
	if got.BodyText != string(body) {
		t.Errorf("BodyText mismatch")
	}
}

func TestBuildPayload_BinaryFallsBackToBase64(t *testing.T) {
	body := []byte{0x89, 'P', 'N', 'G', 0x00, 0x01, 0x02, 0x03}
	got := buildPayload(body, "image/png")

	if got.BodyBase64 == "" {
		t.Fatal("BodyBase64 should be set for binary content")
	}
	if got.Body != nil || got.BodyText != "" {
		t.Errorf("only BodyBase64 should be set for binary; got body=%s text=%q", string(got.Body), got.BodyText)
	}
	decoded, err := base64.StdEncoding.DecodeString(got.BodyBase64)
	if err != nil {
		t.Fatalf("base64 round-trip failed: %v", err)
	}
	if !bytes.Equal(decoded, body) {
		t.Errorf("body bytes mismatch after base64 round-trip")
	}
}

func TestBuildPayload_InvalidJSONDegradesToText(t *testing.T) {
	// Defensive: upstream might claim Content-Type: application/json yet
	// send malformed bytes. We must not silently put garbage into the
	// parsed-JSON branch — fall through to text so the admin UI can still
	// render the actual bytes for debugging.
	body := []byte(`{"truncated":`)
	got := buildPayload(body, "application/json")

	if got.Body != nil {
		t.Errorf("invalid JSON must not populate Body, got %s", string(got.Body))
	}
	if got.BodyText != string(body) {
		t.Errorf("invalid JSON should fall through to BodyText, got %q", got.BodyText)
	}
}

func TestBuildPayload_EmptyBody(t *testing.T) {
	got := buildPayload(nil, "application/json")
	if got.Bytes != 0 || got.Body != nil || got.BodyText != "" || got.BodyBase64 != "" {
		t.Errorf("empty body should produce all-zero payload, got %+v", got)
	}
}

func TestGzipBytes_Roundtrip(t *testing.T) {
	original := []byte(strings.Repeat(`{"k":"v"}`, 1000)) // compresses well
	compressed, err := gzipBytes(original)
	if err != nil {
		t.Fatalf("gzip: %v", err)
	}
	if len(compressed) >= len(original) {
		t.Errorf("compressed payload not actually smaller: got %d original %d", len(compressed), len(original))
	}
	gz, err := gzip.NewReader(bytes.NewReader(compressed))
	if err != nil {
		t.Fatalf("gzip new reader: %v", err)
	}
	defer gz.Close()
	got, err := io.ReadAll(gz)
	if err != nil {
		t.Fatalf("gunzip: %v", err)
	}
	if !bytes.Equal(got, original) {
		t.Errorf("round-trip data mismatch")
	}
}
