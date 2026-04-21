package controller

import (
	"github.com/QuantumNous/new-api/common/tracing"

	"github.com/gin-gonic/gin"
)

// TraceEvent aliased to the shared tracing.Event so the JSON shape written
// to log.other stays backward compatible.
type TraceEvent = tracing.Event

func addTraceEvent(c *gin.Context, phase string, message string, detail map[string]interface{}) {
	tracing.Add(c, phase, message, detail)
}

func getTraceEvents(c *gin.Context) []tracing.Event {
	return tracing.Get(c)
}
