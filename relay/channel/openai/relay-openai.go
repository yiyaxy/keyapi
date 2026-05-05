package openai

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/relay/channel/openrouter"
	taskapimart "github.com/QuantumNous/new-api/relay/channel/task/apimart"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relay/helper"
	relayimagegen "github.com/QuantumNous/new-api/relay/imagegen"
	"github.com/QuantumNous/new-api/relaymetrics"
	"github.com/QuantumNous/new-api/service"

	"github.com/QuantumNous/new-api/types"

	"github.com/bytedance/gopkg/util/gopool"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

func sendStreamData(c *gin.Context, info *relaycommon.RelayInfo, data string, forceFormat bool, thinkToContent bool) (err error) {
	defer func() {
		if err == nil && data != "" {
			info.MarkFirstStreamContent()
		}
	}()
	if data == "" {
		return nil
	}

	needResponseReplace := service.HasResponseRules(info.ChannelId)

	if !forceFormat && !thinkToContent && !needResponseReplace {
		return helper.StringData(c, data)
	}

	var lastStreamResponse dto.ChatCompletionsStreamResponse
	if err := common.UnmarshalJsonStr(data, &lastStreamResponse); err != nil {
		return err
	}

	// Apply response content replacement rules
	if needResponseReplace {
		for i := range lastStreamResponse.Choices {
			if content := lastStreamResponse.Choices[i].Delta.GetContentString(); content != "" {
				newContent := service.ApplyResponseContentRules(content, info.ChannelId)
				if newContent != content {
					lastStreamResponse.Choices[i].Delta.SetContentString(newContent)
				}
			}
		}
	}

	if !thinkToContent {
		return helper.ObjectData(c, lastStreamResponse)
	}

	hasThinkingContent := false
	hasContent := false
	var thinkingContent strings.Builder
	for _, choice := range lastStreamResponse.Choices {
		if len(choice.Delta.GetReasoningContent()) > 0 {
			hasThinkingContent = true
			thinkingContent.WriteString(choice.Delta.GetReasoningContent())
		}
		if len(choice.Delta.GetContentString()) > 0 {
			hasContent = true
		}
	}

	// Handle think to content conversion
	if info.ThinkingContentInfo.IsFirstThinkingContent {
		if hasThinkingContent {
			response := lastStreamResponse.Copy()
			for i := range response.Choices {
				// send `think` tag with thinking content
				response.Choices[i].Delta.SetContentString("<think>\n" + thinkingContent.String())
				response.Choices[i].Delta.ReasoningContent = nil
				response.Choices[i].Delta.Reasoning = nil
			}
			info.ThinkingContentInfo.IsFirstThinkingContent = false
			info.ThinkingContentInfo.HasSentThinkingContent = true
			return helper.ObjectData(c, response)
		}
	}

	if lastStreamResponse.Choices == nil || len(lastStreamResponse.Choices) == 0 {
		return helper.ObjectData(c, lastStreamResponse)
	}

	// Process each choice
	for i, choice := range lastStreamResponse.Choices {
		// Handle transition from thinking to content
		// only send `</think>` tag when previous thinking content has been sent
		if hasContent && !info.ThinkingContentInfo.SendLastThinkingContent && info.ThinkingContentInfo.HasSentThinkingContent {
			response := lastStreamResponse.Copy()
			for j := range response.Choices {
				response.Choices[j].Delta.SetContentString("\n</think>\n")
				response.Choices[j].Delta.ReasoningContent = nil
				response.Choices[j].Delta.Reasoning = nil
			}
			info.ThinkingContentInfo.SendLastThinkingContent = true
			helper.ObjectData(c, response)
		}

		// Convert reasoning content to regular content if any
		if len(choice.Delta.GetReasoningContent()) > 0 {
			lastStreamResponse.Choices[i].Delta.SetContentString(choice.Delta.GetReasoningContent())
			lastStreamResponse.Choices[i].Delta.ReasoningContent = nil
			lastStreamResponse.Choices[i].Delta.Reasoning = nil
		} else if !hasThinkingContent && !hasContent {
			// flush thinking content
			lastStreamResponse.Choices[i].Delta.ReasoningContent = nil
			lastStreamResponse.Choices[i].Delta.Reasoning = nil
		}
	}

	return helper.ObjectData(c, lastStreamResponse)
}

func OaiStreamHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	if resp == nil || resp.Body == nil {
		logger.LogError(c, "invalid response or response body")
		return nil, types.NewOpenAIError(fmt.Errorf("invalid response"), types.ErrorCodeBadResponse, http.StatusInternalServerError)
	}

	defer service.CloseResponseBodyGracefully(resp)

	model := info.UpstreamModelName
	var responseId string
	var createAt int64 = 0
	var systemFingerprint string
	var containStreamUsage bool
	var responseTextBuilder strings.Builder
	var toolCount int
	var usage = &dto.Usage{}
	var streamItems []string // store stream items
	var lastStreamData string
	var secondLastStreamData string // 存储倒数第二个stream data，用于音频模型
	needRewrite := service.HasRewriteRules(info.ChannelId)

	// 检查是否为音频模型
	isAudioModel := strings.Contains(strings.ToLower(model), "audio")
	var imageToolCapture *relayimagegen.OpenAIStreamCapture
	if _, ok := info.Request.(*dto.GeneralOpenAIRequest); ok && info.RelayFormat == types.RelayFormatOpenAI {
		imageToolCapture = relayimagegen.NewOpenAIStreamCapture(relayimagegen.EnabledForInfo(info))
	}

	helper.StreamScannerHandler(c, resp, info, func(data string, sr *helper.StreamResult) {
		if imageToolCapture != nil {
			decision, err := imageToolCapture.Handle(data, info.SendResponseCount > 0)
			if err != nil {
				sr.Stop(types.NewError(err, types.ErrorCodeBadResponseBody))
				return
			}
			if decision == relayimagegen.OpenAIStreamSuppress {
				lastStreamData = ""
				streamItems = nil
				return
			}
		}
		if lastStreamData != "" {
			if err := HandleStreamFormat(c, info, lastStreamData, info.ChannelSetting.ForceFormat, info.ChannelSetting.ThinkingToContent); err != nil {
				common.SysLog("error handling stream format: " + err.Error())
				sr.Error(err)
			}
		}
		if len(data) > 0 {
			// 对音频模型，保存倒数第二个stream data
			if isAudioModel && lastStreamData != "" {
				secondLastStreamData = lastStreamData
			}

			lastStreamData = data
			streamItems = append(streamItems, data)
		}
	})
	if imageToolCapture != nil && imageToolCapture.Ready() {
		req := info.Request.(*dto.GeneralOpenAIRequest)
		usage, apiErr := handleOpenAIImageToolCall(c, info, req, imageToolCapture.ToolCall())
		if apiErr != nil {
			return nil, apiErr
		}
		return usage, nil
	}

	// Zero chunks = upstream returned empty stream, trigger retry
	if info.ReceivedResponseCount == 0 {
		if info.StreamFirstTokenTimedOut() {
			return nil, types.NewOpenAIError(
				fmt.Errorf("upstream stream first token timeout"),
				types.ErrorCodeUpstreamFirstTokenTimeout,
				http.StatusBadGateway,
			)
		}
		return nil, types.NewOpenAIError(
			fmt.Errorf("upstream stream ended without sending any data chunks"),
			types.ErrorCodeBadResponse,
			http.StatusBadGateway,
		)
	}

	// Received chunk(s) but produced no meaningful content — trigger retry if nothing sent yet
	if info.ReceivedResponseCount > 0 && info.SendResponseCount == 0 && !needRewrite {
		// Check if the single buffered lastStreamData has actual content
		var lastResp dto.ChatCompletionsStreamResponse
		hasContent := false
		if err := common.UnmarshalJsonStr(lastStreamData, &lastResp); err == nil {
			for _, choice := range lastResp.Choices {
				if choice.Delta.GetContentString() != "" || choice.Delta.GetReasoningContent() != "" || len(choice.Delta.ToolCalls) > 0 {
					hasContent = true
					break
				}
			}
		}
		if !hasContent {
			return nil, types.NewOpenAIError(
				fmt.Errorf("upstream stream had %d chunks but no content produced", info.ReceivedResponseCount),
				types.ErrorCodeEmptyResponse,
				http.StatusBadGateway,
			)
		}
	}

	// 对音频模型，从倒数第二个stream data中提取usage信息
	if isAudioModel && secondLastStreamData != "" {
		var streamResp struct {
			Usage *dto.Usage `json:"usage"`
		}
		err := common.Unmarshal([]byte(secondLastStreamData), &streamResp)
		if err == nil && streamResp.Usage != nil && service.ValidUsage(streamResp.Usage) {
			usage = streamResp.Usage
			containStreamUsage = true

			if common.DebugEnabled {
				logger.LogDebug(c, fmt.Sprintf("Audio model usage extracted from second last SSE: PromptTokens=%d, CompletionTokens=%d, TotalTokens=%d, InputTokens=%d, OutputTokens=%d",
					usage.PromptTokens, usage.CompletionTokens, usage.TotalTokens,
					usage.InputTokens, usage.OutputTokens))
			}
		}
	}

	// 处理最后的响应
	shouldSendLastResp := true
	if err := handleLastResponse(lastStreamData, &responseId, &createAt, &systemFingerprint, &model, &usage,
		&containStreamUsage, info, &shouldSendLastResp); err != nil {
		logger.LogError(c, fmt.Sprintf("error handling last response: %s, lastStreamData: [%s]", err.Error(), lastStreamData))
	}

	if info.RelayFormat == types.RelayFormatOpenAI {
		if shouldSendLastResp && !needRewrite {
			_ = sendStreamData(c, info, lastStreamData, info.ChannelSetting.ForceFormat, info.ChannelSetting.ThinkingToContent)
		}
	}

	// 处理token计算
	if err := processTokens(info.RelayMode, streamItems, &responseTextBuilder, &toolCount); err != nil {
		logger.LogError(c, "error processing tokens: "+err.Error())
	}

	// Handle AI rewrite for streaming
	if needRewrite {
		fullContent := responseTextBuilder.String()
		rewrittenContent, rewritten := service.ApplyResponseRewriteRules(fullContent, info.ChannelId, info.OriginModelName)
		if rewritten {
			if len(streamItems) > 0 {
				var tpl dto.ChatCompletionsStreamResponse
				if err := common.UnmarshalJsonStr(streamItems[0], &tpl); err == nil && len(tpl.Choices) > 0 {
					tpl.Choices[0].Delta.SetContentString(rewrittenContent)
					tpl.Choices[0].Delta.ReasoningContent = nil
					tpl.Choices[0].Delta.Reasoning = nil
					helper.ObjectData(c, tpl)
				}
			}
		} else {
			for i := 0; i < len(streamItems)-1; i++ {
				HandleStreamFormat(c, info, streamItems[i], info.ChannelSetting.ForceFormat, info.ChannelSetting.ThinkingToContent)
			}
			if info.RelayFormat == types.RelayFormatOpenAI && lastStreamData != "" {
				sendStreamData(c, info, lastStreamData, info.ChannelSetting.ForceFormat, info.ChannelSetting.ThinkingToContent)
			}
		}
	}

	if !containStreamUsage {
		usage = service.ResponseText2Usage(c, responseTextBuilder.String(), info.UpstreamModelName, info.GetEstimatePromptTokens())
		usage.CompletionTokens += toolCount * 7
	}

	applyUsagePostProcessing(info, usage, common.StringToByteSlice(lastStreamData))

	HandleFinalResponse(c, info, lastStreamData, responseId, createAt, model, systemFingerprint, usage, containStreamUsage)

	return usage, nil
}

func handleOpenAIImageToolCall(c *gin.Context, info *relaycommon.RelayInfo, req *dto.GeneralOpenAIRequest, call relayimagegen.OpenAIToolCall) (*dto.Usage, *types.NewAPIError) {
	common.WriteRequestJSONL(c, "imagegen.openai.tool_call", map[string]interface{}{
		"id":        call.ID,
		"name":      call.Name,
		"arguments": call.Arguments,
	})
	args, err := relayimagegen.ParseGenerateArgs(call.Arguments)
	if err != nil {
		return nil, types.NewErrorWithStatusCode(err, types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}
	common.WriteRequestJSONL(c, "imagegen.openai.tool_args", args)
	result, apiErr := relayimagegen.ExecuteGenerate(c, info, args)
	if apiErr != nil {
		if c.GetBool(relayimagegen.StatusSentContextKey) && info.IsStream && info.RelayFormat == types.RelayFormatOpenAI {
			sendOpenAIImageToolStatusError(c, info, apiErr.Error())
			return &dto.Usage{}, nil
		}
		return nil, apiErr
	}
	common.WriteRequestJSONL(c, "imagegen.openai.tool_result", result)
	nextReq, err := relayimagegen.BuildOpenAIRoundTripRequest(req, call, result)
	if err != nil {
		return nil, types.NewError(err, types.ErrorCodeConvertRequestFailed, types.ErrOptionWithSkipRetry())
	}
	common.WriteRequestJSONL(c, "imagegen.openai.round_trip_request", nextReq)
	usage, apiErr := runOpenAIRoundTrip(c, info, nextReq)
	if apiErr != nil && c.GetBool(relayimagegen.StatusSentContextKey) && info.IsStream && info.RelayFormat == types.RelayFormatOpenAI {
		sendOpenAIImageToolStatusError(c, info, apiErr.Error())
		return &dto.Usage{}, nil
	}
	return usage, apiErr
}

func sendOpenAIImageToolStatusError(c *gin.Context, info *relaycommon.RelayInfo, message string) {
	if c == nil || info == nil {
		return
	}
	if strings.TrimSpace(message) == "" {
		message = "图片生成失败"
	}
	content := "\n图片生成失败：" + message + "\n"
	response := &dto.ChatCompletionsStreamResponse{
		Id:      helper.GetResponseID(c),
		Object:  "chat.completion.chunk",
		Created: common.GetTimestamp(),
		Model:   info.OriginModelName,
		Choices: []dto.ChatCompletionsStreamResponseChoice{
			{
				Delta: dto.ChatCompletionsStreamResponseChoiceDelta{
					Content: common.GetPointer(content),
				},
				Index: 0,
			},
		},
	}
	_ = helper.ObjectData(c, response)
	helper.Done(c)
	info.SendResponseCount++
	info.MarkFirstStreamContent()
}

func runOpenAIRoundTrip(c *gin.Context, info *relaycommon.RelayInfo, req *dto.GeneralOpenAIRequest) (*dto.Usage, *types.NewAPIError) {
	prevRequest := info.Request
	prevStream := info.IsStream
	info.Request = req
	info.IsStream = req.IsStream(c)
	defer func() {
		info.Request = prevRequest
		info.IsStream = prevStream
	}()

	adaptor := &Adaptor{}
	adaptor.Init(info)
	convertedRequest, err := adaptor.ConvertOpenAIRequest(c, info, req)
	if err != nil {
		return nil, types.NewError(err, types.ErrorCodeConvertRequestFailed, types.ErrOptionWithSkipRetry())
	}
	relaycommon.AppendRequestConversionFromRequest(info, convertedRequest)
	jsonData, err := common.Marshal(convertedRequest)
	if err != nil {
		return nil, types.NewError(err, types.ErrorCodeJsonMarshalFailed, types.ErrOptionWithSkipRetry())
	}
	jsonData, err = relaycommon.RemoveDisabledFields(jsonData, info.ChannelOtherSettings, info.ChannelSetting.PassThroughBodyEnabled)
	if err != nil {
		return nil, types.NewError(err, types.ErrorCodeConvertRequestFailed, types.ErrOptionWithSkipRetry())
	}
	if len(info.ParamOverride) > 0 {
		jsonData, err = relaycommon.ApplyParamOverrideWithRelayInfo(jsonData, info)
		if err != nil {
			return nil, types.NewError(err, types.ErrorCodeConvertRequestFailed, types.ErrOptionWithSkipRetry())
		}
	}
	common.WriteRequestJSONL(c, "imagegen.openai.round_trip_upstream_request", map[string]interface{}{
		"channel_id":   info.ChannelId,
		"channel_type": info.ChannelType,
		"model":        info.OriginModelName,
		"body":         common.RequestJSONLRawJSON(jsonData),
	})

	resp, err := adaptor.DoRequest(c, info, bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeDoRequestFailed, http.StatusInternalServerError)
	}
	httpResp, _ := resp.(*http.Response)
	if httpResp != nil {
		defer service.CloseResponseBodyGracefully(httpResp)
		if httpResp.StatusCode != http.StatusOK {
			apiErr := service.RelayErrorHandler(c.Request.Context(), httpResp, false)
			service.ResetStatusCode(apiErr, c.GetString("status_code_mapping"))
			return nil, apiErr
		}
	}
	usage, apiErr := adaptor.DoResponse(c, httpResp, info)
	if apiErr != nil {
		service.ResetStatusCode(apiErr, c.GetString("status_code_mapping"))
		return nil, apiErr
	}
	if usage == nil {
		return &dto.Usage{}, nil
	}
	return usage.(*dto.Usage), nil
}

func OpenaiHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	defer service.CloseResponseBodyGracefully(resp)

	var simpleResponse dto.OpenAITextResponse
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeReadResponseBodyFailed, http.StatusInternalServerError)
	}
	// Mark non-stream body fully read as "first data parsed"
	if sess := relaymetrics.SessionFromGin(c); sess != nil {
		sess.MarkFirstDataParsed()
	}
	if common.DebugEnabled {
		println("upstream response body:", string(responseBody))
	}
	// Unmarshal to simpleResponse
	if info.ChannelType == constant.ChannelTypeOpenRouter && info.ChannelOtherSettings.IsOpenRouterEnterprise() {
		// 尝试解析为 openrouter enterprise
		var enterpriseResponse openrouter.OpenRouterEnterpriseResponse
		err = common.Unmarshal(responseBody, &enterpriseResponse)
		if err != nil {
			return nil, types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusInternalServerError)
		}
		if enterpriseResponse.Success {
			responseBody = enterpriseResponse.Data
		} else {
			logger.LogError(c, fmt.Sprintf("openrouter enterprise response success=false, data: %s", enterpriseResponse.Data))
			return nil, types.NewOpenAIError(fmt.Errorf("openrouter response success=false"), types.ErrorCodeBadResponseBody, http.StatusInternalServerError)
		}
	}

	err = common.Unmarshal(responseBody, &simpleResponse)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusInternalServerError)
	}

	if oaiError := simpleResponse.GetOpenAIError(); oaiError != nil && oaiError.Type != "" {
		return nil, types.WithOpenAIError(*oaiError, resp.StatusCode)
	}

	// Empty response check: no choices = empty response, trigger retry
	if len(simpleResponse.Choices) == 0 {
		return nil, types.NewOpenAIError(
			fmt.Errorf("upstream returned empty response with no choices"),
			types.ErrorCodeEmptyResponse,
			http.StatusBadGateway,
		)
	}

	for _, choice := range simpleResponse.Choices {
		if choice.FinishReason == constant.FinishReasonContentFilter {
			common.SetContextKey(c, constant.ContextKeyAdminRejectReason, "openai_finish_reason=content_filter")
			break
		}
	}
	if req, ok := info.Request.(*dto.GeneralOpenAIRequest); ok &&
		info.RelayFormat == types.RelayFormatOpenAI &&
		relayimagegen.EnabledForInfo(info) {
		if call, found := relayimagegen.FindOpenAIGenerateToolCall(&simpleResponse); found {
			return handleOpenAIImageToolCall(c, info, req, call)
		}
	}

	forceFormat := false
	if info.ChannelSetting.ForceFormat {
		forceFormat = true
	}

	// Apply response content replacement rules
	for i := range simpleResponse.Choices {
		if content := simpleResponse.Choices[i].Message.StringContent(); content != "" {
			newContent := service.ApplyResponseContentRules(content, info.ChannelId)
			if newContent != content {
				simpleResponse.Choices[i].Message.SetStringContent(newContent)
				forceFormat = true
			}
		}
	}

	// Apply AI rewrite rules (type=4)
	if len(simpleResponse.Choices) > 0 {
		if rewrittenContent, rewritten := service.ApplyResponseRewriteRules(
			simpleResponse.Choices[0].Message.StringContent(), info.ChannelId, info.OriginModelName,
		); rewritten {
			simpleResponse.Choices[0].Message.SetStringContent(rewrittenContent)
			forceFormat = true
		}
	}

	usageModified := false
	if simpleResponse.Usage.PromptTokens == 0 {
		completionTokens := simpleResponse.Usage.CompletionTokens
		if completionTokens == 0 {
			for _, choice := range simpleResponse.Choices {
				ctkm := service.CountTextToken(choice.Message.StringContent()+choice.Message.ReasoningContent+choice.Message.Reasoning, info.UpstreamModelName)
				completionTokens += ctkm
			}
		}
		simpleResponse.Usage = dto.Usage{
			PromptTokens:     info.GetEstimatePromptTokens(),
			CompletionTokens: completionTokens,
			TotalTokens:      info.GetEstimatePromptTokens() + completionTokens,
		}
		usageModified = true
	}

	applyUsagePostProcessing(info, &simpleResponse.Usage, responseBody)

	switch info.RelayFormat {
	case types.RelayFormatOpenAI:
		if usageModified {
			var bodyMap map[string]interface{}
			err = common.Unmarshal(responseBody, &bodyMap)
			if err != nil {
				return nil, types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusInternalServerError)
			}
			bodyMap["usage"] = simpleResponse.Usage
			responseBody, _ = common.Marshal(bodyMap)
		}
		if forceFormat {
			responseBody, err = common.Marshal(simpleResponse)
			if err != nil {
				return nil, types.NewError(err, types.ErrorCodeBadResponseBody)
			}
		} else {
			break
		}
	case types.RelayFormatClaude:
		claudeResp := service.ResponseOpenAI2Claude(&simpleResponse, info)
		claudeRespStr, err := common.Marshal(claudeResp)
		if err != nil {
			return nil, types.NewError(err, types.ErrorCodeBadResponseBody)
		}
		responseBody = claudeRespStr
	case types.RelayFormatGemini:
		geminiResp := service.ResponseOpenAI2Gemini(&simpleResponse, info)
		geminiRespStr, err := common.Marshal(geminiResp)
		if err != nil {
			return nil, types.NewError(err, types.ErrorCodeBadResponseBody)
		}
		responseBody = geminiRespStr
	}

	service.IOCopyBytesGracefully(c, resp, responseBody)

	return &simpleResponse.Usage, nil
}

func streamTTSResponse(c *gin.Context, resp *http.Response) {
	c.Writer.WriteHeaderNow()

	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		logger.LogWarn(c, "streaming not supported")
		_, err := io.Copy(c.Writer, resp.Body)
		if err != nil {
			logger.LogWarn(c, err.Error())
		}
		return
	}

	buffer := make([]byte, 4096)
	for {
		n, err := resp.Body.Read(buffer)
		//logger.LogInfo(c, fmt.Sprintf("streamTTSResponse read %d bytes", n))
		if n > 0 {
			if _, writeErr := c.Writer.Write(buffer[:n]); writeErr != nil {
				logger.LogError(c, writeErr.Error())
				break
			}
			flusher.Flush()
		}
		if err != nil {
			if err != io.EOF {
				logger.LogError(c, err.Error())
			}
			break
		}
	}
}

func OpenaiRealtimeHandler(c *gin.Context, info *relaycommon.RelayInfo) (*types.NewAPIError, *dto.RealtimeUsage) {
	if info == nil || info.ClientWs == nil || info.TargetWs == nil {
		return types.NewError(fmt.Errorf("invalid websocket connection"), types.ErrorCodeBadResponse), nil
	}

	info.IsStream = true
	clientConn := info.ClientWs
	targetConn := info.TargetWs

	clientClosed := make(chan struct{})
	targetClosed := make(chan struct{})
	sendChan := make(chan []byte, 100)
	receiveChan := make(chan []byte, 100)
	errChan := make(chan error, 2)

	usage := &dto.RealtimeUsage{}
	localUsage := &dto.RealtimeUsage{}
	sumUsage := &dto.RealtimeUsage{}

	gopool.Go(func() {
		defer func() {
			if r := recover(); r != nil {
				errChan <- fmt.Errorf("panic in client reader: %v", r)
			}
		}()
		for {
			select {
			case <-c.Done():
				return
			default:
				_, message, err := clientConn.ReadMessage()
				if err != nil {
					if !websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
						errChan <- fmt.Errorf("error reading from client: %v", err)
					}
					close(clientClosed)
					return
				}

				realtimeEvent := &dto.RealtimeEvent{}
				err = common.Unmarshal(message, realtimeEvent)
				if err != nil {
					errChan <- fmt.Errorf("error unmarshalling message: %v", err)
					return
				}

				if realtimeEvent.Type == dto.RealtimeEventTypeSessionUpdate {
					if realtimeEvent.Session != nil {
						if realtimeEvent.Session.Tools != nil {
							info.RealtimeTools = realtimeEvent.Session.Tools
						}
					}
				}

				textToken, audioToken, err := service.CountTokenRealtime(info, *realtimeEvent, info.UpstreamModelName)
				if err != nil {
					errChan <- fmt.Errorf("error counting text token: %v", err)
					return
				}
				logger.LogInfo(c, fmt.Sprintf("type: %s, textToken: %d, audioToken: %d", realtimeEvent.Type, textToken, audioToken))
				localUsage.TotalTokens += textToken + audioToken
				localUsage.InputTokens += textToken + audioToken
				localUsage.InputTokenDetails.TextTokens += textToken
				localUsage.InputTokenDetails.AudioTokens += audioToken

				err = helper.WssString(c, targetConn, string(message))
				if err != nil {
					errChan <- fmt.Errorf("error writing to target: %v", err)
					return
				}

				select {
				case sendChan <- message:
				default:
				}
			}
		}
	})

	gopool.Go(func() {
		defer func() {
			if r := recover(); r != nil {
				errChan <- fmt.Errorf("panic in target reader: %v", r)
			}
		}()
		for {
			select {
			case <-c.Done():
				return
			default:
				_, message, err := targetConn.ReadMessage()
				if err != nil {
					if !websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
						errChan <- fmt.Errorf("error reading from target: %v", err)
					}
					close(targetClosed)
					return
				}
				info.SetFirstResponseTime()
				realtimeEvent := &dto.RealtimeEvent{}
				err = common.Unmarshal(message, realtimeEvent)
				if err != nil {
					errChan <- fmt.Errorf("error unmarshalling message: %v", err)
					return
				}

				if realtimeEvent.Type == dto.RealtimeEventTypeResponseDone {
					realtimeUsage := realtimeEvent.Response.Usage
					if realtimeUsage != nil {
						usage.TotalTokens += realtimeUsage.TotalTokens
						usage.InputTokens += realtimeUsage.InputTokens
						usage.OutputTokens += realtimeUsage.OutputTokens
						usage.InputTokenDetails.AudioTokens += realtimeUsage.InputTokenDetails.AudioTokens
						usage.InputTokenDetails.CachedTokens += realtimeUsage.InputTokenDetails.CachedTokens
						usage.InputTokenDetails.TextTokens += realtimeUsage.InputTokenDetails.TextTokens
						usage.OutputTokenDetails.AudioTokens += realtimeUsage.OutputTokenDetails.AudioTokens
						usage.OutputTokenDetails.TextTokens += realtimeUsage.OutputTokenDetails.TextTokens
						err := preConsumeUsage(c, info, usage, sumUsage)
						if err != nil {
							errChan <- fmt.Errorf("error consume usage: %v", err)
							return
						}
						// 本次计费完成，清除
						usage = &dto.RealtimeUsage{}

						localUsage = &dto.RealtimeUsage{}
					} else {
						textToken, audioToken, err := service.CountTokenRealtime(info, *realtimeEvent, info.UpstreamModelName)
						if err != nil {
							errChan <- fmt.Errorf("error counting text token: %v", err)
							return
						}
						logger.LogInfo(c, fmt.Sprintf("type: %s, textToken: %d, audioToken: %d", realtimeEvent.Type, textToken, audioToken))
						localUsage.TotalTokens += textToken + audioToken
						info.IsFirstRequest = false
						localUsage.InputTokens += textToken + audioToken
						localUsage.InputTokenDetails.TextTokens += textToken
						localUsage.InputTokenDetails.AudioTokens += audioToken
						err = preConsumeUsage(c, info, localUsage, sumUsage)
						if err != nil {
							errChan <- fmt.Errorf("error consume usage: %v", err)
							return
						}
						// 本次计费完成，清除
						localUsage = &dto.RealtimeUsage{}
						// print now usage
					}
					logger.LogInfo(c, fmt.Sprintf("realtime streaming sumUsage: %v", sumUsage))
					logger.LogInfo(c, fmt.Sprintf("realtime streaming localUsage: %v", localUsage))
					logger.LogInfo(c, fmt.Sprintf("realtime streaming localUsage: %v", localUsage))

				} else if realtimeEvent.Type == dto.RealtimeEventTypeSessionUpdated || realtimeEvent.Type == dto.RealtimeEventTypeSessionCreated {
					realtimeSession := realtimeEvent.Session
					if realtimeSession != nil {
						// update audio format
						info.InputAudioFormat = common.GetStringIfEmpty(realtimeSession.InputAudioFormat, info.InputAudioFormat)
						info.OutputAudioFormat = common.GetStringIfEmpty(realtimeSession.OutputAudioFormat, info.OutputAudioFormat)
					}
				} else {
					textToken, audioToken, err := service.CountTokenRealtime(info, *realtimeEvent, info.UpstreamModelName)
					if err != nil {
						errChan <- fmt.Errorf("error counting text token: %v", err)
						return
					}
					logger.LogInfo(c, fmt.Sprintf("type: %s, textToken: %d, audioToken: %d", realtimeEvent.Type, textToken, audioToken))
					localUsage.TotalTokens += textToken + audioToken
					localUsage.OutputTokens += textToken + audioToken
					localUsage.OutputTokenDetails.TextTokens += textToken
					localUsage.OutputTokenDetails.AudioTokens += audioToken
				}

				err = helper.WssString(c, clientConn, string(message))
				if err != nil {
					errChan <- fmt.Errorf("error writing to client: %v", err)
					return
				}

				select {
				case receiveChan <- message:
				default:
				}
			}
		}
	})

	select {
	case <-clientClosed:
	case <-targetClosed:
	case err := <-errChan:
		//return service.OpenAIErrorWrapper(err, "realtime_error", http.StatusInternalServerError), nil
		logger.LogError(c, "realtime error: "+err.Error())
	case <-c.Done():
	}

	if usage.TotalTokens != 0 {
		_ = preConsumeUsage(c, info, usage, sumUsage)
	}

	if localUsage.TotalTokens != 0 {
		_ = preConsumeUsage(c, info, localUsage, sumUsage)
	}

	// check usage total tokens, if 0, use local usage

	return nil, sumUsage
}

func preConsumeUsage(ctx *gin.Context, info *relaycommon.RelayInfo, usage *dto.RealtimeUsage, totalUsage *dto.RealtimeUsage) error {
	if usage == nil || totalUsage == nil {
		return fmt.Errorf("invalid usage pointer")
	}

	totalUsage.TotalTokens += usage.TotalTokens
	totalUsage.InputTokens += usage.InputTokens
	totalUsage.OutputTokens += usage.OutputTokens
	totalUsage.InputTokenDetails.CachedTokens += usage.InputTokenDetails.CachedTokens
	totalUsage.InputTokenDetails.TextTokens += usage.InputTokenDetails.TextTokens
	totalUsage.InputTokenDetails.AudioTokens += usage.InputTokenDetails.AudioTokens
	totalUsage.OutputTokenDetails.TextTokens += usage.OutputTokenDetails.TextTokens
	totalUsage.OutputTokenDetails.AudioTokens += usage.OutputTokenDetails.AudioTokens
	// clear usage
	err := service.PreWssConsumeQuota(ctx, info, usage)
	return err
}

func OpenaiHandlerWithUsage(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	defer service.CloseResponseBodyGracefully(resp)

	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeReadResponseBodyFailed, http.StatusInternalServerError)
	}

	if usage, handled, apiErr := handleApimartAsyncImageGeneration(c, info, resp, responseBody); handled {
		return usage, apiErr
	}

	var usageResp dto.SimpleResponse
	err = common.Unmarshal(responseBody, &usageResp)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusInternalServerError)
	}

	// 写入新的 response body
	service.IOCopyBytesGracefully(c, resp, responseBody)

	// Once we've written to the client, we should not return errors anymore
	// because the upstream has already consumed resources and returned content
	// We should still perform billing even if parsing fails
	// format
	if usageResp.InputTokens > 0 {
		usageResp.PromptTokens += usageResp.InputTokens
	}
	if usageResp.OutputTokens > 0 {
		usageResp.CompletionTokens += usageResp.OutputTokens
	}
	if usageResp.InputTokensDetails != nil {
		usageResp.PromptTokensDetails.ImageTokens += usageResp.InputTokensDetails.ImageTokens
		usageResp.PromptTokensDetails.TextTokens += usageResp.InputTokensDetails.TextTokens
	}
	applyUsagePostProcessing(info, &usageResp.Usage, responseBody)
	return &usageResp.Usage, nil
}

func handleApimartAsyncImageGeneration(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response, submitBody []byte) (*dto.Usage, bool, *types.NewAPIError) {
	if info == nil ||
		info.ChannelType != constant.ChannelTypeApimart ||
		info.RelayMode != relayconstant.RelayModeImagesGenerations {
		return nil, false, nil
	}

	var submitResp struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
		Data    []struct {
			Status string `json:"status"`
			TaskID string `json:"task_id"`
		} `json:"data"`
	}
	if err := common.Unmarshal(submitBody, &submitResp); err != nil {
		return nil, true, types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusInternalServerError)
	}
	if len(submitResp.Data) == 0 || strings.TrimSpace(submitResp.Data[0].TaskID) == "" {
		return nil, true, types.NewOpenAIError(fmt.Errorf("apimart response missing task_id"), types.ErrorCodeBadResponseBody, http.StatusInternalServerError)
	}

	taskID := submitResp.Data[0].TaskID
	adaptor := &taskapimart.TaskAdaptor{}
	baseURL := info.ChannelBaseUrl
	apiKey := info.ApiKey
	proxy := info.ChannelSetting.Proxy

	time.Sleep(5 * time.Second)
	for i := 0; i < 20; i++ {
		fetchResp, err := adaptor.FetchTask(baseURL, apiKey, map[string]any{"task_id": taskID}, proxy)
		if err != nil {
			logger.LogWarn(c.Request.Context(), "apimart image poll failed: "+err.Error())
			time.Sleep(10 * time.Second)
			continue
		}
		body, readErr := io.ReadAll(fetchResp.Body)
		_ = fetchResp.Body.Close()
		if readErr != nil {
			return nil, true, types.NewOpenAIError(readErr, types.ErrorCodeReadResponseBodyFailed, http.StatusInternalServerError)
		}
		if fetchResp.StatusCode != http.StatusOK {
			return nil, true, types.NewOpenAIError(fmt.Errorf("apimart poll returned %d: %s", fetchResp.StatusCode, string(body)), types.ErrorCodeBadResponse, fetchResp.StatusCode)
		}
		taskInfo, err := adaptor.ParseTaskResult(body)
		if err != nil {
			return nil, true, types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusInternalServerError)
		}
		switch taskInfo.Status {
		case "SUCCESS":
			imageResp := dto.ImageResponse{
				Created: common.GetTimestamp(),
				Data:    make([]dto.ImageData, 0, len(taskInfo.Urls)),
			}
			for _, imageURL := range taskInfo.Urls {
				imageResp.Data = append(imageResp.Data, dto.ImageData{Url: imageURL})
			}
			jsonResponse, err := common.Marshal(imageResp)
			if err != nil {
				return nil, true, types.NewError(err, types.ErrorCodeBadResponseBody)
			}
			service.IOCopyBytesGracefully(c, resp, jsonResponse)
			return &dto.Usage{}, true, nil
		case "FAILURE":
			reason := taskInfo.Reason
			if reason == "" {
				reason = "apimart image task failed"
			}
			return nil, true, types.NewOpenAIError(fmt.Errorf("%s", reason), types.ErrorCodeBadResponse, http.StatusBadGateway)
		default:
			time.Sleep(10 * time.Second)
		}
	}
	return nil, true, types.NewOpenAIError(fmt.Errorf("apimart image task polling timeout"), types.ErrorCodeBadResponse, http.StatusGatewayTimeout)
}

func applyUsagePostProcessing(info *relaycommon.RelayInfo, usage *dto.Usage, responseBody []byte) {
	if info == nil || usage == nil {
		return
	}

	switch info.ChannelType {
	case constant.ChannelTypeDeepSeek:
		if usage.PromptTokensDetails.CachedTokens == 0 && usage.PromptCacheHitTokens != 0 {
			usage.PromptTokensDetails.CachedTokens = usage.PromptCacheHitTokens
		}
	case constant.ChannelTypeZhipu_v4:
		// 智普的cached_tokens在标准位置: usage.prompt_tokens_details.cached_tokens
		if usage.PromptTokensDetails.CachedTokens == 0 {
			if usage.InputTokensDetails != nil && usage.InputTokensDetails.CachedTokens > 0 {
				usage.PromptTokensDetails.CachedTokens = usage.InputTokensDetails.CachedTokens
			} else if cachedTokens, ok := extractCachedTokensFromBody(responseBody); ok {
				usage.PromptTokensDetails.CachedTokens = cachedTokens
			} else if usage.PromptCacheHitTokens > 0 {
				usage.PromptTokensDetails.CachedTokens = usage.PromptCacheHitTokens
			}
		}
	case constant.ChannelTypeMoonshot:
		// Moonshot的cached_tokens在非标准位置: choices[].usage.cached_tokens
		if usage.PromptTokensDetails.CachedTokens == 0 {
			if usage.InputTokensDetails != nil && usage.InputTokensDetails.CachedTokens > 0 {
				usage.PromptTokensDetails.CachedTokens = usage.InputTokensDetails.CachedTokens
			} else if cachedTokens, ok := extractMoonshotCachedTokensFromBody(responseBody); ok {
				usage.PromptTokensDetails.CachedTokens = cachedTokens
			} else if cachedTokens, ok := extractCachedTokensFromBody(responseBody); ok {
				usage.PromptTokensDetails.CachedTokens = cachedTokens
			} else if usage.PromptCacheHitTokens > 0 {
				usage.PromptTokensDetails.CachedTokens = usage.PromptCacheHitTokens
			}
		}
	case constant.ChannelTypeOpenAI:
		if usage.PromptTokensDetails.CachedTokens == 0 {
			if cachedTokens, ok := extractLlamaCachedTokensFromBody(responseBody); ok {
				usage.PromptTokensDetails.CachedTokens = cachedTokens
			}
		}
	}
}

func extractCachedTokensFromBody(body []byte) (int, bool) {
	if len(body) == 0 {
		return 0, false
	}

	var payload struct {
		Usage struct {
			PromptTokensDetails struct {
				CachedTokens *int `json:"cached_tokens"`
			} `json:"prompt_tokens_details"`
			CachedTokens         *int `json:"cached_tokens"`
			PromptCacheHitTokens *int `json:"prompt_cache_hit_tokens"`
		} `json:"usage"`
	}

	if err := common.Unmarshal(body, &payload); err != nil {
		return 0, false
	}

	if payload.Usage.PromptTokensDetails.CachedTokens != nil {
		return *payload.Usage.PromptTokensDetails.CachedTokens, true
	}
	if payload.Usage.CachedTokens != nil {
		return *payload.Usage.CachedTokens, true
	}
	if payload.Usage.PromptCacheHitTokens != nil {
		return *payload.Usage.PromptCacheHitTokens, true
	}
	return 0, false
}

// extractMoonshotCachedTokensFromBody 从Moonshot的非标准位置提取cached_tokens
// Moonshot的流式响应格式: {"choices":[{"usage":{"cached_tokens":111}}]}
func extractMoonshotCachedTokensFromBody(body []byte) (int, bool) {
	if len(body) == 0 {
		return 0, false
	}

	var payload struct {
		Choices []struct {
			Usage struct {
				CachedTokens *int `json:"cached_tokens"`
			} `json:"usage"`
		} `json:"choices"`
	}

	if err := common.Unmarshal(body, &payload); err != nil {
		return 0, false
	}

	// 遍历choices查找cached_tokens
	for _, choice := range payload.Choices {
		if choice.Usage.CachedTokens != nil && *choice.Usage.CachedTokens > 0 {
			return *choice.Usage.CachedTokens, true
		}
	}

	return 0, false
}

// extractLlamaCachedTokensFromBody 从llama.cpp的非标准位置提取cache_n
func extractLlamaCachedTokensFromBody(body []byte) (int, bool) {
	if len(body) == 0 {
		return 0, false
	}

	var payload struct {
		Timings struct {
			CachedTokens *int `json:"cache_n"`
		} `json:"timings"`
	}

	if err := common.Unmarshal(body, &payload); err != nil {
		return 0, false
	}

	if payload.Timings.CachedTokens == nil {
		return 0, false
	}
	return *payload.Timings.CachedTokens, true
}
