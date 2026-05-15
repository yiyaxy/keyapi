package user

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"

	"github.com/QuantumNous/new-api/constant"

	"github.com/bytedance/gopkg/util/gopool"
	"github.com/gin-contrib/sessions"
	"github.com/gin-gonic/gin"
)

type LoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func Login(c *gin.Context) {
	if !service.GetConfigBool(middleware.GetTenantId(c), "PasswordLoginEnabled", common.PasswordLoginEnabled) {
		common.ApiErrorI18n(c, i18n.MsgUserPasswordLoginDisabled)
		return
	}
	var loginRequest LoginRequest
	err := json.NewDecoder(c.Request.Body).Decode(&loginRequest)
	if err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	username := loginRequest.Username
	password := loginRequest.Password
	if username == "" || password == "" {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	user := model.User{
		Username: username,
		Password: password,
	}
	err = user.ValidateAndFillWithTenant(middleware.GetTenantId(c))
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"message": err.Error(),
			"success": false,
		})
		return
	}

	c.Set("login_type", "password")

	// 检查是否启用2FA
	if model.IsTwoFAEnabled(user.Id) {
		// 设置pending session，等待2FA验证
		session := sessions.Default(c)
		session.Set("pending_username", user.Username)
		session.Set("pending_user_id", user.Id)
		err := session.Save()
		if err != nil {
			common.ApiErrorI18n(c, i18n.MsgUserSessionSaveFailed)
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"message": i18n.T(c, i18n.MsgUserRequire2FA),
			"success": true,
			"data": map[string]interface{}{
				"require_2fa": true,
			},
		})
		return
	}

	SetupLogin(&user, c)
}

// SetupLogin starts the post-auth session (cookies, role context, user JSON
// response). Exported so other controller subpackages (auth/, etc.) can
// finalize login after their own verification step without importing each
// other.
func SetupLogin(user *model.User, c *gin.Context) {
	tenantId := middleware.GetTenantId(c)
	if tenantId <= 0 {
		common.ApiError(c, model.ErrTenantRequired)
		return
	}
	info, err := model.GetTenantMembershipAuthInfo(tenantId, user)
	if err != nil {
		common.ApiErrorMsg(c, "当前用户不属于该租户")
		return
	}
	platformRole := info.PlatformRole
	tenantRole := info.TenantRole
	effectiveRole := info.EffectiveRole
	c.Set("role", effectiveRole)
	c.Set("platform_role", platformRole)
	c.Set("tenant_role", tenantRole)
	session := sessions.Default(c)
	session.Set("id", user.Id)
	session.Set("username", user.Username)
	session.Set("role", effectiveRole)
	session.Set("platform_role", platformRole)
	session.Set("tenant_role", tenantRole)
	session.Set("status", user.Status)
	session.Set("group", user.Group)
	session.Set("session_version", common.SessionVersion)
	session.Set("tenant_id", tenantId)
	err = session.Save()
	if err != nil {
		common.ApiErrorI18n(c, i18n.MsgUserSessionSaveFailed)
		return
	}

	// Record login IP asynchronously
	ip := c.ClientIP()
	userAgent := c.Request.UserAgent()
	loginType := c.GetString("login_type")
	userId := user.Id
	username := user.Username
	gopool.Go(func() {
		model.RecordLoginIp(tenantId, userId, username, ip, loginType, userAgent)
		service.LookupIPAsync(ip)
	})

	c.JSON(http.StatusOK, gin.H{
		"message": "",
		"success": true,
		"data": map[string]any{
			"id":            user.Id,
			"username":      user.Username,
			"display_name":  user.DisplayName,
			"role":          effectiveRole,
			"platform_role": platformRole,
			"tenant_role":   tenantRole,
			"tenant_id":     tenantId,
			"status":        user.Status,
			"group":         user.Group,
		},
	})
}

func Logout(c *gin.Context) {
	session := sessions.Default(c)
	session.Clear()
	err := session.Save()
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"message": err.Error(),
			"success": false,
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"message": "",
		"success": true,
	})
}

func Register(c *gin.Context) {
	tenantId := middleware.GetTenantId(c)
	if !service.GetConfigBool(tenantId, "RegisterEnabled", common.RegisterEnabled) {
		common.ApiErrorI18n(c, i18n.MsgUserRegisterDisabled)
		return
	}
	if !service.GetConfigBool(tenantId, "PasswordRegisterEnabled", common.PasswordRegisterEnabled) {
		common.ApiErrorI18n(c, i18n.MsgUserPasswordRegisterDisabled)
		return
	}
	var user model.User
	err := json.NewDecoder(c.Request.Body).Decode(&user)
	if err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	if err := common.Validate.Struct(&user); err != nil {
		common.ApiErrorI18n(c, i18n.MsgUserInputInvalid, map[string]any{"Error": err.Error()})
		return
	}
	if service.GetConfigBool(tenantId, "EmailVerificationEnabled", common.EmailVerificationEnabled) {
		if user.Email == "" || user.VerificationCode == "" {
			common.ApiErrorI18n(c, i18n.MsgUserEmailVerificationRequired)
			return
		}
		if !common.VerifyCodeWithKey(user.Email, user.VerificationCode, common.EmailVerificationPurpose) {
			common.ApiErrorI18n(c, i18n.MsgUserVerificationCodeError)
			return
		}
	}
	exist, err := model.CheckUserExistOrDeleted(user.Username, user.Email, middleware.GetTenantId(c))
	if err != nil {
		common.ApiErrorI18n(c, i18n.MsgDatabaseError)
		common.SysLog(fmt.Sprintf("CheckUserExistOrDeleted error: %v", err))
		return
	}
	if exist {
		common.ApiErrorI18n(c, i18n.MsgUserExists)
		return
	}
	affCode := user.AffCode // this code is the inviter's code, not the user's own code
	inviterId, _ := model.GetUserIdByAffCode(affCode)
	cleanUser := model.User{
		TenantId:              middleware.GetTenantId(c),
		Username:              user.Username,
		Password:              user.Password,
		DisplayName:           user.Username,
		InviterId:             inviterId,
		SkipRegistrationQuota: true,
		Role:                  common.RoleCommonUser, // 明确设置角色为普通用户
	}
	if user.Email != "" {
		// 邮箱统一转为小写存储，确保大小写不敏感
		cleanUser.Email = strings.ToLower(user.Email)
	}
	if err := cleanUser.Insert(inviterId); err != nil {
		common.ApiError(c, err)
		return
	}
	if err := model.EnsureTenantMembership(cleanUser.Id, cleanUser.TenantId, model.TenantRoleMember, inviterId); err != nil {
		common.ApiError(c, err)
		return
	}

	// 获取插入后的用户ID
	var insertedUser model.User
	if err := model.DB.Where("username = ? AND tenant_id = ?", cleanUser.Username, middleware.GetTenantId(c)).First(&insertedUser).Error; err != nil {
		common.ApiErrorI18n(c, i18n.MsgUserRegisterFailed)
		return
	}
	// 生成默认令牌
	if constant.GenerateDefaultToken {
		key, err := common.GenerateKey()
		if err != nil {
			common.ApiErrorI18n(c, i18n.MsgUserDefaultTokenFailed)
			common.SysLog("failed to generate token key: " + err.Error())
			return
		}
		// 生成默认令牌
		token := model.Token{
			TenantId:           middleware.GetTenantId(c),
			UserId:             insertedUser.Id, // 使用插入后的用户ID
			Name:               cleanUser.Username + "的初始令牌",
			Key:                key,
			CreatedTime:        common.GetTimestamp(),
			AccessedTime:       common.GetTimestamp(),
			ExpiredTime:        -1,     // 永不过期
			RemainQuota:        500000, // 示例额度
			UnlimitedQuota:     true,
			ModelLimitsEnabled: false,
			EnableImageGen:     true,
		}
		if setting.DefaultUseAutoGroup {
			token.Group = "auto"
		}
		if err := token.Insert(); err != nil {
			common.ApiErrorI18n(c, i18n.MsgCreateDefaultTokenErr)
			return
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
	})
	return
}

func GetAllUsers(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	tenantId := middleware.GetTenantId(c)
	users, total, err := model.GetAllUsersByTenant(tenantId, pageInfo)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if err := model.ApplyMembershipView(tenantId, users); err != nil {
		common.ApiError(c, err)
		return
	}
	if err := model.FillUserLevelNames(tenantId, users); err != nil {
		common.ApiError(c, err)
		return
	}

	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(users)

	common.ApiSuccess(c, pageInfo)
	return
}

func SearchUsers(c *gin.Context) {
	keyword := c.Query("keyword")
	group := c.Query("group")
	ip := c.Query("ip")
	pageInfo := common.GetPageQuery(c)
	tenantId := middleware.GetTenantId(c)
	users, total, err := model.SearchUsersByTenant(tenantId, keyword, group, ip, pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if err := model.ApplyMembershipView(tenantId, users); err != nil {
		common.ApiError(c, err)
		return
	}
	if err := model.FillUserLevelNames(tenantId, users); err != nil {
		common.ApiError(c, err)
		return
	}

	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(users)
	common.ApiSuccess(c, pageInfo)
	return
}

func GetUser(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	// Tenant gate: verify target user belongs to current tenant
	if err := model.RequireTenantMembership(middleware.GetTenantId(c), id, c.GetInt("platform_role")); err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	user, err := model.GetUserByIdWithContext(c, id, false)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if err := model.ApplyMembershipViewToUser(middleware.GetTenantId(c), user); err != nil {
		common.ApiError(c, err)
		return
	}
	myRole := c.GetInt("role")
	if myRole <= user.Role && myRole != common.RoleRootUser {
		common.ApiErrorI18n(c, i18n.MsgUserNoPermissionSameLevel)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    user,
	})
	return
}

func GenerateAccessToken(c *gin.Context) {
	id := c.GetInt("id")
	user, err := model.GetUserByIdWithContext(c, id, true)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	// get rand int 28-32
	randI := common.GetRandomInt(4)
	key, err := common.GenerateRandomKey(29 + randI)
	if err != nil {
		common.ApiErrorI18n(c, i18n.MsgGenerateFailed)
		common.SysLog("failed to generate key: " + err.Error())
		return
	}
	user.SetAccessToken(key)

	if model.DB.Where("access_token = ?", user.AccessToken).First(user).RowsAffected != 0 {
		common.ApiErrorI18n(c, i18n.MsgUuidDuplicate)
		return
	}

	if err := user.Update(false); err != nil {
		common.ApiError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    user.AccessToken,
	})
	return
}

type TransferAffQuotaRequest struct {
	Quota int `json:"quota" binding:"required"`
}

func TransferAffQuota(c *gin.Context) {
	id := c.GetInt("id")
	user, err := model.GetUserByIdWithContext(c, id, true)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	tran := TransferAffQuotaRequest{}
	if err := c.ShouldBindJSON(&tran); err != nil {
		common.ApiError(c, err)
		return
	}
	if float64(tran.Quota) < common.QuotaPerUnit {
		common.ApiErrorMsg(c, "转移额度不足最小额度")
		return
	}
	if user.AffQuota < tran.Quota {
		common.ApiErrorI18n(c, i18n.MsgUserTransferFailed, map[string]any{"Error": "邀请额度不足"})
		return
	}
	transferReq := &model.AffTransferRequest{
		TenantId: middleware.GetTenantId(c),
		UserId:   id,
		Username: user.Username,
		Quota:    tran.Quota,
		Status:   model.AffTransferStatusPending,
	}
	if err := model.CreateAffTransferRequest(transferReq); err != nil {
		common.ApiErrorI18n(c, i18n.MsgUserTransferFailed, map[string]any{"Error": err.Error()})
		return
	}
	common.ApiSuccessI18n(c, i18n.MsgUserTransferSuccess, nil)
}

func GetAffCode(c *gin.Context) {
	id := c.GetInt("id")
	user, err := model.GetUserByIdWithContext(c, id, true)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if user.AffCode == "" {
		user.AffCode = common.GetRandomString(4)
		if err := user.Update(false); err != nil {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": err.Error(),
			})
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    user.AffCode,
	})
	return
}

type BindAffCodeRequest struct {
	AffCode string `json:"aff_code"`
}

func BindAffCode(c *gin.Context) {
	var req BindAffCodeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "invalid request parameters")
		return
	}
	result, err := model.BindInviteCode(middleware.GetTenantId(c), c.GetInt("id"), req.AffCode)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}

func GetInvitees(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	users, total, err := model.GetInviteesByInviterId(middleware.GetTenantId(c), c.GetInt("id"), pageInfo)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(users)
	common.ApiSuccess(c, pageInfo)
}

func GetSelf(c *gin.Context) {
	id := c.GetInt("id")
	userRole := c.GetInt("role")
	platformRole := c.GetInt("platform_role")
	tenantRole := c.GetInt("tenant_role")
	user, err := model.GetUserByIdWithContext(c, id, false)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if err := model.ApplyMembershipViewToUser(middleware.GetTenantId(c), user); err != nil {
		common.ApiError(c, err)
		return
	}
	if err := model.FillUserLevelNames(middleware.GetTenantId(c), []*model.User{user}); err != nil {
		common.ApiError(c, err)
		return
	}
	// Hide admin remarks: set to empty to trigger omitempty tag, ensuring the remark field is not included in JSON returned to regular users
	user.Remark = ""

	// 计算用户权限信息
	permissions := calculateUserPermissions(userRole)

	// 获取用户设置并提取sidebar_modules
	userSetting := user.GetSetting()

	// 构建响应数据，包含用户信息和权限
	responseData := map[string]interface{}{
		"id":                user.Id,
		"username":          user.Username,
		"display_name":      user.DisplayName,
		"role":              user.Role,
		"platform_role":     platformRole,
		"tenant_role":       tenantRole,
		"tenant_id":         middleware.GetTenantId(c),
		"status":            user.Status,
		"email":             user.Email,
		"github_id":         user.GitHubId,
		"discord_id":        user.DiscordId,
		"oidc_id":           user.OidcId,
		"wechat_id":         user.WeChatId,
		"telegram_id":       user.TelegramId,
		"group":             user.Group,
		"quota":             user.Quota,
		"used_quota":        user.UsedQuota,
		"request_count":     user.RequestCount,
		"aff_code":          user.AffCode,
		"aff_count":         user.AffCount,
		"aff_quota":         user.AffQuota,
		"aff_history_quota": user.AffHistoryQuota,
		"inviter_id":        user.InviterId,
		"level_id":          user.LevelId,
		"level_name":        user.LevelName,
		"linux_do_id":       user.LinuxDOId,
		"setting":           user.Setting,
		"stripe_customer":   user.StripeCustomer,
		"sidebar_modules":   userSetting.SidebarModules, // 正确提取sidebar_modules字段
		"permissions":       permissions,                // 新增权限字段
		// features 是按租户开通的功能开关集合。前端用它决定菜单显隐 / 路由守卫。
		// 只有超管（platform_role >= RoleRootUser）默认拥有所有 feature；
		// 租户管理员（含 platform_role == RoleAdminUser）仅拥有租户被显式开通的 feature。
		"features": map[string]bool{
			"chat_history": platformRole >= common.RoleRootUser ||
				model.IsChatHistoryViewEnabled(middleware.GetTenantId(c)),
		},
	}

	// Expose effective rebate settings for the current user (as inviter)
	rebateSetting := model.GetEffectiveRebateSetting(user.Id, user.TenantId)
	responseData["effective_register_reward"] = rebateSetting.RegisterReward
	responseData["effective_invitee_reward"] = rebateSetting.InviteeReward
	responseData["effective_top_up_rebate_count"] = rebateSetting.TopUpRebateCount
	responseData["effective_top_up_rebate_percent"] = rebateSetting.TopUpRebatePercent

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    responseData,
	})
	return
}

// 计算用户权限的辅助函数
func calculateUserPermissions(userRole int) map[string]interface{} {
	permissions := map[string]interface{}{}

	// 根据用户角色计算权限
	if userRole == common.RoleRootUser {
		// 超级管理员不需要边栏设置功能
		permissions["sidebar_settings"] = false
		permissions["sidebar_modules"] = map[string]interface{}{}
	} else if userRole == common.RoleAdminUser {
		// 管理员可以设置边栏，但不包含系统设置功能
		permissions["sidebar_settings"] = true
		permissions["sidebar_modules"] = map[string]interface{}{
			"admin": map[string]interface{}{
				"setting": false, // 管理员不能访问系统设置
			},
		}
	} else {
		// 普通用户只能设置个人功能，不包含管理员区域
		permissions["sidebar_settings"] = true
		permissions["sidebar_modules"] = map[string]interface{}{
			"admin": false, // 普通用户不能访问管理员区域
		}
	}

	return permissions
}

// 根据用户角色生成默认的边栏配置
func generateDefaultSidebarConfig(userRole int) string {
	defaultConfig := map[string]interface{}{}

	// 聊天区域 - 所有用户都可以访问
	defaultConfig["chat"] = map[string]interface{}{
		"enabled":    true,
		"playground": true,
		"chat":       true,
	}

	// 控制台区域 - 所有用户都可以访问
	defaultConfig["console"] = map[string]interface{}{
		"enabled":    true,
		"detail":     true,
		"token":      true,
		"log":        true,
		"midjourney": true,
		"task":       true,
	}

	// 个人中心区域 - 所有用户都可以访问
	defaultConfig["personal"] = map[string]interface{}{
		"enabled":  true,
		"topup":    true,
		"personal": true,
	}

	// 管理员区域 - 根据角色决定
	if userRole == common.RoleAdminUser {
		// 管理员可以访问管理员区域，但不能访问系统设置
		defaultConfig["admin"] = map[string]interface{}{
			"enabled":    true,
			"channel":    true,
			"models":     true,
			"redemption": true,
			"user":       true,
			"setting":    false, // 管理员不能访问系统设置
		}
	} else if userRole == common.RoleRootUser {
		// 超级管理员可以访问所有功能
		defaultConfig["admin"] = map[string]interface{}{
			"enabled":    true,
			"channel":    true,
			"models":     true,
			"redemption": true,
			"user":       true,
			"setting":    true,
		}
	}
	// 普通用户不包含admin区域

	// 转换为JSON字符串
	configBytes, err := json.Marshal(defaultConfig)
	if err != nil {
		common.SysLog("生成默认边栏配置失败: " + err.Error())
		return ""
	}

	return string(configBytes)
}

func GetUserModels(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		id = c.GetInt("id")
	}
	user, err := model.GetUserCacheWithContext(c, id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	groups := service.GetTenantUserUsableGroups(middleware.GetTenantId(c), user.Group)
	var models []string
	for group := range groups {
		for _, g := range model.GetGroupEnabledModels(group, middleware.GetTenantId(c)) {
			if !common.StringsContains(models, g) {
				models = append(models, g)
			}
		}
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    models,
	})
	return
}

func UpdateUser(c *gin.Context) {
	var updatedUser model.User
	err := json.NewDecoder(c.Request.Body).Decode(&updatedUser)
	if err != nil || updatedUser.Id == 0 {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	if updatedUser.Password == "" {
		updatedUser.Password = "$I_LOVE_U" // make Validator happy :)
	}
	if err := common.Validate.Struct(&updatedUser); err != nil {
		common.ApiErrorI18n(c, i18n.MsgUserInputInvalid, map[string]any{"Error": err.Error()})
		return
	}
	// Tenant gate: verify target user belongs to current tenant
	if err := model.RequireTenantMembership(middleware.GetTenantId(c), updatedUser.Id, c.GetInt("platform_role")); err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	originUser, err := model.GetUserByIdWithContext(c, updatedUser.Id, false)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if err := model.ApplyMembershipViewToUser(middleware.GetTenantId(c), originUser); err != nil {
		common.ApiError(c, err)
		return
	}
	myRole := c.GetInt("role")
	// 自己改自己不受同级保护规则约束（典型场景：租户管理员调整自身额度）。
	// Edit() 仅落库 username/display_name/group/quota/remark/user_level_id/password，
	// 不会改 role，所以无提权风险。
	if originUser.Id != c.GetInt("id") && myRole <= originUser.Role && myRole != common.RoleRootUser {
		common.ApiErrorI18n(c, i18n.MsgUserNoPermissionHigherLevel)
		return
	}
	if updatedUser.Password == "$I_LOVE_U" {
		updatedUser.Password = "" // rollback to what it should be
	}
	updatedUser.TenantId = middleware.GetTenantId(c)
	updatePassword := updatedUser.Password != ""
	if err := updatedUser.Edit(updatePassword); err != nil {
		common.ApiError(c, err)
		return
	}
	if originUser.Quota != updatedUser.Quota {
		model.RecordLogCtx(c, originUser.Id, model.LogTypeManage, fmt.Sprintf("管理员将用户额度从 %s修改为 %s", logger.LogQuota(originUser.Quota), logger.LogQuota(updatedUser.Quota)))
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
	})
	return
}

func AdminClearUserBinding(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}

	bindingType := strings.ToLower(strings.TrimSpace(c.Param("binding_type")))
	if bindingType == "" {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}

	// Tenant gate: verify target user belongs to current tenant
	if err := model.RequireTenantMembership(middleware.GetTenantId(c), id, c.GetInt("platform_role")); err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}

	user, err := model.GetUserByIdWithContext(c, id, false)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if err := model.ApplyMembershipViewToUser(middleware.GetTenantId(c), user); err != nil {
		common.ApiError(c, err)
		return
	}

	myRole := c.GetInt("role")
	if myRole <= user.Role && myRole != common.RoleRootUser {
		common.ApiErrorI18n(c, i18n.MsgUserNoPermissionSameLevel)
		return
	}

	// Use user's actual TenantId (not current tenant) for the DB update,
	// since guest members have a different home tenant_id
	if err := user.ClearBinding(bindingType); err != nil {
		common.ApiError(c, err)
		return
	}

	model.RecordLogCtx(c, user.Id, model.LogTypeManage, fmt.Sprintf("admin cleared %s binding for user %s", bindingType, user.Username))

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "success",
	})
}

func UpdateSelf(c *gin.Context) {
	var requestData map[string]interface{}
	err := json.NewDecoder(c.Request.Body).Decode(&requestData)
	if err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}

	// 检查是否是用户设置更新请求 (sidebar_modules 或 language)
	if sidebarModules, sidebarExists := requestData["sidebar_modules"]; sidebarExists {
		userId := c.GetInt("id")
		user, err := model.GetUserByIdWithContext(c, userId, false)
		if err != nil {
			common.ApiError(c, err)
			return
		}

		// 获取当前用户设置
		currentSetting := user.GetSetting()

		// 更新sidebar_modules字段
		if sidebarModulesStr, ok := sidebarModules.(string); ok {
			currentSetting.SidebarModules = sidebarModulesStr
		}

		// 保存更新后的设置
		user.SetSetting(currentSetting)
		if err := user.Update(false); err != nil {
			common.ApiErrorI18n(c, i18n.MsgUpdateFailed)
			return
		}

		common.ApiSuccessI18n(c, i18n.MsgUpdateSuccess, nil)
		return
	}

	// 检查是否是语言偏好更新请求
	if language, langExists := requestData["language"]; langExists {
		userId := c.GetInt("id")
		user, err := model.GetUserByIdWithContext(c, userId, false)
		if err != nil {
			common.ApiError(c, err)
			return
		}

		// 获取当前用户设置
		currentSetting := user.GetSetting()

		// 更新language字段
		if langStr, ok := language.(string); ok {
			currentSetting.Language = langStr
		}

		// 保存更新后的设置
		user.SetSetting(currentSetting)
		if err := user.Update(false); err != nil {
			common.ApiErrorI18n(c, i18n.MsgUpdateFailed)
			return
		}

		common.ApiSuccessI18n(c, i18n.MsgUpdateSuccess, nil)
		return
	}

	// 原有的用户信息更新逻辑
	var user model.User
	requestDataBytes, err := json.Marshal(requestData)
	if err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	err = json.Unmarshal(requestDataBytes, &user)
	if err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}

	if user.Password == "" {
		user.Password = "$I_LOVE_U" // make Validator happy :)
	}
	if err := common.Validate.Struct(&user); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidInput)
		return
	}

	userTenantId, err := model.GetUserTenantId(c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}

	cleanUser := model.User{
		Id:          c.GetInt("id"),
		TenantId:    userTenantId,
		Username:    user.Username,
		Password:    user.Password,
		DisplayName: user.DisplayName,
	}
	if user.Password == "$I_LOVE_U" {
		user.Password = "" // rollback to what it should be
		cleanUser.Password = ""
	}
	updatePassword, err := checkUpdatePassword(c, user.OriginalPassword, user.Password, cleanUser.Id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if err := cleanUser.Update(updatePassword); err != nil {
		common.ApiError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
	})
	return
}

func checkUpdatePassword(c *gin.Context, originalPassword string, newPassword string, userId int) (updatePassword bool, err error) {
	// 没有新密码，不需要验证原密码，直接跳过
	if newPassword == "" {
		return
	}

	var currentUser *model.User
	currentUser, err = model.GetUserByIdWithContext(c, userId, true)
	if err != nil {
		return
	}

	// 密码不为空,需要验证原密码
	// 支持第一次账号绑定时原密码为空的情况
	if !common.ValidatePasswordAndHash(originalPassword, currentUser.Password) && currentUser.Password != "" {
		err = fmt.Errorf("原密码错误")
		return
	}
	updatePassword = true
	return
}

func DeleteUser(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	// Tenant gate: verify target user belongs to current tenant
	if err := model.RequireTenantMembership(middleware.GetTenantId(c), id, c.GetInt("platform_role")); err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	originUser, err := model.GetUserByIdWithContext(c, id, false)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if err := model.ApplyMembershipViewToUser(middleware.GetTenantId(c), originUser); err != nil {
		common.ApiError(c, err)
		return
	}
	myRole := c.GetInt("role")
	if myRole <= originUser.Role {
		common.ApiErrorI18n(c, i18n.MsgUserNoPermissionHigherLevel)
		return
	}
	tenantId := middleware.GetTenantId(c)
	platformRole := c.GetInt("platform_role")
	if platformRole >= common.RoleRootUser {
		// Platform root: hard delete the user globally
		err = model.HardDeleteUserByIdWithTenant(id, 0)
		if err != nil {
			common.ApiError(c, err)
			return
		}
	} else {
		// Tenant admin: remove membership, don't delete the global user
		err = model.RemoveTenantMembership(tenantId, id)
		if err != nil {
			common.ApiError(c, err)
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
	})
}

func DeleteSelf(c *gin.Context) {
	id := c.GetInt("id")
	user, _ := model.GetUserByIdWithContext(c, id, false)

	if user.Role == common.RoleRootUser {
		common.ApiErrorI18n(c, i18n.MsgUserCannotDeleteRootUser)
		return
	}

	tenantId := middleware.GetTenantId(c)
	// Check if user's home tenant matches current tenant
	if user.TenantId == tenantId {
		// Home tenant — actually delete the user
		err := model.DeleteUserByIdWithTenant(id, tenantId)
		if err != nil {
			common.ApiError(c, err)
			return
		}
	} else {
		// Guest membership — just remove from current tenant
		err := model.RemoveTenantMembership(tenantId, id)
		if err != nil {
			common.ApiError(c, err)
			return
		}
	}
	// Clear session
	session := sessions.Default(c)
	session.Clear()
	_ = session.Save()
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
	})
	return
}

func CreateUser(c *gin.Context) {
	var user model.User
	err := json.NewDecoder(c.Request.Body).Decode(&user)
	user.Username = strings.TrimSpace(user.Username)
	if err != nil || user.Username == "" || user.Password == "" {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	if err := common.Validate.Struct(&user); err != nil {
		common.ApiErrorI18n(c, i18n.MsgUserInputInvalid, map[string]any{"Error": err.Error()})
		return
	}
	if user.DisplayName == "" {
		user.DisplayName = user.Username
	}
	myRole := c.GetInt("role")
	requestedTenantRole := model.TenantRoleMember
	if user.Role >= common.RoleAdminUser {
		requestedTenantRole = model.TenantRoleAdmin
	}
	if model.EffectiveRole(common.RoleCommonUser, requestedTenantRole) >= myRole {
		common.ApiErrorI18n(c, i18n.MsgUserCannotCreateHigherLevel)
		return
	}
	// Even for admin users, we cannot fully trust them!
	cleanUser := model.User{
		TenantId:    middleware.GetTenantId(c),
		Username:    user.Username,
		Password:    user.Password,
		DisplayName: user.DisplayName,
		Role:        common.RoleCommonUser,
	}
	if err := cleanUser.Insert(0); err != nil {
		common.ApiError(c, err)
		return
	}
	if err := model.EnsureTenantMembership(cleanUser.Id, cleanUser.TenantId, requestedTenantRole, c.GetInt("id")); err != nil {
		common.ApiError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
	})
	return
}

type ManageRequest struct {
	Id     int    `json:"id"`
	Action string `json:"action"`
}

// ManageUser Only admin user can do this
func ManageUser(c *gin.Context) {
	var req ManageRequest
	err := json.NewDecoder(c.Request.Body).Decode(&req)

	if err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	tenantId := middleware.GetTenantId(c)
	platformRole := c.GetInt("platform_role")
	// Tenant gate: verify target user belongs to current tenant
	if err := model.RequireTenantMembership(tenantId, req.Id, platformRole); err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	var user model.User
	{
		q := model.DB.Unscoped()
		if platformRole >= common.RoleRootUser {
			q = model.WithTenantBypass(q)
		} else {
			q = q.Where("tenant_id = ?", tenantId)
		}
		_ = q.Where("id = ?", req.Id).First(&user).Error
	}
	if user.Id == 0 {
		common.ApiErrorI18n(c, i18n.MsgUserNotExists)
		return
	}
	if err := model.ApplyMembershipViewToUser(middleware.GetTenantId(c), &user); err != nil {
		common.ApiError(c, err)
		return
	}
	myRole := c.GetInt("role")
	if myRole <= user.Role && myRole != common.RoleRootUser {
		common.ApiErrorI18n(c, i18n.MsgUserNoPermissionHigherLevel)
		return
	}
	switch req.Action {
	case "disable":
		user.Status = common.UserStatusDisabled
		if user.Role == common.RoleRootUser {
			common.ApiErrorI18n(c, i18n.MsgUserCannotDisableRootUser)
			return
		}
	case "enable":
		user.Status = common.UserStatusEnabled
	case "delete":
		if user.Role == common.RoleRootUser {
			common.ApiErrorI18n(c, i18n.MsgUserCannotDeleteRootUser)
			return
		}
	case "promote":
		if user.Role >= common.RoleAdminUser {
			common.ApiErrorI18n(c, i18n.MsgUserAlreadyAdmin)
			return
		}
		if err := model.UpdateTenantMembershipRole(middleware.GetTenantId(c), user.Id, model.TenantRoleAdmin); err != nil {
			common.ApiError(c, err)
			return
		}
		user.Role = common.RoleAdminUser
	case "demote":
		if user.Role == common.RoleRootUser {
			common.ApiErrorI18n(c, i18n.MsgUserCannotDemoteRootUser)
			return
		}
		if user.Role == common.RoleCommonUser {
			common.ApiErrorI18n(c, i18n.MsgUserAlreadyCommon)
			return
		}
		if err := model.UpdateTenantMembershipRole(middleware.GetTenantId(c), user.Id, model.TenantRoleMember); err != nil {
			common.ApiError(c, err)
			return
		}
		if user.Role < common.RoleAdminUser {
			user.Role = common.RoleCommonUser
		}
	}

	if req.Action == "disable" || req.Action == "enable" || req.Action == "delete" {
		membershipStatus := model.TenantMembershipStatusActive
		switch req.Action {
		case "disable":
			membershipStatus = model.TenantMembershipStatusDisabled
		case "delete":
			membershipStatus = model.TenantMembershipStatusRemoved
		}
		if err := model.UpdateTenantMembershipStatus(middleware.GetTenantId(c), user.Id, membershipStatus); err != nil {
			common.ApiError(c, err)
			return
		}
	}

	if req.Action == "disable" || req.Action == "enable" {
		var platformUser model.User
		pq := model.DB
		if platformRole >= common.RoleRootUser {
			pq = model.WithTenantBypass(pq)
		} else {
			pq = pq.Where("tenant_id = ?", tenantId)
		}
		if err := pq.Where("id = ?", user.Id).First(&platformUser).Error; err != nil {
			common.ApiError(c, err)
			return
		}
		platformUser.Status = user.Status
		user = platformUser
		if err := user.Update(false); err != nil {
			common.ApiError(c, err)
			return
		}
	}
	if req.Action == "promote" || req.Action == "demote" {
		var current model.User
		cq := model.DB
		if platformRole >= common.RoleRootUser {
			cq = model.WithTenantBypass(cq)
		} else {
			cq = cq.Where("tenant_id = ?", tenantId)
		}
		if err := cq.Omit("password").Where("id = ?", user.Id).First(&current).Error; err == nil {
			user = current
			_ = model.ApplyMembershipViewToUser(tenantId, &user)
		}
	}
	clearUser := model.User{
		Role:   user.Role,
		Status: user.Status,
	}
	if req.Action == "delete" {
		common.ApiSuccess(c, clearUser)
		return
	}
	if err := model.ApplyMembershipViewToUser(middleware.GetTenantId(c), &user); err != nil {
		common.ApiError(c, err)
		return
	}
	clearUser.Role = user.Role
	clearUser.Status = user.Status
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    clearUser,
	})
	return
}

type emailBindRequest struct {
	Email string `json:"email"`
	Code  string `json:"code"`
}

func EmailBind(c *gin.Context) {
	var req emailBindRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiError(c, errors.New("invalid request body"))
		return
	}
	email := req.Email
	code := req.Code
	if !common.VerifyCodeWithKey(email, code, common.EmailVerificationPurpose) {
		common.ApiErrorI18n(c, i18n.MsgUserVerificationCodeError)
		return
	}
	session := sessions.Default(c)
	id := session.Get("id")
	user, err := model.GetUserByIdWithContext(c, id.(int), true)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	// 邮箱存储为小写，确保大小写不敏感
	user.Email = strings.ToLower(email)
	// no need to check if this email already taken, because we have used verification code to check it
	err = user.Update(false)
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

type topUpRequest struct {
	Key string `json:"key"`
}

var topUpLocks sync.Map
var topUpCreateLock sync.Mutex

type topUpTryLock struct {
	ch chan struct{}
}

func newTopUpTryLock() *topUpTryLock {
	return &topUpTryLock{ch: make(chan struct{}, 1)}
}

func (l *topUpTryLock) TryLock() bool {
	select {
	case l.ch <- struct{}{}:
		return true
	default:
		return false
	}
}

func (l *topUpTryLock) Unlock() {
	select {
	case <-l.ch:
	default:
	}
}

func getTopUpLock(userID int) *topUpTryLock {
	if v, ok := topUpLocks.Load(userID); ok {
		return v.(*topUpTryLock)
	}
	topUpCreateLock.Lock()
	defer topUpCreateLock.Unlock()
	if v, ok := topUpLocks.Load(userID); ok {
		return v.(*topUpTryLock)
	}
	l := newTopUpTryLock()
	topUpLocks.Store(userID, l)
	return l
}

func TopUp(c *gin.Context) {
	id := c.GetInt("id")
	lock := getTopUpLock(id)
	if !lock.TryLock() {
		common.ApiErrorI18n(c, i18n.MsgUserTopUpProcessing)
		return
	}
	defer lock.Unlock()
	req := topUpRequest{}
	err := c.ShouldBindJSON(&req)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	quota, err := model.Redeem(req.Key, id)
	if err != nil {
		if errors.Is(err, model.ErrRedeemFailed) {
			common.ApiErrorI18n(c, i18n.MsgRedeemFailed)
			return
		}
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    quota,
	})
}

type UpdateUserSettingRequest struct {
	QuotaWarningType                 string  `json:"notify_type"`
	QuotaWarningThreshold            float64 `json:"quota_warning_threshold"`
	WebhookUrl                       string  `json:"webhook_url,omitempty"`
	WebhookSecret                    string  `json:"webhook_secret,omitempty"`
	NotificationEmail                string  `json:"notification_email,omitempty"`
	BarkUrl                          string  `json:"bark_url,omitempty"`
	GotifyUrl                        string  `json:"gotify_url,omitempty"`
	GotifyToken                      string  `json:"gotify_token,omitempty"`
	GotifyPriority                   int     `json:"gotify_priority,omitempty"`
	UpstreamModelUpdateNotifyEnabled *bool   `json:"upstream_model_update_notify_enabled,omitempty"`
	AcceptUnsetModelRatioModel       bool    `json:"accept_unset_model_ratio_model"`
	RecordIpLog                      bool    `json:"record_ip_log"`
}

func UpdateUserSetting(c *gin.Context) {
	var req UpdateUserSettingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}

	// 验证预警类型
	if req.QuotaWarningType != dto.NotifyTypeEmail && req.QuotaWarningType != dto.NotifyTypeWebhook && req.QuotaWarningType != dto.NotifyTypeBark && req.QuotaWarningType != dto.NotifyTypeGotify {
		common.ApiErrorI18n(c, i18n.MsgSettingInvalidType)
		return
	}

	// 验证预警阈值
	if req.QuotaWarningThreshold <= 0 {
		common.ApiErrorI18n(c, i18n.MsgQuotaThresholdGtZero)
		return
	}

	// 如果是webhook类型,验证webhook地址
	if req.QuotaWarningType == dto.NotifyTypeWebhook {
		if req.WebhookUrl == "" {
			common.ApiErrorI18n(c, i18n.MsgSettingWebhookEmpty)
			return
		}
		// 验证URL格式
		if _, err := url.ParseRequestURI(req.WebhookUrl); err != nil {
			common.ApiErrorI18n(c, i18n.MsgSettingWebhookInvalid)
			return
		}
	}

	// 如果是邮件类型，验证邮箱地址
	if req.QuotaWarningType == dto.NotifyTypeEmail && req.NotificationEmail != "" {
		// 验证邮箱格式
		if !strings.Contains(req.NotificationEmail, "@") {
			common.ApiErrorI18n(c, i18n.MsgSettingEmailInvalid)
			return
		}
	}

	// 如果是Bark类型，验证Bark URL
	if req.QuotaWarningType == dto.NotifyTypeBark {
		if req.BarkUrl == "" {
			common.ApiErrorI18n(c, i18n.MsgSettingBarkUrlEmpty)
			return
		}
		// 验证URL格式
		if _, err := url.ParseRequestURI(req.BarkUrl); err != nil {
			common.ApiErrorI18n(c, i18n.MsgSettingBarkUrlInvalid)
			return
		}
		// 检查是否是HTTP或HTTPS
		if !strings.HasPrefix(req.BarkUrl, "https://") && !strings.HasPrefix(req.BarkUrl, "http://") {
			common.ApiErrorI18n(c, i18n.MsgSettingUrlMustHttp)
			return
		}
	}

	// 如果是Gotify类型，验证Gotify URL和Token
	if req.QuotaWarningType == dto.NotifyTypeGotify {
		if req.GotifyUrl == "" {
			common.ApiErrorI18n(c, i18n.MsgSettingGotifyUrlEmpty)
			return
		}
		if req.GotifyToken == "" {
			common.ApiErrorI18n(c, i18n.MsgSettingGotifyTokenEmpty)
			return
		}
		// 验证URL格式
		if _, err := url.ParseRequestURI(req.GotifyUrl); err != nil {
			common.ApiErrorI18n(c, i18n.MsgSettingGotifyUrlInvalid)
			return
		}
		// 检查是否是HTTP或HTTPS
		if !strings.HasPrefix(req.GotifyUrl, "https://") && !strings.HasPrefix(req.GotifyUrl, "http://") {
			common.ApiErrorI18n(c, i18n.MsgSettingUrlMustHttp)
			return
		}
	}

	userId := c.GetInt("id")
	user, err := model.GetUserByIdWithContext(c, userId, true)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	existingSettings := user.GetSetting()
	upstreamModelUpdateNotifyEnabled := existingSettings.UpstreamModelUpdateNotifyEnabled
	if user.Role >= common.RoleAdminUser && req.UpstreamModelUpdateNotifyEnabled != nil {
		upstreamModelUpdateNotifyEnabled = *req.UpstreamModelUpdateNotifyEnabled
	}

	// 构建设置
	settings := dto.UserSetting{
		NotifyType:                       req.QuotaWarningType,
		QuotaWarningThreshold:            req.QuotaWarningThreshold,
		UpstreamModelUpdateNotifyEnabled: upstreamModelUpdateNotifyEnabled,
		AcceptUnsetRatioModel:            req.AcceptUnsetModelRatioModel,
		RecordIpLog:                      req.RecordIpLog,
	}

	// 如果是webhook类型,添加webhook相关设置
	if req.QuotaWarningType == dto.NotifyTypeWebhook {
		settings.WebhookUrl = req.WebhookUrl
		if req.WebhookSecret != "" {
			settings.WebhookSecret = req.WebhookSecret
		}
	}

	// 如果提供了通知邮箱，添加到设置中
	if req.QuotaWarningType == dto.NotifyTypeEmail && req.NotificationEmail != "" {
		settings.NotificationEmail = req.NotificationEmail
	}

	// 如果是Bark类型，添加Bark URL到设置中
	if req.QuotaWarningType == dto.NotifyTypeBark {
		settings.BarkUrl = req.BarkUrl
	}

	// 如果是Gotify类型，添加Gotify配置到设置中
	if req.QuotaWarningType == dto.NotifyTypeGotify {
		settings.GotifyUrl = req.GotifyUrl
		settings.GotifyToken = req.GotifyToken
		// Gotify优先级范围0-10，超出范围则使用默认值5
		if req.GotifyPriority < 0 || req.GotifyPriority > 10 {
			settings.GotifyPriority = 5
		} else {
			settings.GotifyPriority = req.GotifyPriority
		}
	}

	// 更新用户设置
	user.SetSetting(settings)
	if err := user.Update(false); err != nil {
		common.ApiErrorI18n(c, i18n.MsgUpdateFailed)
		return
	}

	common.ApiSuccessI18n(c, i18n.MsgSettingSaved, nil)
}
