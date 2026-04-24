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

// ─── 基础 CRUD ───────────────────────────────────────────────────────────────

func (app *AiApp) Insert() error {
	return DB.Create(app).Error
}

func (app *AiApp) Update() error {
	return DB.Model(app).Where("id = ? AND tenant_id = ?", app.Id, app.TenantId).
		Select("name", "slug", "description", "icon_url", "target_url", "status",
			"sort_order", "vendor_user_id", "guest_quota", "default_group",
			"session_token_ttl", "tags").
		Updates(app).Error
}

func (app *AiApp) Delete() error {
	return DB.Where("id = ? AND tenant_id = ?", app.Id, app.TenantId).
		Delete(app).Error
}

// ─── 查询 ────────────────────────────────────────────────────────────────────

// GetAllOnlineAiApps 返回指定租户上架的所有应用，按 sort_order DESC, id DESC 排序。
// tenantId = 0 时跨租户返回所有上架应用（仅用于平台管理）。
func GetAllOnlineAiApps(tenantId int) ([]*AiApp, error) {
	var apps []*AiApp
	q := WithTenantBypass(DB).Where("status = ?", AiAppStatusOnline)
	if tenantId > 0 {
		q = q.Where("tenant_id = ?", tenantId)
	}
	err := q.Order("sort_order desc, id desc").Find(&apps).Error
	return apps, err
}

// GetAiAppBySlug 通过 slug 查找应用（用于详情页，无需鉴权）。
func GetAiAppBySlug(slug string) (*AiApp, error) {
	var app AiApp
	err := WithTenantBypass(DB).Where("slug = ? AND status = ?", slug, AiAppStatusOnline).
		First(&app).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("应用不存在或已下架")
		}
		return nil, err
	}
	return &app, nil
}

// GetAiAppById 通过 ID 查找应用（管理端使用，不限状态）。
func GetAiAppById(id int) (*AiApp, error) {
	var app AiApp
	err := WithTenantBypass(DB).Where("id = ?", id).First(&app).Error
	if err != nil {
		return nil, err
	}
	return &app, nil
}

// ListAiAppsForAdmin 返回管理员可见的所有应用（分页），包含各种状态。
func ListAiAppsForAdmin(tenantId int, offset, limit int) ([]*AiApp, int64, error) {
	var apps []*AiApp
	var total int64
	q := DB.Model(&AiApp{})
	if tenantId > 0 {
		q = q.Where("tenant_id = ?", tenantId)
	} else {
		q = WithTenantBypass(q)
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
func GenerateSessionTokenForApp(app *AiApp, userId int, tenantId int) (*Token, error) {
	if app == nil {
		return nil, errors.New("app is nil")
	}
	if userId <= 0 {
		return nil, errors.New("invalid user id")
	}

	expiredTime := common.GetTimestamp() + int64(app.SessionTokenTTL)
	if app.SessionTokenTTL <= 0 {
		expiredTime = common.GetTimestamp() + 86400 // 默认 24h
	}

	// 生成随机密钥
	key, err := common.GenerateKey()
	if err != nil {
		return nil, errors.New("failed to generate token key: " + err.Error())
	}

	group := app.DefaultGroup
	if group == "" {
		// 继承用户默认分组
		user, err := GetUserById(userId, false)
		if err == nil && user.Group != "" {
			group = user.Group
		}
	}

	token := &Token{
		TenantId:       tenantId,
		UserId:         userId,
		Key:            key,
		Status:         common.TokenStatusEnabled,
		Name:           "app-session:" + app.Slug,
		CreatedTime:    common.GetTimestamp(),
		AccessedTime:   common.GetTimestamp(),
		ExpiredTime:    expiredTime,
		RemainQuota:    0,
		UnlimitedQuota: true, // 继承用户额度
		Group:          group,
		AppId:          app.Id,
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
	}

	if err := token.Insert(); err != nil {
		return nil, errors.New("failed to create guest token: " + err.Error())
	}
	return token, nil
}
