package middleware

import (
	"bytes"
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	servicechathistory "github.com/QuantumNous/new-api/service/chat_history"
	settingchathistory "github.com/QuantumNous/new-api/setting/chat_history"

	"github.com/gin-gonic/gin"
)

// ChatHistoryViewGate enforces the per-tenant "view chat history" feature
// flag for the admin list/detail endpoints. Only root (platform_role >=
// RoleRootUser) bypasses — they need cross-tenant visibility for ops /
// troubleshooting. Tenant admins (including platform_role == RoleAdminUser)
// only pass when the tenant's TenantOptionKeyChatHistoryView is "true".
//
// Mount AFTER TenantAdminAuth so role + tenant context are populated.
func ChatHistoryViewGate() gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.GetInt("platform_role") >= common.RoleRootUser {
			c.Next()
			return
		}
		tenantId := GetTenantId(c)
		if tenantId > 0 && model.IsChatHistoryViewEnabled(tenantId) {
			c.Next()
			return
		}
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
			"success": false,
			"message": "chat history view is not enabled for this tenant",
		})
	}
}

// chatHistoryWriter wraps gin.ResponseWriter to mirror everything written to
// the client into an in-memory buffer for later upload. The wrapper is fully
// transparent to the underlying writer — it never blocks, never modifies, and
// only retains bytes up to a hard cap so a runaway response can't OOM the
// process.
type chatHistoryWriter struct {
	gin.ResponseWriter
	buf         *bytes.Buffer
	cap         int
	truncatedAt int // bytes written when the cap was hit; 0 if never hit
}

func (w *chatHistoryWriter) Write(b []byte) (int, error) {
	w.captureTo(b)
	return w.ResponseWriter.Write(b)
}

func (w *chatHistoryWriter) WriteString(s string) (int, error) {
	w.captureTo([]byte(s))
	return w.ResponseWriter.WriteString(s)
}

func (w *chatHistoryWriter) captureTo(b []byte) {
	if w.buf == nil || len(b) == 0 {
		return
	}
	remaining := w.cap - w.buf.Len()
	if remaining <= 0 {
		return
	}
	if len(b) <= remaining {
		w.buf.Write(b)
		return
	}
	// Past the cap. Record the *true* total at the moment of truncation
	// (cap value is the count we saved + the length of this aborted write
	// = approx the wire byte count). Subsequent writes are silently dropped
	// from the captured copy but still flow through to the client.
	w.buf.Write(b[:remaining])
	if w.truncatedAt == 0 {
		w.truncatedAt = w.cap
	}
}

// ChatHistoryRecorder is the relay middleware that conditionally captures
// request + response bodies for chat-style routes when the operator has
// enabled `chat_history.record_messages`. When disabled it is a near-zero-cost
// pass-through (one map read + one path lookup).
//
// Register on the relay V1 group AFTER TokenAuth (so user_id is set on the
// context) and BEFORE the route handler (so we wrap the writer the handler
// will write through).
func ChatHistoryRecorder() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Cheap gates first: skip the writer wrap entirely when not recording.
		// RecordMessagesEnabled is a single map read under RWMutex.RLock.
		if !settingchathistory.RecordMessagesEnabled() {
			c.Next()
			return
		}
		if !servicechathistory.IsChatPath(c.Request.URL.Path) {
			c.Next()
			return
		}

		buf := &bytes.Buffer{}
		// Pre-grow to a reasonable starting size to skip a few realloc copies
		// during typical chat completions. 64 KiB matches a small turn.
		buf.Grow(64 * 1024)
		wrapped := &chatHistoryWriter{
			ResponseWriter: c.Writer,
			buf:            buf,
			cap:            servicechathistory.MaxResponseBufferBytes,
		}
		c.Writer = wrapped

		c.Next()

		servicechathistory.RecordAfterRequest(c, buf.Bytes(), wrapped.truncatedAt)
	}
}
