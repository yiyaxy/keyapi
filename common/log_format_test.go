package common

import (
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common/trace"
)

func TestFmtLogTime(t *testing.T) {
	ts := time.Date(2026, 4, 20, 15, 13, 9, 123_000_000, time.UTC)
	got := FmtLogTime(ts)
	want := "2026/04/20 15:13:09.123"
	if got != want {
		t.Fatalf("FmtLogTime(%v) = %q, want %q", ts, got, want)
	}
}

func TestFmtTrace_Unset(t *testing.T) {
	trace.Clear()
	got := FmtTrace()
	if len(got) != TraceColumnWidth {
		t.Fatalf("FmtTrace() unset len = %d, want %d", len(got), TraceColumnWidth)
	}
	if !strings.HasPrefix(got, "-") {
		t.Fatalf("FmtTrace() unset = %q, want to start with '-'", got)
	}
	if strings.TrimRight(got, " ") != "-" {
		t.Fatalf("FmtTrace() unset = %q, want %q right-padded to %d", got, "-", TraceColumnWidth)
	}
}

func TestFmtTrace_Set(t *testing.T) {
	trace.Set("HTTP-abcdef0123456789")
	defer trace.Clear()
	got := FmtTrace()
	if len(got) != TraceColumnWidth {
		t.Fatalf("FmtTrace() set len = %d, want %d", len(got), TraceColumnWidth)
	}
	if !strings.HasPrefix(got, "HTTP-abcdef0123456789") {
		t.Fatalf("FmtTrace() = %q, want to start with the id", got)
	}
}

func TestTraceColumnWidth_IsThirty(t *testing.T) {
	if TraceColumnWidth != 30 {
		t.Fatalf("TraceColumnWidth = %d, want 30", TraceColumnWidth)
	}
}

func logCallerFromTestHelper() string {
	return LogCaller()
}

func TestLogCaller_ReturnsSourceLocation(t *testing.T) {
	got := logCallerFromTestHelper()
	if !strings.Contains(got, "common/") || !strings.Contains(got, ".go:") {
		t.Fatalf("LogCaller() = %q, want common/<file>.go:<line>", got)
	}
}
