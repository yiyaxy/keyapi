package common

import (
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/common/trace"
)

// TraceColumnWidth is the fixed width (in bytes/ASCII chars) of the TraceId
// column used in every log line. Shorter ids are left-aligned and padded.
const TraceColumnWidth = 30

// FmtLogTime returns a millisecond-precision log timestamp like
// "2026/04/20 15:13:09.123".
func FmtLogTime(t time.Time) string {
	return t.Format("2006/01/02 15:04:05.000")
}

// FmtTrace returns the current goroutine's TraceId left-aligned and padded
// to TraceColumnWidth. Returns "-<spaces>" when unset.
func FmtTrace() string {
	return fmt.Sprintf("%-*s", TraceColumnWidth, trace.Get())
}
