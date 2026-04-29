package jimeng

import (
	"context"
	"fmt"
	"io"
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/relay/channel"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/gin-gonic/gin"
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
	signCtx := &gin.Context{Request: &http.Request{Method: http.MethodPost}}
	if err := Sign(signCtx, req, info.ApiKey); err != nil {
		return nil, err
	}
	return req, nil
}

func (a *Adaptor) ExtractImageResponse(resp *http.Response, info *relaycommon.RelayInfo) (*dto.ImageResponse, *dto.Usage, error) {
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, nil, err
	}
	var jimengResponse ImageResponse
	if err := common.Unmarshal(responseBody, &jimengResponse); err != nil {
		return nil, nil, err
	}
	if jimengResponse.Code != 10000 {
		return nil, nil, fmt.Errorf("jimeng image error %d: %s", jimengResponse.Code, jimengResponse.Message)
	}
	imageResp := responseJimeng2OpenAIImage(nil, &jimengResponse, info)
	if len(imageResp.Data) == 0 {
		return nil, nil, fmt.Errorf("no images generated")
	}
	return imageResp, &dto.Usage{}, nil
}
