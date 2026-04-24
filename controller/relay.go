package controller

import (
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/types"

	"github.com/bytedance/gopkg/util/gopool"
	"github.com/samber/lo"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

// RetryError records a single failed relay attempt for admin logging.
type RetryError struct {
	ChannelId          int               `json:"channel_id"`
	ChannelName        string            `json:"channel_name"`
	StatusCode         int               `json:"status_code"`
	Message            string            `json:"message"`
	UpstreamBody       string            `json:"upstream_body,omitempty"`
	ElapsedMs          int64             `json:"elapsed_ms"`
	UpstreamRequestIds map[string]string `json:"upstream_request_ids,omitempty"`
}

func addRetryError(c *gin.Context, re RetryError) {
	val, exists := c.Get("retry_errors")
	var errs []RetryError
	if exists {
		errs, _ = val.([]RetryError)
	}
	errs = append(errs, re)
	c.Set("retry_errors", errs)
}

func getRetryErrors(c *gin.Context) []RetryError {
	val, exists := c.Get("retry_errors")
	if !exists {
		return nil
	}
	errs, _ := val.([]RetryError)
	return errs
}

func getChannelChain(c *gin.Context) string {
	if c == nil {
		return ""
	}
	if retryErrs := getRetryErrors(c); len(retryErrs) > 0 {
		ids := make([]string, 0, len(retryErrs))
		for _, re := range retryErrs {
			ids = append(ids, fmt.Sprintf("%d", re.ChannelId))
		}
		return strings.Join(ids, "->")
	}
	if useChannel := c.GetStringSlice("use_channel"); len(useChannel) > 0 {
		return strings.Join(useChannel, "->")
	}
	return ""
}

func getLastRetryError(c *gin.Context) *RetryError {
	retryErrs := getRetryErrors(c)
	if len(retryErrs) == 0 {
		return nil
	}
	last := retryErrs[len(retryErrs)-1]
	return &last
}

func formatUpstreamRequestIDs(ids map[string]string) string {
	if len(ids) == 0 {
		return ""
	}
	keys := make([]string, 0, len(ids))
	for key := range ids {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		parts = append(parts, fmt.Sprintf("%s=%s", key, ids[key]))
	}
	return strings.Join(parts, ",")
}

func truncateLogValue(value string, limit int) string {
	if limit <= 0 || len(value) <= limit {
		return value
	}
	return value[:limit] + "..."
}

func buildRelayErrorLogMessage(c *gin.Context, err *types.NewAPIError) string {
	if err == nil {
		return "relay error"
	}
	fields := make([]string, 0, 10)
	if c != nil && c.Request != nil && c.Request.URL != nil {
		fields = append(fields, fmt.Sprintf("request=%s %s", c.Request.Method, c.Request.URL.Path))
	}
	if c != nil {
		if modelName := c.GetString("original_model"); modelName != "" {
			fields = append(fields, fmt.Sprintf("model=%s", modelName))
		}
		if group := c.GetString("group"); group != "" {
			fields = append(fields, fmt.Sprintf("group=%s", group))
		}
		if channelId := c.GetInt("channel_id"); channelId > 0 {
			fields = append(fields, fmt.Sprintf("channel=#%d(%s,type=%d)", channelId, c.GetString("channel_name"), c.GetInt("channel_type")))
		}
		if chain := getChannelChain(c); chain != "" {
			fields = append(fields, fmt.Sprintf("channel_chain=%s", chain))
		}
		if baseURL := common.GetContextKeyString(c, constant.ContextKeyChannelBaseUrl); baseURL != "" {
			fields = append(fields, fmt.Sprintf("base_url=%s", baseURL))
		}
	}
	fields = append(fields, fmt.Sprintf("status=%d", err.StatusCode))
	if err.UpstreamStatusCode > 0 && err.UpstreamStatusCode != err.StatusCode {
		fields = append(fields, fmt.Sprintf("upstream_status=%d", err.UpstreamStatusCode))
	}
	if code := err.GetErrorCode(); code != "" {
		fields = append(fields, fmt.Sprintf("error_code=%s", code))
	}
	if errorType := err.GetErrorType(); errorType != "" {
		fields = append(fields, fmt.Sprintf("error_type=%s", errorType))
	}
	if lastRetry := getLastRetryError(c); lastRetry != nil && len(lastRetry.UpstreamRequestIds) > 0 {
		fields = append(fields, fmt.Sprintf("upstream_request_ids=%s", formatUpstreamRequestIDs(lastRetry.UpstreamRequestIds)))
	}
	fields = append(fields, fmt.Sprintf("message=%s", truncateLogValue(err.MaskSensitiveError(), 300)))
	return "relay error | " + strings.Join(fields, " | ")
}

func buildChannelErrorLogMessage(c *gin.Context, channelError types.ChannelError, err *types.NewAPIError, willDisable bool) string {
	if err == nil {
		return fmt.Sprintf("channel error | channel=#%d(%s,type=%d)", channelError.ChannelId, channelError.ChannelName, channelError.ChannelType)
	}
	fields := []string{
		fmt.Sprintf("channel=#%d(%s,type=%d)", channelError.ChannelId, channelError.ChannelName, channelError.ChannelType),
		fmt.Sprintf("auto_ban=%t", channelError.AutoBan),
		fmt.Sprintf("will_disable=%t", willDisable),
		fmt.Sprintf("status=%d", err.StatusCode),
	}
	if c != nil {
		if c.Request != nil && c.Request.URL != nil {
			fields = append(fields, fmt.Sprintf("request=%s %s", c.Request.Method, c.Request.URL.Path))
		}
		if modelName := c.GetString("original_model"); modelName != "" {
			fields = append(fields, fmt.Sprintf("model=%s", modelName))
		}
		if chain := getChannelChain(c); chain != "" {
			fields = append(fields, fmt.Sprintf("channel_chain=%s", chain))
		}
	}
	if code := err.GetErrorCode(); code != "" {
		fields = append(fields, fmt.Sprintf("error_code=%s", code))
	}
	if errorType := err.GetErrorType(); errorType != "" {
		fields = append(fields, fmt.Sprintf("error_type=%s", errorType))
	}
	if lastRetry := getLastRetryError(c); lastRetry != nil && len(lastRetry.UpstreamRequestIds) > 0 {
		fields = append(fields, fmt.Sprintf("upstream_request_ids=%s", formatUpstreamRequestIDs(lastRetry.UpstreamRequestIds)))
	}
	fields = append(fields, fmt.Sprintf("message=%s", truncateLogValue(err.MaskSensitiveError(), 300)))
	return "channel error | " + strings.Join(fields, " | ")
}

func appendErrorDiagnosticInfo(c *gin.Context, other map[string]interface{}, adminInfo map[string]interface{}) {
	if c == nil {
		return
	}
	if c.Request != nil && c.Request.URL != nil {
		other["request_path"] = c.Request.URL.Path
		other["request_method"] = c.Request.Method
	}
	if chain := getChannelChain(c); chain != "" {
		adminInfo["channel_chain"] = chain
	}
	if baseURL := common.GetContextKeyString(c, constant.ContextKeyChannelBaseUrl); baseURL != "" {
		adminInfo["channel_base_url"] = baseURL
	}
	if retryErrors := getRetryErrors(c); len(retryErrors) > 0 {
		adminInfo["retry_errors"] = retryErrors
		adminInfo["retry_count"] = len(retryErrors)
		if lastRetry := retryErrors[len(retryErrors)-1]; lastRetry.ChannelId > 0 {
			adminInfo["last_retry_error"] = lastRetry
			if len(lastRetry.UpstreamRequestIds) > 0 {
				adminInfo["upstream_request_ids"] = lastRetry.UpstreamRequestIds
			}
		}
	}
}

// friendlyErrorMessage converts raw upstream error into a concise, user-friendly message.
// Users see a clean Chinese summary + status code; raw details are only in admin logs.
func friendlyErrorMessage(err *types.NewAPIError) string {
	if err == nil {
		return "未知错误"
	}
	code := err.StatusCode
	msg := err.Error()
	lower := strings.ToLower(msg)

	// Map common upstream errors to friendly Chinese messages
	switch {
	case code == 401 || strings.Contains(lower, "unauthorized") || strings.Contains(lower, "invalid.*key"):
		return fmt.Sprintf("请求失败(%d)：渠道认证失败", code)
	case code == 403 || strings.Contains(lower, "forbidden") || strings.Contains(lower, "permission"):
		return fmt.Sprintf("请求失败(%d)：访问被拒绝", code)
	case code == 404 || strings.Contains(lower, "not found") || strings.Contains(lower, "does not exist"):
		return fmt.Sprintf("请求失败(%d)：模型或端点不存在", code)
	case code == 429 || strings.Contains(lower, "rate limit") || strings.Contains(lower, "too many request") || strings.Contains(lower, "quota exceeded"):
		return fmt.Sprintf("请求失败(%d)：上游限流，请稍后重试", code)
	case code == 500 || strings.Contains(lower, "internal server error") || strings.Contains(lower, "internal error"):
		return fmt.Sprintf("请求失败(%d)：上游服务异常", code)
	case code == 502 || strings.Contains(lower, "bad gateway"):
		return fmt.Sprintf("请求失败(%d)：上游网关错误", code)
	case code == 503 || strings.Contains(lower, "overloaded") || strings.Contains(lower, "unavailable"):
		return fmt.Sprintf("请求失败(%d)：上游服务过载或不可用", code)
	case code == 504 || strings.Contains(lower, "timeout") || strings.Contains(lower, "timed out"):
		return fmt.Sprintf("请求失败(%d)：上游请求超时", code)
	case strings.Contains(lower, "context length") || strings.Contains(lower, "maximum.*token") || strings.Contains(lower, "too long"):
		return fmt.Sprintf("请求失败(%d)：输入内容超出模型最大长度", code)
	case strings.Contains(lower, "content filter") || strings.Contains(lower, "safety") || strings.Contains(lower, "blocked"):
		return fmt.Sprintf("请求失败(%d)：内容被安全过滤拦截", code)
	case strings.Contains(lower, "empty response") || strings.Contains(lower, "empty content"):
		return fmt.Sprintf("请求失败(%d)：上游返回空响应，已自动重试", code)
	case code >= 400 && code < 500:
		return fmt.Sprintf("请求失败(%d)：请求参数错误", code)
	case code >= 500:
		return fmt.Sprintf("请求失败(%d)：上游服务异常", code)
	default:
		// Fallback: mask sensitive info but keep it concise
		masked := common.MaskSensitiveInfo(msg)
		if len(masked) > 100 {
			masked = masked[:100] + "..."
		}
		return fmt.Sprintf("请求失败(%d)：%s", code, masked)
	}
}

// isUpstreamRelayError returns true if the error originates from an upstream
// provider (channel), as opposed to being generated locally by our system
// (e.g. quota checks, validation, auth). System errors have well-known error
// codes and should keep their original messages so users see actionable info
// like "额度不足" instead of a generic "访问被拒绝".
func isUpstreamRelayError(err *types.NewAPIError) bool {
	if err == nil {
		return false
	}
	switch err.GetErrorCode() {
	case types.ErrorCodeInsufficientUserQuota,
		types.ErrorCodePreConsumeTokenQuotaFailed,
		types.ErrorCodeInvalidRequest,
		types.ErrorCodeReadRequestBodyFailed,
		types.ErrorCodeCountTokenFailed,
		types.ErrorCodeGenRelayInfoFailed,
		types.ErrorCodeSensitiveWordsDetected,
		types.ErrorCodeModelPriceError,
		types.ErrorCodeUpdateDataError,
		types.ErrorCodeQueryDataError,
		types.ErrorCodeGetChannelFailed,
		types.ErrorCodeTenantQuotaExceeded,
		types.ErrorCodeTenantRPMExceeded,
		types.ErrorCodeTenantModelForbidden:
		return false
	}
	return true
}

func relayHandler(c *gin.Context, info *relaycommon.RelayInfo) *types.NewAPIError {
	var err *types.NewAPIError
	switch info.RelayMode {
	case relayconstant.RelayModeImagesGenerations, relayconstant.RelayModeImagesEdits:
		err = relay.ImageHelper(c, info)
	case relayconstant.RelayModeAudioSpeech:
		fallthrough
	case relayconstant.RelayModeAudioTranslation:
		fallthrough
	case relayconstant.RelayModeAudioTranscription:
		err = relay.AudioHelper(c, info)
	case relayconstant.RelayModeRerank:
		err = relay.RerankHelper(c, info)
	case relayconstant.RelayModeEmbeddings:
		err = relay.EmbeddingHelper(c, info)
	case relayconstant.RelayModeResponses, relayconstant.RelayModeResponsesCompact:
		err = relay.ResponsesHelper(c, info)
	default:
		err = relay.TextHelper(c, info)
	}
	return err
}

func geminiRelayHandler(c *gin.Context, info *relaycommon.RelayInfo) *types.NewAPIError {
	var err *types.NewAPIError
	if strings.Contains(c.Request.URL.Path, "embed") {
		err = relay.GeminiEmbeddingHandler(c, info)
	} else {
		err = relay.GeminiHelper(c, info)
	}
	return err
}

func Relay(c *gin.Context, relayFormat types.RelayFormat) {

	requestId := c.GetString(common.RequestIdKey)
	//group := common.GetContextKeyString(c, constant.ContextKeyUsingGroup)
	//originalModel := common.GetContextKeyString(c, constant.ContextKeyOriginalModel)

	var (
		newAPIError *types.NewAPIError
		ws          *websocket.Conn
	)

	if relayFormat == types.RelayFormatOpenAIRealtime {
		var err error
		ws, err = upgrader.Upgrade(c.Writer, c.Request, nil)
		if err != nil {
			helper.WssError(c, ws, types.NewError(err, types.ErrorCodeGetChannelFailed, types.ErrOptionWithSkipRetry()).ToOpenAIError())
			return
		}
		defer ws.Close()
	}

	defer func() {
		if newAPIError != nil {
			logger.LogError(c, buildRelayErrorLogMessage(c, newAPIError))

			// Always record the final relay error to logs table for request tracing.
			// This is the ONLY log entry for a normal relay request — channel retry
			// errors are consolidated into admin_info.retry_errors, not logged separately.
			recordRelayErrorForTrace(c, newAPIError)

			// Build channel chain string (e.g., "3-5-12") from retry history
			channelChain := strings.ReplaceAll(getChannelChain(c), "->", "-")
			// Build user-facing error message.
			// Only apply friendlyErrorMessage to upstream relay errors;
			// system-generated errors (quota, auth, validation) keep their original message.
			var displayMsg string
			if isUpstreamRelayError(newAPIError) {
				displayMsg = friendlyErrorMessage(newAPIError)
			} else {
				displayMsg = newAPIError.Error()
			}
			suffix := ""
			if requestId != "" && channelChain != "" {
				suffix = fmt.Sprintf(" (request id: %s, %s)", requestId, channelChain)
			} else if requestId != "" {
				suffix = fmt.Sprintf(" (request id: %s)", requestId)
			} else if channelChain != "" {
				suffix = fmt.Sprintf(" (%s)", channelChain)
			}
			newAPIError.SetMessage(displayMsg + suffix)
			switch relayFormat {
			case types.RelayFormatOpenAIRealtime:
				helper.WssError(c, ws, newAPIError.ToOpenAIError())
			case types.RelayFormatClaude:
				c.JSON(newAPIError.StatusCode, gin.H{
					"type":  "error",
					"error": newAPIError.ToClaudeError(),
				})
			default:
				c.JSON(newAPIError.StatusCode, gin.H{
					"error": newAPIError.ToOpenAIError(),
				})
			}
		}
	}()

	request, err := helper.GetAndValidateRequest(c, relayFormat)
	if err != nil {
		addTraceEvent(c, "validate", fmt.Sprintf("请求验证失败: %s", err.Error()), nil)
		// Map "request body too large" to 413 so clients can handle it correctly
		if common.IsRequestBodyTooLargeError(err) || errors.Is(err, common.ErrRequestBodyTooLarge) {
			newAPIError = types.NewErrorWithStatusCode(err, types.ErrorCodeReadRequestBodyFailed, http.StatusRequestEntityTooLarge, types.ErrOptionWithSkipRetry())
		} else {
			newAPIError = types.NewError(err, types.ErrorCodeInvalidRequest)
		}
		return
	}

	// Apply global prompt replacement rules (channelId=0)
	addTraceEvent(c, "validate", "请求验证通过", map[string]interface{}{
		"format": string(relayFormat),
	})

	if openaiReq, ok := request.(*dto.GeneralOpenAIRequest); ok {
		service.ApplyPromptRules(openaiReq, 0)
	}

	relayInfo, err := relaycommon.GenRelayInfo(c, relayFormat, request, ws)
	if err != nil {
		addTraceEvent(c, "init", fmt.Sprintf("RelayInfo 初始化失败: %s", err.Error()), nil)
		newAPIError = types.NewError(err, types.ErrorCodeGenRelayInfoFailed)
		return
	}
	addTraceEvent(c, "init", "RelayInfo 初始化完成", map[string]interface{}{
		"model":     relayInfo.OriginModelName,
		"group":     relayInfo.TokenGroup,
		"is_stream": relayInfo.IsStream,
	})

	// ── Tenant-level enforcement: quota / RPM / model access ──
	if relayInfo.TenantId > 0 {
		if err := service.CheckTenantQuota(relayInfo.TenantId); err != nil {
			addTraceEvent(c, "tenant_check", fmt.Sprintf("租户额度检查失败: %s", err.Error()), nil)
			newAPIError = types.NewErrorWithStatusCode(err, types.ErrorCodeTenantQuotaExceeded, http.StatusTooManyRequests, types.ErrOptionWithSkipRetry())
			return
		}
		if err := service.CheckTenantRPM(relayInfo.TenantId); err != nil {
			addTraceEvent(c, "tenant_check", fmt.Sprintf("租户RPM检查失败: %s", err.Error()), nil)
			newAPIError = types.NewErrorWithStatusCode(err, types.ErrorCodeTenantRPMExceeded, http.StatusTooManyRequests, types.ErrOptionWithSkipRetry())
			return
		}
		if err := service.CheckTenantTPM(relayInfo.TenantId); err != nil {
			addTraceEvent(c, "tenant_check", fmt.Sprintf("租户TPM检查失败: %s", err.Error()), nil)
			newAPIError = types.NewErrorWithStatusCode(err, types.ErrorCodeTenantTPMExceeded, http.StatusTooManyRequests, types.ErrOptionWithSkipRetry())
			return
		}
		if err := service.CheckTenantModelAccess(relayInfo.TenantId, relayInfo.OriginModelName); err != nil {
			addTraceEvent(c, "tenant_check", fmt.Sprintf("租户模型访问检查失败: %s", err.Error()), nil)
			newAPIError = types.NewErrorWithStatusCode(err, types.ErrorCodeTenantModelForbidden, http.StatusForbidden, types.ErrOptionWithSkipRetry())
			return
		}
		addTraceEvent(c, "tenant_check", "租户配额检查通过", nil)
	}

	needSensitiveCheck := service.ShouldCheckPromptSensitiveForTenant(relayInfo.TenantId)
	needCountToken := constant.CountToken
	// Avoid building huge CombineText (strings.Join) when token counting and sensitive check are both disabled.
	var meta *types.TokenCountMeta
	if needSensitiveCheck || needCountToken {
		meta = request.GetTokenCountMeta()
	} else {
		meta = fastTokenCountMetaForPricing(request)
	}

	if needSensitiveCheck && meta != nil {
		contains, words := service.CheckSensitiveTextForTenant(relayInfo.TenantId, meta.CombineText)
		if contains {
			addTraceEvent(c, "sensitive_check", fmt.Sprintf("敏感词检测命中: %s", strings.Join(words, ", ")), nil)
			logger.LogWarn(c, fmt.Sprintf("user sensitive words detected: %s", strings.Join(words, ", ")))
			newAPIError = types.NewError(err, types.ErrorCodeSensitiveWordsDetected)
			return
		}
		addTraceEvent(c, "sensitive_check", "敏感词检测通过", nil)
	}

	tokens, err := service.EstimateRequestToken(c, meta, relayInfo)
	if err != nil {
		addTraceEvent(c, "token_estimate", fmt.Sprintf("Token 估算失败: %s", err.Error()), nil)
		newAPIError = types.NewError(err, types.ErrorCodeCountTokenFailed)
		return
	}
	addTraceEvent(c, "token_estimate", fmt.Sprintf("Token 估算完成: %d", tokens), map[string]interface{}{
		"estimated_tokens": tokens,
	})

	relayInfo.SetEstimatePromptTokens(tokens)

	priceData, err := helper.ModelPriceHelper(c, relayInfo, tokens, meta)
	if err != nil {
		addTraceEvent(c, "pricing", fmt.Sprintf("价格计算失败: %s", err.Error()), nil)
		newAPIError = types.NewError(err, types.ErrorCodeModelPriceError)
		return
	}
	addTraceEvent(c, "pricing", "价格计算完成", map[string]interface{}{
		"free_model":           priceData.FreeModel,
		"quota_to_pre_consume": priceData.QuotaToPreConsume,
	})

	// common.SetContextKey(c, constant.ContextKeyTokenCountMeta, meta)

	if priceData.FreeModel {
		addTraceEvent(c, "pre_billing", fmt.Sprintf("模型 %s 免费，跳过预扣费", relayInfo.OriginModelName), nil)
		logger.LogInfo(c, fmt.Sprintf("模型 %s 免费，跳过预扣费", relayInfo.OriginModelName))
	} else {
		newAPIError = service.PreConsumeBilling(c, priceData.QuotaToPreConsume, relayInfo)
		if newAPIError != nil {
			addTraceEvent(c, "pre_billing", fmt.Sprintf("预扣费失败: %s", newAPIError.Error()), nil)
			return
		}
		addTraceEvent(c, "pre_billing", "预扣费成功", map[string]interface{}{
			"quota_to_pre_consume": priceData.QuotaToPreConsume,
			"billing_source":       relayInfo.BillingSource,
		})
	}

	defer func() {
		// Only return quota if downstream failed and quota was actually pre-consumed
		if newAPIError != nil {
			newAPIError = service.NormalizeViolationFeeError(newAPIError)
			if relayInfo.Billing != nil {
				addTraceEvent(c, "refund", "请求失败，退还预扣额度", nil)
				relayInfo.Billing.Refund(c)
			}
			service.ChargeViolationFeeIfNeeded(c, relayInfo, newAPIError)
		}
	}()

	retryParam := &service.RetryParam{
		Ctx:        c,
		TokenGroup: relayInfo.TokenGroup,
		ModelName:  relayInfo.OriginModelName,
		Retry:      common.GetPointer(0),
	}
	relayInfo.RetryIndex = 0
	relayInfo.LastError = nil
	maxRetryTimes := service.GetTenantRetryTimes(relayInfo.TenantId)

	for ; retryParam.GetRetry() <= maxRetryTimes; retryParam.IncreaseRetry() {
		relayInfo.RetryIndex = retryParam.GetRetry()
		channel, channelErr := getChannel(c, relayInfo, retryParam)
		if channelErr != nil {
			addTraceEvent(c, "channel_select", fmt.Sprintf("渠道选择失败: %s", channelErr.Error()), map[string]interface{}{
				"retry_index": retryParam.GetRetry(),
			})
			logger.LogError(c, buildRelayErrorLogMessage(c, channelErr))
			newAPIError = channelErr
			break
		}

		addTraceEvent(c, "channel_select", fmt.Sprintf("选中渠道 #%d %s", channel.Id, channel.Name), map[string]interface{}{
			"channel_id":       channel.Id,
			"channel_name":     channel.Name,
			"channel_type":     channel.Type,
			"channel_priority": channel.GetPriority(),
			"channel_weight":   channel.GetWeight(),
			"max_retry":        channel.GetMaxRetry(),
			"retry_index":      retryParam.GetRetry(),
		})
		addUsedChannel(c, channel.Id)
		maxChannelRetry := channel.GetMaxRetry()

		channelSuccess := false
		for channelAttempt := 0; channelAttempt <= maxChannelRetry; channelAttempt++ {
			attemptStart := time.Now()
			relayInfo.UpstreamRequestIds = nil // reset for each attempt
			bodyStorage, bodyErr := common.GetBodyStorage(c)
			if bodyErr != nil {
				if common.IsRequestBodyTooLargeError(bodyErr) || errors.Is(bodyErr, common.ErrRequestBodyTooLarge) {
					newAPIError = types.NewErrorWithStatusCode(bodyErr, types.ErrorCodeReadRequestBodyFailed, http.StatusRequestEntityTooLarge, types.ErrOptionWithSkipRetry())
				} else {
					newAPIError = types.NewErrorWithStatusCode(bodyErr, types.ErrorCodeReadRequestBodyFailed, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
				}
				break
			}
			c.Request.Body = io.NopCloser(bodyStorage)

			switch relayFormat {
			case types.RelayFormatOpenAIRealtime:
				newAPIError = relay.WssHelper(c, relayInfo)
			case types.RelayFormatClaude:
				newAPIError = relay.ClaudeHelper(c, relayInfo)
			case types.RelayFormatGemini:
				newAPIError = geminiRelayHandler(c, relayInfo)
			default:
				newAPIError = relayHandler(c, relayInfo)
			}

			if newAPIError == nil {
				elapsedMs := time.Since(attemptStart).Milliseconds()
				addTraceEvent(c, "upstream", fmt.Sprintf("上游请求成功: CH#%d %dms", channel.Id, elapsedMs), map[string]interface{}{
					"channel_id":           channel.Id,
					"elapsed_ms":           elapsedMs,
					"upstream_address":     relayInfo.UpstreamAddress,
					"upstream_request_ids": relayInfo.UpstreamRequestIds,
				})
				channelSuccess = true
				break
			}

			newAPIError = service.NormalizeViolationFeeError(newAPIError)
			elapsedMs := time.Since(attemptStart).Milliseconds()

			addRetryError(c, RetryError{
				ChannelId:          channel.Id,
				ChannelName:        channel.Name,
				StatusCode:         newAPIError.StatusCode,
				Message:            newAPIError.Error(),
				UpstreamBody:       newAPIError.UpstreamResponseBody,
				ElapsedMs:          elapsedMs,
				UpstreamRequestIds: relayInfo.UpstreamRequestIds,
			})
			addTraceEvent(c, "upstream", fmt.Sprintf("上游请求失败: CH#%d HTTP %d %dms", channel.Id, newAPIError.StatusCode, elapsedMs), map[string]interface{}{
				"channel_id":           channel.Id,
				"status_code":          newAPIError.StatusCode,
				"elapsed_ms":           elapsedMs,
				"error":                newAPIError.Error(),
				"upstream_address":     relayInfo.UpstreamAddress,
				"upstream_request_ids": relayInfo.UpstreamRequestIds,
			})

			if types.IsSkipRetryError(newAPIError) {
				break
			}

			if channelAttempt < maxChannelRetry {
				logger.LogInfo(c, fmt.Sprintf("channel #%d attempt %d/%d failed, retrying same channel: %s", channel.Id, channelAttempt+1, maxChannelRetry+1, newAPIError.Error()))
			}
		}

		if channelSuccess {
			relayInfo.LastError = nil
			// Increment tenant RPM counter after successful relay (in-memory path only;
			// Redis path auto-increments inside CheckTenantRPM).
			service.IncrementTenantRPM(relayInfo.TenantId)
			return
		}

		newAPIError = service.NormalizeViolationFeeError(newAPIError)
		relayInfo.LastError = newAPIError

		processChannelErrorNoLog(c, *types.NewChannelError(channel.Id, channel.Type, channel.Name, channel.ChannelInfo.IsMultiKey, common.GetContextKeyString(c, constant.ContextKeyChannelKey), channel.GetAutoBan()), newAPIError)

		if !shouldRetry(c, relayInfo.TenantId, newAPIError, maxRetryTimes-retryParam.GetRetry()) {
			break
		}
	}

	useChannel := c.GetStringSlice("use_channel")
	if len(useChannel) > 1 {
		retryLogStr := fmt.Sprintf("重试：%s", strings.Trim(strings.Join(strings.Fields(fmt.Sprint(useChannel)), "->"), "[]"))
		logger.LogInfo(c, retryLogStr)
	}
}

var upgrader = websocket.Upgrader{
	Subprotocols: []string{"realtime"}, // WS 握手支持的协议，如果有使用 Sec-WebSocket-Protocol，则必须在此声明对应的 Protocol TODO add other protocol
	CheckOrigin: func(r *http.Request) bool {
		return true // 允许跨域
	},
}

func addUsedChannel(c *gin.Context, channelId int) {
	useChannel := c.GetStringSlice("use_channel")
	useChannel = append(useChannel, fmt.Sprintf("%d", channelId))
	c.Set("use_channel", useChannel)
}

func fastTokenCountMetaForPricing(request dto.Request) *types.TokenCountMeta {
	if request == nil {
		return &types.TokenCountMeta{}
	}
	meta := &types.TokenCountMeta{
		TokenType: types.TokenTypeTokenizer,
	}
	switch r := request.(type) {
	case *dto.GeneralOpenAIRequest:
		maxCompletionTokens := lo.FromPtrOr(r.MaxCompletionTokens, uint(0))
		maxTokens := lo.FromPtrOr(r.MaxTokens, uint(0))
		if maxCompletionTokens > maxTokens {
			meta.MaxTokens = int(maxCompletionTokens)
		} else {
			meta.MaxTokens = int(maxTokens)
		}
	case *dto.OpenAIResponsesRequest:
		meta.MaxTokens = int(lo.FromPtrOr(r.MaxOutputTokens, uint(0)))
	case *dto.ClaudeRequest:
		meta.MaxTokens = int(lo.FromPtr(r.MaxTokens))
	case *dto.ImageRequest:
		// Pricing for image requests depends on ImagePriceRatio; safe to compute even when CountToken is disabled.
		return r.GetTokenCountMeta()
	default:
		// Best-effort: leave CombineText empty to avoid large allocations.
	}
	return meta
}

// userGroupChannelHint returns a user-friendly message when no channel is
// available for the requested group+model. VIP/VVIP/SVIP are pure user-tier
// groups with no model channels attached.
func userGroupChannelHint(group, modelName string) string {
	upper := strings.ToUpper(group)
	if upper == "VIP" || upper == "VVIP" || upper == "SVIP" {
		return fmt.Sprintf("%s 是用户等级分组，不直接提供模型渠道。请在令牌设置中切换到其他分组（如 default），对应的优惠已自动应用到您的渠道", group)
	}
	if strings.Contains(group, ",") {
		return fmt.Sprintf("分组链 [%s] 中所有分组下模型 %s 的可用渠道均不存在", group, modelName)
	}
	return fmt.Sprintf("分组 %s 下模型 %s 的可用渠道不存在", group, modelName)
}

func getChannel(c *gin.Context, info *relaycommon.RelayInfo, retryParam *service.RetryParam) (*model.Channel, *types.NewAPIError) {
	if info.ChannelMeta == nil {
		autoBan := c.GetBool("auto_ban")
		autoBanInt := 1
		if !autoBan {
			autoBanInt = 0
		}
		return &model.Channel{
			Id:      c.GetInt("channel_id"),
			Type:    c.GetInt("channel_type"),
			Name:    c.GetString("channel_name"),
			AutoBan: &autoBanInt,
		}, nil
	}
	channel, selectGroup, err := service.CacheGetRandomSatisfiedChannel(retryParam)

	info.PriceData.GroupRatioInfo = helper.HandleGroupRatio(c, info)

	if err != nil {
		return nil, types.NewError(fmt.Errorf("%s: %s", userGroupChannelHint(selectGroup, info.OriginModelName), err.Error()), types.ErrorCodeGetChannelFailed, types.ErrOptionWithSkipRetry())
	}
	if channel == nil {
		return nil, types.NewError(fmt.Errorf("%s", userGroupChannelHint(selectGroup, info.OriginModelName)), types.ErrorCodeGetChannelFailed, types.ErrOptionWithSkipRetry())
	}

	newAPIError := middleware.SetupContextForSelectedChannel(c, channel, info.OriginModelName)
	if newAPIError != nil {
		return nil, newAPIError
	}
	if info.Billing != nil {
		prevMarkup := info.PriceMarkupRatio
		prevPreConsumed := info.Billing.GetPreConsumedQuota()
		if _, err := helper.ModelPriceHelper(c, info, info.GetEstimatePromptTokens(), &types.TokenCountMeta{}); err == nil {
			nextPreConsumed := info.PriceData.QuotaToPreConsume
			if nextPreConsumed > prevPreConsumed {
				delta := nextPreConsumed - prevPreConsumed
				if err := info.Billing.PreConsumeAdditional(c, delta); err != nil {
					return nil, types.NewErrorWithStatusCode(err, types.ErrorCodePreConsumeTokenQuotaFailed, http.StatusForbidden, types.ErrOptionWithSkipRetry(), types.ErrOptionWithNoRecordErrorLog())
				}
				logger.LogInfo(c, fmt.Sprintf("channel switch increased markup, topped up pre-consume by %s (markup %.4f -> %.4f)", logger.FormatQuota(delta), prevMarkup, info.PriceMarkupRatio))
			}
		}
	}
	return channel, nil
}

func shouldRetry(c *gin.Context, tenantId int, openaiErr *types.NewAPIError, retryTimes int) bool {
	if openaiErr == nil {
		return false
	}
	if service.ShouldSkipRetryAfterChannelAffinityFailure(c) {
		return false
	}
	if types.IsChannelError(openaiErr) {
		return true
	}
	if types.IsSkipRetryError(openaiErr) {
		return false
	}
	if retryTimes <= 0 {
		return false
	}
	if _, ok := c.Get("specific_channel_id"); ok {
		return false
	}
	code := openaiErr.StatusCode
	if code >= 200 && code < 300 {
		return false
	}
	if code < 100 || code > 599 {
		return true
	}
	if operation_setting.IsAlwaysSkipRetryCode(openaiErr.GetErrorCode()) {
		return false
	}
	return service.ShouldTenantRetryByStatusCode(tenantId, code)
}

// recordRelayErrorForTrace writes a single error log per request to the database,
// consolidating all retry/channel-switch information into one entry.
// This is the ONLY place that writes error logs for relay requests.
func recordRelayErrorForTrace(c *gin.Context, err *types.NewAPIError) {
	// Skip if the error explicitly opts out of logging
	if !types.IsRecordErrorLog(err) {
		return
	}

	userId := c.GetInt("id")
	channelId := c.GetInt("channel_id")
	modelName := c.GetString("original_model")
	tokenName := c.GetString("token_name")
	tokenId := c.GetInt("token_id")
	group := c.GetString("group")

	other := make(map[string]interface{})
	other["error_type"] = err.GetErrorType()
	other["error_code"] = err.GetErrorCode()
	other["status_code"] = err.StatusCode
	other["error_summary"] = buildRelayErrorLogMessage(c, err)
	if channelId > 0 {
		other["channel_id"] = channelId
		other["channel_name"] = c.GetString("channel_name")
		other["channel_type"] = c.GetInt("channel_type")
	}
	adminInfo := make(map[string]interface{})
	if useChannel := c.GetStringSlice("use_channel"); len(useChannel) > 0 {
		adminInfo["use_channel"] = useChannel
	}
	appendErrorDiagnosticInfo(c, other, adminInfo)
	isMultiKey := common.GetContextKeyBool(c, constant.ContextKeyChannelIsMultiKey)
	if isMultiKey {
		adminInfo["is_multi_key"] = true
		adminInfo["multi_key_index"] = common.GetContextKeyInt(c, constant.ContextKeyChannelMultiKeyIndex)
	}
	if common.SiteLabel != "" {
		adminInfo["site_label"] = common.SiteLabel
	}
	service.AppendChannelAffinityAdminInfo(c, adminInfo)
	if err.UpstreamResponseBody != "" {
		adminInfo["upstream_response_body"] = err.UpstreamResponseBody
	}
	if err.UpstreamStatusCode > 0 {
		adminInfo["upstream_status_code"] = err.UpstreamStatusCode
	}
	if len(adminInfo) > 0 {
		other["admin_info"] = adminInfo
	}
	if traceEvents := getTraceEvents(c); len(traceEvents) > 0 {
		other["trace_events"] = traceEvents
	}

	startTime := common.GetContextKeyTime(c, constant.ContextKeyRequestStartTime)
	if startTime.IsZero() {
		startTime = time.Now()
	}
	useTimeSeconds := int(time.Since(startTime).Seconds())

	gopool.Go(func() {
		model.RecordErrorLog(c, userId, channelId, modelName, tokenName,
			err.MaskSensitiveErrorWithStatusCode(),
			tokenId, useTimeSeconds, false, group, other)
	})
}

func processChannelErrorNoLog(c *gin.Context, channelError types.ChannelError, err *types.NewAPIError) {
	// 不要使用context获取渠道信息，异步处理时可能会出现渠道信息不一致的情况
	// do not use context to get channel info, there may be inconsistent channel info when processing asynchronously
	tenantId := middleware.GetTenantId(c)
	shouldDisable := service.ShouldDisableChannel(tenantId, channelError.ChannelType, err)
	logger.LogError(c, buildChannelErrorLogMessage(c, channelError, err, shouldDisable && channelError.AutoBan))
	if shouldDisable && channelError.AutoBan {
		gopool.Go(func() {
			service.DisableChannel(channelError, err.ErrorWithStatusCode())
		})
	}
	// Note: per-channel error logging removed to prevent duplicate logs.
	// Each request now produces exactly one log entry via recordRelayErrorForTrace
	// in the defer block, with all retry_errors included in admin_info.
}

// ProcessChannelError is the public entry point for recording a channel error
// and (if configured) auto-disabling the channel. Exported so the channel
// subpackage's health-check path can reuse the same bookkeeping without
// duplicating disable/log logic.
func ProcessChannelError(c *gin.Context, channelError types.ChannelError, err *types.NewAPIError) {
	// 不要使用context获取渠道信息，异步处理时可能会出现渠道信息不一致的情况
	// do not use context to get channel info, there may be inconsistent channel info when processing asynchronously
	tenantId := middleware.GetTenantId(c)
	shouldDisable := service.ShouldDisableChannel(tenantId, channelError.ChannelType, err)
	logger.LogError(c, buildChannelErrorLogMessage(c, channelError, err, shouldDisable && channelError.AutoBan))
	if shouldDisable && channelError.AutoBan {
		gopool.Go(func() {
			service.DisableChannel(channelError, err.ErrorWithStatusCode())
		})
	}

	if constant.ErrorLogEnabled && types.IsRecordErrorLog(err) {
		// 保存错误日志到mysql中
		userId := c.GetInt("id")
		tokenName := c.GetString("token_name")
		modelName := c.GetString("original_model")
		tokenId := c.GetInt("token_id")
		userGroup := c.GetString("group")
		channelId := c.GetInt("channel_id")
		other := make(map[string]interface{})
		other["error_type"] = err.GetErrorType()
		other["error_code"] = err.GetErrorCode()
		other["status_code"] = err.StatusCode
		other["error_summary"] = buildChannelErrorLogMessage(c, channelError, err, shouldDisable && channelError.AutoBan)
		other["channel_id"] = channelId
		other["channel_name"] = c.GetString("channel_name")
		other["channel_type"] = c.GetInt("channel_type")
		adminInfo := make(map[string]interface{})
		adminInfo["use_channel"] = c.GetStringSlice("use_channel")
		appendErrorDiagnosticInfo(c, other, adminInfo)
		isMultiKey := common.GetContextKeyBool(c, constant.ContextKeyChannelIsMultiKey)
		if isMultiKey {
			adminInfo["is_multi_key"] = true
			adminInfo["multi_key_index"] = common.GetContextKeyInt(c, constant.ContextKeyChannelMultiKeyIndex)
		}
		if common.SiteLabel != "" {
			adminInfo["site_label"] = common.SiteLabel
		}
		service.AppendChannelAffinityAdminInfo(c, adminInfo)
		// Store the final error's upstream response for admin debugging
		if err.UpstreamResponseBody != "" {
			adminInfo["upstream_response_body"] = err.UpstreamResponseBody
		}
		if err.UpstreamStatusCode > 0 {
			adminInfo["upstream_status_code"] = err.UpstreamStatusCode
		}
		other["admin_info"] = adminInfo
		startTime := common.GetContextKeyTime(c, constant.ContextKeyRequestStartTime)
		if startTime.IsZero() {
			startTime = time.Now()
		}
		useTimeSeconds := int(time.Since(startTime).Seconds())
		model.RecordErrorLog(c, userId, channelId, modelName, tokenName, err.MaskSensitiveErrorWithStatusCode(), tokenId, useTimeSeconds, false, userGroup, other)
	}

}

func RelayMidjourney(c *gin.Context) {
	relayInfo, err := relaycommon.GenRelayInfo(c, types.RelayFormatMjProxy, nil, nil)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"description": fmt.Sprintf("failed to generate relay info: %s", err.Error()),
			"type":        "upstream_error",
			"code":        4,
		})
		return
	}

	var mjErr *dto.MidjourneyResponse
	switch relayInfo.RelayMode {
	case relayconstant.RelayModeMidjourneyNotify:
		mjErr = relay.RelayMidjourneyNotify(c)
	case relayconstant.RelayModeMidjourneyTaskFetch, relayconstant.RelayModeMidjourneyTaskFetchByCondition:
		mjErr = relay.RelayMidjourneyTask(c, relayInfo.RelayMode)
	case relayconstant.RelayModeMidjourneyTaskImageSeed:
		mjErr = relay.RelayMidjourneyTaskImageSeed(c)
	case relayconstant.RelayModeSwapFace:
		mjErr = relay.RelaySwapFace(c, relayInfo)
	default:
		mjErr = relay.RelayMidjourneySubmit(c, relayInfo)
	}
	//err = relayMidjourneySubmit(c, relayMode)
	log.Println(mjErr)
	if mjErr != nil {
		statusCode := http.StatusBadRequest
		if mjErr.Code == 30 {
			mjErr.Result = "当前分组负载已饱和，请稍后再试，或升级账户以提升服务质量。"
			statusCode = http.StatusTooManyRequests
		}
		c.JSON(statusCode, gin.H{
			"description": fmt.Sprintf("%s %s", mjErr.Description, mjErr.Result),
			"type":        "upstream_error",
			"code":        mjErr.Code,
		})
		channelId := c.GetInt("channel_id")
		logger.LogError(c, fmt.Sprintf("relay error (channel #%d, status code %d): %s", channelId, statusCode, fmt.Sprintf("%s %s", mjErr.Description, mjErr.Result)))
	}
}

func RelayNotImplemented(c *gin.Context) {
	err := types.OpenAIError{
		Message: "API not implemented",
		Type:    "new_api_error",
		Param:   "",
		Code:    "api_not_implemented",
	}
	c.JSON(http.StatusNotImplemented, gin.H{
		"error": err,
	})
}

func RelayNotFound(c *gin.Context) {
	err := types.OpenAIError{
		Message: fmt.Sprintf("Invalid URL (%s %s)", c.Request.Method, c.Request.URL.Path),
		Type:    "invalid_request_error",
		Param:   "",
		Code:    "",
	}
	c.JSON(http.StatusNotFound, gin.H{
		"error": err,
	})
}

func RelayTaskFetch(c *gin.Context) {
	relayInfo, err := relaycommon.GenRelayInfo(c, types.RelayFormatTask, nil, nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, &dto.TaskError{
			Code:       "gen_relay_info_failed",
			Message:    err.Error(),
			StatusCode: http.StatusInternalServerError,
		})
		return
	}
	if taskErr := relay.RelayTaskFetch(c, relayInfo.RelayMode); taskErr != nil {
		respondTaskError(c, taskErr)
	}
}

func RelayTask(c *gin.Context) {
	relayInfo, err := relaycommon.GenRelayInfo(c, types.RelayFormatTask, nil, nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, &dto.TaskError{
			Code:       "gen_relay_info_failed",
			Message:    err.Error(),
			StatusCode: http.StatusInternalServerError,
		})
		return
	}

	if taskErr := relay.ResolveOriginTask(c, relayInfo); taskErr != nil {
		respondTaskError(c, taskErr)
		return
	}

	var result *relay.TaskSubmitResult
	var taskErr *dto.TaskError
	defer func() {
		if taskErr != nil && relayInfo.Billing != nil {
			relayInfo.Billing.Refund(c)
		}
	}()

	retryParam := &service.RetryParam{
		Ctx:        c,
		TokenGroup: relayInfo.TokenGroup,
		ModelName:  relayInfo.OriginModelName,
		Retry:      common.GetPointer(0),
	}

	maxRetryTimes := service.GetTenantRetryTimes(relayInfo.TenantId)
	for ; retryParam.GetRetry() <= maxRetryTimes; retryParam.IncreaseRetry() {
		var channel *model.Channel

		if lockedCh, ok := relayInfo.LockedChannel.(*model.Channel); ok && lockedCh != nil {
			channel = lockedCh
			if retryParam.GetRetry() > 0 {
				if setupErr := middleware.SetupContextForSelectedChannel(c, channel, relayInfo.OriginModelName); setupErr != nil {
					taskErr = service.TaskErrorWrapperLocal(setupErr.Err, "setup_locked_channel_failed", http.StatusInternalServerError)
					break
				}
			}
		} else {
			var channelErr *types.NewAPIError
			channel, channelErr = getChannel(c, relayInfo, retryParam)
			if channelErr != nil {
				logger.LogError(c, channelErr.Error())
				taskErr = service.TaskErrorWrapperLocal(channelErr.Err, "get_channel_failed", http.StatusInternalServerError)
				break
			}
		}

		addUsedChannel(c, channel.Id)
		bodyStorage, bodyErr := common.GetBodyStorage(c)
		if bodyErr != nil {
			if common.IsRequestBodyTooLargeError(bodyErr) || errors.Is(bodyErr, common.ErrRequestBodyTooLarge) {
				taskErr = service.TaskErrorWrapperLocal(bodyErr, "read_request_body_failed", http.StatusRequestEntityTooLarge)
			} else {
				taskErr = service.TaskErrorWrapperLocal(bodyErr, "read_request_body_failed", http.StatusBadRequest)
			}
			break
		}
		c.Request.Body = io.NopCloser(bodyStorage)

		result, taskErr = relay.RelayTaskSubmit(c, relayInfo)
		if taskErr == nil {
			break
		}

		if !taskErr.LocalError {
			ProcessChannelError(c,
				*types.NewChannelError(channel.Id, channel.Type, channel.Name, channel.ChannelInfo.IsMultiKey,
					common.GetContextKeyString(c, constant.ContextKeyChannelKey), channel.GetAutoBan()),
				types.NewOpenAIError(taskErr.Error, types.ErrorCodeBadResponseStatusCode, taskErr.StatusCode))
		}

		if !shouldRetryTaskRelay(c, relayInfo.TenantId, channel.Id, taskErr, maxRetryTimes-retryParam.GetRetry()) {
			break
		}
	}

	useChannel := c.GetStringSlice("use_channel")
	if len(useChannel) > 1 {
		retryLogStr := fmt.Sprintf("重试：%s", strings.Trim(strings.Join(strings.Fields(fmt.Sprint(useChannel)), "->"), "[]"))
		logger.LogInfo(c, retryLogStr)
	}

	// ── 成功：结算 + 日志 + 插入任务 ──
	if taskErr == nil {
		if result.PlatformCostQuota > 0 {
			relayInfo.PriceData.PlatformCostQuota = result.PlatformCostQuota
		} else if relayInfo.PriceData.PlatformCostQuota <= 0 {
			relayInfo.PriceData.PlatformCostQuota = relayInfo.PriceData.PlatformCostQuotaToPreConsume
		}
		if settleErr := service.SettleBilling(c, relayInfo, result.Quota); settleErr != nil {
			common.SysError("settle task billing error: " + settleErr.Error())
		}
		service.LogTaskConsumption(c, relayInfo)

		task := model.InitTask(result.Platform, relayInfo)
		task.PrivateData.UpstreamTaskID = result.UpstreamTaskID
		task.PrivateData.BillingSource = relayInfo.BillingSource
		task.PrivateData.SubscriptionId = relayInfo.SubscriptionId
		task.PrivateData.TokenId = relayInfo.TokenId
		task.PrivateData.BillingContext = &model.TaskBillingContext{
			ModelPrice:               relayInfo.PriceData.ModelPrice,
			GroupRatio:               relayInfo.PriceData.GroupRatioInfo.GroupRatio,
			ModelRatio:               relayInfo.PriceData.ModelRatio,
			OtherRatios:              relayInfo.PriceData.OtherRatios,
			OriginModelName:          relayInfo.OriginModelName,
			PerCallBilling:           common.StringsContains(constant.TaskPricePatches, relayInfo.OriginModelName) || relayInfo.PriceData.UsePrice,
			PriceMarkupRatio:         relayInfo.PriceMarkupRatio,
			PlatformCostChannelRatio: relayInfo.PriceData.PlatformCostChannelRatio,
			PlatformCostQuota:        relayInfo.PriceData.PlatformCostQuota,
		}
		task.Quota = result.Quota
		task.PlatformCostQuota = relayInfo.PriceData.PlatformCostQuota
		task.Data = result.TaskData
		task.Action = relayInfo.Action
		if insertErr := task.Insert(); insertErr != nil {
			common.SysError("insert task error: " + insertErr.Error())
		}
	}

	if taskErr != nil {
		respondTaskError(c, taskErr)
	}
}

// respondTaskError 统一输出 Task 错误响应（含 429 限流提示改写）
func respondTaskError(c *gin.Context, taskErr *dto.TaskError) {
	if taskErr.StatusCode == http.StatusTooManyRequests {
		taskErr.Message = "当前分组上游负载已饱和，请稍后再试"
	}
	c.JSON(taskErr.StatusCode, taskErr)
}

func shouldRetryTaskRelay(c *gin.Context, tenantId int, channelId int, taskErr *dto.TaskError, retryTimes int) bool {
	if taskErr == nil {
		return false
	}
	if service.ShouldSkipRetryAfterChannelAffinityFailure(c) {
		return false
	}
	if retryTimes <= 0 {
		return false
	}
	if _, ok := c.Get("specific_channel_id"); ok {
		return false
	}
	if taskErr.StatusCode == http.StatusTooManyRequests {
		return true
	}
	if taskErr.StatusCode == 307 {
		return true
	}
	if taskErr.StatusCode/100 == 5 {
		// 超时不重试
		if operation_setting.IsAlwaysSkipRetryStatusCode(taskErr.StatusCode) {
			return false
		}
		return service.ShouldTenantRetryByStatusCode(tenantId, taskErr.StatusCode)
	}
	if taskErr.StatusCode == http.StatusBadRequest {
		return false
	}
	if taskErr.StatusCode == 408 {
		// azure处理超时不重试
		return false
	}
	if taskErr.LocalError {
		return false
	}
	if taskErr.StatusCode/100 == 2 {
		return false
	}
	return service.ShouldTenantRetryByStatusCode(tenantId, taskErr.StatusCode)
}
