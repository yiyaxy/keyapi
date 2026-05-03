package relay

import (
	"encoding/json"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
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
	}, 0, "gpt-image-2", "cat")

	require.NoError(t, err)
	require.Equal(t, "https://example.com/cat.png", result.URL)
	require.Equal(t, "task_123", result.TaskID)
}
