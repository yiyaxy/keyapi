package apimart

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay/channel"
	taskcommon "github.com/QuantumNous/new-api/relay/channel/task/taskcommon"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/samber/lo"
)

type TaskAdaptor struct {
	taskcommon.BaseBilling
	baseURL string
	apiKey  string
	request dto.ImageRequest
}

type submitResponse struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    []struct {
		Status string `json:"status"`
		TaskID string `json:"task_id"`
	} `json:"data"`
}

func (a *TaskAdaptor) Init(info *relaycommon.RelayInfo) {
	a.baseURL = info.ChannelBaseUrl
	a.apiKey = info.ApiKey
}

func (a *TaskAdaptor) ValidateRequestAndSetAction(c *gin.Context, info *relaycommon.RelayInfo) *dto.TaskError {
	var req dto.ImageRequest
	if err := common.UnmarshalBodyReusable(c, &req); err != nil {
		return service.TaskErrorWrapperLocal(err, "invalid_request", http.StatusBadRequest)
	}
	if strings.TrimSpace(req.Model) == "" {
		return service.TaskErrorWrapperLocal(fmt.Errorf("field model is required"), "invalid_request", http.StatusBadRequest)
	}
	if strings.TrimSpace(req.Prompt) == "" {
		return service.TaskErrorWrapperLocal(fmt.Errorf("field prompt is required"), "invalid_request", http.StatusBadRequest)
	}
	a.request = req
	info.Request = &req
	info.Action = constant.TaskActionGenerate
	return nil
}

func (a *TaskAdaptor) EstimateBilling(c *gin.Context, info *relaycommon.RelayInfo) map[string]float64 {
	req := a.request
	n := float64(lo.FromPtrOr(req.N, uint(1)))
	sizeRatio := 1.0
	switch req.Size {
	case "1024x1792", "1792x1024":
		sizeRatio = 2
	case "512x512":
		sizeRatio = 0.5
	case "256x256":
		sizeRatio = 0.25
	}
	return map[string]float64{"n": n, "size": sizeRatio}
}

func (a *TaskAdaptor) BuildRequestURL(info *relaycommon.RelayInfo) (string, error) {
	return fmt.Sprintf("%s/v1/images/generations", strings.TrimRight(a.baseURL, "/")), nil
}

func (a *TaskAdaptor) BuildRequestHeader(c *gin.Context, req *http.Request, info *relaycommon.RelayInfo) error {
	req.Header.Set("Authorization", "Bearer "+a.apiKey)
	req.Header.Set("Content-Type", "application/json")
	return nil
}

func (a *TaskAdaptor) BuildRequestBody(c *gin.Context, info *relaycommon.RelayInfo) (io.Reader, error) {
	req := a.request
	if info.UpstreamModelName != "" {
		req.Model = info.UpstreamModelName
	}
	body, err := common.Marshal(req)
	if err != nil {
		return nil, err
	}
	return bytes.NewReader(body), nil
}

func (a *TaskAdaptor) DoRequest(c *gin.Context, info *relaycommon.RelayInfo, requestBody io.Reader) (*http.Response, error) {
	return channel.DoTaskApiRequest(a, c, info, requestBody)
}

func (a *TaskAdaptor) DoResponse(c *gin.Context, resp *http.Response, info *relaycommon.RelayInfo) (taskID string, taskData []byte, taskErr *dto.TaskError) {
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", nil, service.TaskErrorWrapper(err, "read_response_body_failed", http.StatusInternalServerError)
	}
	_ = resp.Body.Close()
	var parsed submitResponse
	if err := common.Unmarshal(responseBody, &parsed); err != nil {
		return "", nil, service.TaskErrorWrapper(err, "unmarshal_response_body_failed", http.StatusInternalServerError)
	}
	if parsed.Code != 0 && parsed.Code != http.StatusOK {
		msg := parsed.Message
		if msg == "" {
			msg = "apimart submit failed"
		}
		return "", nil, service.TaskErrorWrapperLocal(fmt.Errorf("%s", msg), "upstream_error", http.StatusBadGateway)
	}
	if len(parsed.Data) == 0 || strings.TrimSpace(parsed.Data[0].TaskID) == "" {
		return "", nil, service.TaskErrorWrapperLocal(fmt.Errorf("task_id is empty"), "invalid_response", http.StatusInternalServerError)
	}
	taskcommon.WriteImageAsyncSubmitResponse(c, info)
	return parsed.Data[0].TaskID, responseBody, nil
}

func (a *TaskAdaptor) FetchTask(baseURL, key string, body map[string]any, proxy string) (*http.Response, error) {
	taskID, _ := body["task_id"].(string)
	if taskID == "" {
		return nil, fmt.Errorf("invalid task_id")
	}
	req, err := http.NewRequest(http.MethodGet, fmt.Sprintf("%s/v1/tasks/%s?language=zh", strings.TrimRight(baseURL, "/"), taskID), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+key)
	client, err := service.GetHttpClientWithProxy(proxy)
	if err != nil {
		return nil, err
	}
	return client.Do(req)
}

func (a *TaskAdaptor) ParseTaskResult(respBody []byte) (*relaycommon.TaskInfo, error) {
	var raw struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
		Data    struct {
			Status   string `json:"status"`
			Progress any    `json:"progress"`
			Error    string `json:"error"`
			Result   struct {
				Images []struct {
					URL       any `json:"url"`
					ExpiresAt any `json:"expires_at"`
				} `json:"images"`
			} `json:"result"`
		} `json:"data"`
	}
	if err := common.Unmarshal(respBody, &raw); err != nil {
		return nil, err
	}
	info := &relaycommon.TaskInfo{}
	switch strings.ToLower(raw.Data.Status) {
	case "submitted", "queued":
		info.Status = string(model.TaskStatusQueued)
		info.Progress = taskcommon.ProgressQueued
	case "processing", "running":
		info.Status = string(model.TaskStatusInProgress)
		info.Progress = taskcommon.ProgressInProgress
	case "completed", "succeeded", "success":
		info.Status = string(model.TaskStatusSuccess)
		info.Progress = taskcommon.ProgressComplete
		for _, image := range raw.Data.Result.Images {
			switch v := image.URL.(type) {
			case string:
				if v != "" {
					info.Urls = append(info.Urls, v)
				}
			case []any:
				if len(v) > 0 {
					if s, ok := v[0].(string); ok && s != "" {
						info.Urls = append(info.Urls, s)
					}
				}
			}
		}
	case "failed", "failure", "canceled", "cancelled":
		info.Status = string(model.TaskStatusFailure)
		info.Progress = taskcommon.ProgressComplete
		info.Reason = raw.Data.Error
		if info.Reason == "" {
			info.Reason = raw.Message
		}
	default:
		info.Status = string(model.TaskStatusInProgress)
	}
	return info, nil
}

func (a *TaskAdaptor) GetModelList() []string {
	return ModelList
}

func (a *TaskAdaptor) GetChannelName() string {
	return ChannelName
}
