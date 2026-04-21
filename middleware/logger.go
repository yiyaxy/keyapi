package middleware

import (
	"fmt"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
)

const RouteTagKey = "route_tag"

func RouteTag(tag string) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Set(RouteTagKey, tag)
		c.Next()
	}
}

func SetUpLogger(server *gin.Engine) {
	server.Use(gin.LoggerWithFormatter(func(param gin.LogFormatterParams) string {
		var requestID string
		var tag string
		if param.Keys != nil {
			requestID, _ = param.Keys[common.RequestIdKey].(string)
			tag, _ = param.Keys[RouteTagKey].(string)
		}
		if requestID == "" {
			requestID = "-"
		}
		if tag == "" {
			tag = "web"
		}
		return fmt.Sprintf("[GIN] %s | %-*s | %s | %3d | %13v | %15s | %7s %s\n",
			common.FmtLogTime(param.TimeStamp),
			common.TraceColumnWidth, requestID,
			tag,
			param.StatusCode,
			param.Latency,
			param.ClientIP,
			param.Method,
			param.Path,
		)
	}))
}
