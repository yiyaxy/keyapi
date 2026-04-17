package router

import (
	"github.com/QuantumNous/new-api/controller"
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
		apiRouter.GET("/models", middleware.UserAuth(), controller.DashboardListModels)
		apiRouter.GET("/status/test", middleware.AdminAuth(), controller.TestStatus)
		apiRouter.GET("/notice", controller.GetNotice)
		apiRouter.GET("/user-agreement", controller.GetUserAgreement)
		apiRouter.GET("/privacy-policy", controller.GetPrivacyPolicy)
		apiRouter.GET("/refund-policy", controller.GetRefundPolicy)
		apiRouter.GET("/about", controller.GetAbout)
		//apiRouter.GET("/midjourney", controller.GetMidjourney)
		apiRouter.GET("/home_page_content", controller.GetHomePageContent)
		apiRouter.GET("/pricing", middleware.TryUserAuth(), controller.GetPricing)
		apiRouter.GET("/subscription/plans", controller.GetSubscriptionPlans)
		apiRouter.GET("/verification", middleware.EmailVerificationRateLimit(), middleware.TurnstileCheck(), controller.SendEmailVerification)
		apiRouter.GET("/reset_password", middleware.CriticalRateLimit(), middleware.TurnstileCheck(), controller.SendPasswordResetEmail)
		apiRouter.POST("/user/reset", middleware.CriticalRateLimit(), controller.ResetPassword)
		// OAuth routes - specific routes must come before :provider wildcard
		apiRouter.GET("/oauth/state", middleware.CriticalRateLimit(), controller.GenerateOAuthCode)
		apiRouter.POST("/oauth/email/bind", middleware.CriticalRateLimit(), controller.EmailBind)
		// Non-standard OAuth (WeChat, Telegram) - keep original routes
		apiRouter.GET("/oauth/wechat", middleware.CriticalRateLimit(), controller.WeChatAuth)
		apiRouter.POST("/oauth/wechat/bind", middleware.CriticalRateLimit(), controller.WeChatBind)
		apiRouter.GET("/oauth/telegram/login", middleware.CriticalRateLimit(), controller.TelegramLogin)
		apiRouter.GET("/oauth/telegram/bind", middleware.CriticalRateLimit(), controller.TelegramBind)
		// Standard OAuth providers (GitHub, Discord, OIDC, LinuxDO) - unified route
		apiRouter.GET("/oauth/:provider", middleware.CriticalRateLimit(), controller.HandleOAuth)
		apiRouter.GET("/ratio_config", middleware.CriticalRateLimit(), controller.GetRatioConfig)

		apiRouter.POST("/stripe/webhook", controller.StripeWebhook)
		apiRouter.POST("/creem/webhook", controller.CreemWebhook)
		apiRouter.POST("/waffo/webhook", controller.WaffoWebhook)

		// Universal secure verification routes
		apiRouter.POST("/verify", middleware.UserAuth(), middleware.CriticalRateLimit(), controller.UniversalVerify)

		ticketRoute := apiRouter.Group("/ticket")
		ticketRoute.Use(middleware.UserAuth())
		{
			ticketRoute.POST("/uploads/presign", controller.TicketPresignUpload)
			ticketRoute.POST("", controller.TicketCreate)
			ticketRoute.GET("", controller.TicketList)
			ticketRoute.GET("/:id", controller.TicketDetail)
			ticketRoute.POST("/:id/reply", controller.TicketReply)
			ticketRoute.GET("/attachments/:att_id/presign", controller.TicketPresignAttachment)
		}

		ticketAdminRoute := apiRouter.Group("/ticket/admin")
		ticketAdminRoute.Use(middleware.TenantAdminAuth())
		{
			ticketAdminRoute.GET("", controller.TicketAdminList)
			ticketAdminRoute.GET("/:id", controller.TicketAdminDetail)
			ticketAdminRoute.POST("/:id/reply", controller.TicketAdminReply)
			ticketAdminRoute.POST("/:id/status", controller.TicketAdminUpdateStatus)
			ticketAdminRoute.GET("/attachments/:att_id/presign", controller.TicketAdminPresignAttachment)
		}

		ticketStorageRoute := apiRouter.Group("/ticket_storage")
		ticketStorageRoute.Use(middleware.PlatformAdminAuth())
		{
			ticketStorageRoute.PUT("/secret", controller.UpsertTicketStorageSecret)
		}

		invoiceSelfRoute := apiRouter.Group("/invoice/self")
		invoiceSelfRoute.Use(middleware.UserAuth())
		{
			invoiceSelfRoute.GET("/invoiceable_orders", controller.InvoiceSelfInvoiceableOrders)
			invoiceSelfRoute.GET("/applications", controller.InvoiceSelfListApplications)
			invoiceSelfRoute.GET("/applications/:id", controller.InvoiceSelfGetApplicationDetail)
			invoiceSelfRoute.POST("/applications", controller.InvoiceSelfCreateApplication)
			invoiceSelfRoute.POST("/applications/:id/cancel", controller.InvoiceSelfCancelApplication)
			invoiceSelfRoute.GET("/files/:file_id/presign", controller.InvoiceSelfPresignFile)
		}

		invoiceAdminRoute := apiRouter.Group("/invoice/admin")
		invoiceAdminRoute.Use(middleware.TenantAdminAuth())
		{
			invoiceAdminRoute.GET("/applications", controller.InvoiceAdminListApplications)
			invoiceAdminRoute.GET("/applications/:id", controller.InvoiceAdminGetApplicationDetail)
			invoiceAdminRoute.POST("/applications/:id/status", controller.InvoiceAdminUpdateApplicationStatus)
			invoiceAdminRoute.POST("/applications/:id/issue", controller.InvoiceAdminIssue)
			invoiceAdminRoute.POST("/applications/:id/query", controller.InvoiceAdminQuery)
			invoiceAdminRoute.POST("/applications/:id/red", controller.InvoiceAdminRedInvoice)
			invoiceAdminRoute.POST("/applications/:id/switch_manual", controller.InvoiceAdminSwitchManual)
			invoiceAdminRoute.POST("/applications/:id/items/:item_id/payment_info", controller.InvoiceAdminSetItemPaymentInfo)
			invoiceAdminRoute.POST("/uploads/presign", controller.InvoiceAdminPresignUpload)
			invoiceAdminRoute.POST("/applications/:id/files", controller.InvoiceAdminFinalizeInvoiceFiles)
			invoiceAdminRoute.POST("/applications/:id/files/:file_id/visibility", controller.InvoiceAdminUpdateFileVisibility)
			invoiceAdminRoute.GET("/files/:file_id/presign", controller.InvoiceAdminPresignFile)
		}

		userRoute := apiRouter.Group("/user")
		{
			userRoute.POST("/register", middleware.CriticalRateLimit(), middleware.TurnstileCheck(), controller.Register)
			userRoute.POST("/login", middleware.CriticalRateLimit(), middleware.TurnstileCheck(), controller.Login)
			userRoute.POST("/login/2fa", middleware.CriticalRateLimit(), controller.Verify2FALogin)
			userRoute.POST("/passkey/login/begin", middleware.CriticalRateLimit(), controller.PasskeyLoginBegin)
			userRoute.POST("/passkey/login/finish", middleware.CriticalRateLimit(), controller.PasskeyLoginFinish)
			//userRoute.POST("/tokenlog", middleware.CriticalRateLimit(), controller.TokenLog)
			userRoute.POST("/logout", controller.Logout)
			userRoute.POST("/epay/notify", controller.EpayNotify)
			userRoute.GET("/epay/notify", controller.EpayNotify)
			userRoute.GET("/groups", controller.GetUserGroups)

			selfRoute := userRoute.Group("/")
			selfRoute.Use(middleware.UserAuth())
			{
				selfRoute.GET("/self/groups", controller.GetUserGroups)
				selfRoute.GET("/self/channel-groups", controller.GetChannelGroups)
				selfRoute.GET("/self", controller.GetSelf)
				selfRoute.GET("/tenants", controller.ListCurrentUserTenants)
				selfRoute.POST("/tenant/switch", controller.SwitchTenant)
				selfRoute.GET("/models", controller.GetUserModels)
				selfRoute.PUT("/self", controller.UpdateSelf)
				selfRoute.DELETE("/self", controller.DeleteSelf)
				selfRoute.GET("/token", controller.GenerateAccessToken)
				selfRoute.GET("/passkey", controller.PasskeyStatus)
				selfRoute.POST("/passkey/register/begin", controller.PasskeyRegisterBegin)
				selfRoute.POST("/passkey/register/finish", controller.PasskeyRegisterFinish)
				selfRoute.POST("/passkey/verify/begin", controller.PasskeyVerifyBegin)
				selfRoute.POST("/passkey/verify/finish", controller.PasskeyVerifyFinish)
				selfRoute.DELETE("/passkey", controller.PasskeyDelete)
				selfRoute.GET("/aff", controller.GetAffCode)
				selfRoute.GET("/topup/info", controller.GetTopUpInfo)
				selfRoute.GET("/topup/self", controller.GetUserTopUps)
				selfRoute.POST("/topup", middleware.CriticalRateLimit(), controller.TopUp)
				selfRoute.POST("/pay", middleware.CriticalRateLimit(), controller.RequestEpay)
				selfRoute.POST("/amount", controller.RequestAmount)
				selfRoute.POST("/stripe/pay", middleware.CriticalRateLimit(), controller.RequestStripePay)
				selfRoute.POST("/stripe/amount", controller.RequestStripeAmount)
				selfRoute.POST("/creem/pay", middleware.CriticalRateLimit(), controller.RequestCreemPay)
				selfRoute.POST("/waffo/pay", middleware.CriticalRateLimit(), controller.RequestWaffoPay)
				selfRoute.POST("/aff_transfer", controller.TransferAffQuota)
				selfRoute.PUT("/setting", controller.UpdateUserSetting)

				// 2FA routes
				selfRoute.GET("/2fa/status", controller.Get2FAStatus)
				selfRoute.POST("/2fa/setup", controller.Setup2FA)
				selfRoute.POST("/2fa/enable", controller.Enable2FA)
				selfRoute.POST("/2fa/disable", controller.Disable2FA)
				selfRoute.POST("/2fa/backup_codes", controller.RegenerateBackupCodes)

				// Check-in routes
				selfRoute.GET("/checkin", controller.GetCheckinStatus)
				selfRoute.POST("/checkin", middleware.TurnstileCheck(), controller.DoCheckin)

				// Custom OAuth bindings
				selfRoute.GET("/oauth/bindings", controller.GetUserOAuthBindings)
				selfRoute.DELETE("/oauth/bindings/:provider_id", controller.UnbindCustomOAuth)
			}

			adminRoute := userRoute.Group("/")
			adminRoute.Use(middleware.TenantAdminAuth())
			{
				adminRoute.GET("/", controller.GetAllUsers)
				adminRoute.GET("/topup", controller.GetAllTopUps)
				adminRoute.POST("/topup/complete", controller.AdminCompleteTopUp)
				adminRoute.GET("/search", controller.SearchUsers)
				adminRoute.GET("/:id/oauth/bindings", controller.GetUserOAuthBindingsByAdmin)
				adminRoute.DELETE("/:id/oauth/bindings/:provider_id", controller.UnbindCustomOAuthByAdmin)
				adminRoute.DELETE("/:id/bindings/:binding_type", controller.AdminClearUserBinding)
				adminRoute.GET("/:id", controller.GetUser)
				adminRoute.POST("/", controller.CreateUser)
				adminRoute.POST("/manage", controller.ManageUser)
				adminRoute.PUT("/", controller.UpdateUser)
				adminRoute.DELETE("/:id", controller.DeleteUser)
				adminRoute.DELETE("/:id/reset_passkey", controller.AdminResetPasskey)

				// Admin 2FA routes
				adminRoute.GET("/2fa/stats", controller.Admin2FAStats)
				adminRoute.DELETE("/:id/2fa", controller.AdminDisable2FA)

				// Admin IP history
				adminRoute.GET("/:id/ips", controller.GetUserIpHistory)
				adminRoute.GET("/:id/api-ips", controller.GetUserApiIpHistory)
			}
		}

		// Subscription billing (plans, purchase, admin management)
		subscriptionRoute := apiRouter.Group("/subscription")
		subscriptionRoute.Use(middleware.UserAuth())
		{
			subscriptionRoute.GET("/self", controller.GetSubscriptionSelf)
			subscriptionRoute.PUT("/self/preference", controller.UpdateSubscriptionPreference)
			subscriptionRoute.POST("/activate/:id", controller.ActivateSubscription)
			subscriptionRoute.POST("/epay/pay", middleware.CriticalRateLimit(), controller.SubscriptionRequestEpay)
			subscriptionRoute.POST("/stripe/pay", middleware.CriticalRateLimit(), controller.SubscriptionRequestStripePay)
			subscriptionRoute.POST("/creem/pay", middleware.CriticalRateLimit(), controller.SubscriptionRequestCreemPay)
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
		apiRouter.POST("/subscription/epay/notify", controller.SubscriptionEpayNotify)
		apiRouter.GET("/subscription/epay/notify", controller.SubscriptionEpayNotify)
		apiRouter.GET("/subscription/epay/return", controller.SubscriptionEpayReturn)
		apiRouter.POST("/subscription/epay/return", controller.SubscriptionEpayReturn)
		optionRoute := apiRouter.Group("/option")
		optionRoute.Use(middleware.RootAuth())
		{
			optionRoute.GET("/", controller.GetOptions)
			optionRoute.PUT("/", controller.UpdateOption)
			optionRoute.GET("/channel_affinity_cache", controller.GetChannelAffinityCacheStats)
			optionRoute.DELETE("/channel_affinity_cache", controller.ClearChannelAffinityCache)
			optionRoute.POST("/rest_model_ratio", controller.ResetModelRatio)
			optionRoute.POST("/migrate_console_setting", controller.MigrateConsoleSetting) // 用于迁移检测的旧键，下个版本会删除
			optionRoute.POST("/force_logout_all", controller.ForceLogoutAll)
		}

		// Custom OAuth provider management (root only)
		customOAuthRoute := apiRouter.Group("/custom-oauth-provider")
		customOAuthRoute.Use(middleware.RootAuth())
		{
			customOAuthRoute.POST("/discovery", controller.FetchCustomOAuthDiscovery)
			customOAuthRoute.GET("/", controller.GetCustomOAuthProviders)
			customOAuthRoute.GET("/:id", controller.GetCustomOAuthProvider)
			customOAuthRoute.POST("/", controller.CreateCustomOAuthProvider)
			customOAuthRoute.PUT("/:id", controller.UpdateCustomOAuthProvider)
			customOAuthRoute.DELETE("/:id", controller.DeleteCustomOAuthProvider)
		}
		performanceRoute := apiRouter.Group("/performance")
		performanceRoute.Use(middleware.RootAuth())
		{
			performanceRoute.GET("/stats", controller.GetPerformanceStats)
			performanceRoute.DELETE("/disk_cache", controller.ClearDiskCache)
			performanceRoute.POST("/reset_stats", controller.ResetPerformanceStats)
			performanceRoute.POST("/gc", controller.ForceGC)
			performanceRoute.GET("/logs", controller.GetLogFiles)
			performanceRoute.DELETE("/logs", controller.CleanupLogFiles)
		}
		ratioSyncRoute := apiRouter.Group("/ratio_sync")
		ratioSyncRoute.Use(middleware.RootAuth())
		{
			ratioSyncRoute.GET("/channels", controller.GetSyncableChannels)
			ratioSyncRoute.POST("/fetch", controller.FetchUpstreamRatios)
		}
		channelRoute := apiRouter.Group("/channel")
		channelRoute.Use(middleware.RootAuth())
		{
			channelRoute.GET("/", controller.GetAllChannels)
			channelRoute.GET("/search", controller.SearchChannels)
			channelRoute.GET("/models", controller.ChannelListModels)
			channelRoute.GET("/models_enabled", controller.EnabledListModels)
			channelRoute.GET("/:id", controller.GetChannel)
			channelRoute.POST("/:id/key", middleware.RootAuth(), middleware.CriticalRateLimit(), middleware.DisableCache(), middleware.SecureVerificationRequired(), controller.GetChannelKey)
			channelRoute.GET("/test", controller.TestAllChannels)
			channelRoute.GET("/test/:id", controller.TestChannel)
			channelRoute.GET("/update_balance", controller.UpdateAllChannelsBalance)
			channelRoute.GET("/update_balance/:id", controller.UpdateChannelBalance)
			channelRoute.POST("/", controller.AddChannel)
			channelRoute.PUT("/", controller.UpdateChannel)
			channelRoute.DELETE("/disabled", controller.DeleteDisabledChannel)
			channelRoute.POST("/tag/disabled", controller.DisableTagChannels)
			channelRoute.POST("/tag/enabled", controller.EnableTagChannels)
			channelRoute.PUT("/tag", controller.EditTagChannels)
			channelRoute.DELETE("/:id", controller.DeleteChannel)
			channelRoute.POST("/batch", controller.DeleteChannelBatch)
			channelRoute.POST("/fix", controller.FixChannelsAbilities)
			channelRoute.GET("/fetch_models/:id", controller.FetchUpstreamModels)
			channelRoute.POST("/fetch_models", middleware.RootAuth(), controller.FetchModels)
			channelRoute.POST("/codex/oauth/start", controller.StartCodexOAuth)
			channelRoute.POST("/codex/oauth/complete", controller.CompleteCodexOAuth)
			channelRoute.POST("/:id/codex/oauth/start", controller.StartCodexOAuthForChannel)
			channelRoute.POST("/:id/codex/oauth/complete", controller.CompleteCodexOAuthForChannel)
			channelRoute.POST("/:id/codex/refresh", controller.RefreshCodexChannelCredential)
			channelRoute.GET("/:id/codex/usage", controller.GetCodexChannelUsage)
			channelRoute.POST("/ollama/pull", controller.OllamaPullModel)
			channelRoute.POST("/ollama/pull/stream", controller.OllamaPullModelStream)
			channelRoute.DELETE("/ollama/delete", controller.OllamaDeleteModel)
			channelRoute.GET("/ollama/version/:id", controller.OllamaVersion)
			channelRoute.POST("/batch/tag", controller.BatchSetChannelTag)
			channelRoute.GET("/tag/models", controller.GetTagModels)
			channelRoute.POST("/copy/:id", controller.CopyChannel)
			channelRoute.POST("/multi_key/manage", controller.ManageMultiKeys)
			channelRoute.POST("/upstream_updates/apply", controller.ApplyChannelUpstreamModelUpdates)
			channelRoute.POST("/upstream_updates/apply_all", controller.ApplyAllChannelUpstreamModelUpdates)
			channelRoute.POST("/upstream_updates/detect", controller.DetectChannelUpstreamModelUpdates)
			channelRoute.POST("/upstream_updates/detect_all", controller.DetectAllChannelUpstreamModelUpdates)
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
			redemptionRoute.GET("/", controller.GetAllRedemptions)
			redemptionRoute.GET("/search", controller.SearchRedemptions)
			redemptionRoute.GET("/:id", controller.GetRedemption)
			redemptionRoute.POST("/", controller.AddRedemption)
			redemptionRoute.PUT("/", controller.UpdateRedemption)
			redemptionRoute.DELETE("/invalid", controller.DeleteInvalidRedemption)
			redemptionRoute.DELETE("/:id", controller.DeleteRedemption)
		}
		logRoute := apiRouter.Group("/log")
		logRoute.GET("/", middleware.TenantAdminAuth(), controller.GetAllLogs)
		logRoute.DELETE("/", middleware.TenantAdminAuth(), controller.DeleteHistoryLogs)
		logRoute.GET("/stat", middleware.TenantAdminAuth(), controller.GetLogsStat)
		logRoute.GET("/self/stat", middleware.UserAuth(), controller.GetLogsSelfStat)
		logRoute.GET("/channel_affinity_usage_cache", middleware.TenantAdminAuth(), controller.GetChannelAffinityUsageCacheStats)
		logRoute.GET("/search", middleware.TenantAdminAuth(), controller.SearchAllLogs)
		logRoute.GET("/self", middleware.UserAuth(), controller.GetUserLogs)
		logRoute.GET("/self/search", middleware.UserAuth(), middleware.SearchRateLimit(), controller.SearchUserLogs)
		logRoute.GET("/self/cache_savings", middleware.UserAuth(), controller.GetCacheSavingsSelf)
		logRoute.GET("/cache_savings", middleware.TenantAdminAuth(), controller.GetCacheSavingsStat)
		logRoute.GET("/request/:request_id", middleware.TenantAdminAuth(), controller.GetRequestTrace)

		dataRoute := apiRouter.Group("/data")
		dataRoute.GET("/", middleware.TenantAdminAuth(), controller.GetAllQuotaDates)
		dataRoute.GET("/self", middleware.UserAuth(), controller.GetUserQuotaDates)

		analyticsRoute := apiRouter.Group("/analytics")
		analyticsRoute.Use(middleware.TenantAdminAuth())
		{
			analyticsRoute.GET("/channel", controller.GetAnalyticsByChannel)
			analyticsRoute.GET("/model", controller.GetAnalyticsByModel)
			analyticsRoute.GET("/user", controller.GetAnalyticsByUser)
			analyticsRoute.GET("/site-rpm", controller.GetSiteRPM)
			analyticsRoute.GET("/site-rpm/history", controller.GetSiteRPMHistory)

			// Purchase analytics
			analyticsRoute.GET("/purchase/overview", controller.GetPurchaseOverview)
			analyticsRoute.GET("/purchase/trend", controller.GetPurchaseTrend)
			analyticsRoute.GET("/purchase/payment-method", controller.GetPurchasePaymentMethod)
			analyticsRoute.GET("/purchase/order-type", controller.GetPurchaseOrderType)
			analyticsRoute.GET("/purchase/top-users", controller.GetPurchaseTopSpenders)
			analyticsRoute.GET("/purchase/redemption", controller.GetPurchaseRedemptionStats)

			// Subscription & Top-up analytics (new separate endpoints)
			analyticsRoute.GET("/purchase/subscription/overview", controller.GetSubscriptionOverview)
			analyticsRoute.GET("/purchase/subscription/plan-breakdown", controller.GetSubscriptionPlanBreakdown)
			analyticsRoute.GET("/purchase/subscription/heatmap", controller.GetSubscriptionHeatmap)
			analyticsRoute.GET("/purchase/topup/overview", controller.GetTopUpOverview)
			analyticsRoute.GET("/purchase/dau", controller.GetPurchaseDAUTrend)
			analyticsRoute.GET("/purchase/registrations", controller.GetPurchaseRegistrationTrend)
			analyticsRoute.GET("/purchase/conversion", controller.GetPurchaseConversionFunnel)
			analyticsRoute.GET("/purchase/referral", controller.GetPurchaseReferralAnalytics)
			analyticsRoute.GET("/channel-monitor", controller.GetChannelMonitor)
		}

		agentLogRoute := apiRouter.Group("/agent-logs")
		agentLogRoute.Use(middleware.TenantAdminAuth())
		{
			agentLogRoute.GET("", controller.GetAgentLogs)
			agentLogRoute.POST("", controller.CreateAgentLog)
			agentLogRoute.PUT("/:id", controller.UpdateAgentLog)
			agentLogRoute.DELETE("/:id", controller.DeleteAgentLog)
		}

		agentReportRoute := apiRouter.Group("/agent-reports")
		agentReportRoute.Use(middleware.TenantAdminAuth())
		{
			agentReportRoute.GET("", controller.GetAgentReports)
			agentReportRoute.GET("/:id", controller.GetAgentReportDetail)
			agentReportRoute.POST("", controller.CreateAgentReport)
			agentReportRoute.PUT("/:id", controller.UpdateAgentReport)
			agentReportRoute.DELETE("/:id", controller.DeleteAgentReport)
		}

		purchaseRoute := apiRouter.Group("/purchase")
		purchaseRoute.Use(middleware.TenantAdminAuth())
		{
			purchaseRoute.GET("/topup", controller.AdminListTopUpOrders)
			purchaseRoute.POST("/topup/complete", controller.AdminCompleteTopUp)
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
			promptRuleRoute.GET("/", controller.GetAllPromptRules)
			promptRuleRoute.POST("/", controller.CreatePromptRule)
			promptRuleRoute.PUT("/", controller.UpdatePromptRule)
			promptRuleRoute.DELETE("/:id", controller.DeletePromptRule)
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
			ipRoute.GET("/lookup", controller.IpLookup)
			ipRoute.GET("/users", controller.IpUsers)
			ipRoute.GET("/analytics", controller.IpAnalytics)
			ipRoute.GET("/records", controller.IpRecords)
			ipRoute.POST("/ban", controller.BanIp)
			ipRoute.POST("/unban", controller.UnbanIp)
			ipRoute.GET("/bans", controller.GetIpBans)

			// V2 enhanced IP analytics
			ipV2 := ipRoute.Group("/v2")
			{
				ipV2.GET("/overview", controller.IpOverviewV2)
				ipV2.GET("/login/geo", controller.LoginGeoDist)
				ipV2.GET("/login/time_pattern", controller.LoginTimePattern)
				ipV2.GET("/login/type_detail", controller.LoginTypeDetail)
				ipV2.GET("/login/multi_account", controller.MultiAccountIps)
				ipV2.POST("/login/multi_account/disable_users", controller.DisableMultiAccountUsersByIp)
				ipV2.GET("/api/top_ips", controller.ApiTopIps)
				ipV2.GET("/api/geo", controller.ApiGeoDist)
				ipV2.GET("/api/time_pattern", controller.ApiTimePattern)
				ipV2.GET("/api/high_freq", controller.HighFreqIps)
				ipV2.GET("/api/ip_models", controller.ApiIpModelUsage)
				ipV2.GET("/cross/ip_mismatch", controller.IpMismatch)
				ipV2.GET("/cross/risk_score", controller.IpRiskScores)
				ipV2.GET("/cross/new_ips", controller.NewIps)
				ipV2.GET("/cross/user_ip_summary", controller.UserIpSummary)
			}
		}

		logRoute.Use(middleware.CORS(), middleware.CriticalRateLimit())
		{
			logRoute.GET("/token", middleware.TokenAuthReadOnly(), controller.GetLogByKey)
		}
		groupRoute := apiRouter.Group("/group")
		groupRoute.Use(middleware.TenantAdminAuth())
		{
			groupRoute.GET("/", controller.GetGroups)
		}

		prefillGroupRoute := apiRouter.Group("/prefill_group")
		prefillGroupRoute.Use(middleware.TenantAdminAuth())
		{
			prefillGroupRoute.GET("/", controller.GetPrefillGroups)
			prefillGroupRoute.POST("/", controller.CreatePrefillGroup)
			prefillGroupRoute.PUT("/", controller.UpdatePrefillGroup)
			prefillGroupRoute.DELETE("/:id", controller.DeletePrefillGroup)
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
			vendorRoute.GET("/", controller.GetAllVendors)
			vendorRoute.GET("/search", controller.SearchVendors)
			vendorRoute.GET("/:id", controller.GetVendorMeta)
			vendorRoute.POST("/", controller.CreateVendorMeta)
			vendorRoute.PUT("/", controller.UpdateVendorMeta)
			vendorRoute.DELETE("/:id", controller.DeleteVendorMeta)
		}

		modelsRoute := apiRouter.Group("/models")
		modelsRoute.Use(middleware.PlatformAdminAuth())
		{
			modelsRoute.GET("/sync_upstream/preview", controller.SyncUpstreamPreview)
			modelsRoute.POST("/sync_upstream", controller.SyncUpstreamModels)
			modelsRoute.GET("/missing", controller.GetMissingModels)
			modelsRoute.GET("/", controller.GetAllModelsMeta)
			modelsRoute.GET("/search", controller.SearchModelsMeta)
			modelsRoute.GET("/:id", controller.GetModelMeta)
			modelsRoute.POST("/", controller.CreateModelMeta)
			modelsRoute.PUT("/", controller.UpdateModelMeta)
			modelsRoute.DELETE("/:id", controller.DeleteModelMeta)
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
			tenantRoute.GET("/info", controller.GetTenant)
			tenantRoute.PUT("/", controller.UpdateTenant)
			tenantRoute.GET("/members", controller.ListTenantMembers)
			tenantRoute.PUT("/members", controller.UpdateTenantMember)
			tenantRoute.POST("/invite", controller.InviteMember)
			tenantRoute.DELETE("/members", controller.RemoveMember)
			tenantRoute.GET("/config", controller.GetTenantConfig)
			tenantRoute.PUT("/config", controller.UpdateTenantConfig)
			tenantRoute.DELETE("/config", controller.DeleteTenantConfig)
			tenantRoute.GET("/dashboard", controller.GetTenantDashboard)
			tenantRoute.GET("/usage/trend", controller.GetTenantUsageTrend)
			tenantRoute.GET("/usage/models", controller.GetTenantModelUsage)
			tenantRoute.GET("/alerts", controller.GetTenantAlerts)
			tenantRoute.GET("/alerts/history", controller.GetTenantAlertHistory)
			tenantRoute.POST("/alerts/:id/ack", controller.AckTenantAlert)
			tenantRoute.POST("/alerts/:id/resolve", controller.ResolveTenantAlertHandler)
			tenantRoute.GET("/audit", controller.GetTenantAuditLogs)
			tenantRoute.GET("/bills", controller.ListTenantBillsHandler)
			tenantRoute.POST("/bills/current/refresh", controller.RefreshCurrentTenantBillHandler)
			tenantRoute.GET("/ledger", controller.ListTenantLedgerHandler)
			tenantRoute.GET("/plan", controller.GetTenantPlanInfo)
		}

		platformTenantRoute := apiRouter.Group("/platform/tenants")
		platformTenantRoute.Use(middleware.PlatformAdminAuth())
		{
			platformTenantRoute.GET("/", controller.ListAllTenantsHandler)
			platformTenantRoute.POST("/", controller.CreateTenant)
			platformTenantRoute.DELETE("/:id", controller.DeleteTenant)
			platformTenantRoute.GET("/plans", controller.ListTenantPlans)
			platformTenantRoute.PUT("/:id/plan", controller.UpdateTenantPlanHandler)
		}

		tenantInviteRoute := apiRouter.Group("/tenant/invite")
		tenantInviteRoute.Use(middleware.UserAuth())
		{
			tenantInviteRoute.GET("/accept", controller.AcceptInvite)
		}
	}
}
