package channel

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
)

func MarshalImageRequestBody(info *relaycommon.RelayInfo, converted any) (io.Reader, error) {
	switch v := converted.(type) {
	case io.Reader:
		return v, nil
	default:
		jsonData, err := common.Marshal(v)
		if err != nil {
			return nil, err
		}
		if len(info.ParamOverride) > 0 {
			jsonData, err = relaycommon.ApplyParamOverrideWithRelayInfo(jsonData, info)
			if err != nil {
				return nil, err
			}
		}
		return bytes.NewReader(jsonData), nil
	}
}

func NewJSONImageRequest(ctx context.Context, method, url string, body io.Reader) (*http.Request, error) {
	if method == "" {
		method = http.MethodPost
	}
	req, err := http.NewRequestWithContext(ctx, method, url, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	return req, nil
}

func ExtractOpenAIImageResponse(resp *http.Response, info *relaycommon.RelayInfo) (*dto.ImageResponse, *dto.Usage, error) {
	if resp == nil || resp.Body == nil {
		return nil, nil, fmt.Errorf("empty upstream response")
	}
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, nil, err
	}
	var imageResp dto.ImageResponse
	if err := common.Unmarshal(responseBody, &imageResp); err != nil {
		return nil, nil, err
	}
	if imageResp.Created == 0 && info != nil && !info.StartTime.IsZero() {
		imageResp.Created = info.StartTime.Unix()
	}
	var usageResp dto.SimpleResponse
	_ = common.Unmarshal(responseBody, &usageResp)
	return &imageResp, &usageResp.Usage, nil
}
