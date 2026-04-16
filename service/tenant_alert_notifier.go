package service

import (
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

// dispatchTenantAlertNotification 把一条告警通过 SMTP 发给该租户全部 active 管理员。
//
// 行为：
//   - SMTP 未配置（SMTPServer 为空）→ 直接跳过（但记录 SysLog 以便调试）
//   - 无任何 active 租户管理员 → 跳过
//   - 任一收件人发送失败 → 仅记录 SysError，不影响其他收件人
//
// 本函数不做"去重/频率限制"——由 notifyPendingAlerts 按 sinceUnix 过滤新告警来保证。
func dispatchTenantAlertNotification(record model.TenantAlertRecord) {
	if common.SMTPServer == "" {
		common.SysLog(fmt.Sprintf("dispatchTenantAlertNotification skipped: SMTP not configured (tenant=%d type=%s)",
			record.TenantId, record.AlertType))
		return
	}
	emails, err := model.ListTenantAdminEmails(record.TenantId)
	if err != nil {
		common.SysError(fmt.Sprintf("dispatchTenantAlertNotification list admins failed tenant=%d: %s",
			record.TenantId, err.Error()))
		return
	}
	if len(emails) == 0 {
		return
	}

	tenant := model.GetTenantById(record.TenantId)
	tenantName := ""
	if tenant != nil {
		tenantName = tenant.Name
	}

	subject := fmt.Sprintf("[%s 告警] %s", tenantName, alertSeverityLabel(record.Severity))
	body := buildAlertEmailBody(tenantName, record)

	for _, to := range emails {
		if err := common.SendEmail(subject, to, body); err != nil {
			common.SysError(fmt.Sprintf("dispatchTenantAlertNotification SendEmail failed tenant=%d to=%s: %s",
				record.TenantId, to, err.Error()))
		}
	}
}

func alertSeverityLabel(severity string) string {
	switch severity {
	case "critical":
		return "严重告警"
	case "warning":
		return "警告"
	default:
		return "告警"
	}
}

func buildAlertEmailBody(tenantName string, r model.TenantAlertRecord) string {
	return fmt.Sprintf(`<div style="font-family:Arial,sans-serif;line-height:1.6">
<h2>租户告警通知</h2>
<p><b>租户：</b>%s</p>
<p><b>告警类型：</b>%s</p>
<p><b>严重度：</b>%s</p>
<p><b>消息：</b>%s</p>
<p><b>触发时间：</b>%s</p>
<hr>
<p style="color:#888;font-size:12px">请登录租户管理后台查看详情或确认此告警。</p>
</div>`,
		htmlEscape(tenantName),
		htmlEscape(r.AlertType),
		htmlEscape(alertSeverityLabel(r.Severity)),
		htmlEscape(r.Message),
		htmlEscape(formatUnix(r.TriggeredAt)),
	)
}

func htmlEscape(s string) string {
	// 轻量 HTML escape；告警文本基本受控（由本后端生成），这里只防 XSS 兜底
	out := ""
	for _, c := range s {
		switch c {
		case '<':
			out += "&lt;"
		case '>':
			out += "&gt;"
		case '&':
			out += "&amp;"
		case '"':
			out += "&quot;"
		default:
			out += string(c)
		}
	}
	return out
}

func formatUnix(u int64) string {
	if u <= 0 {
		return ""
	}
	return time.Unix(u, 0).Format("2006-01-02 15:04:05")
}
