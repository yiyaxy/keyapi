package platform

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/oauth"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/console_setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/system_setting"

	"github.com/gin-gonic/gin"
)

func TestStatus(c *gin.Context) {
	err := model.PingDB()
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"success": false,
			"message": "数据库连接失败",
		})
		return
	}
	// 获取HTTP统计信息
	httpStats := middleware.GetStats()
	c.JSON(http.StatusOK, gin.H{
		"success":    true,
		"message":    "Server is running",
		"http_stats": httpStats,
	})
	return
}

func GetStatus(c *gin.Context) {

	cs := *console_setting.GetConsoleSetting()
	tenantId := middleware.GetTenantId(c)

	// Take a narrow snapshot only for direct OptionMap reads. service.GetConfig*
	// also reads OptionMap internally, so holding this lock while building the
	// whole response can deadlock when an option writer is waiting.
	common.OptionMapRWMutex.RLock()
	topupSubscriptionNotice := strings.TrimSpace(common.OptionMap["TopupSubscriptionNotice"])
	invoiceDefaultIssueKindCode := common.OptionMap["InvoiceDefaultIssueKindCode"]
	invoiceDefaultGoodsName := common.OptionMap["InvoiceDefaultGoodsName"]
	headerNavModules := common.OptionMap["HeaderNavModules"]
	sidebarModulesAdmin := common.OptionMap["SidebarModulesAdmin"]
	common.OptionMapRWMutex.RUnlock()

	passkeySetting := system_setting.GetPasskeySettings()
	legalSetting := system_setting.GetLegalSettings()

	data := gin.H{
		"version":                     common.Version,
		"start_time":                  common.StartTime,
		"register_enabled":            service.GetConfigBool(tenantId, "RegisterEnabled", common.RegisterEnabled),
		"password_register_enabled":   service.GetConfigBool(tenantId, "PasswordRegisterEnabled", common.PasswordRegisterEnabled),
		"password_login_enabled":      service.GetConfigBool(tenantId, "PasswordLoginEnabled", common.PasswordLoginEnabled),
		"email_verification":          service.GetConfigBool(tenantId, "EmailVerificationEnabled", common.EmailVerificationEnabled),
		"github_oauth":                service.GetConfigBool(tenantId, "GitHubOAuthEnabled", common.GitHubOAuthEnabled),
		"github_client_id":            service.GetConfig(tenantId, "GitHubClientId", common.GitHubClientId),
		"discord_oauth":               system_setting.GetDiscordSettings().Enabled,
		"discord_client_id":           system_setting.GetDiscordSettings().ClientId,
		"linuxdo_oauth":               service.GetConfigBool(tenantId, "LinuxDOOAuthEnabled", common.LinuxDOOAuthEnabled),
		"linuxdo_client_id":           service.GetConfig(tenantId, "LinuxDOClientId", common.LinuxDOClientId),
		"linuxdo_minimum_trust_level": service.GetConfigInt(tenantId, "LinuxDOMinimumTrustLevel", common.LinuxDOMinimumTrustLevel),
		"telegram_oauth":              service.GetConfigBool(tenantId, "TelegramOAuthEnabled", common.TelegramOAuthEnabled),
		"telegram_bot_name":           service.GetConfig(tenantId, "TelegramBotName", common.TelegramBotName),
		"system_name":                 service.GetConfig(tenantId, "SystemName", common.SystemName),
		"logo":                        service.GetConfig(tenantId, "Logo", common.Logo),
		"footer_html":                 service.GetConfig(tenantId, "Footer", common.Footer),
		"wechat_qrcode":               service.GetConfig(tenantId, "WeChatAccountQRCodeImageURL", common.WeChatAccountQRCodeImageURL),
		"wechat_login":                service.GetConfigBool(tenantId, "WeChatAuthEnabled", common.WeChatAuthEnabled),
		"wx_mini_login":               service.IsWxMiniLoginEnabled(tenantId),
		"server_address":              system_setting.ServerAddress,
		"turnstile_check":             service.GetConfigBool(tenantId, "TurnstileCheckEnabled", common.TurnstileCheckEnabled),
		"turnstile_site_key":          service.GetConfig(tenantId, "TurnstileSiteKey", common.TurnstileSiteKey),
		"top_up_link":                 service.GetConfig(tenantId, "TopUpLink", common.TopUpLink),
		"topup_subscription_notice":   topupSubscriptionNotice,
		"docs_link":                   operation_setting.GetGeneralSetting().DocsLink,
		"quota_per_unit":              common.QuotaPerUnit,
		// 兼容旧前端：保留 display_in_currency，同时提供新的 quota_display_type
		"display_in_currency":           operation_setting.IsCurrencyDisplay(),
		"quota_display_type":            operation_setting.GetQuotaDisplayType(),
		"custom_currency_symbol":        operation_setting.GetGeneralSetting().CustomCurrencySymbol,
		"custom_currency_exchange_rate": operation_setting.GetGeneralSetting().CustomCurrencyExchangeRate,
		"enable_batch_update":           common.BatchUpdateEnabled,
		"enable_drawing":                service.GetConfigBool(tenantId, "DrawingEnabled", common.DrawingEnabled),
		"enable_task":                   service.GetConfigBool(tenantId, "TaskEnabled", common.TaskEnabled),
		"wx_pay_enabled":                service.GetConfigBool(tenantId, "WxPayEnabled", common.WxPayEnabled),
		"enable_data_export":            service.GetConfigBool(tenantId, "DataExportEnabled", common.DataExportEnabled),
		"data_export_default_time":      common.DataExportDefaultTime,
		"default_collapse_sidebar":      common.DefaultCollapseSidebar,
		"mj_notify_enabled":             setting.MjNotifyEnabled,
		"chats":                         setting.Chats,
		"demo_site_enabled":             operation_setting.DemoSiteEnabled,
		"self_use_mode_enabled":         operation_setting.SelfUseModeEnabled,
		"default_use_auto_group":        setting.DefaultUseAutoGroup,

		"usd_exchange_rate":               operation_setting.USDExchangeRate,
		"price":                           operation_setting.Price,
		"min_invoice_amount":              service.GetConfigInt(tenantId, "MinInvoiceAmount", operation_setting.MinInvoiceAmount),
		"invoice_provider":                service.GetConfig(tenantId, "InvoiceProvider", common.InvoiceProvider),
		"invoice_auto_issue_enabled":      service.GetConfigBool(tenantId, "InvoiceAutoIssueEnabled", common.InvoiceAutoIssueEnabled),
		"invoice_default_issue_kind_code": strings.TrimSpace(service.GetConfig(tenantId, "InvoiceDefaultIssueKindCode", invoiceDefaultIssueKindCode)),
		"invoice_default_goods_name":      strings.TrimSpace(service.GetConfig(tenantId, "InvoiceDefaultGoodsName", invoiceDefaultGoodsName)),
		"stripe_unit_price":               setting.StripeUnitPrice,

		// 面板启用开关
		"api_info_enabled":      cs.ApiInfoEnabled,
		"uptime_kuma_enabled":   cs.UptimeKumaEnabled,
		"announcements_enabled": cs.AnnouncementsEnabled,
		"faq_enabled":           cs.FAQEnabled,

		// 模块管理配置
		"HeaderNavModules":    headerNavModules,
		"SidebarModulesAdmin": sidebarModulesAdmin,

		"oidc_enabled":                 system_setting.GetOIDCSettings().Enabled,
		"oidc_client_id":               system_setting.GetOIDCSettings().ClientId,
		"oidc_authorization_endpoint":  system_setting.GetOIDCSettings().AuthorizationEndpoint,
		"passkey_login":                passkeySetting.Enabled,
		"passkey_display_name":         passkeySetting.RPDisplayName,
		"passkey_rp_id":                passkeySetting.RPID,
		"passkey_origins":              passkeySetting.Origins,
		"passkey_allow_insecure":       passkeySetting.AllowInsecureOrigin,
		"passkey_user_verification":    passkeySetting.UserVerification,
		"passkey_attachment":           passkeySetting.AttachmentPreference,
		"setup":                        constant.Setup,
		"user_agreement_enabled":       legalSetting.UserAgreement != "",
		"privacy_policy_enabled":       legalSetting.PrivacyPolicy != "",
		"refund_policy_enabled":        legalSetting.RefundPolicy != "",
		"checkin_enabled":              operation_setting.GetCheckinSetting().Enabled,
		"top_up_rebate_count":          service.GetConfigInt(tenantId, "TopUpRebateCount", common.TopUpRebateCount),
		"top_up_rebate_percent":        service.GetConfigInt(tenantId, "TopUpRebatePercent", common.TopUpRebatePercent),
		"quota_for_inviter":            service.GetConfigInt(tenantId, "QuotaForInviter", common.QuotaForInviter),
		"quota_for_invitee":            service.GetConfigInt(tenantId, "QuotaForInvitee", common.QuotaForInvitee),
		"subscription_recommend_count": common.SubscriptionRecommendCount,
		"_qn":                          "new-api",
	}

	// 根据启用状态注入可选内容
	if cs.ApiInfoEnabled {
		data["api_info"] = console_setting.GetApiInfo()
	}
	if cs.AnnouncementsEnabled {
		data["announcements"] = console_setting.GetAnnouncements()
	}
	if cs.FAQEnabled {
		data["faq"] = console_setting.GetFAQ()
	}

	// Add enabled custom OAuth providers
	customProviders := oauth.GetEnabledCustomProviders()
	if len(customProviders) > 0 {
		type CustomOAuthInfo struct {
			Id                    int    `json:"id"`
			Name                  string `json:"name"`
			Slug                  string `json:"slug"`
			Icon                  string `json:"icon"`
			ClientId              string `json:"client_id"`
			AuthorizationEndpoint string `json:"authorization_endpoint"`
			Scopes                string `json:"scopes"`
		}
		providersInfo := make([]CustomOAuthInfo, 0, len(customProviders))
		for _, p := range customProviders {
			config := p.GetConfig()
			providersInfo = append(providersInfo, CustomOAuthInfo{
				Id:                    config.Id,
				Name:                  config.Name,
				Slug:                  config.Slug,
				Icon:                  config.Icon,
				ClientId:              config.ClientId,
				AuthorizationEndpoint: config.AuthorizationEndpoint,
				Scopes:                config.Scopes,
			})
		}
		data["custom_oauth_providers"] = providersInfo
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    data,
	})
	return
}

func GetNotice(c *gin.Context) {
	tenantId := middleware.GetTenantId(c)
	notice := service.GetConfig(tenantId, "Notice", "")

	lang := c.Query("lang")
	if lang != "" && lang != "zh" && notice != "" {
		translated, err := service.TranslateContent("notice", "main", map[string]string{"content": notice}, lang)
		if err == nil && translated["content"] != "" {
			notice = translated["content"]
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    notice,
	})
	return
}

func GetAbout(c *gin.Context) {
	tenantId := middleware.GetTenantId(c)
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    service.GetConfig(tenantId, "About", ""),
	})
	return
}

func GetUserAgreement(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    system_setting.GetLegalSettings().UserAgreement,
	})
	return
}

func GetPrivacyPolicy(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    system_setting.GetLegalSettings().PrivacyPolicy,
	})
	return
}

func GetRefundPolicy(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    system_setting.GetLegalSettings().RefundPolicy,
	})
	return
}

func GetMidjourney(c *gin.Context) {
	common.OptionMapRWMutex.RLock()
	defer common.OptionMapRWMutex.RUnlock()
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    common.OptionMap["Midjourney"],
	})
	return
}

func GetHomePageContent(c *gin.Context) {
	tenantId := middleware.GetTenantId(c)
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    service.GetConfig(tenantId, "HomePageContent", ""),
	})
	return
}

func SendEmailVerification(c *gin.Context) {
	email := c.Query("email")
	if err := common.Validate.Var(email, "required,email"); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "无效的参数",
		})
		return
	}
	parts := strings.Split(email, "@")
	if len(parts) != 2 {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "无效的邮箱地址",
		})
		return
	}
	localPart := parts[0]
	domainPart := parts[1]
	tenantId := middleware.GetTenantId(c)
	if service.GetConfigBool(tenantId, "EmailDomainRestrictionEnabled", common.EmailDomainRestrictionEnabled) {
		whitelist := common.EmailDomainWhitelist
		if override := service.GetConfig(tenantId, "EmailDomainWhitelist", ""); override != "" {
			items := strings.Split(override, ",")
			whitelist = make([]string, 0, len(items))
			for _, p := range items {
				if trimmed := strings.TrimSpace(p); trimmed != "" {
					whitelist = append(whitelist, trimmed)
				}
			}
		}
		allowed := false
		for _, domain := range whitelist {
			if domainPart == domain {
				allowed = true
				break
			}
		}
		if !allowed {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "The administrator has enabled the email domain name whitelist, and your email address is not allowed due to special symbols or it's not in the whitelist.",
			})
			return
		}
	}
	if service.GetConfigBool(tenantId, "EmailAliasRestrictionEnabled", common.EmailAliasRestrictionEnabled) {
		containsSpecialSymbols := strings.Contains(localPart, "+") || strings.Contains(localPart, ".")
		if containsSpecialSymbols {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "管理员已启用邮箱地址别名限制，您的邮箱地址由于包含特殊符号而被拒绝。",
			})
			return
		}
	}

	if model.IsEmailAlreadyTaken(email, middleware.GetTenantId(c)) {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "邮箱地址已被占用",
		})
		return
	}
	code := common.GenerateVerificationCode(6)
	common.RegisterVerificationCodeWithKey(email, code, common.EmailVerificationPurpose)
	systemName := service.TenantSystemName(tenantId)
	subject := fmt.Sprintf("%s邮箱验证邮件", systemName)
	body := fmt.Sprintf(`<p style="margin:0 0 16px">您好，您正在进行 <strong>%s</strong> 邮箱验证。</p>
<div style="margin:20px 0;padding:20px;background-color:#f0f4ff;border-radius:8px;text-align:center">
<span style="font-size:32px;font-weight:700;letter-spacing:8px;color:#4f46e5">%s</span>
</div>
<p style="margin:16px 0 0;color:#6b7280;font-size:13px">验证码 %d 分钟内有效，如果不是本人操作，请忽略此邮件。</p>`,
		systemName, code, common.VerificationValidMinutes)
	err := service.SendTenantEmail(tenantId, subject, email, service.WrapTenantEmailHTML(tenantId, body))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
	})
	return
}

func SendPasswordResetEmail(c *gin.Context) {
	email := c.Query("email")
	if err := common.Validate.Var(email, "required,email"); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "无效的参数",
		})
		return
	}
	if !model.IsEmailAlreadyTaken(email, middleware.GetTenantId(c)) {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "该邮箱地址未注册",
		})
		return
	}
	code := common.GenerateVerificationCode(0)
	common.RegisterVerificationCodeWithKey(email, code, common.PasswordResetPurpose)
	link := fmt.Sprintf("%s/user/reset?email=%s&token=%s", system_setting.ServerAddress, email, code)
	tenantId := middleware.GetTenantId(c)
	systemName := service.TenantSystemName(tenantId)
	subject := fmt.Sprintf("%s密码重置", systemName)
	body := fmt.Sprintf(`<p style="margin:0 0 16px">您好，您正在进行 <strong>%s</strong> 密码重置。</p>
<div style="margin:20px 0;text-align:center">
<a href="%s" style="display:inline-block;padding:12px 32px;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#ffffff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600">重置密码</a>
</div>
<p style="margin:16px 0 8px;color:#6b7280;font-size:13px">如果按钮无法点击，请复制以下链接到浏览器中打开：</p>
<p style="margin:0 0 16px;word-break:break-all;color:#4f46e5;font-size:13px">%s</p>
<p style="margin:0;color:#6b7280;font-size:13px">链接 %d 分钟内有效，如果不是本人操作，请忽略此邮件。</p>`,
		systemName, link, link, common.VerificationValidMinutes)
	err := service.SendTenantEmail(tenantId, subject, email, service.WrapTenantEmailHTML(tenantId, body))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
	})
}

type PasswordResetRequest struct {
	Email string `json:"email"`
	Token string `json:"token"`
}

func ResetPassword(c *gin.Context) {
	var req PasswordResetRequest
	err := json.NewDecoder(c.Request.Body).Decode(&req)
	if req.Email == "" || req.Token == "" {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "无效的参数",
		})
		return
	}
	if !common.VerifyCodeWithKey(req.Email, req.Token, common.PasswordResetPurpose) {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "重置链接非法或已过期",
		})
		return
	}
	password := common.GenerateVerificationCode(12)
	err = model.ResetUserPasswordByEmail(req.Email, password, middleware.GetTenantId(c))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.DeleteKey(req.Email, common.PasswordResetPurpose)
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    password,
	})
	return
}
