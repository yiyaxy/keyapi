package common

import (
	"fmt"
	"path/filepath"
	"runtime"
	"strings"
)

var logCallerSkipSuffixes = []string{
	filepath.ToSlash("common/sys_log.go"),
	filepath.ToSlash("logger/logger.go"),
}

// LogCaller returns a compact file:line origin for the first frame outside the
// shared logging helpers so log lines can be traced back to their source.
func LogCaller() string {
	pcs := make([]uintptr, 16)
	n := runtime.Callers(2, pcs)
	if n == 0 {
		return "-"
	}
	frames := runtime.CallersFrames(pcs[:n])
	for {
		frame, more := frames.Next()
		if frame.File != "" {
			file := filepath.ToSlash(frame.File)
			if !shouldSkipLogCallerFrame(file) {
				return formatLogCaller(file, frame.Line)
			}
		}
		if !more {
			break
		}
	}
	return "-"
}

func shouldSkipLogCallerFrame(file string) bool {
	for _, suffix := range logCallerSkipSuffixes {
		if strings.HasSuffix(file, suffix) {
			return true
		}
	}
	return false
}

func formatLogCaller(file string, line int) string {
	base := filepath.Base(file)
	dir := filepath.Base(filepath.Dir(file))
	if dir == "." || dir == "" || dir == string(filepath.Separator) {
		return fmt.Sprintf("%s:%d", base, line)
	}
	return fmt.Sprintf("%s/%s:%d", dir, base, line)
}
