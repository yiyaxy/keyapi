package controller

import (
	"errors"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
)

func TestBuildRelayErrorLogMessageIncludesDiagnostics(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "/v1/chat/completions", nil)
	c.Set("original_model", "gpt-4o")
	c.Set("group", "default")
	c.Set("channel_id", 15)
	c.Set("channel_name", "primary")
	c.Set("channel_type", 1)
	common.SetContextKey(c, constant.ContextKeyChannelBaseUrl, "https://api.openai.com")
	addRetryError(c, RetryError{
		ChannelId:          12,
		ChannelName:        "backup",
		StatusCode:         429,
		Message:            "rate limited",
		UpstreamRequestIds: map[string]string{"x-request-id": "up-123"},
	})
	addRetryError(c, RetryError{
		ChannelId:          15,
		ChannelName:        "primary",
		StatusCode:         429,
		Message:            "quota exceeded",
		UpstreamRequestIds: map[string]string{"x-request-id": "up-456"},
	})

	err := types.NewErrorWithStatusCode(errors.New("quota exceeded"), types.ErrorCodeBadResponseStatusCode, 429)
	err.UpstreamStatusCode = 429

	got := buildRelayErrorLogMessage(c, err)
	for _, want := range []string{
		"request=POST /v1/chat/completions",
		"model=gpt-4o",
		"group=default",
		"channel=#15(primary,type=1)",
		"channel_chain=12->15",
		"base_url=https://api.openai.com",
		"error_code=bad_response_status_code",
		"message=quota exceeded",
		"upstream_request_ids=x-request-id=up-456",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("buildRelayErrorLogMessage() missing %q in %q", want, got)
		}
	}
}

func TestAppendErrorDiagnosticInfoIncludesRetryContext(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("GET", "/v1/models", nil)
	c.Set("use_channel", []string{"9", "10"})
	common.SetContextKey(c, constant.ContextKeyChannelBaseUrl, "https://example.com")
	addRetryError(c, RetryError{
		ChannelId:          10,
		ChannelName:        "fallback",
		StatusCode:         503,
		Message:            "upstream unavailable",
		UpstreamRequestIds: map[string]string{"request-id": "abc"},
	})

	other := map[string]interface{}{}
	adminInfo := map[string]interface{}{}
	appendErrorDiagnosticInfo(c, other, adminInfo)

	if got := other["request_method"]; got != "GET" {
		t.Fatalf("request_method = %v, want GET", got)
	}
	if got := other["request_path"]; got != "/v1/models" {
		t.Fatalf("request_path = %v, want /v1/models", got)
	}
	if got := adminInfo["channel_chain"]; got != "10" {
		t.Fatalf("channel_chain = %v, want 10", got)
	}
	if got := adminInfo["retry_count"]; got != 1 {
		t.Fatalf("retry_count = %v, want 1", got)
	}
	if got := adminInfo["channel_base_url"]; got != "https://example.com" {
		t.Fatalf("channel_base_url = %v, want https://example.com", got)
	}
	if _, ok := adminInfo["upstream_request_ids"]; !ok {
		t.Fatalf("expected upstream_request_ids in admin info, got %v", adminInfo)
	}
}
