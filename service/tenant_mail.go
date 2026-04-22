package service

import (
	"strings"

	"github.com/QuantumNous/new-api/common"
)

func TenantSystemName(tenantId int) string {
	return strings.TrimSpace(GetConfig(tenantId, "SystemName", common.SystemName))
}

func GetTenantSMTPConfig(tenantId int) common.SMTPConfig {
	from := strings.TrimSpace(GetConfig(tenantId, "SMTPFrom", common.SMTPFrom))
	account := strings.TrimSpace(GetConfig(tenantId, "SMTPAccount", common.SMTPAccount))
	if from == "" {
		from = account
	}

	return common.SMTPConfig{
		Server:     strings.TrimSpace(GetConfig(tenantId, "SMTPServer", common.SMTPServer)),
		Port:       GetConfigInt(tenantId, "SMTPPort", common.SMTPPort),
		SSLEnabled: GetConfigBool(tenantId, "SMTPSSLEnabled", common.SMTPSSLEnabled),
		Account:    account,
		From:       from,
		Token:      strings.TrimSpace(GetConfig(tenantId, "SMTPToken", common.SMTPToken)),
		SystemName: TenantSystemName(tenantId),
	}
}

func CanSendTenantEmail(tenantId int) bool {
	cfg := GetTenantSMTPConfig(tenantId)
	return cfg.Server != "" || cfg.Account != ""
}

func WrapTenantEmailHTML(tenantId int, body string) string {
	return common.WrapEmailHTMLWithSystemName(TenantSystemName(tenantId), body)
}

func SendTenantEmail(tenantId int, subject string, receiver string, content string) error {
	return common.SendEmailWithConfig(GetTenantSMTPConfig(tenantId), subject, receiver, content)
}
