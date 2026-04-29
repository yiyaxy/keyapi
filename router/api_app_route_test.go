package router

import (
	"net/http"
	"net/http/httptest"
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
