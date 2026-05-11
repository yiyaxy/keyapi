package model

import (
	"errors"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

// guestUserCache avoids repeated DB lookups per tenant.
var (
	guestUserCache   = map[int]int{} // tenantId -> userId
	guestUserCacheMu sync.Mutex
)

// GetOrCreateAppGuestUser returns the ID of the dedicated anonymous-visitor
// account for the given tenant, creating it if it does not yet exist.
// The account has a large initial quota so it can absorb guest-session charges.
func GetOrCreateAppGuestUser(tenantId int) (int, error) {
	if tenantId <= 0 {
		return 0, errors.New("invalid tenantId")
	}
	guestUserCacheMu.Lock()
	defer guestUserCacheMu.Unlock()

	if id, ok := guestUserCache[tenantId]; ok {
		return id, nil
	}

	const guestUsername = "__app_guest__"
	var user User
	err := DB.Where("username = ? AND tenant_id = ?", guestUsername, tenantId).First(&user).Error
	if err == nil {
		guestUserCache[tenantId] = user.Id
		return user.Id, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return 0, err
	}

	// Create the guest user with a large quota (admin can adjust later).
	pwd, err := common.Password2Hash(common.GetUUID())
	if err != nil {
		return 0, err
	}
	newUser := &User{
		TenantId:    tenantId,
		Username:    guestUsername,
		DisplayName: "App Guest",
		Password:    pwd,
		Role:        1, // common user
		Status:      1,
		Quota:       500_000_000, // 500M units; platform admin can topup as needed
		AffCode:     common.GetRandomString(4),
	}
	if err := DB.Create(newUser).Error; err != nil {
		return 0, err
	}
	guestUserCache[tenantId] = newUser.Id
	return newUser.Id, nil
}

// AiApp 表示 AI 应用广场中的一个应用。
// 每个应用有独立的 ID，用于与调用日志绑定，实现三方结算。
type AiApp struct {
	Id          int    `json:"id"`
	TenantId    int    `json:"tenant_id" gorm:"index;not null;default:1"`
	Name        string `json:"name" gorm:"type:varchar(128);not null"`
	Slug        string `json:"slug" gorm:"type:varchar(64);uniqueIndex"` // URL 友好的唯一标识
	Description string `json:"description" gorm:"type:text"`
	IconUrl     string `json:"icon_url" gorm:"type:varchar(512);default:''"`
	TargetUrl   string `json:"target_url" gorm:"type:varchar(512);not null"` // 应用的前端部署地址
	// Scope: "platform" 表示平台官方应用，对所有租户可见；"tenant" 表示仅本租户可见
	Scope string `json:"scope" gorm:"type:varchar(16);not null;default:'tenant';index"`
	// Status: 0=下架, 1=上架, 2=草稿
	Status int `json:"status" gorm:"default:0;index"`
	// SortOrder: 排序权重，越大越靠前
	SortOrder int `json:"sort_order" gorm:"default:0"`
	// VendorUserId: 关联的三方开发者用户 ID（0 表示平台自营）
	VendorUserId int `json:"vendor_user_id" gorm:"default:0;index"`
	// GuestQuota: 未登录用户体验此应用时分配的 quota 数量（0 表示不允许免登录体验）
	GuestQuota int `json:"guest_quota" gorm:"default:0"`
	// DefaultGroup: 生成的临时 token 使用的分组，留空则继承用户当前分组
	DefaultGroup string `json:"default_group" gorm:"type:varchar(64);default:''"`
	// SessionTokenTTL: 生成的临时 Session Token 有效期（秒），默认 86400 = 24h
	SessionTokenTTL int `json:"session_token_ttl" gorm:"default:86400"`
	// Tags: 应用标签，逗号分隔（如 "写作,效率"）
	Tags      string         `json:"tags" gorm:"type:varchar(256);default:''"`
	CreatedAt int64          `json:"created_at" gorm:"bigint;autoCreateTime"`
	UpdatedAt int64          `json:"updated_at" gorm:"bigint;autoUpdateTime"`
	DeletedAt gorm.DeletedAt `gorm:"index"`
}

// ─── 状态常量 ────────────────────────────────────────────────────────────────

const (
	AiAppStatusDraft   = 0 // 草稿 / 下架
	AiAppStatusOnline  = 1 // 已上架
	AiAppStatusArchive = 2 // 已归档（软删除替代）
)

// ─── Scope 常量 ─────────────────────────────────────────────────────────────
//
// AiAppScopePlatform：平台官方应用，所有租户都能看见
// AiAppScopeTenant：租户私有应用，仅本租户可见
const (
	AiAppScopePlatform = "platform"
	AiAppScopeTenant   = "tenant"
)

// ─── 基础 CRUD ───────────────────────────────────────────────────────────────

func (app *AiApp) Insert() error {
	if app.Scope == "" {
		app.Scope = AiAppScopeTenant
	}
	if app.Scope == AiAppScopePlatform {
		// 平台应用 tenant_id 固定为 0。
		// 注意：TenantId 字段带 `default:1`，GORM 会把 zero-value 0 当作"未设置"
		// 替换成默认值 1（参考 channel_cache_merge_test.go 的同款 workaround）。
		// 这里先正常 Create，再用一条显式 UPDATE 把 tenant_id 修正为 0。
		app.TenantId = 0
		if err := WithTenantBypass(DB).Create(app).Error; err != nil {
			return err
		}
		return WithTenantBypass(DB).Model(app).Where("id = ?", app.Id).
			Update("tenant_id", 0).Error
	}
	return DB.Create(app).Error
}

// Update 按 (Id, Scope) 定位行：
//   - 平台 scope：忽略 tenant_id，使用 bypass 才能命中 tenant_id=0 的行
//   - 租户 scope：仍按 (id, tenant_id) 隔离
func (app *AiApp) Update() error {
	cols := []string{"name", "slug", "description", "icon_url", "target_url", "status",
		"sort_order", "vendor_user_id", "guest_quota", "default_group",
		"session_token_ttl", "tags"}
	if app.Scope == AiAppScopePlatform {
		return WithTenantBypass(DB).Model(app).
			Where("id = ? AND scope = ?", app.Id, AiAppScopePlatform).
			Select(cols).
			Updates(app).Error
	}
	return DB.Model(app).
		Where("id = ? AND tenant_id = ? AND scope = ?", app.Id, app.TenantId, AiAppScopeTenant).
		Select(cols).
		Updates(app).Error
}

// UpdateFrom updates an existing app while allowing platform root flows to
// change scope between tenant and platform.
func (app *AiApp) UpdateFrom(existing *AiApp) error {
	if existing == nil {
		return errors.New("existing app is nil")
	}
	if app.Scope == "" {
		app.Scope = AiAppScopeTenant
	}
	if app.Scope == AiAppScopePlatform {
		app.TenantId = 0
	}
	cols := []string{"tenant_id", "scope", "name", "slug", "description", "icon_url", "target_url", "status",
		"sort_order", "vendor_user_id", "guest_quota", "default_group",
		"session_token_ttl", "tags"}
	if existing.Scope == AiAppScopePlatform {
		return WithTenantBypass(DB).Model(&AiApp{}).
			Where("id = ? AND scope = ?", existing.Id, AiAppScopePlatform).
			Select(cols).
			Updates(app).Error
	}
	return DB.Model(&AiApp{}).
		Where("id = ? AND tenant_id = ? AND scope = ?", existing.Id, existing.TenantId, AiAppScopeTenant).
		Select(cols).
		Updates(app).Error
}

func (app *AiApp) Delete() error {
	if app.Scope == AiAppScopePlatform {
		return WithTenantBypass(DB).
			Where("id = ? AND scope = ?", app.Id, AiAppScopePlatform).
			Delete(&AiApp{}).Error
	}
	return DB.Where("id = ? AND tenant_id = ? AND scope = ?", app.Id, app.TenantId, AiAppScopeTenant).
		Delete(&AiApp{}).Error
}

// ─── 查询 ────────────────────────────────────────────────────────────────────

// GetAllOnlineAiApps 返回当前租户可见的所有上架应用：
//   - tenantId > 0：返回 (scope='platform' 的所有平台应用) ∪ (tenant_id = tenantId 的本租户应用)
//   - tenantId <= 0：仅平台运维使用，返回全部上架应用
//
// 排序：sort_order DESC, id DESC。
func GetAllOnlineAiApps(tenantId int) ([]*AiApp, error) {
	var apps []*AiApp
	q := WithTenantBypass(DB).Where("status = ?", AiAppStatusOnline)
	if tenantId > 0 {
		q = q.Where("scope = ? OR tenant_id = ?", AiAppScopePlatform, tenantId)
	}
	err := q.Order("sort_order desc, id desc").Find(&apps).Error
	return apps, err
}

// GetAiAppBySlug 通过 slug 查找应用（用于详情页 / 换 token）。
// 必须传入当前租户上下文，避免子租户访问到其他租户的私有应用。
//
// 命中条件：status = 上架 AND (scope='platform' OR tenant_id=tenantId)。
func GetAiAppBySlug(slug string, tenantId int) (*AiApp, error) {
	var app AiApp
	q := WithTenantBypass(DB).Where("slug = ? AND status = ?", slug, AiAppStatusOnline)
	if tenantId > 0 {
		q = q.Where("scope = ? OR tenant_id = ?", AiAppScopePlatform, tenantId)
	}
	err := q.First(&app).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("应用不存在或已下架")
		}
		return nil, err
	}
	return &app, nil
}

// GetAiAppById 通过 ID 查找应用（管理端使用，不限状态）。
// 调用方必须自己做租户/scope 鉴权（参考 controller 层）。
func GetAiAppById(id int) (*AiApp, error) {
	var app AiApp
	err := WithTenantBypass(DB).Where("id = ?", id).First(&app).Error
	if err != nil {
		return nil, err
	}
	return &app, nil
}

// ListAiAppsForAdmin 返回管理员可见的应用（分页），包含各种状态。
//
// 语义：
//   - tenantId > 0：返回 (本租户全部 scope='tenant' 应用) ∪ (全部 scope='platform' 平台应用)
//   - tenantId <= 0：bypass，列出所有应用（仅供平台超管 / 跨租户视图）
func ListAiAppsForAdmin(tenantId int, offset, limit int) ([]*AiApp, int64, error) {
	var apps []*AiApp
	var total int64
	q := WithTenantBypass(DB).Model(&AiApp{})
	if tenantId > 0 {
		q = q.Where("scope = ? OR tenant_id = ?", AiAppScopePlatform, tenantId)
	}
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	err := q.Order("sort_order desc, id desc").Offset(offset).Limit(limit).Find(&apps).Error
	return apps, total, err
}

// ─── Session Token 生成 ──────────────────────────────────────────────────────

// GenerateSessionTokenForApp 为已登录用户生成一个与应用绑定的临时 Session Token。
// 这个 Token 有效期、额度均受应用配置控制，且在日志里会记录 AppId，方便后续结算。
//
// 单行模型：(tenant_id, user_id, app_id) 维度下只保留一条 status=enabled 的 token。
//   - 已存在：刷新 expired_time 和 accessed_time，复用同一把 key（用户每次拿到的 sk-xxx 不变）
//   - 不存在：才创建新的
//
// 已禁用 / 已删除的 token 不参与复用（被管理员手动关停过），重新建新的。
func GenerateSessionTokenForApp(app *AiApp, userId int, tenantId int) (*Token, error) {
	if app == nil {
		return nil, errors.New("app is nil")
	}
	if userId <= 0 {
		return nil, errors.New("invalid user id")
	}

	now := common.GetTimestamp()
	ttl := int64(app.SessionTokenTTL)
	if ttl <= 0 {
		ttl = 86400 // 默认 24h
	}
	expiredTime := now + ttl

	// 先看有没有可复用的（status=enabled 的，无论是否过期）
	var existing Token
	err := DB.Where(
		"tenant_id = ? AND user_id = ? AND app_id = ? AND status = ?",
		tenantId, userId, app.Id, common.TokenStatusEnabled,
	).Order("id DESC").First(&existing).Error
	if err == nil {
		// 存在 —— 刷新过期时间和访问时间后返回；key 保持不变
		if err := DB.Model(&existing).
			Where("id = ?", existing.Id).
			Updates(map[string]interface{}{
				"expired_time":  expiredTime,
				"accessed_time": now,
			}).Error; err != nil {
			return nil, errors.New("failed to refresh session token: " + err.Error())
		}
		existing.ExpiredTime = expiredTime
		existing.AccessedTime = now
		return &existing, nil
	}

	// 生成随机密钥
	key, err := common.GenerateKey()
	if err != nil {
		return nil, errors.New("failed to generate token key: " + err.Error())
	}

	group := app.DefaultGroup
	if group == "" {
		// 继承用户默认分组（用 Global 查，因为这里 tenant 已经显式传入，
		// 且不能用废弃的 GetUserById stub）
		user, err := GetUserByIdGlobal(userId, false)
		if err == nil && user != nil && user.Group != "" {
			group = user.Group
		}
	}

	token := &Token{
		TenantId:       tenantId,
		UserId:         userId,
		Key:            key,
		Status:         common.TokenStatusEnabled,
		Name:           "app-session:" + app.Slug,
		CreatedTime:    now,
		AccessedTime:   now,
		ExpiredTime:    expiredTime,
		RemainQuota:    0,
		UnlimitedQuota: true, // 继承用户额度
		Group:          group,
		AppId:          app.Id,
		EnableImageGen: true,
	}

	if err := token.Insert(); err != nil {
		return nil, errors.New("failed to create session token: " + err.Error())
	}
	return token, nil
}

// GenerateGuestSessionToken 为未登录访客生成一个与应用绑定的体验 Token。
// GuestUserId 是平台预设的访客账户 ID。
func GenerateGuestSessionToken(app *AiApp, guestUserId int, tenantId int) (*Token, error) {
	if app == nil {
		return nil, errors.New("app is nil")
	}
	if app.GuestQuota <= 0 {
		return nil, errors.New("此应用不支持免登录体验")
	}

	expiredTime := common.GetTimestamp() + 3600 // 访客 token 最多 1 小时有效

	key, err := common.GenerateKey()
	if err != nil {
		return nil, errors.New("failed to generate guest token key: " + err.Error())
	}

	token := &Token{
		TenantId:       tenantId,
		UserId:         guestUserId,
		Key:            key,
		Status:         common.TokenStatusEnabled,
		Name:           "guest-session:" + app.Slug + ":" + time.Now().Format("060102"),
		CreatedTime:    common.GetTimestamp(),
		AccessedTime:   common.GetTimestamp(),
		ExpiredTime:    expiredTime,
		RemainQuota:    app.GuestQuota,
		UnlimitedQuota: false,
		Group:          app.DefaultGroup,
		AppId:          app.Id,
		IsGuest:        true,
		EnableImageGen: true,
	}

	if err := token.Insert(); err != nil {
		return nil, errors.New("failed to create guest token: " + err.Error())
	}
	return token, nil
}
