package service

import (
	"fmt"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
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
	tenant := model.GetTenantById(record.TenantId)
	tenantName := ""
	if tenant != nil {
		tenantName = tenant.Name
	}

	// 1) SMTP 邮件分发（保持原行为）
	if common.SMTPServer == "" {
		common.SysLog(fmt.Sprintf("dispatchTenantAlertNotification SMTP skipped: not configured (tenant=%d type=%s)",
			record.TenantId, record.AlertType))
	} else {
		emails, err := model.ListTenantAdminEmails(record.TenantId)
		if err != nil {
			common.SysError(fmt.Sprintf("dispatchTenantAlertNotification list admin emails failed tenant=%d: %s",
				record.TenantId, err.Error()))
		} else if len(emails) > 0 {
			subject := fmt.Sprintf("[%s 告警] %s", tenantName, alertSeverityLabel(record.Severity))
			body := buildAlertEmailBody(tenantName, record)
			for _, to := range emails {
				if err := common.SendEmail(subject, to, body); err != nil {
					common.SysError(fmt.Sprintf("dispatchTenantAlertNotification SendEmail failed tenant=%d to=%s: %s",
						record.TenantId, to, err.Error()))
				}
			}
		}
	}

	// 2) Webhook 分发（best-effort）
	dispatchTenantAlertWebhook(record)

	// 3) 站内信分发（best-effort）
	dispatchTenantAlertInApp(record)
}

// dispatchTenantAlertWebhook 当租户配置了 WebhookURL 时，POST 一份告警 payload。
// HMAC-SHA256 签名由 SendWebhookNotify 内部根据 secret 生成。
func dispatchTenantAlertWebhook(record model.TenantAlertRecord) {
	webhookURL := GetConfig(record.TenantId, "WebhookURL", "")
	if webhookURL == "" {
		return
	}
	secret := GetConfig(record.TenantId, "WebhookSecret", "")
	notify := dto.Notify{
		Type:    "alert." + record.AlertType,
		Title:   fmt.Sprintf("[%s] %s", strings.ToUpper(record.Severity), record.AlertType),
		Content: record.Message,
		Values: []interface{}{
			map[string]interface{}{
				"tenant_id":    record.TenantId,
				"alert_id":     record.Id,
				"alert_type":   record.AlertType,
				"severity":     record.Severity,
				"triggered_at": record.TriggeredAt,
			},
		},
	}
	if err := SendWebhookNotify(webhookURL, secret, notify); err != nil {
		common.SysError(fmt.Sprintf("tenant alert webhook failed (tenant=%d alert=%d): %s",
			record.TenantId, record.Id, err.Error()))
	}
}

// dispatchTenantAlertInApp 给租户全部 active 管理员塞一条 directed 站内信。
func dispatchTenantAlertInApp(record model.TenantAlertRecord) {
	adminIds, err := model.ListTenantAdminUserIds(record.TenantId)
	if err != nil {
		common.SysError(fmt.Sprintf("dispatchTenantAlertInApp list admin ids failed tenant=%d: %s",
			record.TenantId, err.Error()))
		return
	}
	if len(adminIds) == 0 {
		return
	}
	title := fmt.Sprintf("[告警] %s", record.AlertType)
	for _, uid := range adminIds {
		msg := &model.Message{
			TenantId:     record.TenantId,
			Title:        title,
			Content:      record.Message,
			Type:         model.MessageTypeDirected,
			TargetUserId: uid,
			SenderId:     0, // system sender
			Status:       model.MessageStatusNormal,
		}
		if err := model.CreateMessage(msg); err != nil {
			common.SysError(fmt.Sprintf("dispatchTenantAlertInApp CreateMessage failed tenant=%d user=%d: %s",
				record.TenantId, uid, err.Error()))
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
