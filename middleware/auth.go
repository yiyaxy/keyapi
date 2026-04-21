package middleware

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/common/tenant_ctx"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-contrib/sessions"
	"github.com/gin-gonic/gin"
)

// applyTenantFromToken 在请求未显式携带租户时，用 token.TenantId 注入 ctx 三处
// （gin.Context / request.Context / goroutine-local tenant_ctx），让后续所有
// 租户隔离查询自然按 token 归属的租户走。
//
// 返回：
//   - cleanup: 非 nil 时调用方必须 defer 调用（goroutine-local 清理，防止 net/http
//     keep-alive 复用 goroutine 时把本次租户泄漏给下一次请求）
//   - ok=false: 请求已显式解析到 tenant 但与 token.TenantId 不一致，调用方应 403
func applyTenantFromToken(c *gin.Context, token *model.Token) (cleanup func(), ok bool) {
	if token == nil {
		return nil, true
	}
	requestTenantId := GetTenantId(c)
	if requestTenantId == 0 {
		if token.TenantId > 0 {
			c.Set(string(constant.ContextKeyTenantId), token.TenantId)
			ctx := context.WithValue(c.Request.Context(), constant.ContextKeyTenantId, token.TenantId)
			c.Request = c.Request.WithContext(ctx)
			tenant_ctx.Set(token.TenantId)
			return tenant_ctx.Clear, true
		}
		return nil, true
	}
	if token.TenantId != 0 && token.TenantId != requestTenantId {
		return nil, false
	}
	return nil, true
}

func validUserInfo(username string, role int) bool {
	// check username is empty
	if strings.TrimSpace(username) == "" {
		return false
	}
	if !common.IsValidateRole(role) {
		return false
	}
	return true
}

func authHelper(c *gin.Context, minRole int) bool {
	session := sessions.Default(c)
	username := session.Get("username")
	id := session.Get("id")
	status := session.Get("status")
	useAccessToken := false
	var userRecord *model.User
	var err error
	if username == nil {
		// Check access token
		accessToken := c.Request.Header.Get("Authorization")
		if accessToken == "" {
			c.JSON(http.StatusUnauthorized, gin.H{
				"success": false,
				"message": "无权进行此操作，未登录且未提供 access token",
			})
			c.Abort()
			return false
		}
		user := model.ValidateAccessTokenWithTenant(accessToken, GetTenantId(c))
		if user != nil && user.Username != "" {
			userRecord = user
			if !validUserInfo(user.Username, user.Role) {
				c.JSON(http.StatusOK, gin.H{
					"success": false,
					"message": "无权进行此操作，用户信息无效",
				})
				c.Abort()
				return false
			}
			// Token is valid
			username = user.Username
			id = user.Id
			status = user.Status
			useAccessToken = true
		} else {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "无权进行此操作，access token 无效",
			})
			c.Abort()
			return false
		}
	}
	if userRecord == nil {
		userRecord, err = model.GetUserByIdWithContext(c.Request.Context(), id.(int), false)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{
				"success": false,
				"message": "无权进行此操作，用户不存在",
			})
			c.Abort()
			return false
		}
	}
	// Check session version (only for cookie sessions, skip for access tokens)
	if !useAccessToken {
		sessionVersion := session.Get("session_version")
		if sessionVersion == nil || sessionVersion.(int) != common.SessionVersion {
			c.JSON(http.StatusUnauthorized, gin.H{
				"success": false,
				"message": "会话已过期，请重新登录",
			})
			c.Abort()
			return false
		}
	}
	// get header New-Api-User
	apiUserIdStr := c.Request.Header.Get("New-Api-User")
	if apiUserIdStr == "" {
		c.JSON(http.StatusUnauthorized, gin.H{
			"success": false,
			"message": "无权进行此操作，未提供 New-Api-User",
		})
		c.Abort()
		return false
	}
	apiUserId, err := strconv.Atoi(apiUserIdStr)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{
			"success": false,
			"message": "无权进行此操作，New-Api-User 格式错误",
		})
		c.Abort()
		return false

	}
	if id != apiUserId {
		c.JSON(http.StatusUnauthorized, gin.H{
			"success": false,
			"message": "无权进行此操作，New-Api-User 与登录用户不匹配",
		})
		c.Abort()
		return false
	}
	if status.(int) == common.UserStatusDisabled {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "用户已被封禁",
		})
		c.Abort()
		return false
	}
	info, err := model.GetTenantMembershipAuthInfo(GetTenantId(c), userRecord)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{
			"success": false,
			"message": "无权进行此操作，当前租户成员状态无效",
		})
		c.Abort()
		return false
	}
	if info.TenantStatus != model.TenantMembershipStatusActive && info.PlatformRole < common.RoleAdminUser {
		c.JSON(http.StatusForbidden, gin.H{
			"success": false,
			"message": "无权进行此操作，当前租户成员状态无效",
		})
		c.Abort()
		return false
	}
	effectiveRole := info.EffectiveRole
	if effectiveRole < minRole {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "无权进行此操作，权限不足",
		})
		c.Abort()
		return false
	}
	if !validUserInfo(username.(string), effectiveRole) {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "无权进行此操作，用户信息无效",
		})
		c.Abort()
		return false
	}
	// Multi-tenant: validate tenant match
	// Access token auth: already tenant-scoped at query time (ValidateAccessTokenWithTenant).
	// Session auth: validate session tenant matches request tenant.
	if !useAccessToken {
		requestTenantId := GetTenantId(c)
		sessionTenantId := session.Get("tenant_id")
		if sessionTenantId != nil {
			if stid, ok := sessionTenantId.(int); ok && stid != 0 && stid != requestTenantId {
				c.JSON(http.StatusForbidden, gin.H{
					"success": false,
					"message": "session does not belong to this tenant",
				})
				c.Abort()
				return false
			}
		}
	}

	// 防止不同newapi版本冲突，导致数据不通用
	c.Header("Auth-Version", "864b7076dbcd0a3c01b5520316720ebf")
	c.Set("username", username)
	c.Set("role", effectiveRole)
	c.Set("platform_role", info.PlatformRole)
	c.Set("tenant_role", info.TenantRole)
	c.Set("id", id)
	c.Set("group", session.Get("group"))
	c.Set("user_group", session.Get("group"))
	c.Set("use_access_token", useAccessToken)
	return true
}

func TryUserAuth() func(c *gin.Context) {
	return func(c *gin.Context) {
		session := sessions.Default(c)
		id := session.Get("id")
		if id != nil {
			c.Set("id", id)
		}
		c.Next()
	}
}

func UserAuth() func(c *gin.Context) {
	return func(c *gin.Context) {
		if !authHelper(c, common.RoleCommonUser) {
			return
		}
		c.Next()
	}
}

func AdminAuth() func(c *gin.Context) {
	return func(c *gin.Context) {
		if !authHelper(c, common.RoleAdminUser) {
			return
		}
		c.Next()
	}
}

func RootAuth() func(c *gin.Context) {
	return func(c *gin.Context) {
		if !authHelper(c, common.RoleRootUser) {
			return
		}
		c.Next()
	}
}

func WssAuth(c *gin.Context) {

}

// TokenOrUserAuth allows either session-based user auth or API token auth.
// Used for endpoints that need to be accessible from both the dashboard and API clients.
func TokenOrUserAuth() func(c *gin.Context) {
	return func(c *gin.Context) {
		// Try session auth first (dashboard users)
		session := sessions.Default(c)
		if id := session.Get("id"); id != nil {
			if status, ok := session.Get("status").(int); ok && status == common.UserStatusEnabled {
				c.Set("id", id)
				c.Next()
				return
			}
		}
		// Fall back to token auth (API clients)
		TokenAuth()(c)
	}
}

// TokenAuthReadOnly 宽松版本的令牌认证中间件，用于只读查询接口。
// 只验证令牌 key 是否存在，不检查令牌状态、过期时间和额度。
// 即使令牌已过期、已耗尽或已禁用，也允许访问。
// 仍然检查用户是否被封禁。
func TokenAuthReadOnly() func(c *gin.Context) {
	return func(c *gin.Context) {
		key := c.Request.Header.Get("Authorization")
		if key == "" {
			c.JSON(http.StatusUnauthorized, gin.H{
				"success": false,
				"message": "未提供 Authorization 请求头",
			})
			c.Abort()
			return
		}
		if strings.HasPrefix(key, "Bearer ") || strings.HasPrefix(key, "bearer ") {
			key = strings.TrimSpace(key[7:])
		}
		key = strings.TrimPrefix(key, "sk-")
		parts := strings.Split(key, "-")
		key = parts[0]

		token, err := model.GetTokenByKeyWithContext(c.Request.Context(), key, false)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{
				"success": false,
				"message": "无效的令牌",
			})
			c.Abort()
			return
		}

		// Multi-tenant: 同 TokenAuth，按 token.TenantId 注入 ctx 或校验一致性。
		cleanup, ok := applyTenantFromToken(c, token)
		if !ok {
			c.JSON(http.StatusForbidden, gin.H{
				"success": false,
				"message": "token does not belong to this tenant",
			})
			c.Abort()
			return
		}
		if cleanup != nil {
			defer cleanup()
		}

		userCache, err := model.GetUserCacheWithContext(c.Request.Context(), token.UserId)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"success": false,
				"message": err.Error(),
			})
			c.Abort()
			return
		}
		if userCache.Status != common.UserStatusEnabled {
			c.JSON(http.StatusForbidden, gin.H{
				"success": false,
				"message": "用户已被封禁",
			})
			c.Abort()
			return
		}

		c.Set("id", token.UserId)
		c.Set("token_id", token.Id)
		c.Set("token_key", token.Key)
		c.Next()
	}
}

func TokenAuth() func(c *gin.Context) {
	return func(c *gin.Context) {
		// 先检测是否为ws
		if c.Request.Header.Get("Sec-WebSocket-Protocol") != "" {
			// Sec-WebSocket-Protocol: realtime, openai-insecure-api-key.sk-xxx, openai-beta.realtime-v1
			// read sk from Sec-WebSocket-Protocol
			key := c.Request.Header.Get("Sec-WebSocket-Protocol")
			parts := strings.Split(key, ",")
			for _, part := range parts {
				part = strings.TrimSpace(part)
				if strings.HasPrefix(part, "openai-insecure-api-key") {
					key = strings.TrimPrefix(part, "openai-insecure-api-key.")
					break
				}
			}
			c.Request.Header.Set("Authorization", "Bearer "+key)
		}
		// 检查path包含/v1/messages 或 /v1/models
		if strings.Contains(c.Request.URL.Path, "/v1/messages") || strings.Contains(c.Request.URL.Path, "/v1/models") {
			anthropicKey := c.Request.Header.Get("x-api-key")
			if anthropicKey != "" {
				c.Request.Header.Set("Authorization", "Bearer "+anthropicKey)
			}
		}
		// gemini api 从query中获取key
		if strings.HasPrefix(c.Request.URL.Path, "/v1beta/models") ||
			strings.HasPrefix(c.Request.URL.Path, "/v1beta/openai/models") ||
			strings.HasPrefix(c.Request.URL.Path, "/v1/models/") {
			skKey := c.Query("key")
			if skKey != "" {
				c.Request.Header.Set("Authorization", "Bearer "+skKey)
			}
			// 从x-goog-api-key header中获取key
			xGoogKey := c.Request.Header.Get("x-goog-api-key")
			if xGoogKey != "" {
				c.Request.Header.Set("Authorization", "Bearer "+xGoogKey)
			}
		}
		key := c.Request.Header.Get("Authorization")
		parts := make([]string, 0)
		if strings.HasPrefix(key, "Bearer ") || strings.HasPrefix(key, "bearer ") {
			key = strings.TrimSpace(key[7:])
		}
		if key == "" || key == "midjourney-proxy" {
			key = c.Request.Header.Get("mj-api-secret")
			if strings.HasPrefix(key, "Bearer ") || strings.HasPrefix(key, "bearer ") {
				key = strings.TrimSpace(key[7:])
			}
			key = strings.TrimPrefix(key, "sk-")
			parts = strings.Split(key, "-")
			key = parts[0]
		} else {
			key = strings.TrimPrefix(key, "sk-")
			parts = strings.Split(key, "-")
			key = parts[0]
		}
		token, err := model.ValidateUserTokenWithContext(c.Request.Context(), key)
		if token != nil {
			id := c.GetInt("id")
			if id == 0 {
				c.Set("id", token.UserId)
			}
		}
		if err != nil {
			abortWithOpenAiMessage(c, http.StatusUnauthorized, err.Error())
			return
		}

		// Multi-tenant: 外部 API 请求走 sk-key 鉴权时通常不带 X-Tenant-Id/子域名，
		// TenantResolve 不会写 tenant。此时以 token.TenantId 为权威注入 ctx，
		// 让后续所有租户隔离查询自然生效；若请求已显式解析到 tenant，则必须
		// 与 token.TenantId 一致，否则拒绝。
		cleanup, ok := applyTenantFromToken(c, token)
		if !ok {
			abortWithOpenAiMessage(c, http.StatusForbidden, "token does not belong to this tenant")
			return
		}
		if cleanup != nil {
			defer cleanup()
		}

		allowIps := token.GetIpLimits()
		if len(allowIps) > 0 {
			clientIp := c.ClientIP()
			logger.LogDebug(c, "Token has IP restrictions, checking client IP %s", clientIp)
			ip := net.ParseIP(clientIp)
			if ip == nil {
				abortWithOpenAiMessage(c, http.StatusForbidden, "无法解析客户端 IP 地址")
				return
			}
			if common.IsIpInCIDRList(ip, allowIps) == false {
				abortWithOpenAiMessage(c, http.StatusForbidden, "您的 IP 不在令牌允许访问的列表中", types.ErrorCodeAccessDenied)
				return
			}
			logger.LogDebug(c, "Client IP %s passed the token IP restrictions check", clientIp)
		}

		userCache, err := model.GetUserCacheWithContext(c.Request.Context(), token.UserId)
		if err != nil {
			abortWithOpenAiMessage(c, http.StatusInternalServerError, err.Error())
			return
		}
		userEnabled := userCache.Status == common.UserStatusEnabled
		if !userEnabled {
			abortWithOpenAiMessage(c, http.StatusForbidden, "用户已被封禁")
			return
		}

		userCache.WriteContext(c)

		userGroup := userCache.Group
		tokenGroup := token.Group
		// When token has no group set, check if the user's group has channels.
		// If not (e.g. VIP/SVIP are pure billing tiers), fall back to "default".
		if tokenGroup == "" {
			if !model.GroupHasChannels(userGroup, GetTenantId(c)) {
				userGroup = "default"
			}
		}
		if tokenGroup != "" {
			if strings.Contains(tokenGroup, ",") {
				// Custom group chain: validate each group in the chain
				chainGroups := strings.Split(tokenGroup, ",")
				usable := service.GetUserUsableGroups(userGroup)
				for _, g := range chainGroups {
					g = strings.TrimSpace(g)
					if g == "" {
						continue
					}
					if _, ok := usable[g]; !ok {
						abortWithOpenAiMessage(c, http.StatusForbidden, fmt.Sprintf("无权访问 %s 分组", g))
						return
					}
					if !ratio_setting.ContainsGroupRatio(g) {
						abortWithOpenAiMessage(c, http.StatusForbidden, fmt.Sprintf("分组 %s 已被弃用", g))
						return
					}
				}
				// Set userGroup to the first non-empty group in the chain
				for _, g := range chainGroups {
					g = strings.TrimSpace(g)
					if g != "" {
						userGroup = g
						break
					}
				}
			} else {
				// Single group: original logic
				// check common.UserUsableGroups[userGroup]
				if _, ok := service.GetUserUsableGroups(userGroup)[tokenGroup]; !ok {
					abortWithOpenAiMessage(c, http.StatusForbidden, fmt.Sprintf("无权访问 %s 分组", tokenGroup))
					return
				}
				// check group in common.GroupRatio
				if !ratio_setting.ContainsGroupRatio(tokenGroup) {
					if tokenGroup != "auto" {
						abortWithOpenAiMessage(c, http.StatusForbidden, fmt.Sprintf("分组 %s 已被弃用", tokenGroup))
						return
					}
				}
				userGroup = tokenGroup
			}
		}
		common.SetContextKey(c, constant.ContextKeyUsingGroup, userGroup)

		err = SetupContextForToken(c, token, parts...)
		if err != nil {
			return
		}
		c.Next()
	}
}

func SetupContextForToken(c *gin.Context, token *model.Token, parts ...string) error {
	if token == nil {
		return fmt.Errorf("token is nil")
	}
	c.Set("id", token.UserId)
	c.Set("token_id", token.Id)
	c.Set("token_key", token.Key)
	c.Set("token_name", token.Name)
	c.Set("token_unlimited_quota", token.UnlimitedQuota)
	if !token.UnlimitedQuota {
		c.Set("token_quota", token.RemainQuota)
	}
	if token.ModelLimitsEnabled {
		c.Set("token_model_limit_enabled", true)
		c.Set("token_model_limit", token.GetModelLimitsMap())
	} else {
		c.Set("token_model_limit_enabled", false)
	}
	common.SetContextKey(c, constant.ContextKeyTokenGroup, token.Group)
	common.SetContextKey(c, constant.ContextKeyTokenCrossGroupRetry, token.CrossGroupRetry)
	if len(parts) > 1 {
		if model.IsAdmin(token.UserId) {
			c.Set("specific_channel_id", parts[1])
		} else {
			c.Header("specific_channel_version", "701e3ae1dc3f7975556d354e0675168d004891c8")
			abortWithOpenAiMessage(c, http.StatusForbidden, "普通用户不支持指定渠道")
			return fmt.Errorf("普通用户不支持指定渠道")
		}
	}
	return nil
}
