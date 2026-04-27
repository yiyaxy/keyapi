package service

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/types"
	"github.com/stretchr/testify/require"
)

func TestResetStatusCode(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		name             string
		statusCode       int
		statusCodeConfig string
		expectedCode     int
	}{
		{
			name:             "map string value",
			statusCode:       429,
			statusCodeConfig: `{"429":"503"}`,
			expectedCode:     503,
		},
		{
			name:             "map int value",
			statusCode:       429,
			statusCodeConfig: `{"429":503}`,
			expectedCode:     503,
		},
		{
			name:             "skip invalid string value",
			statusCode:       429,
			statusCodeConfig: `{"429":"bad-code"}`,
			expectedCode:     429,
		},
		{
			name:             "skip status code 200",
			statusCode:       200,
			statusCodeConfig: `{"200":503}`,
			expectedCode:     200,
		},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			newAPIError := &types.NewAPIError{
				StatusCode: tc.statusCode,
			}
			ResetStatusCode(newAPIError, tc.statusCodeConfig)
			require.Equal(t, tc.expectedCode, newAPIError.StatusCode)
		})
	}
}

func TestRetryAfterFromHeadersParsesDelayAndResetHeaders(t *testing.T) {
	now := time.Date(2026, 4, 27, 12, 0, 0, 0, time.UTC)
	headers := http.Header{}
	headers.Add("Retry-After", "30")
	headers.Add("X-RateLimit-Reset-Requests", "2m")

	got, ok := retryAfterFromHeaders(headers, now)
	require.True(t, ok)
	require.Equal(t, now.Add(2*time.Minute), got)
}

func TestRelayErrorHandlerCarriesChannelErrorHints(t *testing.T) {
	resp := &http.Response{
		StatusCode: http.StatusTooManyRequests,
		Header: http.Header{
			"Retry-After": []string{"60"},
		},
		Body: io.NopCloser(strings.NewReader(`{"error":{"message":"rate limit","type":"rate_limit_error","code":"rate_limit_error"}}`)),
	}

	err := RelayErrorHandler(context.Background(), resp, false)
	require.NotNil(t, err)
	require.NotNil(t, err.ChannelErrorHints.RetryAfter)
	require.WithinDuration(t, time.Now().Add(time.Minute), *err.ChannelErrorHints.RetryAfter, 2*time.Second)
}
