package relay

import (
	"encoding/json"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayimagegen "github.com/QuantumNous/new-api/relay/imagegen"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestCalculateImageToolFinalQuotaUsesSyntheticImageUsage(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(nil)
	info := &relaycommon.RelayInfo{
		OriginModelName: "gpt-image-1",
		PriceData: types.PriceData{
			ModelRatio:      1,
			ImageRatio:      1,
			GroupRatioInfo:  types.GroupRatioInfo{GroupRatio: 1},
			OtherRatios:     map[string]float64{"n": 2},
			CompletionRatio: 1,
		},
	}
	info.SetEstimatePromptTokens(10)
	req := &dto.ImageRequest{Model: "gpt-image-1", Prompt: "cat"}

	usage := imageToolUsage(info, req)
	got := calculateImageToolFinalQuota(ctx, info, usage)

	require.Equal(t, 1594, usage.PromptTokens)
	require.Equal(t, 1584, usage.PromptTokensDetails.ImageTokens)
	require.Equal(t, 3188, got)
}

func TestCalculateImageToolFinalQuotaPerCallDoesNotDoubleApplyMarkup(t *testing.T) {
	oldPatches := constant.TaskPricePatches
	constant.TaskPricePatches = []string{"dall-e-3"}
	t.Cleanup(func() {
		constant.TaskPricePatches = oldPatches
	})

	info := &relaycommon.RelayInfo{
		OriginModelName: "dall-e-3",
		PriceData: types.PriceData{
			UsePrice:       true,
			ModelPrice:     1 / common.QuotaPerUnit,
			Quota:          2,
			GroupRatioInfo: types.GroupRatioInfo{GroupRatio: 1},
			OtherRatios: map[string]float64{
				"platform_markup": 2,
				"channel_ratio":   3,
			},
		},
	}

	got := calculateImageToolFinalQuota(nil, info, &dto.Usage{PromptTokens: 1, TotalTokens: 1})

	require.Equal(t, 6, got)
}

func TestImageToolResultFromResponseRejectsEmptyImageData(t *testing.T) {
	_, err := imageToolResultFromResponse(&dto.ImageResponse{
		Data: []dto.ImageData{{}},
	}, "gpt-image-2", "cat")

	require.Error(t, err)
	require.Contains(t, err.Error(), "no displayable image data")
}

func TestImageToolResultFromTaskFallsBackToResultURLAfterEmptyImageData(t *testing.T) {
	imageData, err := json.Marshal([]dto.ImageData{{}})
	require.NoError(t, err)

	result, err := imageToolResultFromTask(&model.Task{
		TaskID: "task_123",
		PrivateData: model.TaskPrivateData{
			ImageData: imageData,
			ResultURL: "https://example.com/cat.png",
		},
	}, 0, "gpt-image-2", "cat", "", 0)

	require.NoError(t, err)
	require.Equal(t, "https://example.com/cat.png", result.URL)
	require.Equal(t, "task_123", result.TaskID)
}

func TestImageToolTaskURLUsesServerAddress(t *testing.T) {
	prev := system_setting.ServerAddress
	system_setting.ServerAddress = "https://api.example.com/"
	t.Cleanup(func() {
		system_setting.ServerAddress = prev
	})

	taskURL := imageToolTaskURLAt(nil, "task_123", 0, time.Unix(1000, 0))
	parsed, err := url.Parse(taskURL)
	require.NoError(t, err)
	require.Equal(t, "https", parsed.Scheme)
	require.Equal(t, "api.example.com", parsed.Host)
	require.Equal(t, "/public/images/async/task_123", parsed.Path)
	require.NoError(t, relayimagegen.ValidatePublicTaskLink("task_123", parsed.Query().Get("expires"), parsed.Query().Get("sig"), time.Unix(1000, 0)))
}

func TestImageToolTaskURLUsesTenantSlugFromTokenTenant(t *testing.T) {
	withImageToolTenantDB(t, model.Tenant{Id: 42, Name: "Acme", Slug: "acme", Status: model.TenantStatusActive})
	prev := system_setting.ServerAddress
	system_setting.ServerAddress = "https://token.cymoon.cn/"
	t.Cleanup(func() {
		system_setting.ServerAddress = prev
	})

	taskURL := imageToolTaskURLAt(nil, "task_123", 42, time.Unix(1000, 0))
	parsed, err := url.Parse(taskURL)
	require.NoError(t, err)
	require.Equal(t, "acme.cymoon.cn", parsed.Host)
	require.Equal(t, "/public/images/async/task_123", parsed.Path)
	require.NoError(t, relayimagegen.ValidatePublicTaskLink("task_123", parsed.Query().Get("expires"), parsed.Query().Get("sig"), time.Unix(1000, 0)))
}

func TestImageToolTaskURLFallsBackToRequestHost(t *testing.T) {
	prev := system_setting.ServerAddress
	system_setting.ServerAddress = ""
	t.Cleanup(func() {
		system_setting.ServerAddress = prev
	})
	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(nil)
	ctx.Request = httptest.NewRequest("POST", "http://local.test/v1/chat/completions", nil)
	ctx.Request.Host = "local.test"
	ctx.Request.Header.Set("X-Forwarded-Proto", "https")

	taskURL := imageToolTaskURLAt(ctx, "task_abc", 0, time.Unix(1000, 0))
	parsed, err := url.Parse(taskURL)
	require.NoError(t, err)
	require.Equal(t, "https", parsed.Scheme)
	require.Equal(t, "local.test", parsed.Host)
	require.Equal(t, "/public/images/async/task_abc", parsed.Path)
	require.NoError(t, relayimagegen.ValidatePublicTaskLink("task_abc", parsed.Query().Get("expires"), parsed.Query().Get("sig"), time.Unix(1000, 0)))
}

func TestSendImageToolSubmittedStreamMessageWritesOpenAIChunk(t *testing.T) {
	prev := system_setting.ServerAddress
	system_setting.ServerAddress = "https://api.example.com"
	t.Cleanup(func() {
		system_setting.ServerAddress = prev
	})
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(w)
	ctx.Request = httptest.NewRequest("POST", "http://local.test/v1/chat/completions", nil)
	info := &relaycommon.RelayInfo{
		IsStream:        true,
		RelayFormat:     types.RelayFormatOpenAI,
		OriginModelName: "chat-model",
	}

	sendImageToolSubmittedStreamMessage(ctx, info, "task_123")

	body := w.Body.String()
	require.Contains(t, body, "你的图片生成任务已提交")
	require.Contains(t, body, "https://api.example.com/public/images/async/task_123")
	require.True(t, ctx.GetBool(relayimagegen.StatusSentContextKey))
	require.Equal(t, 1, info.SendResponseCount)
}

func withImageToolTenantDB(t *testing.T, tenants ...model.Tenant) {
	t.Helper()
	prevDB := model.DB
	model.ClearTenantCache()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.Tenant{}))
	for i := range tenants {
		require.NoError(t, db.Create(&tenants[i]).Error)
	}
	model.DB = db
	t.Cleanup(func() {
		model.DB = prevDB
		model.ClearTenantCache()
	})
}
