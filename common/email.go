package common

import (
	"crypto/tls"
	"encoding/base64"
	"fmt"
	"net/smtp"
	"slices"
	"strings"
	"time"
)

type SMTPConfig struct {
	Server      string
	Port        int
	SSLEnabled  bool
	Account     string
	From        string
	Token       string
	SystemName  string
}

func generateMessageID(from string) (string, error) {
	split := strings.Split(from, "@")
	if len(split) < 2 {
		return "", fmt.Errorf("invalid SMTP account")
	}
	domain := strings.Split(from, "@")[1]
	return fmt.Sprintf("<%d.%s@%s>", time.Now().UnixNano(), GetRandomString(12), domain), nil
}

// WrapEmailHTML wraps the given body HTML in a styled email template.
func WrapEmailHTML(body string) string {
	return WrapEmailHTMLWithSystemName(SystemName, body)
}

func WrapEmailHTMLWithSystemName(systemName string, body string) string {
	if strings.TrimSpace(systemName) == "" {
		systemName = SystemName
	}
	return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7;padding:40px 0">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06)">
<tr><td style="background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 50%,#a855f7 100%);padding:32px 40px;text-align:center">
<div style="margin:0 0 6px;font-size:36px;line-height:1">&#x1F42A;</div>
<h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:1px"><span style="color:#e0e7ff">Ca</span><span style="color:#ffffff">MeL</span> <span style="font-weight:400;color:#c4b5fd">AI</span></h1>
</td></tr>
<tr><td style="padding:32px 40px;color:#1f2937;font-size:15px;line-height:1.7">
` + body + `
</td></tr>
<tr><td style="padding:20px 40px;background-color:#f9fafb;border-top:1px solid #e5e7eb;text-align:center">
<p style="margin:0;color:#9ca3af;font-size:12px">` + systemName + ` &mdash; 此邮件由系统自动发送，请勿直接回复</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`
}

func SendEmailWithConfig(cfg SMTPConfig, subject string, receiver string, content string) error {
	if cfg.From == "" {
		cfg.From = cfg.Account
	}
	if cfg.SystemName == "" {
		cfg.SystemName = SystemName
	}
	id, err2 := generateMessageID(cfg.From)
	if err2 != nil {
		return err2
	}
	if cfg.Server == "" && cfg.Account == "" {
		return fmt.Errorf("SMTP 服务器未配置")
	}
	encodedSubject := fmt.Sprintf("=?UTF-8?B?%s?=", base64.StdEncoding.EncodeToString([]byte(subject)))
	mail := []byte(fmt.Sprintf("To: %s\r\n"+
		"From: %s <%s>\r\n"+
		"Subject: %s\r\n"+
		"Date: %s\r\n"+
		"Message-ID: %s\r\n"+ // 添加 Message-ID 头
		"Content-Type: text/html; charset=UTF-8\r\n\r\n%s\r\n",
		receiver, cfg.SystemName, cfg.From, encodedSubject, time.Now().Format(time.RFC1123Z), id, content))
	auth := smtp.PlainAuth("", cfg.Account, cfg.Token, cfg.Server)
	addr := fmt.Sprintf("%s:%d", cfg.Server, cfg.Port)
	to := strings.Split(receiver, ";")
	var err error
	if cfg.Port == 465 || cfg.SSLEnabled {
		tlsConfig := &tls.Config{
			InsecureSkipVerify: true,
			ServerName:         cfg.Server,
		}
		conn, err := tls.Dial("tcp", fmt.Sprintf("%s:%d", cfg.Server, cfg.Port), tlsConfig)
		if err != nil {
			return err
		}
		client, err := smtp.NewClient(conn, cfg.Server)
		if err != nil {
			return err
		}
		defer client.Close()
		if err = client.Auth(auth); err != nil {
			return err
		}
		if err = client.Mail(cfg.From); err != nil {
			return err
		}
		receiverEmails := strings.Split(receiver, ";")
		for _, receiver := range receiverEmails {
			if err = client.Rcpt(receiver); err != nil {
				return err
			}
		}
		w, err := client.Data()
		if err != nil {
			return err
		}
		_, err = w.Write(mail)
		if err != nil {
			return err
		}
		err = w.Close()
		if err != nil {
			return err
		}
	} else if isOutlookServer(cfg.Account) || slices.Contains(EmailLoginAuthServerList, cfg.Server) {
		auth = LoginAuth(cfg.Account, cfg.Token)
		err = smtp.SendMail(addr, auth, cfg.From, to, mail)
	} else {
		err = smtp.SendMail(addr, auth, cfg.From, to, mail)
	}
	if err != nil {
		SysError(fmt.Sprintf("failed to send email to %s: %v", receiver, err))
	}
	return err
}

func SendEmail(subject string, receiver string, content string) error {
	cfg := SMTPConfig{
		Server:     SMTPServer,
		Port:       SMTPPort,
		SSLEnabled: SMTPSSLEnabled,
		Account:    SMTPAccount,
		From:       SMTPFrom,
		Token:      SMTPToken,
		SystemName: SystemName,
	}
	return SendEmailWithConfig(cfg, subject, receiver, content)
}
