package relay

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay/channel/task/syncwrap"
	"github.com/QuantumNous/new-api/relay/channel/task/taskcommon"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relay/helper"
	relayimagegen "github.com/QuantumNous/new-api/relay/imagegen"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/service/ticket_storage"
	imagegensetting "github.com/QuantumNous/new-api/setting/imagegen"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
)

const imageToolTaskWaitTimeout = 5 * time.Minute

func init() {
	relayimagegen.RegisterGenerateExecutor(executeGenerateImageTool)
}

func executeGenerateImageTool(c *gin.Context, parentInfo *relaycommon.RelayInfo, args relayimagegen.GenerateArgs) (relayimagegen.Result, *types.NewAPIError) {
	// The chat upstream has already produced a tool_call response — by the
	// time we get here, the chat channel has fulfilled its job. The pending
	// wait-for-image phase belongs to the imagegen channel, not the chat one.
	// Mark first-content on the parent (chat) RelayInfo so the stability
	// framework's first-token timer is canceled and the chat channel doesn't
	// get cooled down for what is, from its POV, a request that already
	// returned content. We use MarkFirstStreamContent (not StopFirstTokenTimer)
	// because the latter also cancels the upstream HTTP stream.
	parentInfo.MarkFirstStreamContent()

	common.WriteRequestJSONL(c, "imagegen.execute.start", args)
	imageReq := dto.ImageRequest{
		Model:      args.Model,
		Prompt:     args.Prompt,
		N:          common.GetPointer(args.N),
		Size:       args.Size,
		Quality:    args.Quality,
		Resolution: args.Resolution,
	}
	if len(args.ImageURLs) > 0 {
		// gpt-image-* accepts an `image` field containing a URL (or array of
		// URLs) on /v1/images/generations — same endpoint, no need to switch
		// to /edits. Marshal as JSON and let the adaptor pass through; if a
		// channel ignores the field we simply degrade to text-to-image
		// rather than fail the call.
		raw, err := json.Marshal(args.ImageURLs)
		if err != nil {
			return relayimagegen.Result{}, types.NewError(err, types.ErrorCodeInvalidRequest, types.ErrOptionWithSkipRetry())
		}
		imageReq.Image = raw
	}

	imageInfo, snapshot, apiErr := buildImageRelayInfo(c, parentInfo, imageReq)
	if apiErr != nil {
		return relayimagegen.Result{}, apiErr
	}

	meta := imageReq.GetTokenCountMeta()
	tokens, err := service.EstimateRequestToken(c, meta, imageInfo)
	if err != nil {
		return relayimagegen.Result{}, types.NewError(err, types.ErrorCodeCountTokenFailed, types.ErrOptionWithSkipRetry())
	}
	imageInfo.SetEstimatePromptTokens(tokens)

	if common.StringsContains(constant.TaskPricePatches, imageInfo.OriginModelName) {
		priceData, err := helper.ModelPriceHelperPerCall(c, imageInfo)
		if err != nil {
			return relayimagegen.Result{}, types.NewError(err, types.ErrorCodeModelPriceError, types.ErrOptionWithSkipRetry())
		}
		imageInfo.PriceData = priceData
	} else {
		priceData, err := helper.ModelPriceHelper(c, imageInfo, tokens, meta)
		if err != nil {
			return relayimagegen.Result{}, types.NewError(err, types.ErrorCodeModelPriceError, types.ErrOptionWithSkipRetry())
		}
		imageInfo.PriceData = priceData
		if _, ok := imageInfo.PriceData.OtherRatios["n"]; !ok {
			imageInfo.PriceData.AddOtherRatio("n", float64(args.N))
		}
	}
	if _, ok := imageInfo.PriceData.PlatformCostOtherRatios["n"]; !ok {
		imageInfo.PriceData.AddPlatformCostOtherRatio("n", float64(args.N))
	}
	helper.ApplyChannelBillingOverrides(imageInfo)
	if apiErr := helper.EnforcePlatformChannelQuota(c, imageInfo); apiErr != nil {
		return relayimagegen.Result{}, apiErr
	}

	preConsume := imageInfo.PriceData.QuotaToPreConsume
	if common.StringsContains(constant.TaskPricePatches, imageInfo.OriginModelName) {
		preConsume = imageInfo.PriceData.Quota
	}
	if !imageInfo.PriceData.FreeModel {
		if apiErr := service.PreConsumeBilling(c, preConsume, imageInfo); apiErr != nil {
			return relayimagegen.Result{}, apiErr
		}
	}
	snapshot.PriceData = imageInfo.PriceData
	snapshot.PriceMarkupRatio = imageInfo.PriceMarkupRatio
	snapshot.PriceMarkupSource = imageInfo.PriceMarkupSource

	task, apiErr := submitImageToolTask(c, imageInfo, imageReq, snapshot)
	if apiErr != nil {
		return relayimagegen.Result{}, apiErr
	}
	common.WriteRequestJSONL(c, "imagegen.execute.task_submitted", map[string]interface{}{
		"task_id":    task.TaskID,
		"task_url":   imageToolTaskURL(c, task.TaskID, parentInfo.TenantId),
		"channel_id": imageInfo.ChannelId,
		"model":      imageInfo.OriginModelName,
	})
	sendImageToolSubmittedStreamMessage(c, parentInfo, task.TaskID)

	waitCtx, cancel := context.WithTimeout(c.Request.Context(), imageToolTaskWaitTimeout)
	defer cancel()
	// Bracket the wait with a timer so we can subtract this duration from
	// the parent chat's use_time. Without this the chat channel's recorded
	// duration would inflate by the imagegen wait, distorting admin log
	// readability and any duration-based stability heuristic.
	waitStart := time.Now()
	result, apiErr := waitForImageToolTask(waitCtx, c, parentInfo.RequestId, task.TaskID, imageInfo.TenantId, args.Model, args.Prompt)
	parentInfo.AddImageToolWaitDuration(time.Since(waitStart))
	return result, apiErr
}

func sendImageToolSubmittedStreamMessage(c *gin.Context, info *relaycommon.RelayInfo, taskID string) {
	if c == nil || info == nil || !info.IsStream || info.RelayFormat != types.RelayFormatOpenAI || taskID == "" {
		return
	}
	taskURL := imageToolTaskURL(c, taskID, info.TenantId)
	message := imagegensetting.RenderSubmittedMessage(taskID, taskURL)
	if message == "" {
		return
	}

	response := &dto.ChatCompletionsStreamResponse{
		Id:      helper.GetResponseID(c),
		Object:  "chat.completion.chunk",
		Created: common.GetTimestamp(),
		Model:   info.OriginModelName,
		Choices: []dto.ChatCompletionsStreamResponseChoice{
			{
				Delta: dto.ChatCompletionsStreamResponseChoiceDelta{
					Role:    "assistant",
					Content: common.GetPointer(message),
				},
				Index: 0,
			},
		},
	}
	if err := helper.ObjectData(c, response); err == nil {
		c.Set(relayimagegen.StatusSentContextKey, true)
		info.SendResponseCount++
		info.MarkFirstStreamContent()
	}
}

func imageToolTaskURL(c *gin.Context, taskID string, tenantID int) string {
	return imageToolTaskURLAt(c, taskID, tenantID, time.Now())
}

func imageToolTaskURLAt(c *gin.Context, taskID string, tenantID int, now time.Time) string {
	taskID = strings.TrimSpace(taskID)
	if taskID == "" {
		return ""
	}
	return relayimagegen.PublicTaskURL(imageToolPublicBaseURL(c, tenantID), taskID, now.Add(relayimagegen.PublicTaskLinkTTL).Unix())
}

func imageToolPublicBaseURL(c *gin.Context, tenantID int) string {
	return imageToolTenantBaseURL(imageToolRequestBaseURL(c), tenantID)
}

func imageToolRequestBaseURL(c *gin.Context) string {
	base := strings.TrimRight(strings.TrimSpace(system_setting.ServerAddress), "/")
	if base == "" && c != nil && c.Request != nil {
		scheme := firstForwardedValue(c.Request.Header.Get("X-Forwarded-Proto"))
		if scheme == "" {
			scheme = strings.TrimSpace(c.Request.Header.Get("X-Scheme"))
		}
		if scheme == "" {
			if c.Request.TLS != nil {
				scheme = "https"
			} else {
				scheme = "http"
			}
		}
		host := firstForwardedValue(c.Request.Header.Get("X-Forwarded-Host"))
		if host == "" {
			host = strings.TrimSpace(c.Request.Host)
		}
		if host != "" {
			base = scheme + "://" + host
		}
	}
	return base
}

func imageToolTenantBaseURL(base string, tenantID int) string {
	base = strings.TrimRight(strings.TrimSpace(base), "/")
	if tenantID <= 0 {
		return base
	}
	tenant := model.GetTenantById(tenantID)
	if tenant == nil || strings.TrimSpace(tenant.Slug) == "" {
		return base
	}
	parsed, err := url.Parse(base)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return base
	}
	host := parsed.Hostname()
	if host == "" || strings.EqualFold(host, "localhost") || net.ParseIP(host) != nil {
		return base
	}
	rootHost := host
	if parts := strings.Split(host, "."); len(parts) >= 3 {
		rootHost = strings.Join(parts[1:], ".")
	}
	newHost := strings.TrimSpace(tenant.Slug) + "." + rootHost
	if port := parsed.Port(); port != "" {
		newHost = net.JoinHostPort(newHost, port)
	}
	parsed.Host = newHost
	return strings.TrimRight(parsed.String(), "/")
}

func firstForwardedValue(value string) string {
	if idx := strings.Index(value, ","); idx >= 0 {
		value = value[:idx]
	}
	return strings.TrimSpace(value)
}

func submitImageToolTask(c *gin.Context, imageInfo *relaycommon.RelayInfo, imageReq dto.ImageRequest, snapshot *syncwrap.SyncWrapSnapshot) (*model.Task, *types.NewAPIError) {
	if imageInfo == nil || snapshot == nil {
		return nil, types.NewErrorWithStatusCode(fmt.Errorf("image task info is nil"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}
	if imageInfo.TaskRelayInfo == nil {
		imageInfo.TaskRelayInfo = &relaycommon.TaskRelayInfo{}
	}
	if imageInfo.PublicTaskID == "" {
		imageInfo.PublicTaskID = model.GenerateTaskID()
	}
	imageInfo.Action = constant.TaskActionGenerate
	snapshot.TaskPublicID = imageInfo.PublicTaskID

	usage := imageToolUsage(imageInfo, &imageReq)
	finalQuota := calculateImageToolFinalQuota(c, imageInfo, usage)
	if imageInfo.PriceData.PlatformCostChannelRatio > 0 {
		if platformCostQuota := service.ComputePlatformCostActualText(c, imageInfo, imageInfo.PriceData, usage); platformCostQuota > 0 {
			imageInfo.PriceData.PlatformCostQuota = platformCostQuota
		}
	}
	if imageInfo.PriceData.PlatformCostQuota <= 0 {
		imageInfo.PriceData.PlatformCostQuota = imageInfo.PriceData.PlatformCostQuotaToPreConsume
	}
	imageInfo.PriceData.Quota = finalQuota
	task := model.InitTask(constant.TaskPlatformImageSyncWrap, imageInfo)
	task.PrivateData.BillingSource = imageInfo.BillingSource
	task.PrivateData.SubscriptionId = imageInfo.SubscriptionId
	task.PrivateData.TokenId = imageInfo.TokenId
	task.PrivateData.BillingContext = &model.TaskBillingContext{
		ModelPrice:               imageInfo.PriceData.ModelPrice,
		GroupRatio:               imageInfo.PriceData.GroupRatioInfo.GroupRatio,
		ModelRatio:               imageInfo.PriceData.ModelRatio,
		OtherRatios:              imageInfo.PriceData.OtherRatios,
		OriginModelName:          imageInfo.OriginModelName,
		PerCallBilling:           common.StringsContains(constant.TaskPricePatches, imageInfo.OriginModelName) || imageInfo.PriceData.UsePrice,
		PriceMarkupRatio:         imageInfo.PriceMarkupRatio,
		PlatformCostChannelRatio: imageInfo.PriceData.PlatformCostChannelRatio,
		PlatformCostQuota:        imageInfo.PriceData.PlatformCostQuota,
	}
	task.Quota = finalQuota
	task.PlatformCostQuota = imageInfo.PriceData.PlatformCostQuota
	task.SetData(imageReq)
	task.Action = imageInfo.Action
	if err := task.Insert(); err != nil {
		if imageInfo.Billing != nil {
			imageInfo.Billing.Refund(c)
		}
		return nil, types.NewErrorWithStatusCode(err, types.ErrorCodeDoRequestFailed, http.StatusInternalServerError, types.ErrOptionWithSkipRetry())
	}

	if imageInfo.Billing != nil {
		if err := service.SettleBilling(c, imageInfo, finalQuota); err != nil {
			imageInfo.Billing.Refund(c)
			failInsertedImageToolTask(c.Request.Context(), task, err)
			return nil, types.NewError(err, types.ErrorCodeDoRequestFailed, types.ErrOptionWithSkipRetry())
		}
	}
	service.LogTaskConsumption(c, imageInfo)

	var adaptor syncwrap.TaskAdaptor
	adaptor.OnTaskInserted(context.Background(), task, imageInfo)
	return task, nil
}

func imageToolUsage(info *relaycommon.RelayInfo, request *dto.ImageRequest) *dto.Usage {
	usage := &dto.Usage{}
	normalizeImageToolUsage(usage, info, request)
	return usage
}

func calculateImageToolFinalQuota(c *gin.Context, info *relaycommon.RelayInfo, usage *dto.Usage) int {
	if info == nil || info.PriceData.FreeModel {
		return 0
	}
	if common.StringsContains(constant.TaskPricePatches, info.OriginModelName) {
		return calculateImageToolPerCallQuota(info)
	}
	return service.CalculateTextQuota(c, info, usage)
}

func calculateImageToolPerCallQuota(info *relaycommon.RelayInfo) int {
	if info == nil || info.PriceData.FreeModel {
		return 0
	}
	priceData := info.PriceData
	groupRatio := priceData.GroupRatioInfo.GroupRatio
	var quota decimal.Decimal
	if priceData.UsePrice {
		quota = decimal.NewFromFloat(priceData.ModelPrice).
			Mul(decimal.NewFromFloat(common.QuotaPerUnit)).
			Mul(decimal.NewFromFloat(groupRatio))
	} else {
		quota = decimal.NewFromFloat(priceData.ModelRatio).
			Div(decimal.NewFromInt(2)).
			Mul(decimal.NewFromFloat(common.QuotaPerUnit)).
			Mul(decimal.NewFromFloat(groupRatio))
	}
	for _, ratio := range priceData.OtherRatios {
		if ratio > 0 {
			quota = quota.Mul(decimal.NewFromFloat(ratio))
		}
	}
	result := int(quota.Round(0).IntPart())
	if result == 0 && groupRatio > 0 && (priceData.ModelPrice > 0 || priceData.ModelRatio > 0) {
		return 1
	}
	return result
}

func failInsertedImageToolTask(ctx context.Context, task *model.Task, err error) {
	if task == nil || err == nil {
		return
	}
	oldStatus := task.Status
	task.Status = model.TaskStatusFailure
	task.FailReason = err.Error()
	task.Progress = taskcommon.ProgressComplete
	task.FinishTime = time.Now().Unix()
	_, _ = task.UpdateWithStatus(oldStatus)
}

func waitForImageToolTask(ctx context.Context, c *gin.Context, requestID string, taskID string, tenantID int, modelName string, prompt string) (relayimagegen.Result, *types.NewAPIError) {
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()

	for {
		task, exists, err := model.GetByOnlyTaskId(taskID)
		if err != nil {
			return relayimagegen.Result{}, types.NewErrorWithStatusCode(err, types.ErrorCodeDoRequestFailed, http.StatusInternalServerError, types.ErrOptionWithSkipRetry())
		}
		if exists && task != nil {
			switch task.Status {
			case model.TaskStatusSuccess:
				expiresAt := time.Now().Add(relayimagegen.PublicTaskLinkTTL).Unix()
				publicBaseURL := imageToolPublicBaseURL(c, tenantID)
				result, err := imageToolResultFromTask(task, tenantID, modelName, prompt, publicBaseURL, expiresAt)
				if err != nil {
					return relayimagegen.Result{}, types.NewErrorWithStatusCode(err, types.ErrorCodeBadResponseBody, http.StatusBadGateway, types.ErrOptionWithSkipRetry())
				}
				result.TaskURL = relayimagegen.PublicTaskURL(publicBaseURL, task.TaskID, expiresAt)
				common.WriteRequestJSONLByID(requestID, "imagegen.execute.task_success", result)
				return result, nil
			case model.TaskStatusFailure:
				err := fmt.Errorf("image generation task %s failed: %s", task.TaskID, task.FailReason)
				common.WriteRequestJSONLByID(requestID, "imagegen.execute.task_failure", map[string]interface{}{
					"task_id": task.TaskID,
					"reason":  task.FailReason,
				})
				return relayimagegen.Result{}, types.NewErrorWithStatusCode(err, types.ErrorCodeDoRequestFailed, http.StatusBadGateway, types.ErrOptionWithSkipRetry())
			}
		}

		select {
		case <-ctx.Done():
			status := "processing"
			if ctx.Err() == context.DeadlineExceeded {
				status = "timeout"
			}
			common.WriteRequestJSONLByID(requestID, "imagegen.execute.task_wait_done", map[string]interface{}{
				"task_id": taskID,
				"status":  status,
				"error":   ctx.Err().Error(),
			})
			return relayimagegen.Result{
				TaskID:  taskID,
				TaskURL: imageToolTaskURL(c, taskID, tenantID),
				Status:  status,
				Model:   modelName,
				Prompt:  prompt,
			}, nil
		case <-ticker.C:
		}
	}
}

func buildImageRelayInfo(c *gin.Context, parentInfo *relaycommon.RelayInfo, request dto.ImageRequest) (*relaycommon.RelayInfo, *syncwrap.SyncWrapSnapshot, *types.NewAPIError) {
	if parentInfo == nil {
		return nil, nil, types.NewErrorWithStatusCode(fmt.Errorf("relay info is nil"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}
	retry := 0
	channel, selectedGroup, err := service.CacheGetRandomSatisfiedChannel(&service.RetryParam{
		Ctx:        c,
		TokenGroup: parentInfo.TokenGroup,
		ModelName:  request.Model,
		Retry:      &retry,
	})
	if err != nil {
		return nil, nil, types.NewErrorWithStatusCode(err, types.ErrorCodeGetChannelFailed, http.StatusServiceUnavailable, types.ErrOptionWithSkipRetry())
	}
	if channel == nil {
		return nil, nil, types.NewErrorWithStatusCode(fmt.Errorf("no available image channel for model %s", request.Model), types.ErrorCodeGetChannelFailed, http.StatusServiceUnavailable, types.ErrOptionWithSkipRetry())
	}
	common.WriteRequestJSONL(c, "imagegen.channel.selected", map[string]interface{}{
		"channel_id":   channel.Id,
		"channel_type": channel.Type,
		"channel_name": channel.Name,
		"group":        selectedGroup,
		"model":        request.Model,
	})

	meta, apiErr := channelMetaFromModelChannel(channel, request.Model)
	if apiErr != nil {
		return nil, nil, apiErr
	}
	imageInfo := &relaycommon.RelayInfo{
		TenantId:          parentInfo.TenantId,
		TokenId:           parentInfo.TokenId,
		TokenKey:          parentInfo.TokenKey,
		TokenGroup:        parentInfo.TokenGroup,
		TokenAppId:        parentInfo.TokenAppId,
		UserId:            parentInfo.UserId,
		UsingGroup:        selectedGroup,
		UserGroup:         parentInfo.UserGroup,
		TokenUnlimited:    parentInfo.TokenUnlimited,
		StartTime:         time.Now(),
		UsePrice:          parentInfo.UsePrice,
		RelayMode:         relayconstant.RelayModeImagesGenerations,
		RelayFormat:       types.RelayFormatOpenAIImage,
		OriginModelName:   request.Model,
		RequestURLPath:    "/v1/images/generations",
		UserSetting:       parentInfo.UserSetting,
		UserEmail:         parentInfo.UserEmail,
		UserQuota:         parentInfo.UserQuota,
		RequestId:         parentInfo.RequestId + "-imagegen",
		ChannelMeta:       meta,
		Request:           &request,
		PriceMarkupRatio:  parentInfo.PriceMarkupRatio,
		PriceMarkupSource: parentInfo.PriceMarkupSource,
		TaskRelayInfo: &relaycommon.TaskRelayInfo{
			Action:       constant.TaskActionGenerate,
			PublicTaskID: model.GenerateTaskID(),
		},
	}
	imageInfo.UpstreamModelName = meta.UpstreamModelName

	snapshot := &syncwrap.SyncWrapSnapshot{
		TaskPublicID:      imageInfo.PublicTaskID,
		RequestID:         parentInfo.RequestId,
		ChannelMeta:       *meta,
		Proxy:             meta.ChannelSetting.Proxy,
		OriginModelName:   request.Model,
		UpstreamModelName: meta.UpstreamModelName,
		ImageRequest:      request,
		UserID:            parentInfo.UserId,
		TenantID:          parentInfo.TenantId,
		TokenID:           parentInfo.TokenId,
		PriceData:         imageInfo.PriceData,
		PriceMarkupRatio:  imageInfo.PriceMarkupRatio,
		PriceMarkupSource: imageInfo.PriceMarkupSource,
	}
	return imageInfo, snapshot, nil
}

func channelMetaFromModelChannel(channel *model.Channel, modelName string) (*relaycommon.ChannelMeta, *types.NewAPIError) {
	if channel == nil {
		return nil, types.NewErrorWithStatusCode(fmt.Errorf("channel is nil"), types.ErrorCodeGetChannelFailed, http.StatusServiceUnavailable, types.ErrOptionWithSkipRetry())
	}
	key, index, apiErr := channel.GetNextEnabledKey()
	if apiErr != nil {
		return nil, apiErr
	}
	apiType, ok := common.ChannelType2APIType(channel.Type)
	if !ok {
		return nil, types.NewErrorWithStatusCode(fmt.Errorf("invalid channel type: %d", channel.Type), types.ErrorCodeInvalidApiType, http.StatusInternalServerError, types.ErrOptionWithSkipRetry())
	}
	upstreamModel, mapped := mapImageToolModelName(modelName, channel.GetModelMapping())
	meta := &relaycommon.ChannelMeta{
		ChannelType:          channel.Type,
		ChannelId:            channel.Id,
		ChannelIsMultiKey:    channel.ChannelInfo.IsMultiKey,
		ChannelMultiKeyIndex: index,
		ChannelBaseUrl:       channel.GetBaseURL(),
		ApiType:              apiType,
		ApiKey:               key,
		ChannelCreateTime:    channel.CreatedTime,
		ParamOverride:        channel.GetParamOverride(),
		HeadersOverride:      channel.GetHeaderOverride(),
		ChannelSetting:       channel.GetSetting(),
		ChannelOtherSettings: channel.GetOtherSettings(),
		UpstreamModelName:    upstreamModel,
		IsModelMapped:        mapped,
	}
	if channel.OpenAIOrganization != nil {
		meta.Organization = *channel.OpenAIOrganization
	}
	switch channel.Type {
	case constant.ChannelTypeAzure, constant.ChannelTypeXunfei, constant.ChannelTypeGemini, constant.ChannelCloudflare, constant.ChannelTypeMokaAI:
		meta.ApiVersion = channel.Other
	case constant.ChannelTypeVertexAi:
		meta.ApiVersion = channel.Other
	}
	return meta, nil
}

func mapImageToolModelName(modelName, mapping string) (string, bool) {
	modelName = strings.TrimSpace(modelName)
	if modelName == "" || strings.TrimSpace(mapping) == "" || strings.TrimSpace(mapping) == "{}" {
		return modelName, false
	}
	var modelMap map[string]string
	if err := json.Unmarshal([]byte(mapping), &modelMap); err != nil {
		return modelName, false
	}
	current := modelName
	visited := map[string]bool{current: true}
	mapped := false
	for {
		next := strings.TrimSpace(modelMap[current])
		if next == "" {
			break
		}
		if visited[next] {
			break
		}
		visited[next] = true
		current = next
		mapped = true
	}
	return current, mapped
}

func imageToolResultFromResponse(resp *dto.ImageResponse, modelName, prompt string) (relayimagegen.Result, error) {
	if resp == nil {
		return relayimagegen.Result{}, fmt.Errorf("image response is empty")
	}
	data := filterDisplayableImageData(resp.Data)
	if len(data) == 0 {
		return relayimagegen.Result{}, fmt.Errorf("image response has no displayable image data")
	}
	item := data[0]
	result := relayimagegen.Result{
		URL:           strings.TrimSpace(item.Url),
		B64JSON:       strings.TrimSpace(item.B64Json),
		MimeType:      "image/png",
		RevisedPrompt: item.RevisedPrompt,
		Model:         modelName,
		Prompt:        prompt,
	}
	sum := sha256.Sum256([]byte(result.URL + "\n" + result.B64JSON + "\n" + result.RevisedPrompt))
	result.ImageID = "img_" + hex.EncodeToString(sum[:])[:16]
	return result, nil
}

func imageToolResultFromTask(task *model.Task, tenantID int, modelName, prompt string, publicBaseURL string, publicExpiresAt int64) (relayimagegen.Result, error) {
	if task == nil {
		return relayimagegen.Result{}, fmt.Errorf("image task is nil")
	}
	var data []dto.ImageData
	if len(task.PrivateData.ImageData) > 0 {
		if err := common.Unmarshal(task.PrivateData.ImageData, &data); err != nil {
			return relayimagegen.Result{}, err
		}
	}
	data = filterDisplayableImageData(data)
	fromImageData := len(data) > 0
	if len(data) == 0 && task.PrivateData.ResultURL != "" {
		data = append(data, dto.ImageData{Url: task.PrivateData.ResultURL})
	}
	if len(data) == 0 {
		return relayimagegen.Result{}, fmt.Errorf("image task %s has no image data", task.TaskID)
	}
	if data[0].Url != "" {
		if storageURL, ok, err := presignStoredImageURL(data[0].Url); err != nil {
			return relayimagegen.Result{}, err
		} else if ok {
			data[0].Url = storageURL
		} else if publicExpiresAt > 0 {
			data[0].Url = relayimagegen.PublicTaskContentURL(publicBaseURL, task.TaskID, 0, publicExpiresAt)
		} else if fromImageData {
			if proxyURL := taskcommon.BuildImageProxyURL(task.TaskID, 0, tenantID); strings.HasPrefix(proxyURL, "http://") || strings.HasPrefix(proxyURL, "https://") {
				data[0].Url = proxyURL
			}
		}
	}
	result, err := imageToolResultFromResponse(&dto.ImageResponse{Data: data}, modelName, prompt)
	if err != nil {
		return relayimagegen.Result{}, err
	}
	result.TaskID = task.TaskID
	if publicExpiresAt > 0 {
		result.TaskURL = relayimagegen.PublicTaskURL(publicBaseURL, task.TaskID, publicExpiresAt)
	} else {
		result.TaskURL = imageToolTaskURL(nil, task.TaskID, tenantID)
	}
	result.Status = "succeeded"
	return result, nil
}

func presignStoredImageURL(rawURL string) (string, bool, error) {
	objectKey, ok := ticket_storage.ObjectKeyFromURL(rawURL)
	if !ok {
		return "", false, nil
	}
	client, err := ticket_storage.GetClient()
	if err != nil {
		return "", true, fmt.Errorf("image storage client unavailable: %w", err)
	}
	url, _, err := client.PresignGet(objectKey, relayimagegen.PublicTaskLinkTTL)
	if err != nil {
		return "", true, fmt.Errorf("presign stored image %s: %w", objectKey, err)
	}
	return url, true, nil
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

func normalizeImageToolUsage(usage *dto.Usage, info *relaycommon.RelayInfo, request *dto.ImageRequest) {
	if usage == nil {
		return
	}
	if usage.PromptTokens == 0 && usage.CompletionTokens == 0 && usage.TotalTokens > 0 {
		usage.PromptTokens = usage.TotalTokens
	}
	if usage.TotalTokens == 0 && usage.PromptTokens+usage.CompletionTokens > 0 {
		usage.TotalTokens = usage.PromptTokens + usage.CompletionTokens
	}
	if usage.PromptTokens+usage.CompletionTokens > 0 {
		return
	}
	promptTokens := 0
	if info != nil {
		promptTokens = info.GetEstimatePromptTokens()
	}
	imageTokens := 0
	if request != nil {
		if meta := request.GetTokenCountMeta(); meta != nil && meta.MaxTokens > 0 {
			imageTokens = meta.MaxTokens
		}
	}
	if imageTokens > 0 {
		usage.PromptTokens = promptTokens + imageTokens
		usage.PromptTokensDetails.ImageTokens = imageTokens
		usage.TotalTokens = usage.PromptTokens
		return
	}
	if promptTokens <= 0 {
		promptTokens = 1
	}
	usage.PromptTokens = promptTokens
	usage.TotalTokens = promptTokens
}
