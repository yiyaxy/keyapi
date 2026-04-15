package middleware

import (
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/relaymetrics"
	"github.com/gin-gonic/gin"
)

// PerformanceTrace 性能追踪中间件 - 记录请求各阶段耗时
func PerformanceTrace() gin.HandlerFunc {
	return func(c *gin.Context) {
		// 只追踪中继请求
		if !isRelayRequest(c) {
			c.Next()
			return
		}

		startTime := time.Now()
		requestID := c.GetString("X-Request-Id")
		if requestID == "" {
			requestID = fmt.Sprintf("%d", time.Now().UnixNano())
		}

		// 记录请求开始
		common.SysLog(fmt.Sprintf("[PERF][%s] === Request Start === Path: %s", requestID, c.Request.URL.Path))

		// 记录中间件链开始时间
		c.Set("perf_start", startTime)
		c.Set("perf_request_id", requestID)

		// 记录中间件完成时间
		c.Next()

		// 请求处理完成
		totalDuration := time.Since(startTime)

		// 获取各阶段耗时
		authTime := getStageTime(c, "perf_auth_done")
		distributeTime := getStageTime(c, "perf_distribute_done")
		relayTime := getStageTime(c, "perf_relay_done")
		firstByteTime := getStageTime(c, "perf_first_byte")

		// 输出性能报告
		common.SysLog(fmt.Sprintf("[PERF][%s] === Performance Report ===", requestID))
		common.SysLog(fmt.Sprintf("[PERF][%s] Total:        %v", requestID, totalDuration))
		common.SysLog(fmt.Sprintf("[PERF][%s] Auth:         %v", requestID, authTime))
		common.SysLog(fmt.Sprintf("[PERF][%s] Distribute:   %v", requestID, distributeTime))
		common.SysLog(fmt.Sprintf("[PERF][%s] Relay:        %v", requestID, relayTime))
		common.SysLog(fmt.Sprintf("[PERF][%s] FirstByte:    %v", requestID, firstByteTime))

		// 计算各阶段占比
		if totalDuration > 0 {
			authPercent := float64(authTime) / float64(totalDuration) * 100
			distributePercent := float64(distributeTime) / float64(totalDuration) * 100
			relayPercent := float64(relayTime) / float64(totalDuration) * 100

			common.SysLog(fmt.Sprintf("[PERF][%s] Auth%%:        %.2f%%", requestID, authPercent))
			common.SysLog(fmt.Sprintf("[PERF][%s] Distribute%%:  %.2f%%", requestID, distributePercent))
			common.SysLog(fmt.Sprintf("[PERF][%s] Relay%%:       %.2f%%", requestID, relayPercent))
		}

		// 警告：如果首字延迟超过 5 秒
		if firstByteTime > 5*time.Second {
			common.SysLog(fmt.Sprintf("[PERF][%s] ⚠️  WARNING: First byte time > 5s!", requestID))
		}

		common.SysLog(fmt.Sprintf("[PERF][%s] === End ===", requestID))
	}
}

// MarkStage 标记性能追踪阶段
func MarkStage(c *gin.Context, stage string) {
	startTime, exists := c.Get("perf_start")
	if !exists {
		return
	}

	start := startTime.(time.Time)
	elapsed := time.Since(start)
	c.Set(stage, elapsed)

	requestID := c.GetString("perf_request_id")
	stageName := getStageName(stage)
	common.SysLog(fmt.Sprintf("[PERF][%s] %s: %v", requestID, stageName, elapsed))
}

func getStageTime(c *gin.Context, stage string) time.Duration {
	val, exists := c.Get(stage)
	if !exists {
		return 0
	}
	return val.(time.Duration)
}

func getStageName(stage string) string {
	names := map[string]string{
		"perf_auth_done":       "Auth Done",
		"perf_distribute_done": "Distribute Done",
		"perf_relay_done":      "Relay Done",
		"perf_first_byte":      "First Byte",
		"perf_upstream_start":  "Upstream Start",
		"perf_upstream_done":   "Upstream Done",
	}
	if name, ok := names[stage]; ok {
		return name
	}
	return stage
}

func isRelayRequest(c *gin.Context) bool {
	return relaymetrics.PathMonitored(c.Request.URL.Path)
}
