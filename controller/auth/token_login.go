package auth

import (
	"net/http"
	"net/url"
	"strings"

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

	target := buildTokenLoginRedirectTarget(c, callbackUrl)
	query := target.Query()
	query.Del("token")
	if token != "" {
		query.Set("token", token)
	}
	target.RawQuery = query.Encode()

	c.Redirect(http.StatusSeeOther, target.String())
}

func buildTokenLoginRedirectTarget(c *gin.Context, callbackUrl string) *url.URL {
	origin := requestOrigin(c)
	target, _ := url.Parse(origin + "/")

	if callbackUrl == "" {
		return target
	}

	parsed, err := url.Parse(callbackUrl)
	if err != nil {
		return target
	}
	if !parsed.IsAbs() {
		parsed = target.ResolveReference(parsed)
	}
	if parsed.Scheme != target.Scheme || parsed.Host != target.Host {
		return target
	}

	return parsed
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
