package auth

import (
	"net/http"
	"net/url"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-contrib/sessions"
	"github.com/gin-gonic/gin"
)

// TokenLogin accepts the marketplace token handoff used by external apps.
// For in-process apps, keep the bridge endpoint compatible and redirect back
// to the requested page with the scoped token attached.
func TokenLogin(c *gin.Context) {
	token := c.PostForm("token")
	if token == "" {
		token = c.Query("token")
	}

	callbackUrl := c.PostForm("callbackUrl")
	if callbackUrl == "" {
		callbackUrl = c.Query("callbackUrl")
	}

	target, validCallback := buildTokenLoginRedirectTarget(c, callbackUrl)
	if token != "" {
		setupSessionFromAppToken(c, token)
	}

	query := target.Query()
	query.Del("token")
	if validCallback && token != "" {
		query.Set("token", token)
	}
	target.RawQuery = query.Encode()

	c.Redirect(http.StatusSeeOther, target.String())
}

func setupSessionFromAppToken(c *gin.Context, rawToken string) bool {
	if model.DB == nil {
		return false
	}
	key := strings.TrimSpace(rawToken)
	key = strings.TrimPrefix(key, "Bearer ")
	key = strings.TrimPrefix(key, "bearer ")
	key = strings.TrimPrefix(key, "sk-")
	key = strings.Split(key, "-")[0]
	if key == "" {
		return false
	}

	token, err := model.ValidateUserTokenWithContext(c.Request.Context(), key)
	if err != nil || token == nil || token.UserId <= 0 {
		return false
	}
	tenantId := token.TenantId
	if tenantId <= 0 {
		tenantId = middleware.GetTenantId(c)
	}
	if tenantId <= 0 {
		return false
	}

	user, err := model.GetUserByIdGlobal(token.UserId, false)
	if err != nil || user == nil {
		return false
	}
	info, err := model.GetTenantMembershipAuthInfo(tenantId, user)
	if err != nil {
		return false
	}

	session := sessions.Default(c)
	session.Set("id", user.Id)
	session.Set("username", user.Username)
	session.Set("role", info.EffectiveRole)
	session.Set("platform_role", info.PlatformRole)
	session.Set("tenant_role", info.TenantRole)
	session.Set("status", user.Status)
	session.Set("group", user.Group)
	session.Set("session_version", common.SessionVersion)
	session.Set("tenant_id", tenantId)
	if err := session.Save(); err != nil {
		return false
	}

	c.Set("id", user.Id)
	c.Set("role", info.EffectiveRole)
	c.Set("platform_role", info.PlatformRole)
	c.Set("tenant_role", info.TenantRole)
	c.Set("status", user.Status)
	c.Set("group", user.Group)
	return true
}

func buildTokenLoginRedirectTarget(c *gin.Context, callbackUrl string) (*url.URL, bool) {
	origin := requestOrigin(c)
	target, _ := url.Parse(origin + "/")

	if callbackUrl == "" {
		return target, false
	}

	parsed, err := url.Parse(callbackUrl)
	if err != nil {
		return target, false
	}
	if !parsed.IsAbs() {
		parsed = target.ResolveReference(parsed)
	}
	if parsed.Scheme != target.Scheme || parsed.Host != target.Host {
		return target, false
	}

	return parsed, true
}

func requestOrigin(c *gin.Context) string {
	proto := c.GetHeader("X-Forwarded-Proto")
	if proto == "" {
		if c.Request.TLS != nil {
			proto = "https"
		} else {
			proto = "http"
		}
	}
	proto = strings.Split(proto, ",")[0]
	proto = strings.TrimSpace(proto)

	host := c.GetHeader("X-Forwarded-Host")
	if host == "" {
		host = c.Request.Host
	}
	host = strings.Split(host, ",")[0]
	host = strings.TrimSpace(host)
	if host == "" {
		host = "localhost"
	}

	return proto + "://" + host
}
