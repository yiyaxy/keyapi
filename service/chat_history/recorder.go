package chat_history

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service/ticket_storage"
	settingchathistory "github.com/QuantumNous/new-api/setting/chat_history"

	"github.com/gin-gonic/gin"
)

// MaxResponseBufferBytes caps how much of the response body the middleware
// buffers in memory per request. SSE streams are tiny per chunk but a
// pathological model could in theory emit a multi-MB single response — we'd
// rather truncate the captured copy than OOM the relay process. The cap is
// also a useful brake on sustained traffic when the operator forgot to budget
// OSS storage for this feature.
const MaxResponseBufferBytes = 4 * 1024 * 1024 // 4 MiB

// envelope is the on-disk shape uploaded to OSS for one captured request.
// Versioned via Schema so future shape changes can be detected by the
// admin reader without breaking older records.
type envelope struct {
	Schema      int             `json:"schema"`
	CapturedAt  string          `json:"captured_at"`
	RequestID   string          `json:"request_id"`
	UserID      int             `json:"user_id"`
	Username    string          `json:"username,omitempty"`
	TenantID    int             `json:"tenant_id,omitempty"`
	Model       string          `json:"model,omitempty"`
	Method      string          `json:"method"`
	Path        string          `json:"path"`
	StatusCode  int             `json:"status_code"`
	IsStream    bool            `json:"is_stream"`
	Request     payload         `json:"request"`
	Response    payload         `json:"response"`
	TruncatedAt int             `json:"response_truncated_at_bytes,omitempty"`
	Extra       json.RawMessage `json:"extra,omitempty"`
}

// payload encodes one body. When the original was JSON we keep it parsed so
// the admin UI doesn't need to re-parse; otherwise we keep the raw bytes
// (base64) and the original content_type so the UI can decide how to render.
// Either Body or BodyBase64 is set, never both.
type payload struct {
	ContentType string          `json:"content_type,omitempty"`
	Body        json.RawMessage `json:"body,omitempty"`
	BodyBase64  string          `json:"body_base64,omitempty"`
	BodyText    string          `json:"body_text,omitempty"`
	Bytes       int             `json:"bytes"`
}

// RecordAfterRequest is invoked by the gin middleware once the relay handler
// has returned. Errors are logged but never propagated — chat history is a
// best-effort observability feature; the relay request itself must succeed
// or fail on its own merits.
func RecordAfterRequest(c *gin.Context, capturedResponse []byte, truncatedAt int) {
	if c == nil {
		return
	}
	if !settingchathistory.RecordMessagesEnabled() {
		return
	}

	userID := c.GetInt("id")
	if userID <= 0 {
		// No authenticated user — nothing useful to file under, skip silently.
		return
	}

	requestID := strings.TrimSpace(c.GetString(common.RequestIdKey))
	if requestID == "" {
		// Without a request id we can't deterministically build the OSS key
		// or correlate to the Log row, so skip rather than make up an id.
		return
	}

	now := time.Now().UTC()
	objectKey := settingchathistory.ObjectKey(userID, requestID, now)

	requestBody, requestContentType := captureRequestBody(c)
	responseContentType := c.Writer.Header().Get("Content-Type")
	statusCode := c.Writer.Status()
	isStream := strings.Contains(strings.ToLower(responseContentType), "text/event-stream")

	env := envelope{
		Schema:      1,
		CapturedAt:  now.Format(time.RFC3339Nano),
		RequestID:   requestID,
		UserID:      userID,
		Username:    c.GetString("username"),
		TenantID:    c.GetInt("tenant_id"),
		Model:       firstNonEmpty(c.GetString("original_model"), c.GetString("model")),
		Method:      c.Request.Method,
		Path:        c.Request.URL.Path,
		StatusCode:  statusCode,
		IsStream:    isStream,
		Request:     buildPayload(requestBody, requestContentType),
		Response:    buildPayload(capturedResponse, responseContentType),
		TruncatedAt: truncatedAt,
	}

	body, err := json.Marshal(env)
	if err != nil {
		logger.LogError(c, fmt.Sprintf("chat_history: marshal envelope failed: %s", err.Error()))
		return
	}

	gzipped, err := gzipBytes(body)
	if err != nil {
		logger.LogError(c, fmt.Sprintf("chat_history: gzip failed: %s", err.Error()))
		return
	}

	client, err := ticket_storage.GetClient()
	if err != nil {
		logger.LogError(c, fmt.Sprintf("chat_history: storage client unavailable: %s", err.Error()))
		return
	}

	uploadCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := client.UploadObject(uploadCtx, objectKey, "application/json", gzipped); err != nil {
		logger.LogError(c, fmt.Sprintf("chat_history: upload %s failed: %s", objectKey, err.Error()))
		return
	}

	if err := model.UpdateLogMessageObject(requestID, objectKey, int64(len(gzipped))); err != nil {
		// Upload succeeded but Log update failed. Object exists in OSS but
		// won't be findable via the admin list view (which filters on
		// message_object_key). Worth knowing about, but not worth retrying
		// because the next request will surface the same DB issue.
		logger.LogError(c, fmt.Sprintf("chat_history: log update for %s failed: %s", requestID, err.Error()))
	}
}

// captureRequestBody pulls the cached request body out of BodyStorage. Returns
// (nil, "") if the body wasn't buffered for any reason — the recorder treats
// that as "no request body to capture" rather than failing the whole record.
func captureRequestBody(c *gin.Context) ([]byte, string) {
	storage, err := common.GetBodyStorage(c)
	if err != nil {
		return nil, c.Request.Header.Get("Content-Type")
	}
	body, err := storage.Bytes()
	if err != nil {
		return nil, c.Request.Header.Get("Content-Type")
	}
	return body, c.Request.Header.Get("Content-Type")
}

// buildPayload decides whether to keep the body parsed (for JSON), as
// printable text (for SSE / plain text), or as base64 (for binary). The
// distinction matters at admin read time: a parsed JSON payload renders as
// pretty JSON in the UI without re-parsing, while binary bodies need base64
// to survive a JSON envelope round-trip.
func buildPayload(body []byte, contentType string) payload {
	p := payload{
		ContentType: contentType,
		Bytes:       len(body),
	}
	if len(body) == 0 {
		return p
	}
	ct := strings.ToLower(contentType)
	switch {
	case strings.Contains(ct, "application/json"):
		// Validate it parses; if not, fall through to text/base64 so we don't
		// store a "body" field that the admin UI can't render.
		if json.Valid(body) {
			p.Body = json.RawMessage(body)
			return p
		}
		fallthrough
	case strings.Contains(ct, "text/"), strings.Contains(ct, "event-stream"):
		p.BodyText = string(body)
	default:
		p.BodyBase64 = base64.StdEncoding.EncodeToString(body)
	}
	return p
}

func gzipBytes(in []byte) ([]byte, error) {
	var buf bytes.Buffer
	w := gzip.NewWriter(&buf)
	if _, err := w.Write(in); err != nil {
		_ = w.Close()
		return nil, err
	}
	if err := w.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		v = strings.TrimSpace(v)
		if v != "" {
			return v
		}
	}
	return ""
}
