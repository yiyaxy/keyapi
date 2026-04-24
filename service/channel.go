package service

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/types"
)

func formatNotifyType(channelId int, status int) string {
	return fmt.Sprintf("%s_%d_%d", dto.NotifyTypeChannelUpdate, channelId, status)
}

// disable & notify
func DisableChannel(channelError types.ChannelError, reason string) {
	common.SysLog(fmt.Sprintf("auto disable channel name=%s id=%d type=%d reason=%s", channelError.ChannelName, channelError.ChannelId, channelError.ChannelType, reason))

	// 检查是否启用自动禁用功能
	if !channelError.AutoBan {
		common.SysLog(fmt.Sprintf("skip auto disable channel name=%s id=%d because auto_ban=false", channelError.ChannelName, channelError.ChannelId))
		return
	}

	if err := model.ClearChannelCooldown(channelError.ChannelId); err != nil {
		common.SysLog(fmt.Sprintf("failed to clear channel cooldown before disable: channel_id=%d, error=%v", channelError.ChannelId, err))
	}
	success := model.UpdateChannelStatus(channelError.ChannelId, channelError.UsingKey, common.ChannelStatusAutoDisabled, reason)
	if success {
		subject := fmt.Sprintf("通道「%s」（#%d）已被禁用", channelError.ChannelName, channelError.ChannelId)
		content := fmt.Sprintf("通道「%s」（#%d）已被禁用，原因：%s", channelError.ChannelName, channelError.ChannelId, reason)
		NotifyRootUser(formatNotifyType(channelError.ChannelId, common.ChannelStatusAutoDisabled), subject, content)
	}
}

func EnableChannel(channelId int, usingKey string, channelName string) {
	if err := model.ClearChannelCooldown(channelId); err != nil {
		common.SysLog(fmt.Sprintf("failed to clear channel cooldown before enable: channel_id=%d, error=%v", channelId, err))
	}
	success := model.UpdateChannelStatus(channelId, usingKey, common.ChannelStatusEnabled, "")
	if success {
		subject := fmt.Sprintf("通道「%s」（#%d）已被启用", channelName, channelId)
		content := fmt.Sprintf("通道「%s」（#%d）已被启用", channelName, channelId)
		NotifyRootUser(formatNotifyType(channelId, common.ChannelStatusEnabled), subject, content)
	}
}

func ShouldDisableChannel(tenantId int, channelType int, err *types.NewAPIError) bool {
	if !GetTenantAutomaticDisableChannelEnabled(tenantId) {
		return false
	}
	if err != nil && err.GetErrorCode() == types.ErrorCodeUpstreamFirstTokenTimeout {
		return false
	}
	if !IsChannelStabilityErrorClassificationEnabled(tenantId) {
		return legacyShouldDisableChannel(tenantId, channelType, err)
	}
	return types.ClassifyChannelError(err, channelType) == types.ChannelErrorClassPermanent
}

func legacyShouldDisableChannel(tenantId int, channelType int, err *types.NewAPIError) bool {
	if err == nil {
		return false
	}
	if types.IsChannelError(err) {
		return true
	}
	if types.IsSkipRetryError(err) {
		return false
	}
	if ShouldTenantDisableByStatusCode(tenantId, err.StatusCode) {
		return true
	}
	//if err.StatusCode == http.StatusUnauthorized {
	//	return true
	//}
	if err.StatusCode == http.StatusForbidden {
		switch channelType {
		case constant.ChannelTypeGemini:
			return true
		}
	}
	oaiErr := err.ToOpenAIError()
	switch oaiErr.Code {
	case "invalid_api_key":
		return true
	case "account_deactivated":
		return true
	case "billing_not_active":
		return true
	case "pre_consume_token_quota_failed":
		return true
	case "Arrearage":
		return true
	}
	switch oaiErr.Type {
	case "insufficient_quota":
		return true
	case "insufficient_user_quota":
		return true
	// https://docs.anthropic.com/claude/reference/errors
	case "authentication_error":
		return true
	case "permission_error":
		return true
	case "forbidden":
		return true
	}

	lowerMessage := strings.ToLower(err.Error())
	search, _ := AcSearch(lowerMessage, GetTenantAutomaticDisableKeywords(tenantId), true)
	return search
}

func ShouldCooldownChannel(tenantId int, channelType int, err *types.NewAPIError) bool {
	if !IsChannelStabilityErrorClassificationEnabled(tenantId) {
		return false
	}
	class := types.ClassifyChannelError(err, channelType)
	return class == types.ChannelErrorClassTransient || class == types.ChannelErrorClassScheduledCooldown
}

func HandleChannelAnomaly(tenantId int, channelError types.ChannelError, err *types.NewAPIError) {
	if ShouldDisableChannel(tenantId, channelError.ChannelType, err) {
		DisableChannel(channelError, err.ErrorWithStatusCode())
		return
	}
	if !IsChannelStabilityCooldownEnabled(tenantId) || !ShouldCooldownChannel(tenantId, channelError.ChannelType, err) {
		return
	}

	count, countErr := model.IncrChannelCooldownCount(channelError.ChannelId)
	if countErr != nil {
		common.SysLog(fmt.Sprintf("failed to increment channel cooldown count: channel_id=%d, error=%v", channelError.ChannelId, countErr))
		return
	}

	if count >= GetChannelCooldownEscalationLimit() && channelError.AutoBan {
		common.SysLog(fmt.Sprintf("channel_cooldown_escalated channel_id=%d count=%d", channelError.ChannelId, count))
		_ = model.ClearChannelCooldown(channelError.ChannelId)
		DisableChannel(channelError, "cooldown_escalated")
		return
	}

	duration := NextChannelCooldownDuration(count - 1)
	reason := formatChannelCooldownReason(channelError.ChannelType, err)
	if err := model.SetChannelCooldown(channelError.ChannelId, reason, duration); err != nil {
		common.SysLog(fmt.Sprintf("failed to set channel cooldown: channel_id=%d count=%d duration_ms=%d error=%v", channelError.ChannelId, count, duration.Milliseconds(), err))
		return
	}
	cooldown, _ := model.GetChannelCooldown(channelError.ChannelId)
	until := int64(0)
	if cooldown != nil {
		until = cooldown.Until
	}
	common.SysLog(fmt.Sprintf("channel_cooldown_entered channel_id=%d reason=%s count=%d duration_ms=%d cooldown_until=%d", channelError.ChannelId, reason, count, duration.Milliseconds(), until))
}

func formatChannelCooldownReason(channelType int, err *types.NewAPIError) string {
	if err == nil {
		return "nil"
	}
	_, reason := types.ClassifyChannelErrorWithReason(err, channelType)
	if reason == "" || reason == "default" {
		reason = string(err.GetErrorCode())
	}
	return reason
}

func ShouldEnableChannel(tenantId int, newAPIError *types.NewAPIError, status int) bool {
	if !GetTenantAutomaticEnableChannelEnabled(tenantId) {
		return false
	}
	if newAPIError != nil {
		return false
	}
	if status != common.ChannelStatusAutoDisabled {
		return false
	}
	return true
}
