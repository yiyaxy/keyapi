package middleware

import (
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/relaymetrics"
	"github.com/gin-gonic/gin"
)

// PerformanceTrace 性能追踪中间件 - 记录请求各阶段耗时
// TraceId 自动由 common.SysLog 从 goroutine-local 带入,不再在消息体嵌 id
func PerformanceTrace() gin.HandlerFunc {
	return func(c *gin.Context) {
		// 只追踪中继请求
		if !isRelayRequest(c) {
			c.Next()
			return
		}

		startTime := time.Now()

		// 记录请求开始
		common.SysLog(fmt.Sprintf("[PERF] === Request Start === Path: %s", c.Request.URL.Path))

		// 记录中间件链开始时间
		c.Set("perf_start", startTime)
		c.Next()

		// 请求处理完成
		totalDuration := time.Since(startTime)

		authTime := getStageTime(c, "perf_auth_done")
		distributeTime := getStageTime(c, "perf_distribute_done")
		relayTime := getStageTime(c, "perf_relay_done")
		firstByteTime := getStageTime(c, "perf_first_byte")

		common.SysLog("[PERF] === Performance Report ===")
		common.SysLog(fmt.Sprintf("[PERF] Total:        %v", totalDuration))
		common.SysLog(fmt.Sprintf("[PERF] Auth:         %v", authTime))
		common.SysLog(fmt.Sprintf("[PERF] Distribute:   %v", distributeTime))
		common.SysLog(fmt.Sprintf("[PERF] Relay:        %v", relayTime))
		common.SysLog(fmt.Sprintf("[PERF] FirstByte:    %v", firstByteTime))

		if totalDuration > 0 {
			authPercent := float64(authTime) / float64(totalDuration) * 100
			distributePercent := float64(distributeTime) / float64(totalDuration) * 100
			relayPercent := float64(relayTime) / float64(totalDuration) * 100

			common.SysLog(fmt.Sprintf("[PERF] Auth%%:        %.2f%%", authPercent))
			common.SysLog(fmt.Sprintf("[PERF] Distribute%%:  %.2f%%", distributePercent))
			common.SysLog(fmt.Sprintf("[PERF] Relay%%:       %.2f%%", relayPercent))
		}

		if firstByteTime > 5*time.Second {
			common.SysLog("[PERF] ⚠️  WARNING: First byte time > 5s!")
		}

		common.SysLog("[PERF] === End ===")
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

	stageName := getStageName(stage)
	common.SysLog(fmt.Sprintf("[PERF] %s: %v", stageName, elapsed))
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
