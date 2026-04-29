package app

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

// ─── Identity Bridge ─────────────────────────────────────────────────────────

// WhoAmI GET /api/app/whoami — 用 sk-token 换取对应用户信息，供 LobeHub 自动登录使用。
// 使用 TokenAuth 中间件，sk- token 必须有效且未过期。
func WhoAmI(c *gin.Context) {
	userId := c.GetInt("id")
	if userId <= 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "invalid token"})
		return
	}

	user, err := model.GetUserById(userId, false)
	if err != nil || user == nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "user not found"})
		return
	}

	tenantId := middleware.GetTenantId(c)
	common.ApiSuccess(c, gin.H{
		"id":           user.Id,
		"username":     user.Username,
		"email":        user.Email,
		"display_name": user.DisplayName,
		"tenant_id":    tenantId,
	})
}

// ─── Public API ──────────────────────────────────────────────────────────────

// ListApps GET /api/app — returns all published apps for the current tenant.
func ListApps(c *gin.Context) {
	tenantId := middleware.GetTenantId(c)
	apps, err := model.GetAllOnlineAiApps(tenantId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, apps)
}

// GetApp GET /api/app/:slug — public detail for a single app.
func GetApp(c *gin.Context) {
	slug := c.Param("slug")
	tenantId := middleware.GetTenantId(c)
	app, err := model.GetAiAppBySlug(slug, tenantId)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": err.Error()})
		return
	}
	common.ApiSuccess(c, app)
}

// GetSessionToken POST /api/app/:slug/session — for authenticated users.
// Returns a short-lived token scoped to the app.
func GetSessionToken(c *gin.Context) {
	slug := c.Param("slug")
	tenantId := middleware.GetTenantId(c)
	app, err := model.GetAiAppBySlug(slug, tenantId)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": err.Error()})
		return
	}

	userId := c.GetInt("id")

	token, err := model.GenerateSessionTokenForApp(app, userId, tenantId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{
		"key":          "sk-" + token.Key,
		"expired_time": token.ExpiredTime,
		"app_id":       app.Id,
	})
}

// GetGuestToken POST /api/app/:slug/guest-session — for anonymous visitors.
// Only works when app.GuestQuota > 0.
func GetGuestToken(c *gin.Context) {
	slug := c.Param("slug")
	tenantId := middleware.GetTenantId(c)

	app, err := model.GetAiAppBySlug(slug, tenantId)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": err.Error()})
		return
	}
	if app.GuestQuota <= 0 {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "此应用不支持免登录体验"})
		return
	}

	guestUserId, err := model.GetOrCreateAppGuestUser(tenantId)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	token, err := model.GenerateGuestSessionToken(app, guestUserId, tenantId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{
		"key":          "sk-" + token.Key,
		"expired_time": token.ExpiredTime,
		"quota":        app.GuestQuota,
	})
}

// ─── Admin API ───────────────────────────────────────────────────────────────

type upsertAppRequest struct {
	Name            string `json:"name"`
	Slug            string `json:"slug"`
	Description     string `json:"description"`
	IconUrl         string `json:"icon_url"`
	TargetUrl       string `json:"target_url"`
	Scope           string `json:"scope"` // "platform" / "tenant"，留空默认 tenant
	Status          int    `json:"status"`
	SortOrder       int    `json:"sort_order"`
	VendorUserId    int    `json:"vendor_user_id"`
	GuestQuota      int    `json:"guest_quota"`
	DefaultGroup    string `json:"default_group"`
	SessionTokenTTL int    `json:"session_token_ttl"`
	Tags            string `json:"tags"`
}

// resolveAppScope 根据请求体里的 scope 字段、当前用户 platform_role 和当前租户，
// 计算出这条 app 应当落库的 (scope, tenant_id)，并对越权请求返回 error 字符串。
//
// 规则：
//   - scope == "platform"：必须 platform_role >= RoleRootUser，落库 tenant_id=0
//   - scope == "tenant" 或留空：落库 tenant_id = 当前租户
func resolveAppScope(c *gin.Context, scope string) (resolvedScope string, tenantId int, errMsg string) {
	scope = strings.TrimSpace(scope)
	if scope == "" {
		scope = model.AiAppScopeTenant
	}
	switch scope {
	case model.AiAppScopePlatform:
		role := c.GetInt("platform_role")
		if role < common.RoleRootUser {
			return "", 0, "只有平台超管可以创建/修改平台应用"
		}
		return model.AiAppScopePlatform, 0, ""
	case model.AiAppScopeTenant:
		return model.AiAppScopeTenant, middleware.GetTenantId(c), ""
	default:
		return "", 0, "invalid scope"
	}
}

// authorizeAppMutation 对一条已存在的 app 做"修改/删除"鉴权：
//   - 平台 scope 应用：必须 platform_role >= RoleRootUser
//   - 租户 scope 应用：必须 app.TenantId == 当前租户
func authorizeAppMutation(c *gin.Context, app *model.AiApp) string {
	if app.Scope == model.AiAppScopePlatform {
		if c.GetInt("platform_role") < common.RoleRootUser {
			return "只有平台超管可以操作平台应用"
		}
		return ""
	}
	if app.TenantId != middleware.GetTenantId(c) {
		return "无权操作其他租户的应用"
	}
	return ""
}

// AdminListApps GET /api/admin/app — paginated list (all statuses).
func AdminListApps(c *gin.Context) {
	tenantId := middleware.GetTenantId(c)
	page, _ := strconv.Atoi(c.DefaultQuery("p", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	offset := (page - 1) * pageSize

	apps, total, err := model.ListAiAppsForAdmin(tenantId, offset, pageSize)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{
		"items": apps,
		"total": total,
	})
}

// AdminGetApp GET /api/admin/app/:id — get single app by ID.
//
// 鉴权：
//   - 平台 scope：所有租户管理员都可以查看（详情公开）
//   - 租户 scope：必须是该租户的管理员；platform_role >= Root 可跨租户查看
func AdminGetApp(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorMsg(c, "invalid app id")
		return
	}
	app, err := model.GetAiAppById(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "应用不存在"})
		return
	}
	if app.Scope == model.AiAppScopeTenant &&
		app.TenantId != middleware.GetTenantId(c) &&
		c.GetInt("platform_role") < common.RoleRootUser {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "无权查看其他租户的应用"})
		return
	}
	common.ApiSuccess(c, app)
}

// AdminCreateApp POST /api/admin/app — create a new app.
func AdminCreateApp(c *gin.Context) {
	var req upsertAppRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "invalid request parameters")
		return
	}
	if req.Name == "" || req.Slug == "" || req.TargetUrl == "" {
		common.ApiErrorMsg(c, "name, slug and target_url are required")
		return
	}

	scope, tenantId, errMsg := resolveAppScope(c, req.Scope)
	if errMsg != "" {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": errMsg})
		return
	}
	app := &model.AiApp{
		TenantId:        tenantId,
		Scope:           scope,
		Name:            req.Name,
		Slug:            req.Slug,
		Description:     req.Description,
		IconUrl:         req.IconUrl,
		TargetUrl:       req.TargetUrl,
		Status:          req.Status,
		SortOrder:       req.SortOrder,
		VendorUserId:    req.VendorUserId,
		GuestQuota:      req.GuestQuota,
		DefaultGroup:    req.DefaultGroup,
		SessionTokenTTL: req.SessionTokenTTL,
		Tags:            req.Tags,
	}
	if app.SessionTokenTTL <= 0 {
		app.SessionTokenTTL = 86400
	}

	if err := app.Insert(); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, app)
}

// AdminUpdateApp PUT /api/admin/app/:id — update an existing app.
func AdminUpdateApp(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorMsg(c, "invalid app id")
		return
	}

	var req upsertAppRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "invalid request parameters")
		return
	}

	existing, err := model.GetAiAppById(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "应用不存在"})
		return
	}
	if msg := authorizeAppMutation(c, existing); msg != "" {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": msg})
		return
	}

	app := &model.AiApp{
		Id:              id,
		TenantId:        existing.TenantId,
		Scope:           existing.Scope,
		Name:            req.Name,
		Slug:            req.Slug,
		Description:     req.Description,
		IconUrl:         req.IconUrl,
		TargetUrl:       req.TargetUrl,
		Status:          req.Status,
		SortOrder:       req.SortOrder,
		VendorUserId:    req.VendorUserId,
		GuestQuota:      req.GuestQuota,
		DefaultGroup:    req.DefaultGroup,
		SessionTokenTTL: req.SessionTokenTTL,
		Tags:            req.Tags,
	}
	if err := app.Update(); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, app)
}

// AdminUpdateAppStatus PATCH /api/admin/app/:id/status — toggle status.
func AdminUpdateAppStatus(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorMsg(c, "invalid app id")
		return
	}

	var req struct {
		Status int `json:"status"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "invalid request parameters")
		return
	}

	existing, err := model.GetAiAppById(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "应用不存在"})
		return
	}
	if msg := authorizeAppMutation(c, existing); msg != "" {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": msg})
		return
	}

	existing.Status = req.Status
	if err := existing.Update(); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

// AdminDeleteApp DELETE /api/admin/app/:id — soft-delete an app.
func AdminDeleteApp(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorMsg(c, "invalid app id")
		return
	}

	existing, err := model.GetAiAppById(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "应用不存在"})
		return
	}
	if msg := authorizeAppMutation(c, existing); msg != "" {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": msg})
		return
	}

	if err := existing.Delete(); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}
