package gemini

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"

	"github.com/gin-gonic/gin"
)

func TestConvertImageRequestSupportsGeminiImagePreviewModels(t *testing.T) {
	n := uint(2)
	info := &relaycommon.RelayInfo{
		ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "gemini-3.1-flash-image-preview"},
	}
	converted, err := (&Adaptor{}).ConvertImageRequest(nil, info, dto.ImageRequest{
		Prompt:  "a studio product photo",
		N:       &n,
		Size:    "1792x1024",
		Quality: "hd",
	})
	if err != nil {
		t.Fatalf("ConvertImageRequest returned error: %v", err)
	}

	geminiRequest, ok := converted.(dto.GeminiChatRequest)
	if !ok {
		t.Fatalf("expected dto.GeminiChatRequest, got %T", converted)
	}
	if len(geminiRequest.GenerationConfig.ResponseModalities) != 2 ||
		geminiRequest.GenerationConfig.ResponseModalities[1] != "IMAGE" {
		t.Fatalf("expected image response modalities, got %#v", geminiRequest.GenerationConfig.ResponseModalities)
	}
	if geminiRequest.GenerationConfig.CandidateCount == nil || *geminiRequest.GenerationConfig.CandidateCount != 2 {
		t.Fatalf("expected candidate count 2, got %#v", geminiRequest.GenerationConfig.CandidateCount)
	}

	var imageConfig map[string]string
	if err := json.Unmarshal(geminiRequest.GenerationConfig.ImageConfig, &imageConfig); err != nil {
		t.Fatalf("failed to unmarshal image config: %v", err)
	}
	if imageConfig["aspectRatio"] != "16:9" || imageConfig["imageSize"] != "2K" {
		t.Fatalf("unexpected image config: %#v", imageConfig)
	}
}

func TestGeminiGenerateContentImageHandlerReturnsOpenAIImageResponse(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	resp := &http.Response{
		StatusCode: http.StatusOK,
		Body: io.NopCloser(strings.NewReader(`{
			"candidates": [{
				"content": {
					"parts": [
						{"text": "revised prompt"},
						{"inlineData": {"mimeType": "image/png", "data": "aW1hZ2U="}}
					]
				}
			}],
			"usageMetadata": {
				"promptTokenCount": 11,
				"candidatesTokenCount": 22,
				"totalTokenCount": 33
			}
		}`)),
	}

	usage, apiErr := GeminiGenerateContentImageHandler(c, &relaycommon.RelayInfo{}, resp)
	if apiErr != nil {
		t.Fatalf("GeminiGenerateContentImageHandler returned error: %v", apiErr)
	}
	if usage == nil || usage.TotalTokens != 33 {
		t.Fatalf("unexpected usage: %#v", usage)
	}

	var imageResponse dto.ImageResponse
	if err := json.Unmarshal(w.Body.Bytes(), &imageResponse); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}
	if len(imageResponse.Data) != 1 || imageResponse.Data[0].B64Json != "aW1hZ2U=" {
		t.Fatalf("unexpected image response: %#v", imageResponse)
	}
	if imageResponse.Data[0].RevisedPrompt != "revised prompt" {
		t.Fatalf("unexpected revised prompt: %q", imageResponse.Data[0].RevisedPrompt)
	}
}
