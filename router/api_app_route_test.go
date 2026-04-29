package router

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestAppWhoamiRouteIsNotCapturedBySlug(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	SetApiRouter(r)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/app/whoami", nil)
	r.ServeHTTP(w, req)

	require.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestTokenLoginRedirectsBackToSameOriginCallback(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	SetApiRouter(r)

	form := url.Values{}
	form.Set("token", "sk-test")
	form.Set("callbackUrl", "/apps/image-diagnosis?appType=style#top")
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "https://token.cymoon.cn/api/auth/token-login", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	r.ServeHTTP(w, req)

	require.Equal(t, http.StatusSeeOther, w.Code)
	location := w.Header().Get("Location")
	require.Contains(t, location, "https://token.cymoon.cn/apps/image-diagnosis")
	require.Contains(t, location, "appType=style")
	require.Contains(t, location, "token=sk-test")
	require.Contains(t, location, "#top")
}

func TestTokenLoginRejectsExternalCallback(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	SetApiRouter(r)

	form := url.Values{}
	form.Set("token", "sk-test")
	form.Set("callbackUrl", "https://evil.example/callback")
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "https://token.cymoon.cn/api/auth/token-login", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	r.ServeHTTP(w, req)

	require.Equal(t, http.StatusSeeOther, w.Code)
	require.Equal(t, "https://token.cymoon.cn/?token=sk-test", w.Header().Get("Location"))
}
