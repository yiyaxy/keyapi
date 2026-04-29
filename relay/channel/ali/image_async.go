package ali

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/relay/channel"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
)

func (a *Adaptor) BuildImageHTTPRequest(ctx context.Context, info *relaycommon.RelayInfo, request dto.ImageRequest) (*http.Request, error) {
	if info.UpstreamModelName != "" {
		request.Model = info.UpstreamModelName
	}
	if isSyncImageModel(info.OriginModelName) {
		a.IsSyncImageModel = true
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
	req.Header.Set("Authorization", "Bearer "+info.ApiKey)
	if info.RelayMode == relayconstant.RelayModeImagesGenerations && !a.IsSyncImageModel {
		req.Header.Set("X-DashScope-Async", "enable")
	}
	return req, nil
}

func (a *Adaptor) ExtractImageResponse(resp *http.Response, info *relaycommon.RelayInfo) (*dto.ImageResponse, *dto.Usage, error) {
	responseFormat := ""
	if req, ok := info.Request.(*dto.ImageRequest); ok && req != nil {
		responseFormat = req.ResponseFormat
	}
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, nil, err
	}
	var aliTaskResponse AliResponse
	if err := common.Unmarshal(responseBody, &aliTaskResponse); err != nil {
		return nil, nil, err
	}
	if aliTaskResponse.Message != "" {
		return nil, nil, fmt.Errorf("%s", aliTaskResponse.Message)
	}

	aliResponse := &aliTaskResponse
	originRespBody := responseBody
	if !a.IsSyncImageModel {
		aliResponse, originRespBody, err = asyncTaskWaitDetached(context.Background(), info, aliTaskResponse.Output.TaskId)
		if err != nil {
			return nil, nil, err
		}
		if aliResponse.Output.TaskStatus != "SUCCEEDED" {
			return nil, nil, fmt.Errorf("ali image task failed: %s", aliResponse.Output.Message)
		}
	}
	imageResponse := responseAli2OpenAIImage(nil, aliResponse, originRespBody, info, responseFormat)
	if len(imageResponse.Data) == 0 {
		return nil, nil, fmt.Errorf("no images generated")
	}
	usage := &dto.Usage{}
	return imageResponse, usage, nil
}

func asyncTaskWaitDetached(ctx context.Context, info *relaycommon.RelayInfo, taskID string) (*AliResponse, []byte, error) {
	waitSeconds := 10
	maxStep := 20
	var responseBody []byte

	timer := time.NewTimer(5 * time.Second)
	select {
	case <-ctx.Done():
		timer.Stop()
		return nil, nil, ctx.Err()
	case <-timer.C:
	}

	for step := 0; step < maxStep; step++ {
		rsp, err, body := updateTask(info, taskID)
		responseBody = body
		if err != nil {
			logger.LogWarn(ctx, "asyncTaskWait UpdateTask err: "+err.Error())
		} else if rsp.Output.TaskStatus == "" ||
			rsp.Output.TaskStatus == "FAILED" ||
			rsp.Output.TaskStatus == "CANCELED" ||
			rsp.Output.TaskStatus == "SUCCEEDED" ||
			rsp.Output.TaskStatus == "UNKNOWN" {
			return rsp, responseBody, nil
		}

		timer = time.NewTimer(time.Duration(waitSeconds) * time.Second)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil, nil, ctx.Err()
		case <-timer.C:
		}
	}
	return nil, responseBody, fmt.Errorf("aliAsyncTaskWait timeout")
}
