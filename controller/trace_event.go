package controller

import (
	"time"

	"github.com/gin-gonic/gin"
)

// TraceEvent records a single decision/action during request processing.
type TraceEvent struct {
	Time    int64                  `json:"time"`    // unix milliseconds
	Phase   string                 `json:"phase"`   // e.g. "validate", "sensitive_check", "token_estimate", "pricing", "pre_billing", "channel_select", "upstream", "post_billing", "refund"
	Message string                 `json:"message"` // human-readable summary
	Detail  map[string]interface{} `json:"detail,omitempty"`
}

const traceEventsKey = "trace_events"

func addTraceEvent(c *gin.Context, phase string, message string, detail map[string]interface{}) {
	val, exists := c.Get(traceEventsKey)
	var events []TraceEvent
	if exists {
		events, _ = val.([]TraceEvent)
	}
	events = append(events, TraceEvent{
		Time:    time.Now().UnixMilli(),
		Phase:   phase,
		Message: message,
		Detail:  detail,
	})
	c.Set(traceEventsKey, events)
}

func getTraceEvents(c *gin.Context) []TraceEvent {
	val, exists := c.Get(traceEventsKey)
	if !exists {
		return nil
	}
	events, _ := val.([]TraceEvent)
	return events
}
