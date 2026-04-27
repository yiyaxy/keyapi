package common

import (
	"testing"

	"github.com/QuantumNous/new-api/constant"
)

func TestIsImageGenerationModelRecognizesGptImageFamily(t *testing.T) {
	for _, modelName := range []string{
		"gpt-image-1",
		"gpt-image-2",
		"GPT-IMAGE-2",
		"openai/gpt-image-2",
		"gemini-3.1-flash-image-preview",
		"gemini-3-pro-image-preview",
	} {
		if !IsImageGenerationModel(modelName) {
			t.Fatalf("expected %q to be treated as an image generation model", modelName)
		}
	}
}

func TestGetEndpointTypesByChannelTypePrioritizesGptImageFamily(t *testing.T) {
	endpoints := GetEndpointTypesByChannelType(constant.ChannelTypeOpenAI, "gpt-image-2")
	if len(endpoints) == 0 || endpoints[0] != constant.EndpointTypeImageGeneration {
		t.Fatalf("expected image-generation to be first endpoint for gpt-image-2, got %#v", endpoints)
	}
}

func TestGetEndpointTypesByChannelTypePrioritizesGeminiImagePreview(t *testing.T) {
	endpoints := GetEndpointTypesByChannelType(constant.ChannelTypeGemini, "gemini-3-pro-image-preview")
	if len(endpoints) == 0 || endpoints[0] != constant.EndpointTypeImageGeneration {
		t.Fatalf("expected image-generation to be first endpoint for gemini image preview, got %#v", endpoints)
	}
}
