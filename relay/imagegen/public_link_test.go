package imagegen

import (
	"net/url"
	"strconv"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestPublicTaskURLBuildsSignedURL(t *testing.T) {
	expiresAt := time.Unix(2000, 0).Unix()

	taskURL := PublicTaskURL("https://api.example.com/", "task_123", expiresAt)

	parsed, err := url.Parse(taskURL)
	require.NoError(t, err)
	require.Equal(t, "https", parsed.Scheme)
	require.Equal(t, "api.example.com", parsed.Host)
	require.Equal(t, "/public/images/async/task_123", parsed.Path)
	require.Equal(t, strconv.FormatInt(expiresAt, 10), parsed.Query().Get("expires"))
	require.NotEmpty(t, parsed.Query().Get("sig"))
	require.NoError(t, ValidatePublicTaskLink("task_123", parsed.Query().Get("expires"), parsed.Query().Get("sig"), time.Unix(1000, 0)))
}

func TestValidatePublicTaskLinkRejectsExpiredAndTamperedLinks(t *testing.T) {
	expiresAt := time.Unix(2000, 0).Unix()
	taskURL := PublicTaskURL("", "task_123", expiresAt)
	parsed, err := url.Parse(taskURL)
	require.NoError(t, err)
	q := parsed.Query()

	require.ErrorIs(t, ValidatePublicTaskLink("task_123", q.Get("expires"), q.Get("sig"), time.Unix(2001, 0)), ErrPublicTaskLinkExpired)
	require.ErrorIs(t, ValidatePublicTaskLink("task_other", q.Get("expires"), q.Get("sig"), time.Unix(1000, 0)), ErrPublicTaskLinkInvalid)
}
