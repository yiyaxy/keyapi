// Package chat_history exposes operator-facing config + helpers for the
// "view user conversation history" admin feature. Recording is OFF by default
// because it captures full request and response bodies, which:
//   - has obvious privacy implications (operator must opt in);
//   - bloats storage (chat bodies can be tens of KB each).
//
// Storage layout (object key in OSS / S3-compatible bucket):
//
//	chat-history/{user_id}/{yyyy-mm}/{request_id}.json.gz
//
// The {yyyy-mm} bucket lets operators apply OSS lifecycle policies (e.g.,
// transition older months to cold storage or expire after N months) without
// touching application code. {user_id} as the second segment makes per-user
// inspection a flat-prefix list operation, which is cheap on every S3-like
// backend.
package chat_history

import (
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
)

const (
	OptionRecordMessages = "chat_history.record_messages"

	objectKeyPrefix = "chat-history"
)

// RecordMessagesEnabled is the gate the recorder middleware checks. We treat
// any unparseable / missing value as OFF — defensive default so a config typo
// never silently starts capturing user prompts.
func RecordMessagesEnabled() bool {
	common.OptionMapRWMutex.RLock()
	value := ""
	if common.OptionMap != nil {
		value = common.OptionMap[OptionRecordMessages]
	}
	common.OptionMapRWMutex.RUnlock()
	enabled, err := strconv.ParseBool(strings.TrimSpace(value))
	if err != nil {
		return false
	}
	return enabled
}

// ObjectKey builds the canonical OSS key for one captured request. now is
// passed in (rather than read from time.Now inside) so the recorder can use a
// stable timestamp from the request log entry, keeping the key reproducible
// across re-uploads or audit recalculation.
func ObjectKey(userID int, requestID string, now time.Time) string {
	requestID = sanitizeRequestID(requestID)
	if requestID == "" {
		requestID = strconv.FormatInt(now.UnixNano(), 10)
	}
	month := now.UTC().Format("2006-01")
	return fmt.Sprintf("%s/%d/%s/%s.json.gz", objectKeyPrefix, userID, month, requestID)
}

// sanitizeRequestID strips characters that would either break a flat object key
// (slash) or produce ambiguous file names (dots collapsing into "..", spaces).
// We intentionally do not URL-encode — keys are written and read with the same
// helper, so any deterministic single-pass cleanup is fine.
func sanitizeRequestID(requestID string) string {
	requestID = strings.TrimSpace(requestID)
	out := strings.Builder{}
	out.Grow(len(requestID))
	for _, r := range requestID {
		switch {
		case r >= '0' && r <= '9',
			r >= 'a' && r <= 'z',
			r >= 'A' && r <= 'Z':
			out.WriteRune(r)
		case r == '-' || r == '_':
			out.WriteRune(r)
		default:
			// drop any other char (slash, dot, space, control...)
		}
	}
	return out.String()
}
