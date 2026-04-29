package gemini

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/relay/channel"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/setting/model_setting"
)

func (a *Adaptor) BuildImageHTTPRequest(ctx context.Context, info *relaycommon.RelayInfo, request dto.ImageRequest) (*http.Request, error) {
	if info.UpstreamModelName != "" {
		request.Model = info.UpstreamModelName
	}
	convertedRequest, err := a.ConvertImageRequest(nil, info, request)
	if err != nil {
		return nil, err
	}
	requestBody, err := channel.MarshalImageRequestBody(info, convertedRequest)
	if err != nil {
		return nil, err
	}
	fullRequestURL, err := a.GetRequestURL(info)
	if err != nil {
		return nil, err
	}
	req, err := channel.NewJSONImageRequest(ctx, http.MethodPost, fullRequestURL, requestBody)
	if err != nil {
		return nil, err
	}
	req.Header.Set("x-goog-api-key", info.ApiKey)
	return req, nil
}

func (a *Adaptor) ExtractImageResponse(resp *http.Response, info *relaycommon.RelayInfo) (*dto.ImageResponse, *dto.Usage, error) {
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, nil, err
	}
	if strings.HasPrefix(info.UpstreamModelName, "imagen") {
		var geminiResponse dto.GeminiImageResponse
		if err := common.Unmarshal(responseBody, &geminiResponse); err != nil {
			return nil, nil, err
		}
		if len(geminiResponse.Predictions) == 0 {
			return nil, nil, errors.New("no images generated")
		}
		imageResp := &dto.ImageResponse{Created: common.GetTimestamp(), Data: make([]dto.ImageData, 0, len(geminiResponse.Predictions))}
		for _, prediction := range geminiResponse.Predictions {
			if prediction.RaiFilteredReason != "" {
				continue
			}
			imageResp.Data = append(imageResp.Data, dto.ImageData{B64Json: prediction.BytesBase64Encoded})
		}
		const imageTokens = 258
		total := imageTokens * len(imageResp.Data)
		return imageResp, &dto.Usage{PromptTokens: total, TotalTokens: total}, nil
	}
	if model_setting.IsGeminiModelSupportImagine(info.UpstreamModelName) {
		var geminiResponse dto.GeminiChatResponse
		if err := common.Unmarshal(responseBody, &geminiResponse); err != nil {
			return nil, nil, err
		}
		imageResp := &dto.ImageResponse{Created: common.GetTimestamp(), Data: make([]dto.ImageData, 0)}
		for _, candidate := range geminiResponse.Candidates {
			revisedPromptParts := make([]string, 0)
			for _, part := range candidate.Content.Parts {
				if part.Text != "" {
					revisedPromptParts = append(revisedPromptParts, part.Text)
					continue
				}
				if part.InlineData == nil || !strings.HasPrefix(part.InlineData.MimeType, "image") {
					continue
				}
				imageResp.Data = append(imageResp.Data, dto.ImageData{
					B64Json:       part.InlineData.Data,
					RevisedPrompt: strings.Join(revisedPromptParts, "\n"),
				})
			}
		}
		if len(imageResp.Data) == 0 {
			return nil, nil, errors.New("no images generated")
		}
		usage := &dto.Usage{
			PromptTokens:     geminiResponse.UsageMetadata.PromptTokenCount,
			CompletionTokens: geminiResponse.UsageMetadata.CandidatesTokenCount,
			TotalTokens:      geminiResponse.UsageMetadata.TotalTokenCount,
		}
		return imageResp, usage, nil
	}

	var raw dto.ImageResponse
	if err := json.Unmarshal(responseBody, &raw); err != nil {
		return nil, nil, errors.New("unsupported gemini image response")
	}
	return &raw, &dto.Usage{}, nil
}
