package syncwrap

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"io"
	"mime"
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
	taskapimart "github.com/QuantumNous/new-api/relay/channel/task/apimart"
	taskcommon "github.com/QuantumNous/new-api/relay/channel/task/taskcommon"
	"github.com/QuantumNous/new-api/relay/channel/xai"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/service/ticket_storage"
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
	common.WriteRequestJSONLByID(snapshot.RequestID, "imagegen.syncwrap.start", map[string]interface{}{
		"task_id": snapshot.TaskPublicID,
		"model":   snapshot.OriginModelName,
		"channel": map[string]interface{}{
			"id":   snapshot.ChannelMeta.ChannelId,
			"type": snapshot.ChannelMeta.ChannelType,
		},
	})

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
		common.WriteRequestJSONLByID(snapshot.RequestID, "imagegen.syncwrap.upstream_error", map[string]interface{}{
			"task_id": snapshot.TaskPublicID,
			"error":   err.Error(),
		})
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
	if imageResp == nil || len(filterDisplayableImageData(imageResp.Data)) == 0 {
		common.WriteRequestJSONLByID(snapshot.RequestID, "imagegen.syncwrap.empty_image_data", map[string]interface{}{
			"task_id":  snapshot.TaskPublicID,
			"response": imageResp,
		})
		failSyncTask(ctx, snapshot, fmt.Errorf("image response has no displayable image data"))
		return
	}
	imageResp.Data = filterDisplayableImageData(imageResp.Data)
	common.WriteRequestJSONLByID(snapshot.RequestID, "imagegen.syncwrap.upstream_success", map[string]interface{}{
		"task_id":  snapshot.TaskPublicID,
		"response": imageResp,
	})

	persistedData, err := persistImageDataToStorage(ctx, snapshot, task, imageResp.Data)
	if err != nil {
		common.WriteRequestJSONLByID(snapshot.RequestID, "imagegen.syncwrap.storage_error", map[string]interface{}{
			"task_id": snapshot.TaskPublicID,
			"error":   err.Error(),
		})
		failSyncTask(ctx, snapshot, err)
		return
	}
	imageResp.Data = persistedData

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

func filterDisplayableImageData(data []dto.ImageData) []dto.ImageData {
	filtered := make([]dto.ImageData, 0, len(data))
	for _, item := range data {
		item.Url = strings.TrimSpace(item.Url)
		item.B64Json = strings.TrimSpace(item.B64Json)
		if item.Url == "" && item.B64Json == "" {
			continue
		}
		filtered = append(filtered, item)
	}
	return filtered
}

func persistImageDataToStorage(ctx context.Context, snapshot *SyncWrapSnapshot, task *model.Task, data []dto.ImageData) ([]dto.ImageData, error) {
	if task == nil {
		return nil, fmt.Errorf("image task is nil")
	}
	client, err := ticket_storage.GetClient()
	if err != nil {
		return nil, fmt.Errorf("image storage client unavailable: %w", err)
	}

	persisted := make([]dto.ImageData, 0, len(data))
	for i, item := range data {
		if objectKey, ok := ticket_storage.ObjectKeyFromURL(item.Url); ok {
			common.SysLog(fmt.Sprintf("imagegen storage skip existing object task=%s index=%d object_key=%s", task.TaskID, i, objectKey))
			item.Url = ticket_storage.ObjectURL(objectKey)
			item.B64Json = ""
			persisted = append(persisted, item)
			continue
		}

		contentType, body, err := imageDataBytes(item)
		if err != nil {
			return nil, fmt.Errorf("prepare image %d for storage: %w", i, err)
		}
		objectKey := storedImageObjectKey(task.TaskID, i, contentType, body)
		startedAt := time.Now()
		common.SysLog(fmt.Sprintf("imagegen storage upload start task=%s index=%d object_key=%s content_type=%q size_bytes=%d", task.TaskID, i, objectKey, contentType, len(body)))
		if err := client.UploadObject(ctx, objectKey, contentType, body); err != nil {
			return nil, fmt.Errorf("upload image %d to storage: %w", i, err)
		}
		common.SysLog(fmt.Sprintf("imagegen storage upload success task=%s index=%d object_key=%s elapsed_ms=%d", task.TaskID, i, objectKey, time.Since(startedAt).Milliseconds()))

		item.Url = ticket_storage.ObjectURL(objectKey)
		item.B64Json = ""
		persisted = append(persisted, item)
	}
	common.WriteRequestJSONLByID(snapshot.RequestID, "imagegen.syncwrap.storage_success", map[string]interface{}{
		"task_id": task.TaskID,
		"count":   len(persisted),
	})
	return persisted, nil
}

func imageDataBytes(item dto.ImageData) (string, []byte, error) {
	if item.Url != "" {
		contentType, b64Data, err := service.GetImageFromUrl(item.Url)
		if err != nil {
			return "", nil, err
		}
		body, err := base64.StdEncoding.DecodeString(b64Data)
		if err != nil {
			return "", nil, fmt.Errorf("decode downloaded image: %w", err)
		}
		return normalizeImageContentType(contentType), body, nil
	}
	if item.B64Json != "" {
		contentType, cleanBase64, err := service.DecodeBase64FileData(item.B64Json)
		if err != nil {
			return "", nil, err
		}
		body, err := base64.StdEncoding.DecodeString(cleanBase64)
		if err != nil {
			return "", nil, fmt.Errorf("decode base64 image: %w", err)
		}
		return normalizeImageContentType(contentType), body, nil
	}
	return "", nil, fmt.Errorf("image has neither url nor b64_json")
}

func normalizeImageContentType(contentType string) string {
	contentType = strings.TrimSpace(contentType)
	if contentType == "" || contentType == "application/octet-stream" {
		return "image/png"
	}
	if mediaType, _, err := mime.ParseMediaType(contentType); err == nil && mediaType != "" {
		contentType = mediaType
	}
	if !strings.HasPrefix(contentType, "image/") {
		return "image/png"
	}
	return contentType
}

func storedImageObjectKey(taskID string, index int, contentType string, body []byte) string {
	sum := sha256.Sum256(body)
	ext := imageExtension(contentType)
	taskID = strings.TrimSpace(taskID)
	if taskID == "" {
		taskID = "unknown"
	}
	return fmt.Sprintf("images/async/%s/%d-%s%s", taskID, index, hex.EncodeToString(sum[:])[:16], ext)
}

func imageExtension(contentType string) string {
	contentType = normalizeImageContentType(contentType)
	exts, err := mime.ExtensionsByType(contentType)
	if err == nil && len(exts) > 0 {
		switch exts[0] {
		case ".jpe":
			return ".jpg"
		default:
			return exts[0]
		}
	}
	switch contentType {
	case "image/jpeg":
		return ".jpg"
	case "image/webp":
		return ".webp"
	case "image/gif":
		return ".gif"
	default:
		return ".png"
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
	if snapshot.ChannelMeta.ChannelType == constant.ChannelTypeApimart {
		return execApimartImageUpstream(ctx, snapshot, info, request)
	}

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

func execApimartImageUpstream(ctx context.Context, snapshot *SyncWrapSnapshot, info *relaycommon.RelayInfo, request dto.ImageRequest) (*dto.ImageResponse, *dto.Usage, error) {
	if info.UpstreamModelName != "" {
		request.Model = info.UpstreamModelName
	}
	common.WriteRequestJSONLByID(snapshot.RequestID, "imagegen.apimart.submit_request", map[string]interface{}{
		"model":    request.Model,
		"prompt":   request.Prompt,
		"size":     request.Size,
		"quality":  request.Quality,
		"n":        request.N,
		"base_url": strings.TrimRight(info.ChannelBaseUrl, "/"),
	})
	body, err := common.Marshal(request)
	if err != nil {
		return nil, nil, err
	}
	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		fmt.Sprintf("%s/v1/images/generations", strings.TrimRight(info.ChannelBaseUrl, "/")),
		bytes.NewReader(body),
	)
	if err != nil {
		return nil, nil, err
	}
	req.Header.Set("Authorization", "Bearer "+info.ApiKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	client, err := service.GetHttpClientWithProxy(snapshot.Proxy)
	if err != nil {
		return nil, nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer resp.Body.Close()
	submitBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, nil, err
	}
	common.WriteRequestJSONLByID(snapshot.RequestID, "imagegen.apimart.submit_response", common.RequestJSONLRawJSON(submitBody))
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return nil, nil, fmt.Errorf("upstream returned %d: %s", resp.StatusCode, strings.TrimSpace(string(submitBody)))
	}
	var submitResp struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
		Data    []struct {
			TaskID string `json:"task_id"`
		} `json:"data"`
	}
	if err := common.Unmarshal(submitBody, &submitResp); err != nil {
		return nil, nil, err
	}
	if submitResp.Code != 0 && submitResp.Code != http.StatusOK {
		msg := strings.TrimSpace(submitResp.Message)
		if msg == "" {
			msg = "apimart submit failed"
		}
		return nil, nil, fmt.Errorf("%s", msg)
	}
	if len(submitResp.Data) == 0 || strings.TrimSpace(submitResp.Data[0].TaskID) == "" {
		return nil, nil, fmt.Errorf("apimart response missing task_id")
	}
	common.WriteRequestJSONLByID(snapshot.RequestID, "imagegen.apimart.submitted", map[string]interface{}{
		"upstream_task_id": strings.TrimSpace(submitResp.Data[0].TaskID),
	})
	return pollApimartImageTask(ctx, info, snapshot.Proxy, strings.TrimSpace(submitResp.Data[0].TaskID))
}

func pollApimartImageTask(ctx context.Context, info *relaycommon.RelayInfo, proxy string, taskID string) (*dto.ImageResponse, *dto.Usage, error) {
	adaptor := &taskapimart.TaskAdaptor{}
	wait := 5 * time.Second
	for {
		select {
		case <-ctx.Done():
			return nil, nil, ctx.Err()
		case <-time.After(wait):
			wait = 10 * time.Second
		}

		fetchResp, err := adaptor.FetchTask(info.ChannelBaseUrl, info.ApiKey, map[string]any{"task_id": taskID}, proxy)
		if err != nil {
			logger.LogWarn(ctx, "apimart image poll failed: "+err.Error())
			continue
		}
		body, readErr := io.ReadAll(fetchResp.Body)
		_ = fetchResp.Body.Close()
		if readErr != nil {
			return nil, nil, readErr
		}
		if fetchResp.StatusCode != http.StatusOK {
			return nil, nil, fmt.Errorf("apimart poll returned %d: %s", fetchResp.StatusCode, strings.TrimSpace(string(body)))
		}
		common.WriteRequestJSONLByID(info.RequestId, "imagegen.apimart.poll_response", common.RequestJSONLRawJSON(body))
		taskInfo, err := adaptor.ParseTaskResult(body)
		if err != nil {
			return nil, nil, err
		}
		common.WriteRequestJSONLByID(info.RequestId, "imagegen.apimart.poll_task_info", taskInfo)
		switch taskInfo.Status {
		case string(model.TaskStatusSuccess):
			if len(taskInfo.Urls) == 0 {
				return nil, nil, fmt.Errorf("apimart image task %s completed without image urls", taskID)
			}
			imageResp := &dto.ImageResponse{
				Created: common.GetTimestamp(),
				Data:    make([]dto.ImageData, 0, len(taskInfo.Urls)),
			}
			for _, imageURL := range taskInfo.Urls {
				imageURL = strings.TrimSpace(imageURL)
				if imageURL != "" {
					imageResp.Data = append(imageResp.Data, dto.ImageData{Url: imageURL})
				}
			}
			if len(imageResp.Data) == 0 {
				return nil, nil, fmt.Errorf("apimart image task %s completed without image urls", taskID)
			}
			return imageResp, &dto.Usage{}, nil
		case string(model.TaskStatusFailure):
			reason := strings.TrimSpace(taskInfo.Reason)
			if reason == "" {
				reason = "apimart image task failed"
			}
			return nil, nil, fmt.Errorf("%s", reason)
		}
	}
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
