package types

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/constant"
)

type ChannelErrorClass int

const (
	ChannelErrorClassNormal ChannelErrorClass = iota
	ChannelErrorClassTransient
	// ChannelErrorClassScheduledCooldown 表示上游给出了精确恢复时刻（Retry-After、
	// anthropic-ratelimit-unified-reset 等），选路层应该按该时刻冷却，而不是走自适应退避。
	ChannelErrorClassScheduledCooldown
	// ChannelErrorClassAuthRefresh 表示凭证可刷新类错误（OAuth access token 过期等），
	// 不是渠道故障，应触发刷新流程而非冷却/禁用。
	ChannelErrorClassAuthRefresh
	ChannelErrorClassPermanent
)

func (c ChannelErrorClass) String() string {
	switch c {
	case ChannelErrorClassTransient:
		return "transient"
	case ChannelErrorClassScheduledCooldown:
		return "scheduled_cooldown"
	case ChannelErrorClassAuthRefresh:
		return "auth_refresh"
	case ChannelErrorClassPermanent:
		return "permanent"
	default:
		return "normal"
	}
}

// ChannelErrorHints 承载来自上游响应头/响应体的额外提示，供分类器决定是否将 transient
// 提升为 scheduled_cooldown。调用方（adaptor 层）解析完 Retry-After /
// anthropic-ratelimit-unified-reset 后填入。
type ChannelErrorHints struct {
	// RetryAfter 上游给出的精确恢复时刻。不为 nil 且非零时生效。
	RetryAfter *time.Time
}

func (h ChannelErrorHints) hasRetryAfter() bool {
	return h.RetryAfter != nil && !h.RetryAfter.IsZero()
}

func ClassifyChannelError(err *NewAPIError, channelType int) ChannelErrorClass {
	class, _ := classifyChannelError(err, channelType, channelErrorHintsFromError(err))
	return class
}

func ClassifyChannelErrorWithReason(err *NewAPIError, channelType int) (ChannelErrorClass, string) {
	return classifyChannelError(err, channelType, channelErrorHintsFromError(err))
}

// ClassifyChannelErrorWithHints 在分类基础上支持把带 reset 时间的瞬时错误提升为
// scheduled_cooldown。传入的 hints 仅对 transient 类生效，不会改变 permanent /
// auth_refresh 的判定。
func ClassifyChannelErrorWithHints(err *NewAPIError, channelType int, hints ChannelErrorHints) (ChannelErrorClass, string) {
	return classifyChannelError(err, channelType, mergeChannelErrorHints(channelErrorHintsFromError(err), hints))
}

func channelErrorHintsFromError(err *NewAPIError) ChannelErrorHints {
	if err == nil {
		return ChannelErrorHints{}
	}
	return err.ChannelErrorHints
}

func mergeChannelErrorHints(base ChannelErrorHints, override ChannelErrorHints) ChannelErrorHints {
	if override.hasRetryAfter() {
		base.RetryAfter = override.RetryAfter
	}
	return base
}

func classifyChannelError(err *NewAPIError, channelType int, hints ChannelErrorHints) (ChannelErrorClass, string) {
	if err == nil {
		return ChannelErrorClassNormal, "nil"
	}

	if class, reason, ok := classifyChannelErrorCode(err); ok {
		return promoteWithHints(class, reason, hints)
	}

	oaiErr := err.ToOpenAIError()
	if class, reason, ok := classifyProviderCode(fmt.Sprint(oaiErr.Code), "oaiCode"); ok {
		return promoteWithHints(class, reason, hints)
	}
	if class, reason, ok := classifyProviderCode(oaiErr.Type, "oaiType"); ok {
		return promoteWithHints(class, reason, hints)
	}

	switch err.StatusCode {
	case http.StatusUnauthorized:
		return ChannelErrorClassPermanent, "status=401"
	case http.StatusForbidden:
		if channelType == constant.ChannelTypeGemini {
			return ChannelErrorClassPermanent, "status=403,channel=gemini"
		}
	case http.StatusTooManyRequests, http.StatusBadGateway, http.StatusServiceUnavailable, http.StatusGatewayTimeout:
		return promoteWithHints(ChannelErrorClassTransient, fmt.Sprintf("status=%d", err.StatusCode), hints)
	}

	if isTransientTransportError(err) {
		return promoteWithHints(ChannelErrorClassTransient, "transport", hints)
	}

	return ChannelErrorClassNormal, "default"
}

func classifyChannelErrorCode(err *NewAPIError) (ChannelErrorClass, string, bool) {
	code := err.GetErrorCode()
	switch code {
	case ErrorCodeChannelInvalidKey:
		return ChannelErrorClassPermanent, "channelCode=" + string(code), true
	case ErrorCodeOAuthInvalidGrant:
		return ChannelErrorClassPermanent, "channelCode=" + string(code), true
	case ErrorCodeOAuthTokenExpired:
		return ChannelErrorClassAuthRefresh, "channelCode=" + string(code), true
	case ErrorCodeOAuthRefreshFailed:
		return ChannelErrorClassTransient, "channelCode=" + string(code), true
	case ErrorCodeChannelResponseTimeExceeded, ErrorCodeUpstreamFirstTokenTimeout:
		return ChannelErrorClassTransient, "channelCode=" + string(code), true
	}
	if IsChannelError(err) {
		return ChannelErrorClassNormal, "channelCode=" + string(code), true
	}
	return ChannelErrorClassNormal, "", false
}

func classifyProviderCode(raw string, prefix string) (ChannelErrorClass, string, bool) {
	code := strings.TrimSpace(raw)
	if code == "" || code == "<nil>" {
		return ChannelErrorClassNormal, "", false
	}
	switch code {
	case "invalid_api_key",
		"account_deactivated",
		"insufficient_quota",
		"billing_not_active",
		"Arrearage",
		"authentication_error",
		"permission_error",
		"forbidden",
		"oauth_invalid_grant":
		return ChannelErrorClassPermanent, prefix + "=" + code, true
	case "oauth_token_expired":
		return ChannelErrorClassAuthRefresh, prefix + "=" + code, true
	case "upstream_first_token_timeout",
		"oauth_refresh_failed":
		return ChannelErrorClassTransient, prefix + "=" + code, true
	}
	return ChannelErrorClassNormal, "", false
}

// promoteWithHints 仅把 transient 类错误提升为 scheduled_cooldown。permanent 和
// auth_refresh 不受影响——永久错误不该被"按时恢复"，auth_refresh 应走刷新流程。
func promoteWithHints(class ChannelErrorClass, reason string, hints ChannelErrorHints) (ChannelErrorClass, string) {
	if !hints.hasRetryAfter() {
		return class, reason
	}
	if class != ChannelErrorClassTransient {
		return class, reason
	}
	return ChannelErrorClassScheduledCooldown,
		reason + ",retry_after=" + hints.RetryAfter.UTC().Format(time.RFC3339)
}

func isTransientTransportError(err *NewAPIError) bool {
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, io.EOF) {
		return true
	}
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return true
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "timeout") ||
		strings.Contains(msg, "deadline exceeded") ||
		strings.Contains(msg, "connection reset") ||
		strings.Contains(msg, "connection refused") ||
		strings.Contains(msg, "broken pipe") ||
		msg == "eof" ||
		strings.Contains(msg, "unexpected eof")
}
