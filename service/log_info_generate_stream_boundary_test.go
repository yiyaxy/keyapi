package service

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/gin-gonic/gin"
)

func TestGenerateTextOtherInfoAddsStreamBoundaryAdminInfo(t *testing.T) {
	gin.SetMode(gin.TestMode)
	withOptionMapForChannelStabilityTest(t, map[string]string{
		ChannelStabilityStreamBoundaryEnabledKey: "true",
	})

	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)

	start := time.Now().Add(-1500 * time.Millisecond)
	info := &relaycommon.RelayInfo{
		IsStream:              true,
		StartTime:             start,
		FirstTokenTimeout:     10 * time.Second,
		FirstResponseTime:     start.Add(time.Second),
		SendResponseCount:     1,
		OriginModelName:       "gpt-4o",
		ChannelMeta:           &relaycommon.ChannelMeta{},
		PriceMarkupSource:     "none",
		PriceMarkupRatio:      1,
		FinalPreConsumedQuota: 1,
	}

	other := GenerateTextOtherInfo(ctx, info, 1, 1, 1, 0, 0, 0, 1)
	adminInfo, ok := other["admin_info"].(map[string]interface{})
	if !ok {
		t.Fatalf("admin_info missing from %#v", other)
	}
	if got := adminInfo["stream_stage"]; got != int(relaycommon.StreamStageTokenReceived) {
		t.Fatalf("stream_stage = %v, want token-received", got)
	}
	if got := adminInfo["first_token_timeout_ms"]; got != int64(10000) {
		t.Fatalf("first_token_timeout_ms = %v, want 10000", got)
	}
	if got := adminInfo["cross_channel_switch_after_token"]; got != false {
		t.Fatalf("cross_channel_switch_after_token = %v, want false", got)
	}
}
