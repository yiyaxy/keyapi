package tenant

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

var (
	slugRegexp     = regexp.MustCompile(`^[a-z0-9][a-z0-9\-]{1,62}[a-z0-9]$`)
	tenantUserRegx = regexp.MustCompile(`^[A-Za-z0-9_\-\.]{1,20}$`)
)

// CreateTenantRequest 走「1 user : 1 tenant = 独立平台」模型：新建租户时必须
// 同时指定该租户的初始 admin 凭据，超管自己不会被加入新租户。
type CreateTenantRequest struct {
	Name          string `json:"name" binding:"required"`
	Slug          string `json:"slug" binding:"required"`
	AdminUsername string `json:"admin_username" binding:"required"`
	AdminPassword string `json:"admin_password" binding:"required"`
	AdminEmail    string `json:"admin_email"`
	AdminDisplay  string `json:"admin_display_name"`
}

type UpdateTenantRequest struct {
	Name   string `json:"name"`
	Status int    `json:"status"`
}

type BatchCreateTenantsRequest struct {
	Count int `json:"count"`
}

type BatchCreateTenantResult struct {
	Tenant        *model.Tenant `json:"tenant"`
	AdminUserId   int           `json:"admin_user_id"`
	AdminUsername string        `json:"admin_username"`
	AdminPassword string        `json:"admin_password"`
}

type ResetTenantAdminPasswordResult struct {
	TenantId      int    `json:"tenant_id"`
	AdminUserId   int    `json:"admin_user_id"`
	AdminUsername string `json:"admin_username"`
	Password      string `json:"password"`
}

// ListAllTenantsHandler 平台级：列出所有租户（不含已删除）。
// 路由：GET /api/platform/tenants
func ListAllTenantsHandler(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	items, total, err := model.ListAllTenants(pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(items)
	common.ApiSuccess(c, pageInfo)
}

func randomHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("%d", common.GetTimestamp())
	}
	return hex.EncodeToString(b)
}

func defaultTenantAdminPassword(username string) string {
	return strings.TrimSpace(username) + "123"
}

func generatedAdminUsername(index int) string {
	return fmt.Sprintf("u%06d%03d%s", common.GetTimestamp()%1000000, index, randomHex(2))
}

func createTenantWithAdminTx(tx *gorm.DB, req CreateTenantRequest, operatorId int) (*model.Tenant, *model.User, error) {
	displayName := strings.TrimSpace(req.AdminDisplay)
	if displayName == "" {
		displayName = req.AdminUsername
	}
	tenant := &model.Tenant{
		Name:   strings.TrimSpace(req.Name),
		Slug:   strings.TrimSpace(req.Slug),
		Status: model.TenantStatusActive,
	}
	adminUser := &model.User{
		TenantId:    tenant.Id,
		Username:    strings.TrimSpace(req.AdminUsername),
		Password:    req.AdminPassword,
		DisplayName: displayName,
		Role:        common.RoleAdminUser,
		Status:      common.UserStatusEnabled,
	}
	if email := strings.TrimSpace(req.AdminEmail); email != "" {
		adminUser.Email = strings.ToLower(email)
	}

	if err := tx.Create(tenant).Error; err != nil {
		return nil, nil, err
	}
	now := common.GetTimestamp()
	plan := &model.TenantPlan{
		TenantId:                 tenant.Id,
		PlanName:                 model.TenantPlanDefaultName,
		QuotaLimit:               -1,
		RPMLimit:                 -1,
		TPMLimit:                 -1,
		MaxMembers:               -1,
		MaxTokens:                -1,
		MaxChannels:              -1,
		Status:                   model.TenantPlanStatusActive,
		ExpiresAt:                0,
		PlatformMarkup:           1.0,
		PlatformQuotaCap:         0,
		PlatformQuotaPeriod:      model.PlatformQuotaPeriodNone,
		PlatformQuotaUsed:        0,
		PlatformQuotaPeriodStart: 0,
		CreatedAt:                now,
		UpdatedAt:                now,
	}
	if err := model.WithTenantBypass(tx).Create(plan).Error; err != nil {
		return nil, nil, err
	}

	adminUser.TenantId = tenant.Id
	if err := adminUser.InsertWithTx(tx, 0); err != nil {
		return nil, nil, err
	}
	membership := &model.TenantMembership{
		TenantId:  tenant.Id,
		UserId:    adminUser.Id,
		Role:      model.TenantRoleAdmin,
		Status:    model.TenantMembershipStatusActive,
		InvitedBy: operatorId,
	}
	if err := model.WithTenantBypass(tx).Create(membership).Error; err != nil {
		return nil, nil, err
	}
	return tenant, adminUser, nil
}

func CreateTenant(c *gin.Context) {
	var req CreateTenantRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "参数错误: name、slug、admin_username、admin_password 为必填项")
		return
	}
	if !slugRegexp.MatchString(req.Slug) {
		common.ApiErrorMsg(c, "slug 格式无效: 仅允许小写字母、数字和连字符，长度3-64")
		return
	}
	if !tenantUserRegx.MatchString(req.AdminUsername) {
		common.ApiErrorMsg(c, "admin_username 格式无效: 仅允许字母、数字、下划线、连字符、点，长度1-20")
		return
	}
	if len(req.AdminPassword) < 8 || len(req.AdminPassword) > 20 {
		common.ApiErrorMsg(c, "admin_password 长度必须在 8-20 之间")
		return
	}
	if existing := model.GetTenantBySlug(req.Slug); existing != nil {
		common.ApiErrorMsg(c, "slug 已被使用")
		return
	}

	// 走法 A：一次性派生该租户的初始 admin。超管不进这份 membership——
	// 跨租户管理走平台级 RoleRootUser 权限，不靠成员关系。
	displayName := strings.TrimSpace(req.AdminDisplay)
	if displayName == "" {
		displayName = req.AdminUsername
	}
	tenant := &model.Tenant{
		Name:   req.Name,
		Slug:   req.Slug,
		Status: model.TenantStatusActive,
	}
	adminUser := model.User{
		TenantId:    tenant.Id, // 现在还是 0；在 tx 里 tenant.Create 后再赋值
		Username:    req.AdminUsername,
		Password:    req.AdminPassword, // InsertWithTx 会做 bcrypt
		DisplayName: displayName,
		Role:        common.RoleAdminUser,
		Status:      common.UserStatusEnabled,
	}
	if email := strings.TrimSpace(req.AdminEmail); email != "" {
		adminUser.Email = strings.ToLower(email)
	}
	operatorId := c.GetInt("id")

	// 4 步写库（tenant / plan / admin user / membership）原子化：
	// 任一步失败整单回滚，避免留下「slug 占用但没有可登录 admin」的半成品。
	// 失败后 UI 可以直接用原 slug 重试。
	txErr := model.DB.Transaction(func(tx *gorm.DB) error {
		// 1. tenant 本体（tenants 不在 tenant-scoped 表里，guardrail 不插手）
		if err := tx.Create(tenant).Error; err != nil {
			return err
		}

		// 2. 默认 free plan。内联 GetTenantPlan 的默认字段，避免它用全局 DB
		// 绕过当前 tx 导致部分提交。
		now := common.GetTimestamp()
		plan := &model.TenantPlan{
			TenantId:                 tenant.Id,
			PlanName:                 model.TenantPlanDefaultName,
			QuotaLimit:               -1,
			RPMLimit:                 -1,
			TPMLimit:                 -1,
			MaxMembers:               -1,
			MaxTokens:                -1,
			MaxChannels:              -1,
			Status:                   model.TenantPlanStatusActive,
			ExpiresAt:                0,
			PlatformMarkup:           1.0,
			PlatformQuotaCap:         0,
			PlatformQuotaPeriod:      model.PlatformQuotaPeriodNone,
			PlatformQuotaUsed:        0,
			PlatformQuotaPeriodStart: 0,
			CreatedAt:                now,
			UpdatedAt:                now,
		}
		if err := model.WithTenantBypass(tx).Create(plan).Error; err != nil {
			return err
		}

		// 3. 初始 admin。TenantId 在这里绑定到刚建的 tenant.Id 上。
		adminUser.TenantId = tenant.Id
		if err := adminUser.InsertWithTx(tx, 0); err != nil {
			return err
		}

		// 4. membership。新建 user 肯定没 prior membership，直接 INSERT
		// 不需要走 EnsureTenantMembership 的 upsert 分支。
		membership := &model.TenantMembership{
			TenantId:  tenant.Id,
			UserId:    adminUser.Id,
			Role:      model.TenantRoleAdmin,
			Status:    model.TenantMembershipStatusActive,
			InvitedBy: operatorId,
		}
		if err := model.WithTenantBypass(tx).Create(membership).Error; err != nil {
			return err
		}
		return nil
	})
	if txErr != nil {
		common.ApiError(c, txErr)
		return
	}

	// Post-commit 副作用：sidebar 配置、新用户赠额日志等。InsertWithTx 把
	// 这些挪到 tx 外，避免 tx 里写 log_db（可能是另一条连接）失败后回滚掉
	// 用户创建——日志能掉一次可以接受，admin 账号不能丢。
	adminUser.FinalizeOAuthUserCreation(0)

	// 清 tenant slug/id 的进程内缓存，避免 GetTenantBySlug 刚建完读不到。
	model.ClearTenantCache()

	common.ApiSuccess(c, gin.H{
		"tenant":         tenant,
		"admin_user_id":  adminUser.Id,
		"admin_username": adminUser.Username,
	})
}

func generatedTenantSlug(tx *gorm.DB, index int) (string, error) {
	for attempt := 0; attempt < 8; attempt++ {
		slug := fmt.Sprintf("tenant-%d-%03d-%s", common.GetTimestamp(), index, randomHex(2))
		var count int64
		if err := tx.Model(&model.Tenant{}).Where("slug = ?", slug).Count(&count).Error; err != nil {
			return "", err
		}
		if count == 0 {
			return slug, nil
		}
	}
	return "", fmt.Errorf("failed to generate unique tenant slug")
}

func BatchCreateTenants(c *gin.Context) {
	var req BatchCreateTenantsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	if req.Count <= 0 || req.Count > 100 {
		common.ApiErrorMsg(c, "批量生成数量必须在 1-100 之间")
		return
	}

	operatorId := c.GetInt("id")
	results := make([]BatchCreateTenantResult, 0, req.Count)
	adminUsers := make([]*model.User, 0, req.Count)
	txErr := model.DB.Transaction(func(tx *gorm.DB) error {
		for i := 1; i <= req.Count; i++ {
			slug, err := generatedTenantSlug(tx, i)
			if err != nil {
				return err
			}
			adminUsername := generatedAdminUsername(i)
			password := defaultTenantAdminPassword(adminUsername)
			createReq := CreateTenantRequest{
				Name:          fmt.Sprintf("自动租户 %s", slug),
				Slug:          slug,
				AdminUsername: adminUsername,
				AdminPassword: password,
				AdminDisplay:  "租户管理员",
			}
			tenant, adminUser, err := createTenantWithAdminTx(tx, createReq, operatorId)
			if err != nil {
				return err
			}
			results = append(results, BatchCreateTenantResult{
				Tenant:        tenant,
				AdminUserId:   adminUser.Id,
				AdminUsername: adminUser.Username,
				AdminPassword: password,
			})
			adminUsers = append(adminUsers, adminUser)
		}
		return nil
	})
	if txErr != nil {
		common.ApiError(c, txErr)
		return
	}

	for _, adminUser := range adminUsers {
		adminUser.FinalizeOAuthUserCreation(0)
	}
	model.ClearTenantCache()
	common.ApiSuccess(c, gin.H{
		"items": results,
		"total": len(results),
	})
}

func ResetTenantAdminPassword(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorMsg(c, "无效的租户 ID")
		return
	}
	var adminUser model.User
	err = model.WithTenantBypass(model.DB).
		Table("tenant_memberships AS tm").
		Select("u.*").
		Joins("JOIN users u ON u.id = tm.user_id").
		Where("tm.tenant_id = ? AND tm.role = ? AND tm.status <> ?", id, model.TenantRoleAdmin, model.TenantMembershipStatusRemoved).
		Order("tm.id ASC").
		Limit(1).
		Scan(&adminUser).Error
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if adminUser.Id <= 0 || strings.TrimSpace(adminUser.Username) == "" {
		if err := model.WithTenantBypass(model.DB).
			Where("tenant_id = ? AND role >= ? AND status = ?", id, model.TenantRoleAdmin, common.UserStatusEnabled).
			Order("id ASC").
			First(&adminUser).Error; err != nil {
			common.ApiErrorMsg(c, "未找到该租户的管理员账号")
			return
		}
	}
	password := defaultTenantAdminPassword(adminUser.Username)
	hashedPassword, err := common.Password2Hash(password)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if err := model.WithTenantBypass(model.DB).
		Model(&model.User{}).
		Where("id = ? AND tenant_id = ?", adminUser.Id, id).
		Update("password", hashedPassword).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, ResetTenantAdminPasswordResult{
		TenantId:      id,
		AdminUserId:   adminUser.Id,
		AdminUsername: adminUser.Username,
		Password:      password,
	})
}

func UpdateTenantByPlatform(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorMsg(c, "无效的租户 ID")
		return
	}
	var req UpdateTenantRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	updates := make(map[string]interface{})
	if strings.TrimSpace(req.Name) != "" {
		updates["name"] = strings.TrimSpace(req.Name)
	}
	if req.Status != 0 {
		if req.Status != model.TenantStatusActive && req.Status != model.TenantStatusSuspended {
			common.ApiErrorMsg(c, "租户状态只能设置为正常或暂停")
			return
		}
		if id == model.DefaultTenantId && req.Status == model.TenantStatusSuspended {
			common.ApiErrorMsg(c, "不能禁用默认租户")
			return
		}
		updates["status"] = req.Status
	}
	if len(updates) == 0 {
		common.ApiErrorMsg(c, "没有需要更新的字段")
		return
	}
	if err := model.UpdateTenant(id, updates); err != nil {
		common.ApiError(c, err)
		return
	}
	model.ClearTenantCache()
	var updated model.Tenant
	if err := model.DB.Where("id = ? AND status <> ?", id, model.TenantStatusDeleted).First(&updated).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, updated)
}

func UpdateTenant(c *gin.Context) {
	var req UpdateTenantRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	tenantId := middleware.GetTenantId(c)
	tenant := model.GetTenantById(tenantId)
	if tenant == nil {
		common.ApiErrorMsg(c, "租户不存在")
		return
	}
	updates := make(map[string]interface{})
	if req.Name != "" {
		updates["name"] = req.Name
	}
	if req.Status != 0 {
		updates["status"] = req.Status
	}
	if len(updates) == 0 {
		common.ApiErrorMsg(c, "没有需要更新的字段")
		return
	}
	if err := model.UpdateTenant(tenantId, updates); err != nil {
		common.ApiError(c, err)
		return
	}
	model.ClearTenantCache()
	updated := model.GetTenantById(tenantId)
	common.ApiSuccess(c, updated)
}

func DeleteTenant(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorMsg(c, "无效的租户 ID")
		return
	}
	if id == model.DefaultTenantId {
		common.ApiErrorMsg(c, "不能删除默认租户")
		return
	}
	if err := model.UpdateTenant(id, map[string]interface{}{
		"status": model.TenantStatusDeleted,
	}); err != nil {
		common.ApiError(c, err)
		return
	}
	// Remove all memberships for the deleted tenant
	if err := model.RemoveAllTenantMemberships(id); err != nil {
		common.ApiError(c, err)
		return
	}
	model.ClearTenantCache()
	model.InvalidateTenantPlanCache(id)
	common.ApiSuccess(c, nil)
}

func GetTenant(c *gin.Context) {
	tenantId := middleware.GetTenantId(c)
	tenant := model.GetTenantById(tenantId)
	if tenant == nil {
		common.ApiErrorMsg(c, "租户不存在")
		return
	}
	common.ApiSuccess(c, tenant)
}
