package logger

import (
	"bytes"
	"context"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/common/trace"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
)

func setupLogCapture(t *testing.T) (out, errBuf *bytes.Buffer, restore func()) {
	t.Helper()
	common.LogWriterMu.Lock()
	origOut := gin.DefaultWriter
	origErr := gin.DefaultErrorWriter
	out = &bytes.Buffer{}
	errBuf = &bytes.Buffer{}
	gin.DefaultWriter = out
	gin.DefaultErrorWriter = errBuf
	common.LogWriterMu.Unlock()

	return out, errBuf, func() {
		common.LogWriterMu.Lock()
		gin.DefaultWriter = origOut
		gin.DefaultErrorWriter = origErr
		common.LogWriterMu.Unlock()
	}
}

func TestLogError_NilContext_DoesNotPanic(t *testing.T) {
	_, errBuf, restore := setupLogCapture(t)
	defer restore()

	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("LogError(nil, ...) panicked: %v", r)
		}
	}()
	LogError(nil, "test-nil-ctx")

	got := errBuf.String()
	if !strings.Contains(got, "test-nil-ctx") {
		t.Fatalf("LogError output missing message, got %q", got)
	}
	if !strings.Contains(got, "-") {
		t.Fatalf("LogError output missing '-' trace placeholder, got %q", got)
	}
}

func TestLogInfo_CtxRequestId_AppearsInOutput(t *testing.T) {
	out, _, restore := setupLogCapture(t)
	defer restore()

	ctx := context.WithValue(context.Background(), common.RequestIdKey, "HTTP-ctx0000000000abcd")
	LogInfo(ctx, "test-ctx-id")

	got := out.String()
	if !strings.Contains(got, "HTTP-ctx0000000000abcd") {
		t.Fatalf("expected ctx RequestId in output, got %q", got)
	}
	if !strings.Contains(got, "test-ctx-id") {
		t.Fatalf("expected message in output, got %q", got)
	}
}

func TestLogInfo_FallbackToGoroutineLocalTrace(t *testing.T) {
	out, _, restore := setupLogCapture(t)
	defer restore()

	trace.Set("JOB-test-000000000000aabb")
	defer trace.Clear()

	LogInfo(context.Background(), "test-goroutine-local")

	got := out.String()
	if !strings.Contains(got, "JOB-test-000000000000aabb") {
		t.Fatalf("expected goroutine-local trace in output, got %q", got)
	}
}

func TestFormatTopupDisplayAmount_CNYUsesAmountUnits(t *testing.T) {
	gs := operation_setting.GetGeneralSetting()
	origDisplay := gs.QuotaDisplayType
	t.Cleanup(func() {
		gs.QuotaDisplayType = origDisplay
	})

	gs.QuotaDisplayType = operation_setting.QuotaDisplayTypeCNY
	got := FormatTopupDisplayAmount(1, 68493)
	if got != "1.00 元" {
		t.Fatalf("FormatTopupDisplayAmount(1, 68493) = %q, want %q", got, "1.00 元")
	}
}

func TestFormatTopupDisplayAmount_TokensPrefersRawQuota(t *testing.T) {
	gs := operation_setting.GetGeneralSetting()
	origDisplay := gs.QuotaDisplayType
	t.Cleanup(func() {
		gs.QuotaDisplayType = origDisplay
	})

	gs.QuotaDisplayType = operation_setting.QuotaDisplayTypeTokens
	got := FormatTopupDisplayAmount(1, 500000)
	if got != "500000" {
		t.Fatalf("FormatTopupDisplayAmount(1, 500000) = %q, want %q", got, "500000")
	}
}
