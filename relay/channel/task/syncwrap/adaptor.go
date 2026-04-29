package syncwrap

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"runtime/debug"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay/channel"
	"github.com/QuantumNous/new-api/relay/channel/ali"
	"github.com/QuantumNous/new-api/relay/channel/gemini"
	"github.com/QuantumNous/new-api/relay/channel/jimeng"
	"github.com/QuantumNous/new-api/relay/channel/openai"
	taskcommon "github.com/QuantumNous/new-api/relay/channel/task/taskcommon"
	"github.com/QuantumNous/new-api/relay/channel/xai"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/samber/lo"
)

type TaskAdaptor struct {
	taskcommon.BaseBilling
	request dto.ImageRequest
}

func (a *TaskAdaptor) Init(info *relaycommon.RelayInfo) {}

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
	sizeRatio := 1.0
	switch req.Size {
	case "1024x1792", "1792x1024":
		sizeRatio = 2
	case "512x512":
		sizeRatio = 0.5
	case "256x256":
		sizeRatio = 0.25
	}
	if req.Model == "dall-e-3" && req.Quality == "hd" {
		sizeRatio *= 2
	}
	return map[string]float64{
		"n":    float64(lo.FromPtrOr(req.N, uint(1))),
		"size": sizeRatio,
	}
}

func (a *TaskAdaptor) BuildRequestURL(info *relaycommon.RelayInfo) (string, error) { return "", nil }
func (a *TaskAdaptor) BuildRequestHeader(c *gin.Context, req *http.Request, info *relaycommon.RelayInfo) error {
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
	return &http.Response{
		StatusCode: http.StatusOK,
		Body:       io.NopCloser(bytes.NewReader(nil)),
		Header:     make(http.Header),
	}, nil
}

func (a *TaskAdaptor) DoResponse(c *gin.Context, resp *http.Response, info *relaycommon.RelayInfo) (taskID string, taskData []byte, taskErr *dto.TaskError) {
	req := a.request
	if info.UpstreamModelName != "" {
		req.Model = info.UpstreamModelName
	}
	body, err := common.Marshal(req)
	if err != nil {
		return "", nil, service.TaskErrorWrapper(err, "marshal_request_failed", http.StatusInternalServerError)
	}
	taskcommon.WriteImageAsyncSubmitResponse(c, info)
	return info.PublicTaskID, body, nil
}

func (a *TaskAdaptor) OnTaskInserted(ctx context.Context, task *model.Task, info *relaycommon.RelayInfo) {
	if task == nil || info == nil || info.ChannelMeta == nil {
		return
	}
	var req dto.ImageRequest
	if len(task.Data) > 0 {
		_ = common.Unmarshal(task.Data, &req)
	}
	if req.Model == "" {
		req = a.request
	}
	meta := *info.ChannelMeta
	snapshot := &SyncWrapSnapshot{
		TaskPublicID:      task.TaskID,
		TaskID:            task.ID,
		ChannelMeta:       meta,
		Proxy:             info.ChannelSetting.Proxy,
		OriginModelName:   info.OriginModelName,
		UpstreamModelName: info.UpstreamModelName,
		ImageRequest:      req,
		UserID:            info.UserId,
		TenantID:          info.TenantId,
		TokenID:           info.TokenId,
		Quota:             task.Quota,
		PriceData:         info.PriceData,
		PriceMarkupRatio:  info.PriceMarkupRatio,
		PriceMarkupSource: info.PriceMarkupSource,
	}
	go runSyncUpstream(snapshot)
}

func (a *TaskAdaptor) FetchTask(baseURL, key string, body map[string]any, proxy string) (*http.Response, error) {
	return nil, fmt.Errorf("not applicable for sync wrap")
}

func (a *TaskAdaptor) ParseTaskResult(body []byte) (*relaycommon.TaskInfo, error) {
	return nil, fmt.Errorf("not applicable for sync wrap")
}

func (a *TaskAdaptor) GetModelList() []string { return ModelList }
func (a *TaskAdaptor) GetChannelName() string { return ChannelName }

func runSyncUpstream(snapshot *SyncWrapSnapshot) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	defer func() {
		if r := recover(); r != nil {
			failSyncTask(ctx, snapshot, fmt.Errorf("panic: %v\n%s", r, debug.Stack()))
		}
	}()

	task, exists, err := model.GetByOnlyTaskId(snapshot.TaskPublicID)
	if err != nil || !exists || task == nil {
		logger.LogWarn(ctx, fmt.Sprintf("syncwrap: task %s not found, abort", snapshot.TaskPublicID))
		return
	}
	if task.Status == model.TaskStatusSuccess || task.Status == model.TaskStatusFailure {
		logger.LogWarn(ctx, fmt.Sprintf("syncwrap: task %s already terminal (%s), abort", task.TaskID, task.Status))
		return
	}
	oldStatus := task.Status

	imageResp, _, err := ExecImageUpstream(ctx, snapshot, snapshot.ImageRequest)
	if err != nil {
		task.FailReason = err.Error()
		task.Status = model.TaskStatusFailure
		task.Progress = taskcommon.ProgressComplete
		task.FinishTime = time.Now().Unix()
		updated, updateErr := task.UpdateWithStatus(oldStatus)
		if updateErr != nil {
			logger.LogError(ctx, fmt.Sprintf("syncwrap: update failure task %s failed: %s", task.TaskID, updateErr.Error()))
			return
		}
		if updated {
			service.RefundTaskQuota(ctx, task, task.FailReason)
		}
		return
	}

	data, err := common.Marshal(imageResp.Data)
	if err != nil {
		failSyncTask(ctx, snapshot, err)
		return
	}
	task.PrivateData.ImageData = data
	task.Status = model.TaskStatusSuccess
	task.Progress = taskcommon.ProgressComplete
	task.FinishTime = time.Now().Unix()
	updated, updateErr := task.UpdateWithStatus(oldStatus)
	if updateErr != nil {
		logger.LogError(ctx, fmt.Sprintf("syncwrap: update success task %s failed: %s", task.TaskID, updateErr.Error()))
		return
	}
	if !updated {
		logger.LogWarn(ctx, fmt.Sprintf("syncwrap: task %s was changed concurrently, skip success write", task.TaskID))
	}
}

func failSyncTask(ctx context.Context, snapshot *SyncWrapSnapshot, err error) {
	task, exists, loadErr := model.GetByOnlyTaskId(snapshot.TaskPublicID)
	if loadErr != nil || !exists || task == nil {
		return
	}
	if task.Status == model.TaskStatusSuccess || task.Status == model.TaskStatusFailure {
		return
	}
	oldStatus := task.Status
	task.FailReason = err.Error()
	task.Status = model.TaskStatusFailure
	task.Progress = taskcommon.ProgressComplete
	task.FinishTime = time.Now().Unix()
	updated, updateErr := task.UpdateWithStatus(oldStatus)
	if updateErr != nil {
		logger.LogError(ctx, fmt.Sprintf("syncwrap: fail task %s failed: %s", task.TaskID, updateErr.Error()))
		return
	}
	if updated {
		service.RefundTaskQuota(ctx, task, task.FailReason)
	}
}

func ExecImageUpstream(ctx context.Context, snapshot *SyncWrapSnapshot, request dto.ImageRequest) (*dto.ImageResponse, *dto.Usage, error) {
	info := snapshot.ToRelayInfo()
	adaptor := getImageAdaptor(snapshot.ChannelMeta.ApiType)
	if adaptor == nil {
		return nil, nil, fmt.Errorf("image async not implemented for api type %d", snapshot.ChannelMeta.ApiType)
	}
	adaptor.Init(info)
	builder, ok := adaptor.(channel.ImageRequestBuilder)
	if !ok {
		return nil, nil, fmt.Errorf("image request builder not implemented for %s", adaptor.GetChannelName())
	}
	extractor, ok := adaptor.(channel.ImageResponseExtractor)
	if !ok {
		return nil, nil, fmt.Errorf("image response extractor not implemented for %s", adaptor.GetChannelName())
	}
	req, err := builder.BuildImageHTTPRequest(ctx, info, request)
	if err != nil {
		return nil, nil, err
	}
	client, err := service.GetHttpClientWithProxy(snapshot.Proxy)
	if err != nil {
		return nil, nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		body, _ := io.ReadAll(resp.Body)
		return nil, nil, fmt.Errorf("upstream returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return extractor.ExtractImageResponse(resp, info)
}

func getImageAdaptor(apiType int) channel.Adaptor {
	switch apiType {
	case constant.APITypeOpenAI:
		return &openai.Adaptor{}
	case constant.APITypeAli:
		return &ali.Adaptor{}
	case constant.APITypeGemini:
		return &gemini.Adaptor{}
	case constant.APITypeJimeng:
		return &jimeng.Adaptor{}
	case constant.APITypeXai:
		return &xai.Adaptor{}
	default:
		return nil
	}
}
