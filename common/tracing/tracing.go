// Package tracing 维护请求生命周期里的 phase 打点，供 controller / relay
// 等层复用。事件最终会被 service.GenerateTextOtherInfo 等写入 log.other
// 的 trace_events 字段。
//
// 放在 common 而不是 controller 的原因：relay 包需要在 adaptor 调用前后
// 打点，但不能反向依赖 controller（会循环）。
package tracing

import (
	"time"

	"github.com/gin-gonic/gin"
)

// EventsKey 是 gin.Context 里存放事件切片用的 key。导出以便需要直接读
// ctx.Value 的调用方（例如 service/log_info_generate.go）保持一致。
const EventsKey = "trace_events"

// Event 对应一次 phase 打点。字段与历史上 controller.TraceEvent 完全一致，
// 这样 log.other.trace_events 的 JSON 结构不变。
type Event struct {
	Time    int64                  `json:"time"`
	Phase   string                 `json:"phase"`
	Message string                 `json:"message"`
	Detail  map[string]interface{} `json:"detail,omitempty"`
}

// Add 往当前请求的事件切片追加一条打点。c 为 nil 时是 no-op（便于非
// HTTP 入口调用方无需判空）。
func Add(c *gin.Context, phase string, message string, detail map[string]interface{}) {
	if c == nil {
		return
	}
	val, _ := c.Get(EventsKey)
	events, _ := val.([]Event)
	events = append(events, Event{
		Time:    time.Now().UnixMilli(),
		Phase:   phase,
		Message: message,
		Detail:  detail,
	})
	c.Set(EventsKey, events)
}

// Get 取出已打点的事件切片；未设置时返回 nil。
func Get(c *gin.Context) []Event {
	if c == nil {
		return nil
	}
	val, exists := c.Get(EventsKey)
	if !exists {
		return nil
	}
	events, _ := val.([]Event)
	return events
}
