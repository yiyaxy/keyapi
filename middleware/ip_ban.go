package middleware

import (
	"net/http"

	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

func IPBanCheck() gin.HandlerFunc {
	return func(c *gin.Context) {
		ip := c.ClientIP()
		banned, reason := model.IsIpBanned(ip)
		if banned {
			abortWithOpenAiMessage(c, http.StatusForbidden, "IP banned: "+reason)
			return
		}
		c.Next()
	}
}
