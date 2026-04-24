package app

import (
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

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
	app, err := model.GetAiAppBySlug(slug)
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
	app, err := model.GetAiAppBySlug(slug)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": err.Error()})
		return
	}

	userId := c.GetInt("id")
	tenantId := middleware.GetTenantId(c)

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

	app, err := model.GetAiAppBySlug(slug)
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
	Status          int    `json:"status"`
	SortOrder       int    `json:"sort_order"`
	VendorUserId    int    `json:"vendor_user_id"`
	GuestQuota      int    `json:"guest_quota"`
	DefaultGroup    string `json:"default_group"`
	SessionTokenTTL int    `json:"session_token_ttl"`
	Tags            string `json:"tags"`
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

	tenantId := middleware.GetTenantId(c)
	app := &model.AiApp{
		TenantId:        tenantId,
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

	tenantId := middleware.GetTenantId(c)
	app := &model.AiApp{
		Id:              id,
		TenantId:        tenantId,
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

	tenantId := middleware.GetTenantId(c)
	app := &model.AiApp{Id: id, TenantId: tenantId, Status: req.Status}
	if err := app.Update(); err != nil {
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

	tenantId := middleware.GetTenantId(c)
	app := &model.AiApp{Id: id, TenantId: tenantId}
	if err := app.Delete(); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}
