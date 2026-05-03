package common

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

const (
	RequestJSONLEnabledOption = "RequestJSONLEnabled"
	RequestJSONLDirOption     = "RequestJSONLDir"
)

const requestJSONLStringLimit = 20000

var (
	requestJSONLFileMu  sync.Mutex
	requestJSONLNameRe  = regexp.MustCompile(`[^A-Za-z0-9._-]+`)
	requestJSONLTrueSet = map[string]bool{"1": true, "true": true, "yes": true, "on": true}
)

type requestJSONLEvent struct {
	Time      string `json:"time"`
	Timestamp int64  `json:"timestamp"`
	RequestID string `json:"request_id"`
	Stage     string `json:"stage"`
	Data      any    `json:"data,omitempty"`
}

// RequestJSONLRawJSON embeds valid JSON bytes as structured data in the JSONL
// event. Invalid JSON falls back to a string.
type RequestJSONLRawJSON []byte

func WriteRequestJSONL(c *gin.Context, stage string, data any) {
	if c == nil {
		return
	}
	requestID := c.GetString(RequestIdKey)
	WriteRequestJSONLByID(requestID, stage, data)
}

func WriteRequestJSONLByID(requestID string, stage string, data any) {
	if !RequestJSONLEnabled() {
		return
	}
	requestID = strings.TrimSpace(requestID)
	if requestID == "" || requestID == "-" {
		requestID = "request-" + strconv.FormatInt(time.Now().UnixNano(), 10)
	}
	stage = strings.TrimSpace(stage)
	if stage == "" {
		stage = "event"
	}
	now := time.Now()
	event := requestJSONLEvent{
		Time:      now.Format(time.RFC3339Nano),
		Timestamp: now.UnixMilli(),
		RequestID: requestID,
		Stage:     stage,
		Data:      sanitizeRequestJSONLValue(data, 0),
	}
	line, err := json.Marshal(event)
	if err != nil {
		SysError("request jsonl marshal failed: " + err.Error())
		return
	}
	path := requestJSONLPath(requestID)
	requestJSONLFileMu.Lock()
	defer requestJSONLFileMu.Unlock()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		SysError("request jsonl mkdir failed: " + err.Error())
		return
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		SysError("request jsonl open failed: " + err.Error())
		return
	}
	defer f.Close()
	if _, err := f.Write(append(line, '\n')); err != nil {
		SysError("request jsonl write failed: " + err.Error())
	}
}

func RequestJSONLEnabled() bool {
	if requestJSONLTrueSet[strings.ToLower(strings.TrimSpace(os.Getenv("REQUEST_JSONL_DEBUG")))] {
		return true
	}
	OptionMapRWMutex.RLock()
	value := ""
	if OptionMap != nil {
		value = OptionMap[RequestJSONLEnabledOption]
	}
	OptionMapRWMutex.RUnlock()
	enabled, _ := strconv.ParseBool(strings.TrimSpace(value))
	return enabled
}

func requestJSONLPath(requestID string) string {
	return filepath.Join(requestJSONLDir(), requestJSONLFileName(requestID)+".jsonl")
}

func requestJSONLDir() string {
	if dir := strings.TrimSpace(os.Getenv("REQUEST_JSONL_DIR")); dir != "" {
		return dir
	}
	OptionMapRWMutex.RLock()
	dir := ""
	if OptionMap != nil {
		dir = strings.TrimSpace(OptionMap[RequestJSONLDirOption])
	}
	OptionMapRWMutex.RUnlock()
	if dir != "" {
		return dir
	}
	if LogDir != nil && strings.TrimSpace(*LogDir) != "" {
		return filepath.Join(*LogDir, "request-jsonl")
	}
	return filepath.Join(".", "logs", "request-jsonl")
}

func requestJSONLFileName(requestID string) string {
	name := requestJSONLNameRe.ReplaceAllString(strings.TrimSpace(requestID), "_")
	name = strings.Trim(name, "._-")
	if name == "" {
		return "request"
	}
	if len(name) > 120 {
		return name[:120]
	}
	return name
}

func sanitizeRequestJSONLValue(value any, depth int) any {
	if depth > 8 {
		return fmt.Sprintf("%v", value)
	}
	switch v := value.(type) {
	case nil:
		return nil
	case RequestJSONLRawJSON:
		var parsed any
		if err := json.Unmarshal([]byte(v), &parsed); err == nil {
			return sanitizeRequestJSONLValue(parsed, depth+1)
		}
		return sanitizeRequestJSONLString(string(v))
	case []byte:
		return sanitizeRequestJSONLString(string(v))
	case string:
		return sanitizeRequestJSONLString(v)
	case bool, float64, float32, int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64:
		return v
	case map[string]any:
		out := make(map[string]any, len(v))
		for key, item := range v {
			out[key] = sanitizeRequestJSONLValue(item, depth+1)
		}
		return out
	case []any:
		out := make([]any, 0, len(v))
		for _, item := range v {
			out = append(out, sanitizeRequestJSONLValue(item, depth+1))
		}
		return out
	default:
		raw, err := json.Marshal(v)
		if err != nil {
			return fmt.Sprintf("%v", v)
		}
		var parsed any
		if err := json.Unmarshal(raw, &parsed); err != nil {
			return sanitizeRequestJSONLString(string(raw))
		}
		return sanitizeRequestJSONLValue(parsed, depth+1)
	}
}

func sanitizeRequestJSONLString(value string) string {
	if len(value) <= requestJSONLStringLimit {
		return value
	}
	return value[:requestJSONLStringLimit] + fmt.Sprintf("...(truncated %d bytes)", len(value)-requestJSONLStringLimit)
}
