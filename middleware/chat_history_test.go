package middleware

import (
	"bytes"
	"net/http/httptest"
	"strings"
	"testing"

	servicechathistory "github.com/QuantumNous/new-api/service/chat_history"

	"github.com/gin-gonic/gin"
)

// fakeWriter is a minimal stand-in for the gin.ResponseWriter that we wrap.
// Everything below the chatHistoryWriter only needs Write/WriteString to
// exercise the capture path.
type fakeWriter struct {
	gin.ResponseWriter
	written bytes.Buffer
}

func (f *fakeWriter) Write(b []byte) (int, error)         { return f.written.Write(b) }
func (f *fakeWriter) WriteString(s string) (int, error)   { return f.written.WriteString(s) }
func (f *fakeWriter) Status() int                         { return 200 }
func (f *fakeWriter) Header() (h map[string][]string)     { return nil }
func (f *fakeWriter) Size() int                           { return f.written.Len() }
func (f *fakeWriter) Written() bool                       { return f.written.Len() > 0 }
func (f *fakeWriter) WriteHeader(int)                     {}
func (f *fakeWriter) WriteHeaderNow()                     {}
func (f *fakeWriter) Flush()                              {}
func (f *fakeWriter) CloseNotify() <-chan bool            { return nil }
func (f *fakeWriter) Hijack() (any, any, error)           { return nil, nil, nil }
func (f *fakeWriter) Pusher() any                         { return nil }

func TestChatHistoryWriter_CapturesBelowCap(t *testing.T) {
	buf := &bytes.Buffer{}
	w := &chatHistoryWriter{buf: buf, cap: 1024}
	// Use a no-op underlying writer for capture-only test.
	w.ResponseWriter = &capturingNoopWriter{}

	chunks := []string{"data: a\n", "data: b\n"}
	for _, ch := range chunks {
		_, _ = w.Write([]byte(ch))
	}

	got := buf.String()
	want := strings.Join(chunks, "")
	if got != want {
		t.Errorf("captured %q want %q", got, want)
	}
	if w.truncatedAt != 0 {
		t.Errorf("truncatedAt should be 0 below cap, got %d", w.truncatedAt)
	}
}

func TestChatHistoryWriter_TruncatesAtCap(t *testing.T) {
	buf := &bytes.Buffer{}
	cap := 10
	w := &chatHistoryWriter{buf: buf, cap: cap}
	w.ResponseWriter = &capturingNoopWriter{}

	// Write 5 + 9 = 14 bytes; expect captured to stop at cap=10 and
	// truncatedAt to be set.
	_, _ = w.Write([]byte("hello"))
	_, _ = w.Write([]byte("123456789"))

	if buf.Len() != cap {
		t.Errorf("buf len %d want %d", buf.Len(), cap)
	}
	if got := buf.String(); got != "hello12345" {
		t.Errorf("captured %q want %q", got, "hello12345")
	}
	if w.truncatedAt != cap {
		t.Errorf("truncatedAt %d want %d", w.truncatedAt, cap)
	}
}

func TestChatHistoryWriter_ClientStillSeesEverything(t *testing.T) {
	// Critical invariant: even after truncation in our captured copy, the
	// client (downstream writer) must receive every byte. Otherwise we'd
	// silently corrupt SSE streams when the operator turned recording on.
	buf := &bytes.Buffer{}
	downstream := &capturingNoopWriter{}
	w := &chatHistoryWriter{ResponseWriter: downstream, buf: buf, cap: 5}

	full := []byte("0123456789ABCDEF")
	_, _ = w.Write(full)

	if !bytes.Equal(downstream.written.Bytes(), full) {
		t.Errorf("client should see all %d bytes, got %d", len(full), downstream.written.Len())
	}
	if buf.Len() != 5 {
		t.Errorf("captured %d bytes, expected truncation to 5", buf.Len())
	}
}

func TestChatHistoryWriter_NilBufIsSafe(t *testing.T) {
	// A nil buf simulates "recording was disabled mid-flight" — the writer
	// must remain a transparent pass-through and not panic.
	downstream := &capturingNoopWriter{}
	w := &chatHistoryWriter{ResponseWriter: downstream, buf: nil, cap: 100}
	_, _ = w.Write([]byte("hello"))
	if downstream.written.String() != "hello" {
		t.Errorf("downstream not reached: %q", downstream.written.String())
	}
}

// capturingNoopWriter satisfies enough of gin.ResponseWriter that the
// chatHistoryWriter wrapper can call .Write/.WriteString on it. The httptest
// recorder is too heavy and brings in headers/status state we don't need.
type capturingNoopWriter struct {
	gin.ResponseWriter
	written bytes.Buffer
}

func (c *capturingNoopWriter) Write(b []byte) (int, error)       { return c.written.Write(b) }
func (c *capturingNoopWriter) WriteString(s string) (int, error) { return c.written.WriteString(s) }

// Ensure path filter still routes correctly when consumed by middleware.
// This duplicates IsChatPath unit tests in spirit but exercises the public
// shape the middleware actually depends on.
func TestChatHistoryRecorder_PathFilter_NoOpForUnrelatedRoute(t *testing.T) {
	// Recording enabled but the path is NOT a chat path → middleware must
	// not wrap the writer (so c.Writer remains the original gin writer).
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "/v1/embeddings", nil)
	originalWriter := c.Writer

	// Force the gate to a known state by sanity-checking through the public
	// path filter — we don't toggle the option here because doing so leaks
	// global state into other tests.
	if servicechathistory.IsChatPath(c.Request.URL.Path) {
		t.Fatal("test premise wrong: /v1/embeddings should not be a chat path")
	}

	handler := ChatHistoryRecorder()
	handler(c)

	if c.Writer != originalWriter {
		t.Error("non-chat path must not wrap the writer")
	}
}
