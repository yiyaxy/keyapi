package router

import (
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/controller/auth"
	"github.com/QuantumNous/new-api/controller/catalog"
	"github.com/QuantumNous/new-api/controller/channel"
	"github.com/QuantumNous/new-api/controller/codex"
	"github.com/QuantumNous/new-api/controller/invoice"
	"github.com/QuantumNous/new-api/controller/obs"
	"github.com/QuantumNous/new-api/controller/payment"
	"github.com/QuantumNous/new-api/controller/tenant"
	"github.com/QuantumNous/new-api/controller/ticket"
	"github.com/QuantumNous/new-api/middleware"

	// Import oauth package to register providers via init()
	_ "github.com/QuantumNous/new-api/oauth"

	"github.com/gin-contrib/gzip"
	"github.com/gin-gonic/gin"
)

func SetApiRouter(router *gin.Engine) {
	apiRouter := router.Group("/api")
	apiRouter.Use(middleware.TenantResolve())
	apiRouter.Use(middleware.RouteTag("api"))
	apiRouter.Use(gzip.Gzip(gzip.DefaultCompression))
	apiRouter.Use(middleware.BodyStorageCleanup()) // 清理请求体存储
	apiRouter.Use(middleware.GlobalAPIRateLimit())
	apiRouter.Use(middleware.TenantAPIRateLimit())
	{
		apiRouter.GET("/setup", controller.GetSetup)
		apiRouter.POST("/setup", controller.PostSetup)
		apiRouter.GET("/status", controller.GetStatus)
		apiRouter.GET("/uptime/status", controller.GetUptimeKumaStatus)
		apiRouter.GET("/models", middleware.UserAuth(), catalog.DashboardListModels)
		apiRouter.GET("/status/test", middleware.AdminAuth(), controller.TestStatus)
		apiRouter.GET("/notice", controller.GetNotice)
		apiRouter.GET("/user-agreement", controller.GetUserAgreement)
		apiRouter.GET("/privacy-policy", controller.GetPrivacyPolicy)
		apiRouter.GET("/refund-policy", controller.GetRefundPolicy)
		apiRouter.GET("/about", controller.GetAbout)
		//apiRouter.GET("/midjourney", controller.GetMidjourney)
		apiRouter.GET("/home_page_content", controller.GetHomePageContent)
		apiRouter.GET("/pricing", middleware.TryUserAuth(), catalog.GetPricing)
		apiRouter.GET("/subscription/plans", controller.GetSubscriptionPlans)
		apiRouter.GET("/verification", middleware.EmailVerificationRateLimit(), middleware.TurnstileCheck(), controller.SendEmailVerification)
		apiRouter.GET("/reset_password", middleware.CriticalRateLimit(), middleware.TurnstileCheck(), controller.SendPasswordResetEmail)
		apiRouter.POST("/user/reset", middleware.CriticalRateLimit(), controller.ResetPassword)
		// OAuth routes - specific routes must come before :provider wildcard
		apiRouter.GET("/oauth/state", middleware.CriticalRateLimit(), auth.GenerateOAuthCode)
		apiRouter.POST("/oauth/email/bind", middleware.CriticalRateLimit(), controller.EmailBind)
		// Non-standard OAuth (WeChat, Telegram) - keep original routes
		apiRouter.GET("/oauth/wechat", middleware.CriticalRateLimit(), auth.WeChatAuth)
		apiRouter.POST("/oauth/wechat/bind", middleware.CriticalRateLimit(), auth.WeChatBind)
		apiRouter.POST("/oauth/wx_mini/login", middleware.CriticalRateLimit(), auth.WxMiniLogin)
		// WeChat mini-program scan-to-login (PC web)
		apiRouter.POST("/oauth/wx_qr/ticket", middleware.CriticalRateLimit(), auth.GenerateWxQrTicket)
		apiRouter.GET("/oauth/wx_qr/poll", auth.PollWxQrTicket)
		apiRouter.POST("/oauth/wx_qr/confirm", middleware.CriticalRateLimit(), auth.ConfirmWxQrTicket)
		apiRouter.POST("/oauth/wx_qr/login", middleware.CriticalRateLimit(), auth.LoginWithWxQrTicket)
		apiRouter.GET("/oauth/telegram/login", middleware.CriticalRateLimit(), auth.TelegramLogin)
		apiRouter.GET("/oauth/telegram/bind", middleware.CriticalRateLimit(), auth.TelegramBind)
		// Standard OAuth providers (GitHub, Discord, OIDC, LinuxDO) - unified route
		apiRouter.GET("/oauth/:provider", middleware.CriticalRateLimit(), auth.HandleOAuth)
		apiRouter.GET("/ratio_config", middleware.CriticalRateLimit(), catalog.GetRatioConfig)

		apiRouter.POST("/stripe/webhook", payment.StripeWebhook)
		apiRouter.POST("/creem/webhook", payment.CreemWebhook)
		apiRouter.POST("/waffo/webhook", payment.WaffoWebhook)
		// WeChat Pay S2 callback — no auth; signature verified inside handler
		apiRouter.POST("/payment/wechat/notify/:tenant_id/:order_type", payment.HandleWechatNotify)
		// WeChat Pay S3 refund callback — no auth; signature verified inside handler
		apiRouter.POST("/payment/wechat/refund_notify/:tenant_id", payment.HandleWechatRefundNotify)

		// Universal secure verification routes
		apiRouter.POST("/verify", middleware.UserAuth(), middleware.CriticalRateLimit(), auth.UniversalVerify)

		ticketRoute := apiRouter.Group("/ticket")
		ticketRoute.Use(middleware.UserAuth())
		{
			ticketRoute.POST("/uploads/presign", ticket.TicketPresignUpload)
			ticketRoute.POST("", ticket.TicketCreate)
			ticketRoute.GET("", ticket.TicketList)
			ticketRoute.GET("/:id", ticket.TicketDetail)
			ticketRoute.POST("/:id/reply", ticket.TicketReply)
			ticketRoute.GET("/attachments/:att_id/presign", ticket.TicketPresignAttachment)
		}

		ticketAdminRoute := apiRouter.Group("/ticket/admin")
		ticketAdminRoute.Use(middleware.TenantAdminAuth())
		{
			ticketAdminRoute.GET("", ticket.TicketAdminList)
			ticketAdminRoute.GET("/:id", ticket.TicketAdminDetail)
			ticketAdminRoute.POST("/:id/reply", ticket.TicketAdminReply)
			ticketAdminRoute.POST("/:id/status", ticket.TicketAdminUpdateStatus)
			ticketAdminRoute.GET("/attachments/:att_id/presign", ticket.TicketAdminPresignAttachment)
		}

		ticketStorageRoute := apiRouter.Group("/ticket_storage")
		ticketStorageRoute.Use(middleware.PlatformAdminAuth())
		{
			ticketStorageRoute.PUT("/secret", ticket.UpsertTicketStorageSecret)
		}

		invoiceSelfRoute := apiRouter.Group("/invoice/self")
		invoiceSelfRoute.Use(middleware.UserAuth())
		{
			invoiceSelfRoute.GET("/invoiceable_orders", invoice.InvoiceSelfInvoiceableOrders)
			invoiceSelfRoute.GET("/applications", invoice.InvoiceSelfListApplications)
			invoiceSelfRoute.GET("/applications/:id", invoice.InvoiceSelfGetApplicationDetail)
			invoiceSelfRoute.POST("/applications", invoice.InvoiceSelfCreateApplication)
			invoiceSelfRoute.POST("/applications/:id/cancel", invoice.InvoiceSelfCancelApplication)
			invoiceSelfRoute.GET("/files/:file_id/presign", invoice.InvoiceSelfPresignFile)
		}

		invoiceAdminRoute := apiRouter.Group("/invoice/admin")
		invoiceAdminRoute.Use(middleware.TenantAdminAuth())
		{
			invoiceAdminRoute.GET("/applications", invoice.InvoiceAdminListApplications)
			invoiceAdminRoute.GET("/applications/:id", invoice.InvoiceAdminGetApplicationDetail)
			invoiceAdminRoute.POST("/applications/:id/status", invoice.InvoiceAdminUpdateApplicationStatus)
			invoiceAdminRoute.POST("/applications/:id/issue", invoice.InvoiceAdminIssue)
			invoiceAdminRoute.POST("/applications/:id/query", invoice.InvoiceAdminQuery)
			invoiceAdminRoute.POST("/applications/:id/red", invoice.InvoiceAdminRedInvoice)
			invoiceAdminRoute.POST("/applications/:id/switch_manual", invoice.InvoiceAdminSwitchManual)
			invoiceAdminRoute.POST("/applications/:id/items/:item_id/payment_info", invoice.InvoiceAdminSetItemPaymentInfo)
			invoiceAdminRoute.POST("/uploads/presign", invoice.InvoiceAdminPresignUpload)
			invoiceAdminRoute.POST("/applications/:id/files", invoice.InvoiceAdminFinalizeInvoiceFiles)
			invoiceAdminRoute.POST("/applications/:id/files/:file_id/visibility", invoice.InvoiceAdminUpdateFileVisibility)
			invoiceAdminRoute.GET("/files/:file_id/presign", invoice.InvoiceAdminPresignFile)
		}

		userRoute := apiRouter.Group("/user")
		{
			userRoute.POST("/register", middleware.CriticalRateLimit(), middleware.TurnstileCheck(), controller.Register)
			userRoute.POST("/login", middleware.CriticalRateLimit(), middleware.TurnstileCheck(), controller.Login)
			userRoute.POST("/login/2fa", middleware.CriticalRateLimit(), auth.Verify2FALogin)
			userRoute.POST("/passkey/login/begin", middleware.CriticalRateLimit(), auth.PasskeyLoginBegin)
			userRoute.POST("/passkey/login/finish", middleware.CriticalRateLimit(), auth.PasskeyLoginFinish)
			//userRoute.POST("/tokenlog", middleware.CriticalRateLimit(), controller.TokenLog)
			userRoute.POST("/logout", controller.Logout)
			userRoute.POST("/epay/notify", payment.EpayNotify)
			userRoute.GET("/epay/notify", payment.EpayNotify)
			userRoute.GET("/groups", catalog.GetUserGroups)

			selfRoute := userRoute.Group("/")
			selfRoute.Use(middleware.UserAuth())
			{
				selfRoute.GET("/self/groups", catalog.GetUserGroups)
				selfRoute.GET("/self/channel-groups", catalog.GetChannelGroups)
				selfRoute.GET("/self", controller.GetSelf)
				selfRoute.GET("/tenants", controller.ListCurrentUserTenants)
				selfRoute.POST("/tenant/switch", controller.SwitchTenant)
				selfRoute.GET("/models", controller.GetUserModels)
				selfRoute.PUT("/self", controller.UpdateSelf)
				selfRoute.DELETE("/self", controller.DeleteSelf)
				selfRoute.GET("/token", controller.GenerateAccessToken)
				selfRoute.GET("/passkey", auth.PasskeyStatus)
				selfRoute.POST("/passkey/register/begin", auth.PasskeyRegisterBegin)
				selfRoute.POST("/passkey/register/finish", auth.PasskeyRegisterFinish)
				selfRoute.POST("/passkey/verify/begin", auth.PasskeyVerifyBegin)
				selfRoute.POST("/passkey/verify/finish", auth.PasskeyVerifyFinish)
				selfRoute.DELETE("/passkey", auth.PasskeyDelete)
				selfRoute.GET("/aff", controller.GetAffCode)
				selfRoute.GET("/topup/info", payment.GetTopUpInfo)
				selfRoute.GET("/topup/self", payment.GetUserTopUps)
				selfRoute.POST("/topup", middleware.CriticalRateLimit(), controller.TopUp)
				selfRoute.POST("/pay", middleware.CriticalRateLimit(), payment.RequestEpay)
				selfRoute.POST("/amount", payment.RequestAmount)
				selfRoute.POST("/stripe/pay", middleware.CriticalRateLimit(), payment.RequestStripePay)
				selfRoute.POST("/stripe/amount", payment.RequestStripeAmount)
				selfRoute.POST("/creem/pay", middleware.CriticalRateLimit(), payment.RequestCreemPay)
				selfRoute.POST("/waffo/pay", middleware.CriticalRateLimit(), payment.RequestWaffoPay)
				selfRoute.POST("/aff_transfer", controller.TransferAffQuota)
				selfRoute.PUT("/setting", controller.UpdateUserSetting)

				// 2FA routes
				selfRoute.GET("/2fa/status", auth.Get2FAStatus)
				selfRoute.POST("/2fa/setup", auth.Setup2FA)
				selfRoute.POST("/2fa/enable", auth.Enable2FA)
				selfRoute.POST("/2fa/disable", auth.Disable2FA)
				selfRoute.POST("/2fa/backup_codes", auth.RegenerateBackupCodes)

				// Check-in routes
				selfRoute.GET("/checkin", controller.GetCheckinStatus)
				selfRoute.POST("/checkin", middleware.TurnstileCheck(), controller.DoCheckin)

				// Custom OAuth bindings
				selfRoute.GET("/oauth/bindings", auth.GetUserOAuthBindings)
				selfRoute.DELETE("/oauth/bindings/:provider_id", auth.UnbindCustomOAuth)
			}

			adminRoute := userRoute.Group("/")
			adminRoute.Use(middleware.TenantAdminAuth())
			{
				adminRoute.GET("/", controller.GetAllUsers)
				adminRoute.GET("/topup", payment.GetAllTopUps)
				adminRoute.POST("/topup/complete", payment.AdminCompleteTopUp)
				adminRoute.GET("/search", controller.SearchUsers)
				adminRoute.GET("/:id/oauth/bindings", auth.GetUserOAuthBindingsByAdmin)
				adminRoute.DELETE("/:id/oauth/bindings/:provider_id", auth.UnbindCustomOAuthByAdmin)
				adminRoute.DELETE("/:id/bindings/:binding_type", controller.AdminClearUserBinding)
				adminRoute.GET("/:id", controller.GetUser)
				adminRoute.POST("/", controller.CreateUser)
				adminRoute.POST("/manage", controller.ManageUser)
				adminRoute.PUT("/", controller.UpdateUser)
				adminRoute.DELETE("/:id", controller.DeleteUser)
				adminRoute.DELETE("/:id/reset_passkey", auth.AdminResetPasskey)

				// Admin 2FA routes
				adminRoute.GET("/2fa/stats", auth.Admin2FAStats)
				adminRoute.DELETE("/:id/2fa", auth.AdminDisable2FA)

				// Admin IP history
				adminRoute.GET("/:id/ips", obs.GetUserIpHistory)
				adminRoute.GET("/:id/api-ips", obs.GetUserApiIpHistory)
			}
		}

		// Subscription billing (plans, purchase, admin management)
		subscriptionRoute := apiRouter.Group("/subscription")
		subscriptionRoute.Use(middleware.UserAuth())
		{
			subscriptionRoute.GET("/self", controller.GetSubscriptionSelf)
			subscriptionRoute.PUT("/self/preference", controller.UpdateSubscriptionPreference)
			subscriptionRoute.POST("/activate/:id", controller.ActivateSubscription)
			subscriptionRoute.POST("/epay/pay", middleware.CriticalRateLimit(), payment.SubscriptionRequestEpay)
			subscriptionRoute.POST("/stripe/pay", middleware.CriticalRateLimit(), payment.SubscriptionRequestStripePay)
			subscriptionRoute.POST("/creem/pay", middleware.CriticalRateLimit(), payment.SubscriptionRequestCreemPay)
		}
		subscriptionAdminRoute := apiRouter.Group("/subscription/admin")
		subscriptionAdminRoute.Use(middleware.TenantAdminAuth())
		{
			subscriptionAdminRoute.GET("/plans", controller.AdminListSubscriptionPlans)
			subscriptionAdminRoute.POST("/plans", controller.AdminCreateSubscriptionPlan)
			subscriptionAdminRoute.PUT("/plans/:id", controller.AdminUpdateSubscriptionPlan)
			subscriptionAdminRoute.PATCH("/plans/:id", controller.AdminUpdateSubscriptionPlanStatus)
			subscriptionAdminRoute.POST("/bind", controller.AdminBindSubscription)

			// User subscription management (admin)
			subscriptionAdminRoute.GET("/users/:id/subscriptions", controller.AdminListUserSubscriptions)
			subscriptionAdminRoute.POST("/users/:id/subscriptions", controller.AdminCreateUserSubscription)
			subscriptionAdminRoute.POST("/user_subscriptions/:id/invalidate", controller.AdminInvalidateUserSubscription)
			subscriptionAdminRoute.DELETE("/user_subscriptions/:id", controller.AdminDeleteUserSubscription)

			// Subscription order management (admin)
			subscriptionAdminRoute.GET("/orders", controller.AdminListSubscriptionOrders)
			subscriptionAdminRoute.POST("/orders/complete", controller.AdminCompleteSubscriptionOrder)
		}

		// Subscription payment callbacks (no auth)
		apiRouter.POST("/subscription/epay/notify", payment.SubscriptionEpayNotify)
		apiRouter.GET("/subscription/epay/notify", payment.SubscriptionEpayNotify)
		apiRouter.GET("/subscription/epay/return", payment.SubscriptionEpayReturn)
		apiRouter.POST("/subscription/epay/return", payment.SubscriptionEpayReturn)
		optionRoute := apiRouter.Group("/option")
		optionRoute.Use(middleware.RootAuth())
		{
			optionRoute.GET("/", controller.GetOptions)
			optionRoute.PUT("/", controller.UpdateOption)
			optionRoute.GET("/channel_affinity_cache", channel.GetChannelAffinityCacheStats)
			optionRoute.DELETE("/channel_affinity_cache", channel.ClearChannelAffinityCache)
			optionRoute.POST("/rest_model_ratio", catalog.ResetModelRatio)
			optionRoute.POST("/migrate_console_setting", controller.MigrateConsoleSetting) // 用于迁移检测的旧键，下个版本会删除
			optionRoute.POST("/force_logout_all", controller.ForceLogoutAll)
		}

		// Custom OAuth provider management (root only)
		customOAuthRoute := apiRouter.Group("/custom-oauth-provider")
		customOAuthRoute.Use(middleware.RootAuth())
		{
			customOAuthRoute.POST("/discovery", auth.FetchCustomOAuthDiscovery)
			customOAuthRoute.GET("/", auth.GetCustomOAuthProviders)
			customOAuthRoute.GET("/:id", auth.GetCustomOAuthProvider)
			customOAuthRoute.POST("/", auth.CreateCustomOAuthProvider)
			customOAuthRoute.PUT("/:id", auth.UpdateCustomOAuthProvider)
			customOAuthRoute.DELETE("/:id", auth.DeleteCustomOAuthProvider)
		}
		performanceRoute := apiRouter.Group("/performance")
		performanceRoute.Use(middleware.RootAuth())
		{
			performanceRoute.GET("/stats", obs.GetPerformanceStats)
			performanceRoute.DELETE("/disk_cache", obs.ClearDiskCache)
			performanceRoute.POST("/reset_stats", obs.ResetPerformanceStats)
			performanceRoute.POST("/gc", obs.ForceGC)
			performanceRoute.GET("/logs", obs.GetLogFiles)
			performanceRoute.DELETE("/logs", obs.CleanupLogFiles)
		}
		ratioSyncRoute := apiRouter.Group("/ratio_sync")
		ratioSyncRoute.Use(middleware.RootAuth())
		{
			ratioSyncRoute.GET("/channels", catalog.GetSyncableChannels)
			ratioSyncRoute.POST("/fetch", catalog.FetchUpstreamRatios)
		}
		channelRoute := apiRouter.Group("/channel")
		channelRoute.Use(middleware.RootAuth())
		{
			channelRoute.GET("/", channel.GetAllChannels)
			channelRoute.GET("/search", channel.SearchChannels)
			channelRoute.GET("/models", catalog.ChannelListModels)
			channelRoute.GET("/models_enabled", catalog.EnabledListModels)
			channelRoute.GET("/:id", channel.GetChannel)
			channelRoute.POST("/:id/key", middleware.RootAuth(), middleware.CriticalRateLimit(), middleware.DisableCache(), middleware.SecureVerificationRequired(), channel.GetChannelKey)
			channelRoute.GET("/test", channel.TestAllChannels)
			channelRoute.GET("/test/:id", channel.TestChannel)
			channelRoute.GET("/update_balance", channel.UpdateAllChannelsBalance)
			channelRoute.GET("/update_balance/:id", channel.UpdateChannelBalance)
			channelRoute.POST("/", channel.AddChannel)
			channelRoute.PUT("/", channel.UpdateChannel)
			channelRoute.DELETE("/disabled", channel.DeleteDisabledChannel)
			channelRoute.POST("/tag/disabled", channel.DisableTagChannels)
			channelRoute.POST("/tag/enabled", channel.EnableTagChannels)
			channelRoute.PUT("/tag", channel.EditTagChannels)
			channelRoute.DELETE("/:id", channel.DeleteChannel)
			channelRoute.POST("/batch", channel.DeleteChannelBatch)
			channelRoute.POST("/fix", channel.FixChannelsAbilities)
			channelRoute.GET("/fetch_models/:id", channel.FetchUpstreamModels)
			channelRoute.POST("/fetch_models", middleware.RootAuth(), channel.FetchModels)
			channelRoute.POST("/codex/oauth/start", codex.StartCodexOAuth)
			channelRoute.POST("/codex/oauth/complete", codex.CompleteCodexOAuth)
			channelRoute.POST("/:id/codex/oauth/start", codex.StartCodexOAuthForChannel)
			channelRoute.POST("/:id/codex/oauth/complete", codex.CompleteCodexOAuthForChannel)
			channelRoute.POST("/:id/codex/refresh", channel.RefreshCodexChannelCredential)
			channelRoute.GET("/:id/codex/usage", codex.GetCodexChannelUsage)
			channelRoute.POST("/ollama/pull", channel.OllamaPullModel)
			channelRoute.POST("/ollama/pull/stream", channel.OllamaPullModelStream)
			channelRoute.DELETE("/ollama/delete", channel.OllamaDeleteModel)
			channelRoute.GET("/ollama/version/:id", channel.OllamaVersion)
			channelRoute.POST("/batch/tag", channel.BatchSetChannelTag)
			channelRoute.GET("/tag/models", channel.GetTagModels)
			channelRoute.POST("/copy/:id", channel.CopyChannel)
			channelRoute.POST("/multi_key/manage", channel.ManageMultiKeys)
			channelRoute.POST("/upstream_updates/apply", channel.ApplyChannelUpstreamModelUpdates)
			channelRoute.POST("/upstream_updates/apply_all", channel.ApplyAllChannelUpstreamModelUpdates)
			channelRoute.POST("/upstream_updates/detect", channel.DetectChannelUpstreamModelUpdates)
			channelRoute.POST("/upstream_updates/detect_all", channel.DetectAllChannelUpstreamModelUpdates)
		}
		tokenRoute := apiRouter.Group("/token")
		tokenRoute.Use(middleware.UserAuth())
		{
			tokenRoute.GET("/", controller.GetAllTokens)
			tokenRoute.GET("/search", middleware.SearchRateLimit(), controller.SearchTokens)
			tokenRoute.GET("/:id", controller.GetToken)
			tokenRoute.POST("/:id/key", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.GetTokenKey)
			tokenRoute.POST("/", controller.AddToken)
			tokenRoute.PUT("/", controller.UpdateToken)
			tokenRoute.DELETE("/:id", controller.DeleteToken)
			tokenRoute.POST("/batch", controller.DeleteTokenBatch)
			tokenRoute.POST("/batch/keys", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.GetTokenKeysBatch)
		}

		usageRoute := apiRouter.Group("/usage")
		usageRoute.Use(middleware.CORS(), middleware.CriticalRateLimit())
		{
			tokenUsageRoute := usageRoute.Group("/token")
			tokenUsageRoute.Use(middleware.TokenAuthReadOnly())
			{
				tokenUsageRoute.GET("/", controller.GetTokenUsage)
			}
		}

		redemptionRoute := apiRouter.Group("/redemption")
		redemptionRoute.Use(middleware.TenantAdminAuth())
		{
			redemptionRoute.GET("/", catalog.GetAllRedemptions)
			redemptionRoute.GET("/search", catalog.SearchRedemptions)
			redemptionRoute.GET("/:id", catalog.GetRedemption)
			redemptionRoute.POST("/", catalog.AddRedemption)
			redemptionRoute.PUT("/", catalog.UpdateRedemption)
			redemptionRoute.DELETE("/invalid", catalog.DeleteInvalidRedemption)
			redemptionRoute.DELETE("/:id", catalog.DeleteRedemption)
		}
		logRoute := apiRouter.Group("/log")
		logRoute.GET("/", middleware.TenantAdminAuth(), obs.GetAllLogs)
		logRoute.DELETE("/", middleware.TenantAdminAuth(), obs.DeleteHistoryLogs)
		logRoute.GET("/stat", middleware.TenantAdminAuth(), obs.GetLogsStat)
		logRoute.GET("/self/stat", middleware.UserAuth(), obs.GetLogsSelfStat)
		logRoute.GET("/channel_affinity_usage_cache", middleware.TenantAdminAuth(), channel.GetChannelAffinityUsageCacheStats)
		logRoute.GET("/search", middleware.TenantAdminAuth(), obs.SearchAllLogs)
		logRoute.GET("/self", middleware.UserAuth(), obs.GetUserLogs)
		logRoute.GET("/self/search", middleware.UserAuth(), middleware.SearchRateLimit(), obs.SearchUserLogs)
		logRoute.GET("/self/cache_savings", middleware.UserAuth(), obs.GetCacheSavingsSelf)
		logRoute.GET("/cache_savings", middleware.TenantAdminAuth(), obs.GetCacheSavingsStat)
		logRoute.GET("/request/:request_id", middleware.TenantAdminAuth(), obs.GetRequestTrace)

		dataRoute := apiRouter.Group("/data")
		dataRoute.GET("/", middleware.TenantAdminAuth(), obs.GetAllQuotaDates)
		dataRoute.GET("/self", middleware.UserAuth(), obs.GetUserQuotaDates)

		analyticsRoute := apiRouter.Group("/analytics")
		analyticsRoute.Use(middleware.TenantAdminAuth())
		{
			analyticsRoute.GET("/channel", obs.GetAnalyticsByChannel)
			analyticsRoute.GET("/model", obs.GetAnalyticsByModel)
			analyticsRoute.GET("/user", obs.GetAnalyticsByUser)
			analyticsRoute.GET("/site-rpm", obs.GetSiteRPM)
			analyticsRoute.GET("/site-rpm/history", obs.GetSiteRPMHistory)

			// Purchase analytics
			analyticsRoute.GET("/purchase/overview", obs.GetPurchaseOverview)
			analyticsRoute.GET("/purchase/trend", obs.GetPurchaseTrend)
			analyticsRoute.GET("/purchase/payment-method", obs.GetPurchasePaymentMethod)
			analyticsRoute.GET("/purchase/order-type", obs.GetPurchaseOrderType)
			analyticsRoute.GET("/purchase/top-users", obs.GetPurchaseTopSpenders)
			analyticsRoute.GET("/purchase/redemption", obs.GetPurchaseRedemptionStats)

			// Subscription & Top-up analytics (new separate endpoints)
			analyticsRoute.GET("/purchase/subscription/overview", obs.GetSubscriptionOverview)
			analyticsRoute.GET("/purchase/subscription/plan-breakdown", obs.GetSubscriptionPlanBreakdown)
			analyticsRoute.GET("/purchase/subscription/heatmap", obs.GetSubscriptionHeatmap)
			analyticsRoute.GET("/purchase/topup/overview", obs.GetTopUpOverview)
			analyticsRoute.GET("/purchase/dau", obs.GetPurchaseDAUTrend)
			analyticsRoute.GET("/purchase/registrations", obs.GetPurchaseRegistrationTrend)
			analyticsRoute.GET("/purchase/conversion", obs.GetPurchaseConversionFunnel)
			analyticsRoute.GET("/purchase/referral", obs.GetPurchaseReferralAnalytics)
			analyticsRoute.GET("/channel-monitor", obs.GetChannelMonitor)
		}

		agentLogRoute := apiRouter.Group("/agent-logs")
		agentLogRoute.Use(middleware.TenantAdminAuth())
		{
			agentLogRoute.GET("", obs.GetAgentLogs)
			agentLogRoute.POST("", obs.CreateAgentLog)
			agentLogRoute.PUT("/:id", obs.UpdateAgentLog)
			agentLogRoute.DELETE("/:id", obs.DeleteAgentLog)
		}

		agentReportRoute := apiRouter.Group("/agent-reports")
		agentReportRoute.Use(middleware.TenantAdminAuth())
		{
			agentReportRoute.GET("", obs.GetAgentReports)
			agentReportRoute.GET("/:id", obs.GetAgentReportDetail)
			agentReportRoute.POST("", obs.CreateAgentReport)
			agentReportRoute.PUT("/:id", obs.UpdateAgentReport)
			agentReportRoute.DELETE("/:id", obs.DeleteAgentReport)
		}

		purchaseRoute := apiRouter.Group("/purchase")
		purchaseRoute.Use(middleware.TenantAdminAuth())
		{
			purchaseRoute.GET("/topup", controller.AdminListTopUpOrders)
			purchaseRoute.POST("/topup/complete", payment.AdminCompleteTopUp)
			purchaseRoute.POST("/topup/expire", controller.AdminExpireTopUpOrder)
			purchaseRoute.POST("/topup/delete", controller.AdminDeleteTopUpOrder)
			purchaseRoute.GET("/subscription", controller.AdminListSubscriptionOrdersFull)
			purchaseRoute.POST("/subscription/complete", controller.AdminCompleteSubscriptionOrder)
			purchaseRoute.POST("/subscription/expire", controller.AdminExpireSubscriptionOrderAction)
			purchaseRoute.POST("/subscription/delete", controller.AdminDeleteSubscriptionOrderAction)
		}

		affTransferRoute := apiRouter.Group("/aff_transfer")
		{
			affTransferRoute.POST("/", middleware.UserAuth(), controller.UserCreateAffTransfer)
			affTransferRoute.GET("/self", middleware.UserAuth(), controller.UserGetAffTransferHistory)
			affTransferRoute.GET("/pending_quota", middleware.UserAuth(), controller.UserGetPendingQuota)
			affTransferRoute.GET("/", middleware.TenantAdminAuth(), controller.AdminGetAllAffTransfers)
			affTransferRoute.POST("/process", middleware.TenantAdminAuth(), controller.AdminProcessAffTransfer)
			affTransferRoute.POST("/batch_approve", middleware.TenantAdminAuth(), controller.AdminBatchApproveAllPending)
			affTransferRoute.GET("/stats", middleware.TenantAdminAuth(), controller.AdminGetAffTransferStats)
			affTransferRoute.GET("/rebate_logs", middleware.UserAuth(), controller.UserGetAffRebateLogs)
		}

		// Prompt rule routes (admin)
		promptRuleRoute := apiRouter.Group("/prompt_rule")
		promptRuleRoute.Use(middleware.TenantAdminAuth())
		{
			promptRuleRoute.GET("/", catalog.GetAllPromptRules)
			promptRuleRoute.POST("/", catalog.CreatePromptRule)
			promptRuleRoute.PUT("/", catalog.UpdatePromptRule)
			promptRuleRoute.DELETE("/:id", catalog.DeletePromptRule)
		}

		// User rebate setting routes (admin)
		rebateSettingRoute := apiRouter.Group("/user_rebate_setting")
		rebateSettingRoute.Use(middleware.TenantAdminAuth())
		{
			rebateSettingRoute.GET("/", controller.GetAllUserRebateSettings)
			rebateSettingRoute.GET("/:id", controller.GetUserRebateSetting)
			rebateSettingRoute.POST("/", controller.CreateUserRebateSetting)
			rebateSettingRoute.PUT("/", controller.UpdateUserRebateSetting)
			rebateSettingRoute.DELETE("/:id", controller.DeleteUserRebateSetting)
		}

		// Message routes (admin)
		messageAdminRoute := apiRouter.Group("/message/admin")
		messageAdminRoute.Use(middleware.TenantAdminAuth())
		{
			messageAdminRoute.POST("/", controller.AdminCreateMessage)
			messageAdminRoute.GET("/", controller.AdminListMessages)
			messageAdminRoute.GET("/:id", controller.AdminGetMessage)
			messageAdminRoute.PUT("/:id", controller.AdminEditMessage)
			messageAdminRoute.DELETE("/:id", controller.AdminRecallMessage)
			messageAdminRoute.GET("/:id/read_status", controller.AdminGetMessageReadStatus)
		}

		// Console translation route
		apiRouter.GET("/console/translated", middleware.UserAuth(), controller.GetTranslatedConsole)

		// Message routes (user inbox)
		messageUserRoute := apiRouter.Group("/message")
		messageUserRoute.Use(middleware.UserAuth())
		{
			messageUserRoute.GET("/inbox", controller.GetUserInbox)
			messageUserRoute.GET("/inbox/:id", controller.GetUserInboxMessage)
			messageUserRoute.POST("/inbox/:id/read", controller.MarkMessageRead)
			messageUserRoute.GET("/unread_count", controller.GetUnreadMessageCount)
		}

		ipRoute := apiRouter.Group("/ip")
		ipRoute.Use(middleware.TenantAdminAuth())
		{
			ipRoute.GET("/lookup", obs.IpLookup)
			ipRoute.GET("/users", obs.IpUsers)
			ipRoute.GET("/analytics", obs.IpAnalytics)
			ipRoute.GET("/records", obs.IpRecords)
			ipRoute.POST("/ban", obs.BanIp)
			ipRoute.POST("/unban", obs.UnbanIp)
			ipRoute.GET("/bans", obs.GetIpBans)

			// V2 enhanced IP analytics
			ipV2 := ipRoute.Group("/v2")
			{
				ipV2.GET("/overview", obs.IpOverviewV2)
				ipV2.GET("/login/geo", obs.LoginGeoDist)
				ipV2.GET("/login/time_pattern", obs.LoginTimePattern)
				ipV2.GET("/login/type_detail", obs.LoginTypeDetail)
				ipV2.GET("/login/multi_account", obs.MultiAccountIps)
				ipV2.POST("/login/multi_account/disable_users", obs.DisableMultiAccountUsersByIp)
				ipV2.GET("/api/top_ips", obs.ApiTopIps)
				ipV2.GET("/api/geo", obs.ApiGeoDist)
				ipV2.GET("/api/time_pattern", obs.ApiTimePattern)
				ipV2.GET("/api/high_freq", obs.HighFreqIps)
				ipV2.GET("/api/ip_models", obs.ApiIpModelUsage)
				ipV2.GET("/cross/ip_mismatch", obs.IpMismatch)
				ipV2.GET("/cross/risk_score", obs.IpRiskScores)
				ipV2.GET("/cross/new_ips", obs.NewIps)
				ipV2.GET("/cross/user_ip_summary", obs.UserIpSummary)
			}
		}

		logRoute.Use(middleware.CORS(), middleware.CriticalRateLimit())
		{
			logRoute.GET("/token", middleware.TokenAuthReadOnly(), obs.GetLogByKey)
		}
		groupRoute := apiRouter.Group("/group")
		groupRoute.Use(middleware.TenantAdminAuth())
		{
			groupRoute.GET("/", catalog.GetGroups)
		}

		prefillGroupRoute := apiRouter.Group("/prefill_group")
		prefillGroupRoute.Use(middleware.TenantAdminAuth())
		{
			prefillGroupRoute.GET("/", catalog.GetPrefillGroups)
			prefillGroupRoute.POST("/", catalog.CreatePrefillGroup)
			prefillGroupRoute.PUT("/", catalog.UpdatePrefillGroup)
			prefillGroupRoute.DELETE("/:id", catalog.DeletePrefillGroup)
		}

		mjRoute := apiRouter.Group("/mj")
		mjRoute.GET("/self", middleware.UserAuth(), controller.GetUserMidjourney)
		mjRoute.GET("/", middleware.TenantAdminAuth(), controller.GetAllMidjourney)

		taskRoute := apiRouter.Group("/task")
		{
			taskRoute.GET("/self", middleware.UserAuth(), controller.GetUserTask)
			taskRoute.GET("/", middleware.TenantAdminAuth(), controller.GetAllTask)
		}

		vendorRoute := apiRouter.Group("/vendors")
		vendorRoute.Use(middleware.PlatformAdminAuth())
		{
			vendorRoute.GET("/", catalog.GetAllVendors)
			vendorRoute.GET("/search", catalog.SearchVendors)
			vendorRoute.GET("/:id", catalog.GetVendorMeta)
			vendorRoute.POST("/", catalog.CreateVendorMeta)
			vendorRoute.PUT("/", catalog.UpdateVendorMeta)
			vendorRoute.DELETE("/:id", catalog.DeleteVendorMeta)
		}

		modelsRoute := apiRouter.Group("/models")
		modelsRoute.Use(middleware.PlatformAdminAuth())
		{
			modelsRoute.GET("/sync_upstream/preview", catalog.SyncUpstreamPreview)
			modelsRoute.POST("/sync_upstream", catalog.SyncUpstreamModels)
			modelsRoute.GET("/missing", catalog.GetMissingModels)
			modelsRoute.GET("/", catalog.GetAllModelsMeta)
			modelsRoute.GET("/search", catalog.SearchModelsMeta)
			modelsRoute.GET("/:id", catalog.GetModelMeta)
			modelsRoute.POST("/", catalog.CreateModelMeta)
			modelsRoute.PUT("/", catalog.UpdateModelMeta)
			modelsRoute.DELETE("/:id", catalog.DeleteModelMeta)
		}

		// Deployments (model deployment management)
		deploymentsRoute := apiRouter.Group("/deployments")
		deploymentsRoute.Use(middleware.PlatformAdminAuth())
		{
			deploymentsRoute.GET("/settings", controller.GetModelDeploymentSettings)
			deploymentsRoute.POST("/settings/test-connection", controller.TestIoNetConnection)
			deploymentsRoute.GET("/", controller.GetAllDeployments)
			deploymentsRoute.GET("/search", controller.SearchDeployments)
			deploymentsRoute.POST("/test-connection", controller.TestIoNetConnection)
			deploymentsRoute.GET("/hardware-types", controller.GetHardwareTypes)
			deploymentsRoute.GET("/locations", controller.GetLocations)
			deploymentsRoute.GET("/available-replicas", controller.GetAvailableReplicas)
			deploymentsRoute.POST("/price-estimation", controller.GetPriceEstimation)
			deploymentsRoute.GET("/check-name", controller.CheckClusterNameAvailability)
			deploymentsRoute.POST("/", controller.CreateDeployment)

			deploymentsRoute.GET("/:id", controller.GetDeployment)
			deploymentsRoute.GET("/:id/logs", controller.GetDeploymentLogs)
			deploymentsRoute.GET("/:id/containers", controller.ListDeploymentContainers)
			deploymentsRoute.GET("/:id/containers/:container_id", controller.GetContainerDetails)
			deploymentsRoute.PUT("/:id", controller.UpdateDeployment)
			deploymentsRoute.PUT("/:id/name", controller.UpdateDeploymentName)
			deploymentsRoute.POST("/:id/extend", controller.ExtendDeployment)
			deploymentsRoute.DELETE("/:id", controller.DeleteDeployment)
		}

		tenantRoute := apiRouter.Group("/tenant")
		tenantRoute.Use(middleware.TenantAdminAuth())
		{
			tenantRoute.GET("/info", tenant.GetTenant)
			tenantRoute.PUT("/", tenant.UpdateTenant)
			tenantRoute.GET("/members", tenant.ListTenantMembers)
			tenantRoute.PUT("/members", tenant.UpdateTenantMember)
			tenantRoute.POST("/invite", tenant.InviteMember)
			tenantRoute.DELETE("/members", tenant.RemoveMember)
			tenantRoute.GET("/config", tenant.GetTenantConfig)
			tenantRoute.PUT("/config", tenant.UpdateTenantConfig)
			tenantRoute.DELETE("/config", tenant.DeleteTenantConfig)
			tenantRoute.GET("/dashboard", tenant.GetTenantDashboard)
			tenantRoute.GET("/usage/trend", tenant.GetTenantUsageTrend)
			tenantRoute.GET("/usage/models", tenant.GetTenantModelUsage)
			tenantRoute.GET("/alerts", tenant.GetTenantAlerts)
			tenantRoute.GET("/alerts/history", tenant.GetTenantAlertHistory)
			tenantRoute.POST("/alerts/:id/ack", tenant.AckTenantAlert)
			tenantRoute.POST("/alerts/:id/resolve", tenant.ResolveTenantAlertHandler)
			tenantRoute.GET("/audit", tenant.GetTenantAuditLogs)
			tenantRoute.GET("/bills", tenant.ListTenantBillsHandler)
			tenantRoute.POST("/bills/current/refresh", tenant.RefreshCurrentTenantBillHandler)
			tenantRoute.GET("/ledger", tenant.ListTenantLedgerHandler)
			tenantRoute.GET("/plan", tenant.GetTenantPlanInfo)
			// Payment configuration (see docs/superpowers/specs/2026-04-17-wechat-pay-multi-tenant-design.md §7.1)
			tenantRoute.GET("/payment/configs", tenant.GetTenantPaymentConfigs)
			tenantRoute.PUT("/payment/configs/wechat", tenant.UpdateTenantWechatConfig)
			tenantRoute.POST("/payment/configs/wechat/test", tenant.TestTenantWechatConfig)
			tenantRoute.DELETE("/payment/configs/wechat", tenant.DeleteTenantWechatConfig)
			// WeChat Pay S2 ordering + callback
			tenantRoute.POST("/payment/wechat/sub/native", payment.CreateWechatSubNative)
			tenantRoute.POST("/payment/wechat/sub/jsapi", payment.CreateWechatSubJsapi)
			tenantRoute.GET("/payment/orders", payment.ListTenantPaymentOrders)
			// WeChat Pay S3 refunds
			tenantRoute.POST("/payment/refunds", payment.CreateWechatRefund)
			tenantRoute.GET("/payment/refunds", payment.ListTenantPaymentRefundsHandler)
		}

		platformTenantRoute := apiRouter.Group("/platform/tenants")
		platformTenantRoute.Use(middleware.PlatformAdminAuth())
		{
			platformTenantRoute.GET("/", tenant.ListAllTenantsHandler)
			platformTenantRoute.POST("/", tenant.CreateTenant)
			platformTenantRoute.DELETE("/:id", tenant.DeleteTenant)
			platformTenantRoute.GET("/plans", tenant.ListTenantPlans)
			platformTenantRoute.PUT("/:id/plan", tenant.UpdateTenantPlanHandler)
		}

		tenantInviteRoute := apiRouter.Group("/tenant/invite")
		tenantInviteRoute.Use(middleware.UserAuth())
		{
			tenantInviteRoute.GET("/accept", tenant.AcceptInvite)
		}

		// WeChat Pay S2 user-facing ordering
		paymentRoute := apiRouter.Group("/payment")
		paymentRoute.Use(middleware.UserAuth())
		{
			paymentRoute.POST("/wechat/topup/native", payment.CreateWechatTopupNative)
			paymentRoute.POST("/wechat/topup/h5", payment.CreateWechatTopupH5)
			paymentRoute.POST("/wechat/topup/jsapi", payment.CreateWechatTopupJsapi)
			paymentRoute.GET("/orders/:out_trade_no", payment.GetPaymentOrderByOutTradeNoHandler)
		}
	}
}
