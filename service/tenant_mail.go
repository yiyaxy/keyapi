package service

import (
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

func TenantSystemName(tenantId int) string {
	return strings.TrimSpace(GetConfig(tenantId, "SystemName", common.SystemName))
}

func GetTenantSMTPConfig(tenantId int) common.SMTPConfig {
	from := strings.TrimSpace(getSMTPConfig(tenantId, "SMTPFrom", common.SMTPFrom))
	account := strings.TrimSpace(getSMTPConfig(tenantId, "SMTPAccount", common.SMTPAccount))
	if from == "" {
		from = account
	}

	return common.SMTPConfig{
		Server:     strings.TrimSpace(getSMTPConfig(tenantId, "SMTPServer", common.SMTPServer)),
		Port:       getSMTPConfigInt(tenantId, "SMTPPort", common.SMTPPort),
		SSLEnabled: getSMTPConfigBool(tenantId, "SMTPSSLEnabled", common.SMTPSSLEnabled),
		Account:    account,
		From:       from,
		Token:      strings.TrimSpace(getSMTPConfig(tenantId, "SMTPToken", common.SMTPToken)),
		SystemName: TenantSystemName(tenantId),
	}
}

func CanSendTenantEmail(tenantId int) bool {
	cfg := GetTenantSMTPConfig(tenantId)
	return cfg.Server != "" && cfg.Account != "" && cfg.Token != ""
}

func WrapTenantEmailHTML(tenantId int, body string) string {
	return common.WrapEmailHTMLWithSystemName(TenantSystemName(tenantId), body)
}

func SendTenantEmail(tenantId int, subject string, receiver string, content string) error {
	return common.SendEmailWithConfig(GetTenantSMTPConfig(tenantId), subject, receiver, content)
}

func getSMTPConfig(tenantId int, key string, platformDefault string) string {
	if tenantId > 0 {
		if val, found := model.GetTenantOption(tenantId, key); found {
			return val
		}
		return ""
	}
	return GetConfig(tenantId, key, platformDefault)
}

func getSMTPConfigBool(tenantId int, key string, platformDefault bool) bool {
	val := getSMTPConfig(tenantId, key, strconv.FormatBool(platformDefault))
	if val == "" {
		return platformDefault
	}
	return val == "true"
}

func getSMTPConfigInt(tenantId int, key string, platformDefault int) int {
	val := getSMTPConfig(tenantId, key, strconv.Itoa(platformDefault))
	if val == "" {
		return platformDefault
	}
	result, err := strconv.Atoi(val)
	if err != nil {
		return platformDefault
	}
	return result
}
