package router

import (
	"github.com/QuantumNous/new-api/controller/app"
	"github.com/QuantumNous/new-api/controller/auth"
	"github.com/QuantumNous/new-api/controller/catalog"
	"github.com/QuantumNous/new-api/controller/channel"
	chathistoryctrl "github.com/QuantumNous/new-api/controller/chat_history"
	"github.com/QuantumNous/new-api/controller/codex"
	"github.com/QuantumNous/new-api/controller/invoice"
	"github.com/QuantumNous/new-api/controller/media"
	"github.com/QuantumNous/new-api/controller/obs"
	"github.com/QuantumNous/new-api/controller/partner"
	"github.com/QuantumNous/new-api/controller/payment"
	"github.com/QuantumNous/new-api/controller/platform"
	"github.com/QuantumNous/new-api/controller/tenant"
	"github.com/QuantumNous/new-api/controller/ticket"
	"github.com/QuantumNous/new-api/controller/user"
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
		apiRouter.GET("/setup", platform.GetSetup)
		apiRouter.POST("/setup", platform.PostSetup)
		apiRouter.GET("/status", platform.GetStatus)
		apiRouter.GET("/uptime/status", platform.GetUptimeKumaStatus)
		apiRouter.GET("/models", middleware.UserAuth(), catalog.DashboardListModels)
		apiRouter.GET("/status/test", middleware.AdminAuth(), platform.TestStatus)
		apiRouter.GET("/notice", platform.GetNotice)
		apiRouter.GET("/user-agreement", platform.GetUserAgreement)
		apiRouter.GET("/privacy-policy", platform.GetPrivacyPolicy)
		apiRouter.GET("/refund-policy", platform.GetRefundPolicy)
		apiRouter.GET("/about", platform.GetAbout)
		//apiRouter.GET("/midjourney", platform.GetMidjourney)
		apiRouter.GET("/home_page_content", platform.GetHomePageContent)
		apiRouter.GET("/pricing", middleware.TryUserAuth(), catalog.GetPricing)
		apiRouter.GET("/subscription/plans", payment.GetSubscriptionPlans)
		apiRouter.GET("/verification", middleware.EmailVerificationRateLimit(), middleware.TurnstileCheck(), platform.SendEmailVerification)
		apiRouter.GET("/reset_password", middleware.CriticalRateLimit(), middleware.TurnstileCheck(), platform.SendPasswordResetEmail)
		apiRouter.POST("/user/reset", middleware.CriticalRateLimit(), platform.ResetPassword)
		apiRouter.GET("/auth/token-login", auth.TokenLogin)
		apiRouter.POST("/auth/token-login", auth.TokenLogin)
		// OAuth routes - specific routes must come before :provider wildcard
		apiRouter.GET("/oauth/state", middleware.CriticalRateLimit(), auth.GenerateOAuthCode)
		apiRouter.POST("/oauth/email/bind", middleware.CriticalRateLimit(), user.EmailBind)
		// Non-standard OAuth (WeChat, Telegram) - keep original routes
		apiRouter.GET("/oauth/wechat", middleware.CriticalRateLimit(), auth.WeChatAuth)
		apiRouter.POST("/oauth/wechat/bind", middleware.CriticalRateLimit(), auth.WeChatBind)
		apiRouter.POST("/oauth/wx_mini/login", middleware.CriticalRateLimit(), auth.WxMiniLogin)
		// WeChat mini-program scan-to-login (PC web)
		apiRouter.POST("/oauth/wx_qr/ticket", middleware.CriticalRateLimit(), auth.GenerateWxQrTicket)
		apiRouter.GET("/oauth/wx_qr/poll", auth.PollWxQrTicket)
		apiRouter.POST("/oauth/wx_qr/confirm", middleware.CriticalRateLimit(), auth.ConfirmWxQrTicket)
		apiRouter.POST("/oauth/wx_qr/login", middleware.CriticalRateLimit(), auth.LoginWithWxQrTicket)
		// Mini-program fetches ticket purpose so it can show login vs bind copy.
		apiRouter.GET("/oauth/wx_qr/info", auth.GetWxQrTicketInfo)
		// WeChat mini-program scan-to-bind (authenticated PC web)
		apiRouter.POST("/oauth/wx_qr/bind/ticket", middleware.UserAuth(), middleware.CriticalRateLimit(), auth.GenerateWxQrBindTicket)
		apiRouter.GET("/oauth/wx_qr/bind/poll", middleware.UserAuth(), auth.PollWxQrBindTicket)
		apiRouter.POST("/oauth/wx_qr/bind/finalize", middleware.UserAuth(), middleware.CriticalRateLimit(), auth.FinalizeWxQrBind)
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
		apiRouter.POST("/payment/wechat/xpay_notify/:tenant_id/:order_type", payment.HandleWechatXpayNotify)
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
			ticketStorageRoute.POST("/test", ticket.TestTicketStorageUpload)
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

		// Chat history (admin-only): list + detail of captured conversation
		// envelopes. TenantAdminAuth lets through both tenant admins and
		// platform admins; the controller itself enforces tenant scoping
		// based on platform_role context.
		chatHistoryAdminRoute := apiRouter.Group("/chat_history/admin")
		chatHistoryAdminRoute.Use(middleware.TenantAdminAuth())
		{
			chatHistoryAdminRoute.GET("", chathistoryctrl.AdminList)
			chatHistoryAdminRoute.GET("/:request_id", chathistoryctrl.AdminDetail)
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
			userRoute.POST("/register", middleware.CriticalRateLimit(), middleware.TurnstileCheck(), user.Register)
			userRoute.POST("/login", middleware.CriticalRateLimit(), middleware.TurnstileCheck(), user.Login)
			userRoute.POST("/login/2fa", middleware.CriticalRateLimit(), auth.Verify2FALogin)
			userRoute.POST("/passkey/login/begin", middleware.CriticalRateLimit(), auth.PasskeyLoginBegin)
			userRoute.POST("/passkey/login/finish", middleware.CriticalRateLimit(), auth.PasskeyLoginFinish)
			//userRoute.POST("/tokenlog", middleware.CriticalRateLimit(), controller.TokenLog)
			userRoute.POST("/logout", user.Logout)
			userRoute.POST("/epay/notify", payment.EpayNotify)
			userRoute.GET("/epay/notify", payment.EpayNotify)
			userRoute.GET("/groups", catalog.GetUserGroups)

			selfRoute := userRoute.Group("/")
			selfRoute.Use(middleware.UserAuth())
			{
				selfRoute.GET("/self/groups", catalog.GetUserGroups)
				selfRoute.GET("/self/channel-groups", catalog.GetChannelGroups)
				selfRoute.GET("/self", user.GetSelf)
				// 「1 user : 1 tenant」模型下，普通用户永远只在自己的租户里；
				// 租户切换 / 跨租户列表不再暴露为用户 API。超管跨租户管理
				// 走 /api/platform/* 的平台级接口，不依赖 session 切换。
				selfRoute.GET("/models", user.GetUserModels)
				selfRoute.PUT("/self", user.UpdateSelf)
				selfRoute.DELETE("/self", user.DeleteSelf)
				selfRoute.GET("/token", user.GenerateAccessToken)
				selfRoute.GET("/passkey", auth.PasskeyStatus)
				selfRoute.POST("/passkey/register/begin", auth.PasskeyRegisterBegin)
				selfRoute.POST("/passkey/register/finish", auth.PasskeyRegisterFinish)
				selfRoute.POST("/passkey/verify/begin", auth.PasskeyVerifyBegin)
				selfRoute.POST("/passkey/verify/finish", auth.PasskeyVerifyFinish)
				selfRoute.DELETE("/passkey", auth.PasskeyDelete)
				selfRoute.GET("/aff", user.GetAffCode)
				selfRoute.GET("/aff/invitees", user.GetInvitees)
				selfRoute.POST("/aff/bind", user.BindAffCode)
				selfRoute.GET("/topup/info", payment.GetTopUpInfo)
				selfRoute.GET("/topup/self", payment.GetUserTopUps)
				selfRoute.POST("/topup/preview", payment.PreviewTopUp)
				selfRoute.POST("/topup", middleware.CriticalRateLimit(), user.TopUp)
				selfRoute.POST("/pay", middleware.CriticalRateLimit(), payment.RequestEpay)
				selfRoute.POST("/amount", payment.RequestAmount)
				selfRoute.POST("/stripe/pay", middleware.CriticalRateLimit(), payment.RequestStripePay)
				selfRoute.POST("/stripe/amount", payment.RequestStripeAmount)
				selfRoute.POST("/creem/pay", middleware.CriticalRateLimit(), payment.RequestCreemPay)
				selfRoute.POST("/waffo/pay", middleware.CriticalRateLimit(), payment.RequestWaffoPay)
				selfRoute.POST("/aff_transfer", user.TransferAffQuota)
				selfRoute.PUT("/setting", user.UpdateUserSetting)

				// 2FA routes
				selfRoute.GET("/2fa/status", auth.Get2FAStatus)
				selfRoute.POST("/2fa/setup", auth.Setup2FA)
				selfRoute.POST("/2fa/enable", auth.Enable2FA)
				selfRoute.POST("/2fa/disable", auth.Disable2FA)
				selfRoute.POST("/2fa/backup_codes", auth.RegenerateBackupCodes)

				// Check-in routes
				selfRoute.GET("/checkin", user.GetCheckinStatus)
				selfRoute.POST("/checkin", middleware.TurnstileCheck(), user.DoCheckin)

				// Custom OAuth bindings
				selfRoute.GET("/oauth/bindings", auth.GetUserOAuthBindings)
				selfRoute.DELETE("/oauth/bindings/:provider_id", auth.UnbindCustomOAuth)
			}

			adminRoute := userRoute.Group("/")
			adminRoute.Use(middleware.TenantAdminAuth())
			{
				adminRoute.GET("/", user.GetAllUsers)
				adminRoute.GET("/topup", payment.GetAllTopUps)
				adminRoute.POST("/topup/complete", payment.AdminCompleteTopUp)
				adminRoute.GET("/search", user.SearchUsers)
				adminRoute.GET("/:id/oauth/bindings", auth.GetUserOAuthBindingsByAdmin)
				adminRoute.DELETE("/:id/oauth/bindings/:provider_id", auth.UnbindCustomOAuthByAdmin)
				adminRoute.DELETE("/:id/bindings/:binding_type", user.AdminClearUserBinding)
				adminRoute.GET("/:id", user.GetUser)
				adminRoute.POST("/", user.CreateUser)
				adminRoute.POST("/manage", user.ManageUser)
				adminRoute.PUT("/", user.UpdateUser)
				adminRoute.DELETE("/:id", user.DeleteUser)
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
			subscriptionRoute.GET("/self", payment.GetSubscriptionSelf)
			subscriptionRoute.PUT("/self/preference", payment.UpdateSubscriptionPreference)
			subscriptionRoute.POST("/activate/:id", payment.ActivateSubscription)
			subscriptionRoute.POST("/epay/pay", middleware.CriticalRateLimit(), payment.SubscriptionRequestEpay)
			subscriptionRoute.POST("/stripe/pay", middleware.CriticalRateLimit(), payment.SubscriptionRequestStripePay)
			subscriptionRoute.POST("/creem/pay", middleware.CriticalRateLimit(), payment.SubscriptionRequestCreemPay)
		}
		subscriptionAdminRoute := apiRouter.Group("/subscription/admin")
		subscriptionAdminRoute.Use(middleware.TenantAdminAuth())
		{
			subscriptionAdminRoute.GET("/plans", payment.AdminListSubscriptionPlans)
			subscriptionAdminRoute.POST("/plans", payment.AdminCreateSubscriptionPlan)
			subscriptionAdminRoute.PUT("/plans/:id", payment.AdminUpdateSubscriptionPlan)
			subscriptionAdminRoute.PATCH("/plans/:id", payment.AdminUpdateSubscriptionPlanStatus)
			subscriptionAdminRoute.POST("/bind", payment.AdminBindSubscription)

			// User subscription management (admin)
			subscriptionAdminRoute.GET("/users/:id/subscriptions", payment.AdminListUserSubscriptions)
			subscriptionAdminRoute.POST("/users/:id/subscriptions", payment.AdminCreateUserSubscription)
			subscriptionAdminRoute.POST("/user_subscriptions/:id/invalidate", payment.AdminInvalidateUserSubscription)
			subscriptionAdminRoute.DELETE("/user_subscriptions/:id", payment.AdminDeleteUserSubscription)

			// Subscription order management (admin)
			subscriptionAdminRoute.GET("/orders", payment.AdminListSubscriptionOrders)
			subscriptionAdminRoute.POST("/orders/complete", payment.AdminCompleteSubscriptionOrder)
		}

		// Subscription payment callbacks (no auth)
		apiRouter.POST("/subscription/epay/notify", payment.SubscriptionEpayNotify)
		apiRouter.GET("/subscription/epay/notify", payment.SubscriptionEpayNotify)
		apiRouter.GET("/subscription/epay/return", payment.SubscriptionEpayReturn)
		apiRouter.POST("/subscription/epay/return", payment.SubscriptionEpayReturn)
		optionRoute := apiRouter.Group("/option")
		optionRoute.Use(middleware.RootAuth())
		{
			optionRoute.GET("/", platform.GetOptions)
			optionRoute.PUT("/", platform.UpdateOption)
			optionRoute.GET("/channel_affinity_cache", channel.GetChannelAffinityCacheStats)
			optionRoute.DELETE("/channel_affinity_cache", channel.ClearChannelAffinityCache)
			optionRoute.POST("/rest_model_ratio", catalog.ResetModelRatio)
			optionRoute.POST("/migrate_console_setting", platform.MigrateConsoleSetting) // 用于迁移检测的旧键，下个版本会删除
			optionRoute.POST("/force_logout_all", platform.ForceLogoutAll)
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

		tenantChannelRoute := apiRouter.Group("/tenant-channel")
		tenantChannelRoute.Use(middleware.TenantAdminOnlyAuth())
		{
			tenantChannelRoute.GET("/", channel.TenantListChannels)
			tenantChannelRoute.GET("/search", channel.TenantSearchChannels)
			tenantChannelRoute.GET("/:id", channel.TenantGetChannel)
			tenantChannelRoute.POST("/:id/key", middleware.CriticalRateLimit(), middleware.DisableCache(), middleware.SecureVerificationRequired(), channel.TenantGetChannelKey)
			tenantChannelRoute.POST("/", channel.TenantAddChannel)
			tenantChannelRoute.PUT("/", channel.TenantUpdateChannel)
			tenantChannelRoute.DELETE("/:id", channel.TenantDeleteChannel)
			tenantChannelRoute.POST("/:id/toggle", channel.TenantToggleChannel)
			tenantChannelRoute.POST("/batch", channel.TenantDeleteChannelBatch)
			tenantChannelRoute.POST("/batch/tag", channel.TenantBatchSetChannelTag)
			tenantChannelRoute.DELETE("/disabled", channel.TenantDeleteDisabledChannel)
			tenantChannelRoute.POST("/tag/disabled", channel.TenantDisableTagChannels)
			tenantChannelRoute.POST("/tag/enabled", channel.TenantEnableTagChannels)
			tenantChannelRoute.PUT("/tag", channel.TenantEditTagChannels)
			tenantChannelRoute.GET("/tag/models", channel.TenantGetTagModels)
			tenantChannelRoute.POST("/fix", channel.TenantFixChannelsAbilities)
			tenantChannelRoute.POST("/ollama/pull", channel.TenantOllamaPullModel)
			tenantChannelRoute.POST("/ollama/pull/stream", channel.TenantOllamaPullModelStream)
			tenantChannelRoute.DELETE("/ollama/delete", channel.TenantOllamaDeleteModel)
			tenantChannelRoute.GET("/ollama/version/:id", channel.TenantOllamaVersion)
			tenantChannelRoute.POST("/mode", channel.TenantSetPlatformChannelMode)
			tenantChannelRoute.GET("/mode", channel.TenantGetPlatformChannelMode)
		}

		adminTenantChannelRoute := apiRouter.Group("/admin/tenant/:tenantId/channel")
		adminTenantChannelRoute.Use(middleware.RootAuth())
		{
			adminTenantChannelRoute.GET("/overrides", channel.AdminOnBehalfListDisabledChannels)
			adminTenantChannelRoute.POST("/:channelId/toggle", channel.AdminOnBehalfToggleChannel)
			adminTenantChannelRoute.POST("/fix", channel.AdminOnBehalfFixChannelsAbilities)
		}
		tokenRoute := apiRouter.Group("/token")
		tokenRoute.Use(middleware.UserAuth())
		{
			tokenRoute.GET("/", user.GetAllTokens)
			tokenRoute.GET("/search", middleware.SearchRateLimit(), user.SearchTokens)
			tokenRoute.GET("/:id", user.GetToken)
			tokenRoute.POST("/:id/key", middleware.CriticalRateLimit(), middleware.DisableCache(), user.GetTokenKey)
			tokenRoute.POST("/", user.AddToken)
			tokenRoute.PUT("/", user.UpdateToken)
			tokenRoute.DELETE("/:id", user.DeleteToken)
			tokenRoute.POST("/batch", user.DeleteTokenBatch)
			tokenRoute.POST("/batch/keys", middleware.CriticalRateLimit(), middleware.DisableCache(), user.GetTokenKeysBatch)
		}

		usageRoute := apiRouter.Group("/usage")
		usageRoute.Use(middleware.CORS(), middleware.CriticalRateLimit())
		{
			tokenUsageRoute := usageRoute.Group("/token")
			tokenUsageRoute.Use(middleware.TokenAuthReadOnly())
			{
				tokenUsageRoute.GET("/", user.GetTokenUsage)
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
			purchaseRoute.GET("/topup", payment.AdminListTopUpOrders)
			purchaseRoute.POST("/topup/complete", payment.AdminCompleteTopUp)
			purchaseRoute.POST("/topup/expire", payment.AdminExpireTopUpOrder)
			purchaseRoute.POST("/topup/delete", payment.AdminDeleteTopUpOrder)
			purchaseRoute.GET("/subscription", payment.AdminListSubscriptionOrdersFull)
			purchaseRoute.POST("/subscription/complete", payment.AdminCompleteSubscriptionOrder)
			purchaseRoute.POST("/subscription/expire", payment.AdminExpireSubscriptionOrderAction)
			purchaseRoute.POST("/subscription/delete", payment.AdminDeleteSubscriptionOrderAction)
		}

		partnerRoute := apiRouter.Group("/partner")
		partnerRoute.Use(middleware.PartnerAuth())
		{
			partnerRoute.GET("/capabilities", partner.Capabilities)
			partnerRoute.GET("/topups", partner.ListTopUps)
			partnerRoute.GET("/rebates", partner.ListRebates)
		}

		affTransferRoute := apiRouter.Group("/aff_transfer")
		{
			affTransferRoute.POST("/", middleware.UserAuth(), user.UserCreateAffTransfer)
			affTransferRoute.GET("/self", middleware.UserAuth(), user.UserGetAffTransferHistory)
			affTransferRoute.GET("/pending_quota", middleware.UserAuth(), user.UserGetPendingQuota)
			affTransferRoute.GET("/", middleware.TenantAdminAuth(), user.AdminGetAllAffTransfers)
			affTransferRoute.POST("/process", middleware.TenantAdminAuth(), user.AdminProcessAffTransfer)
			affTransferRoute.POST("/batch_approve", middleware.TenantAdminAuth(), user.AdminBatchApproveAllPending)
			affTransferRoute.GET("/stats", middleware.TenantAdminAuth(), user.AdminGetAffTransferStats)
			affTransferRoute.GET("/rebate_logs", middleware.UserAuth(), user.UserGetAffRebateLogs)
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
			rebateSettingRoute.GET("/", user.GetAllUserRebateSettings)
			rebateSettingRoute.GET("/:id", user.GetUserRebateSetting)
			rebateSettingRoute.POST("/", user.CreateUserRebateSetting)
			rebateSettingRoute.PUT("/", user.UpdateUserRebateSetting)
			rebateSettingRoute.DELETE("/:id", user.DeleteUserRebateSetting)
		}

		userLevelRoute := apiRouter.Group("/user_level")
		userLevelRoute.Use(middleware.TenantAdminAuth())
		{
			userLevelRoute.GET("/", user.GetAllUserLevels)
			userLevelRoute.POST("/", user.CreateUserLevel)
			userLevelRoute.PUT("/", user.UpdateUserLevel)
			userLevelRoute.DELETE("/:id", user.DeleteUserLevel)
		}

		// Message routes (admin)
		messageAdminRoute := apiRouter.Group("/message/admin")
		messageAdminRoute.Use(middleware.TenantAdminAuth())
		{
			messageAdminRoute.POST("/", platform.AdminCreateMessage)
			messageAdminRoute.GET("/", platform.AdminListMessages)
			messageAdminRoute.GET("/:id", platform.AdminGetMessage)
			messageAdminRoute.PUT("/:id", platform.AdminEditMessage)
			messageAdminRoute.DELETE("/:id", platform.AdminRecallMessage)
			messageAdminRoute.GET("/:id/read_status", platform.AdminGetMessageReadStatus)
		}

		// Console translation route
		apiRouter.GET("/console/translated", middleware.UserAuth(), platform.GetTranslatedConsole)

		// Message routes (user inbox)
		messageUserRoute := apiRouter.Group("/message")
		messageUserRoute.Use(middleware.UserAuth())
		{
			messageUserRoute.GET("/inbox", platform.GetUserInbox)
			messageUserRoute.GET("/inbox/:id", platform.GetUserInboxMessage)
			messageUserRoute.POST("/inbox/:id/read", platform.MarkMessageRead)
			messageUserRoute.GET("/unread_count", platform.GetUnreadMessageCount)
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
		mjRoute.GET("/self", middleware.UserAuth(), media.GetUserMidjourney)
		mjRoute.GET("/", middleware.TenantAdminAuth(), media.GetAllMidjourney)

		taskRoute := apiRouter.Group("/task")
		{
			taskRoute.GET("/self", middleware.UserAuth(), media.GetUserTask)
			taskRoute.GET("/", middleware.TenantAdminAuth(), media.GetAllTask)
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
			deploymentsRoute.GET("/settings", platform.GetModelDeploymentSettings)
			deploymentsRoute.POST("/settings/test-connection", platform.TestIoNetConnection)
			deploymentsRoute.GET("/", platform.GetAllDeployments)
			deploymentsRoute.GET("/search", platform.SearchDeployments)
			deploymentsRoute.POST("/test-connection", platform.TestIoNetConnection)
			deploymentsRoute.GET("/hardware-types", platform.GetHardwareTypes)
			deploymentsRoute.GET("/locations", platform.GetLocations)
			deploymentsRoute.GET("/available-replicas", platform.GetAvailableReplicas)
			deploymentsRoute.POST("/price-estimation", platform.GetPriceEstimation)
			deploymentsRoute.GET("/check-name", platform.CheckClusterNameAvailability)
			deploymentsRoute.POST("/", platform.CreateDeployment)

			deploymentsRoute.GET("/:id", platform.GetDeployment)
			deploymentsRoute.GET("/:id/logs", platform.GetDeploymentLogs)
			deploymentsRoute.GET("/:id/containers", platform.ListDeploymentContainers)
			deploymentsRoute.GET("/:id/containers/:container_id", platform.GetContainerDetails)
			deploymentsRoute.PUT("/:id", platform.UpdateDeployment)
			deploymentsRoute.PUT("/:id/name", platform.UpdateDeploymentName)
			deploymentsRoute.POST("/:id/extend", platform.ExtendDeployment)
			deploymentsRoute.DELETE("/:id", platform.DeleteDeployment)
		}

		tenantRoute := apiRouter.Group("/tenant")
		tenantRoute.Use(middleware.TenantAdminAuth())
		{
			tenantRoute.GET("/info", tenant.GetTenant)
			tenantRoute.PUT("/", tenant.UpdateTenant)
			tenantRoute.GET("/members", tenant.ListTenantMembers)
			tenantRoute.PUT("/members", tenant.UpdateTenantMember)
			// 跨租户邀请在「1 user : 1 tenant」模型下不适用（邀请语义 = 拉同一账号进另一租户）。
			// 下线 POST /tenant/invite 与 GET /tenant/invite/accept 两条路由。
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
			tenantRoute.PUT("/plan/markup", tenant.UpdateTenantPlanMarkup)
			tenantRoute.GET("/platform_channel_markup", tenant.ListPlatformChannelMarkups)
			tenantRoute.POST("/platform_channel_markup", tenant.UpsertPlatformChannelMarkup)
			tenantRoute.DELETE("/platform_channel_markup/:channel_id", tenant.DeletePlatformChannelMarkup)
			// Payment configuration (see docs/superpowers/specs/2026-04-17-wechat-pay-multi-tenant-design.md §7.1)
			tenantRoute.GET("/payment/configs", tenant.GetTenantPaymentConfigs)
			tenantRoute.PUT("/payment/configs/wechat", tenant.UpdateTenantWechatConfig)
			tenantRoute.POST("/payment/configs/wechat/test", tenant.TestTenantWechatConfig)
			tenantRoute.DELETE("/payment/configs/wechat", tenant.DeleteTenantWechatConfig)
			tenantRoute.GET("/payment/xpay/products", tenant.ListTenantXpayProducts)
			tenantRoute.POST("/payment/xpay/products", tenant.CreateTenantXpayProduct)
			tenantRoute.PUT("/payment/xpay/products/:id", tenant.UpdateTenantXpayProduct)
			tenantRoute.DELETE("/payment/xpay/products/:id", tenant.DeleteTenantXpayProduct)
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
			platformTenantRoute.GET("/platform-channel-usage", tenant.ListPlatformChannelUsage)
			platformTenantRoute.POST("/:id/platform-channel-usage/reset", tenant.ResetPlatformChannelUsage)
			platformTenantRoute.PUT("/:id/plan", tenant.UpdateTenantPlanHandler)
		}

		// WeChat Pay S2 user-facing ordering
		paymentRoute := apiRouter.Group("/payment")
		paymentRoute.Use(middleware.UserAuth())
		{
			paymentRoute.POST("/wechat/topup/native", payment.CreateWechatTopupNative)
			paymentRoute.POST("/wechat/topup/h5", payment.CreateWechatTopupH5)
			paymentRoute.POST("/wechat/topup/jsapi", payment.CreateWechatTopupJsapi)
			paymentRoute.GET("/wxmini/topup/tiers", payment.GetWxminiXpayTiers)
			paymentRoute.POST("/wxmini/topup/xpay", payment.CreateWxminiTopupXpay)
			paymentRoute.GET("/orders", payment.ListSelfPaymentOrders)
			paymentRoute.GET("/orders/:out_trade_no", payment.GetPaymentOrderByOutTradeNoHandler)
		}

		// AI App Marketplace — public browse & session token exchange
		appPublicRoute := apiRouter.Group("/app")
		{
			appPublicRoute.GET("", app.ListApps)
			appPublicRoute.GET("/whoami", middleware.TokenAuth(), app.WhoAmI)
			appPublicRoute.GET("/image-diagnosis/results", app.ListImageDiagnosisResults)
			appPublicRoute.GET("/image-diagnosis/results/:result_id", app.GetImageDiagnosisResult)
			appPublicRoute.POST("/image-diagnosis/results", app.SaveImageDiagnosisResult)
			appPublicRoute.GET("/mobile-chat/messages", middleware.UserAuth(), app.ListMobileChatMessages)
			appPublicRoute.POST("/mobile-chat/messages", middleware.UserAuth(), app.SaveMobileChatMessage)
			appPublicRoute.DELETE("/mobile-chat/messages", middleware.UserAuth(), app.ClearMobileChatMessages)
			appPublicRoute.GET("/:slug", app.GetApp)
			appPublicRoute.POST("/:slug/guest-session", middleware.CriticalRateLimit(), app.GetGuestToken)
			appPublicRoute.POST("/:slug/session", middleware.UserAuth(), app.GetSessionToken)
		}

		// AI App Marketplace — admin management
		appAdminRoute := apiRouter.Group("/admin/app")
		appAdminRoute.Use(middleware.AdminAuth())
		{
			appAdminRoute.GET("", app.AdminListApps)
			appAdminRoute.POST("", app.AdminCreateApp)
			appAdminRoute.GET("/:id", app.AdminGetApp)
			appAdminRoute.PUT("/:id", app.AdminUpdateApp)
			appAdminRoute.PATCH("/:id/status", app.AdminUpdateAppStatus)
			appAdminRoute.DELETE("/:id", app.AdminDeleteApp)
		}
	}
}
