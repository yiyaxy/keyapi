package relay

import (
	"testing"

	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestNormalizeImageGenerationUsageSynthesizesImageTokens(t *testing.T) {
	info := &relaycommon.RelayInfo{}
	info.SetEstimatePromptTokens(9)
	req := &dto.ImageRequest{
		Model:   "gpt-image-2",
		Prompt:  "a cat",
		Size:    "1024x1024",
		Quality: "standard",
	}
	usage := &dto.Usage{}

	normalizeImageGenerationUsage(usage, info, req)

	require.Equal(t, 1593, usage.PromptTokens)
	require.Equal(t, 1593, usage.TotalTokens)
	require.Equal(t, 1584, usage.PromptTokensDetails.ImageTokens)
}

func TestNormalizeImageGenerationUsageCopiesTotalTokensWhenOnlyTotalExists(t *testing.T) {
	usage := &dto.Usage{TotalTokens: 42}

	normalizeImageGenerationUsage(usage, nil, nil)

	require.Equal(t, 42, usage.PromptTokens)
	require.Equal(t, 42, usage.TotalTokens)
}

func TestApplyImagePerCallBillingIfNeededUsesTaskPricePatch(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(nil)
	oldPatches := constant.TaskPricePatches
	constant.TaskPricePatches = []string{"dall-e-3"}
	defer func() {
		constant.TaskPricePatches = oldPatches
	}()

	info := &relaycommon.RelayInfo{
		OriginModelName: "dall-e-3",
		PriceData:       relaycommonPriceDataForTokenBilling(),
	}

	apiErr := applyImagePerCallBillingIfNeeded(ctx, info)

	require.Nil(t, apiErr)
	require.True(t, info.PriceData.UsePrice)
	require.Equal(t, 0.04, info.PriceData.ModelPrice)
	require.Greater(t, info.PriceData.Quota, 0)
}

func TestApplyImagePerCallBillingIfNeededConvertsRatioFallbackToFixedPrice(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ratio_setting.InitRatioSettings()
	ctx, _ := gin.CreateTestContext(nil)
	oldPatches := constant.TaskPricePatches
	constant.TaskPricePatches = []string{"gpt-image-1"}
	defer func() {
		constant.TaskPricePatches = oldPatches
	}()

	info := &relaycommon.RelayInfo{
		OriginModelName: "gpt-image-1",
		PriceData:       relaycommonPriceDataForTokenBilling(),
	}

	apiErr := applyImagePerCallBillingIfNeeded(ctx, info)

	require.Nil(t, apiErr)
	require.True(t, info.PriceData.UsePrice)
	require.Equal(t, info.PriceData.ModelRatio/2, info.PriceData.ModelPrice)
	require.Greater(t, info.PriceData.Quota, 0)
}

func relaycommonPriceDataForTokenBilling() types.PriceData {
	return types.PriceData{
		ModelPrice: -1,
		ModelRatio: 2.5,
		GroupRatioInfo: types.GroupRatioInfo{
			GroupRatio: 1,
		},
	}
}
