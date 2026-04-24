package types

import (
	"context"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/constant"
)

func TestClassifyChannelError(t *testing.T) {
	tests := []struct {
		name        string
		err         *NewAPIError
		channelType int
		want        ChannelErrorClass
	}{
		{
			name:        "nil error is normal",
			err:         nil,
			channelType: constant.ChannelTypeOpenAI,
			want:        ChannelErrorClassNormal,
		},
		{
			name:        "invalid api key is permanent",
			err:         WithOpenAIError(OpenAIError{Message: "bad key", Code: "invalid_api_key"}, http.StatusUnauthorized),
			channelType: constant.ChannelTypeOpenAI,
			want:        ChannelErrorClassPermanent,
		},
		{
			name:        "429 is transient",
			err:         WithOpenAIError(OpenAIError{Message: "rate limit"}, http.StatusTooManyRequests),
			channelType: constant.ChannelTypeOpenAI,
			want:        ChannelErrorClassTransient,
		},
		{
			name:        "502 is transient",
			err:         WithOpenAIError(OpenAIError{Message: "bad gateway"}, http.StatusBadGateway),
			channelType: constant.ChannelTypeOpenAI,
			want:        ChannelErrorClassTransient,
		},
		{
			name:        "503 is transient",
			err:         WithOpenAIError(OpenAIError{Message: "unavailable"}, http.StatusServiceUnavailable),
			channelType: constant.ChannelTypeOpenAI,
			want:        ChannelErrorClassTransient,
		},
		{
			name:        "504 is transient",
			err:         WithOpenAIError(OpenAIError{Message: "gateway timeout"}, http.StatusGatewayTimeout),
			channelType: constant.ChannelTypeOpenAI,
			want:        ChannelErrorClassTransient,
		},
		{
			name:        "400 bad request is normal",
			err:         WithOpenAIError(OpenAIError{Message: "bad request", Code: "bad_request"}, http.StatusBadRequest),
			channelType: constant.ChannelTypeOpenAI,
			want:        ChannelErrorClassNormal,
		},
		{
			name:        "context deadline exceeded is transient",
			err:         NewErrorWithStatusCode(context.DeadlineExceeded, ErrorCodeDoRequestFailed, http.StatusInternalServerError),
			channelType: constant.ChannelTypeOpenAI,
			want:        ChannelErrorClassTransient,
		},
		{
			name:        "connection reset is transient",
			err:         NewErrorWithStatusCode(errors.New("read: connection reset by peer"), ErrorCodeDoRequestFailed, http.StatusInternalServerError),
			channelType: constant.ChannelTypeOpenAI,
			want:        ChannelErrorClassTransient,
		},
		{
			name:        "Gemini 403 is permanent",
			err:         WithOpenAIError(OpenAIError{Message: "forbidden"}, http.StatusForbidden),
			channelType: constant.ChannelTypeGemini,
			want:        ChannelErrorClassPermanent,
		},
		{
			name:        "OpenAI 403 without forbidden code is normal",
			err:         WithOpenAIError(OpenAIError{Message: "blocked"}, http.StatusForbidden),
			channelType: constant.ChannelTypeOpenAI,
			want:        ChannelErrorClassNormal,
		},
		{
			name:        "first token timeout is transient",
			err:         WithOpenAIError(OpenAIError{Message: "first token timeout", Code: "upstream_first_token_timeout"}, http.StatusInternalServerError),
			channelType: constant.ChannelTypeOpenAI,
			want:        ChannelErrorClassTransient,
		},
		{
			name:        "oauth token expired via channel code is auth_refresh",
			err:         NewErrorWithStatusCode(errors.New("access token expired"), ErrorCodeOAuthTokenExpired, http.StatusUnauthorized),
			channelType: constant.ChannelTypeAnthropic,
			want:        ChannelErrorClassAuthRefresh,
		},
		{
			name:        "oauth invalid grant via channel code is permanent",
			err:         NewErrorWithStatusCode(errors.New("invalid grant"), ErrorCodeOAuthInvalidGrant, http.StatusBadRequest),
			channelType: constant.ChannelTypeAnthropic,
			want:        ChannelErrorClassPermanent,
		},
		{
			name:        "oauth refresh failed via channel code is transient",
			err:         NewErrorWithStatusCode(errors.New("refresh endpoint 502"), ErrorCodeOAuthRefreshFailed, http.StatusBadGateway),
			channelType: constant.ChannelTypeAnthropic,
			want:        ChannelErrorClassTransient,
		},
		{
			name:        "oauth token expired via provider code is auth_refresh",
			err:         WithOpenAIError(OpenAIError{Message: "token expired", Code: "oauth_token_expired"}, http.StatusUnauthorized),
			channelType: constant.ChannelTypeAnthropic,
			want:        ChannelErrorClassAuthRefresh,
		},
		{
			name:        "oauth invalid grant via provider code is permanent",
			err:         WithOpenAIError(OpenAIError{Message: "invalid grant", Code: "oauth_invalid_grant"}, http.StatusBadRequest),
			channelType: constant.ChannelTypeAnthropic,
			want:        ChannelErrorClassPermanent,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ClassifyChannelError(tt.err, tt.channelType); got != tt.want {
				t.Fatalf("ClassifyChannelError() = %s, want %s", got, tt.want)
			}
		})
	}
}

func TestClassifyChannelErrorWithHints(t *testing.T) {
	resetAt := time.Now().Add(30 * time.Minute)

	tests := []struct {
		name        string
		err         *NewAPIError
		channelType int
		hints       ChannelErrorHints
		want        ChannelErrorClass
	}{
		{
			name:        "429 with retry_after becomes scheduled_cooldown",
			err:         WithOpenAIError(OpenAIError{Message: "rate limit"}, http.StatusTooManyRequests),
			channelType: constant.ChannelTypeAnthropic,
			hints:       ChannelErrorHints{RetryAfter: &resetAt},
			want:        ChannelErrorClassScheduledCooldown,
		},
		{
			name:        "503 with retry_after becomes scheduled_cooldown",
			err:         WithOpenAIError(OpenAIError{Message: "unavailable"}, http.StatusServiceUnavailable),
			channelType: constant.ChannelTypeAnthropic,
			hints:       ChannelErrorHints{RetryAfter: &resetAt},
			want:        ChannelErrorClassScheduledCooldown,
		},
		{
			name:        "transport transient with retry_after becomes scheduled_cooldown",
			err:         NewErrorWithStatusCode(context.DeadlineExceeded, ErrorCodeDoRequestFailed, http.StatusInternalServerError),
			channelType: constant.ChannelTypeAnthropic,
			hints:       ChannelErrorHints{RetryAfter: &resetAt},
			want:        ChannelErrorClassScheduledCooldown,
		},
		{
			name:        "429 without hint stays transient",
			err:         WithOpenAIError(OpenAIError{Message: "rate limit"}, http.StatusTooManyRequests),
			channelType: constant.ChannelTypeAnthropic,
			hints:       ChannelErrorHints{},
			want:        ChannelErrorClassTransient,
		},
		{
			name:        "auth_refresh not promoted even with hint",
			err:         NewErrorWithStatusCode(errors.New("token expired"), ErrorCodeOAuthTokenExpired, http.StatusUnauthorized),
			channelType: constant.ChannelTypeAnthropic,
			hints:       ChannelErrorHints{RetryAfter: &resetAt},
			want:        ChannelErrorClassAuthRefresh,
		},
		{
			name:        "permanent not promoted even with hint",
			err:         WithOpenAIError(OpenAIError{Message: "bad key", Code: "invalid_api_key"}, http.StatusUnauthorized),
			channelType: constant.ChannelTypeOpenAI,
			hints:       ChannelErrorHints{RetryAfter: &resetAt},
			want:        ChannelErrorClassPermanent,
		},
		{
			name:        "zero time hint ignored",
			err:         WithOpenAIError(OpenAIError{Message: "rate limit"}, http.StatusTooManyRequests),
			channelType: constant.ChannelTypeAnthropic,
			hints:       ChannelErrorHints{RetryAfter: &time.Time{}},
			want:        ChannelErrorClassTransient,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, _ := ClassifyChannelErrorWithHints(tt.err, tt.channelType, tt.hints)
			if got != tt.want {
				t.Fatalf("ClassifyChannelErrorWithHints() = %s, want %s", got, tt.want)
			}
		})
	}
}

func TestChannelErrorClassString(t *testing.T) {
	cases := map[ChannelErrorClass]string{
		ChannelErrorClassNormal:            "normal",
		ChannelErrorClassTransient:         "transient",
		ChannelErrorClassScheduledCooldown: "scheduled_cooldown",
		ChannelErrorClassAuthRefresh:       "auth_refresh",
		ChannelErrorClassPermanent:         "permanent",
	}
	for class, want := range cases {
		if got := class.String(); got != want {
			t.Fatalf("ChannelErrorClass(%d).String() = %q, want %q", class, got, want)
		}
	}
}
