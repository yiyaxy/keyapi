package relay

import (
	"testing"

	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
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
