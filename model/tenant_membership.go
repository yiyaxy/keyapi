package model

import (
	"errors"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

type TenantMembership struct {
	Id        int            `json:"id" gorm:"primaryKey"`
	TenantId  int            `json:"tenant_id" gorm:"index:idx_tenant_membership_tenant_user,priority:1;index;not null;default:1"`
	UserId    int            `json:"user_id" gorm:"index:idx_tenant_membership_tenant_user,priority:2;uniqueIndex:uk_tenant_membership_tenant_user;not null"`
	Role      int            `json:"role" gorm:"type:int;default:1"`
	Status    int            `json:"status" gorm:"type:int;default:1"`
	InvitedBy int            `json:"invited_by" gorm:"type:int;default:0"`
	CreatedAt int64          `json:"created_at" gorm:"bigint;autoCreateTime"`
	UpdatedAt int64          `json:"updated_at" gorm:"bigint;autoUpdateTime"`
	DeletedAt gorm.DeletedAt `json:"-" gorm:"index"`

	User *User `json:"user,omitempty" gorm:"foreignKey:UserId;references:Id"`
}

const (
	TenantRoleMember = common.RoleCommonUser
	TenantRoleAdmin  = common.RoleAdminUser

	TenantMembershipStatusActive   = common.UserStatusEnabled
	TenantMembershipStatusDisabled = common.UserStatusDisabled
	TenantMembershipStatusRemoved  = 3
)

type MembershipAuthInfo struct {
	PlatformRole  int
	TenantRole    int
	TenantStatus  int
	EffectiveRole int
}

func IsValidTenantRole(role int) bool {
	return role == TenantRoleMember || role == TenantRoleAdmin
}

func IsValidTenantMembershipStatus(status int) bool {
	return status == TenantMembershipStatusActive || status == TenantMembershipStatusDisabled || status == TenantMembershipStatusRemoved
}

func EffectiveRole(platformRole int, tenantRole int) int {
	if platformRole >= common.RoleAdminUser {
		return platformRole
	}
	if tenantRole >= TenantRoleAdmin {
		return common.RoleAdminUser
	}
	return common.RoleCommonUser
}

func GetTenantMembership(tenantId int, userId int) (*TenantMembership, error) {
	if tenantId <= 0 || userId <= 0 {
		return nil, errors.New("invalid tenantId or userId")
	}
	var membership TenantMembership
	err := WithTenantBypass(DB).Where("tenant_id = ? AND user_id = ?", tenantId, userId).First(&membership).Error
	if err != nil {
		return nil, err
	}
	return &membership, nil
}

// RemoveTenantMembership marks a user's membership in a tenant as removed (soft removal).
// Does not delete the global user record.
func RemoveTenantMembership(tenantId int, userId int) error {
	if tenantId <= 0 || userId <= 0 {
		return errors.New("invalid tenantId or userId")
	}
	result := WithTenantBypass(DB).Model(&TenantMembership{}).
		Where("tenant_id = ? AND user_id = ?", tenantId, userId).
		Updates(map[string]interface{}{
			"status":     TenantMembershipStatusRemoved,
			"updated_at": time.Now().Unix(),
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return errors.New("membership not found")
	}
	return nil
}

func GetTenantMembershipUnscoped(tenantId int, userId int) (*TenantMembership, error) {
	if tenantId <= 0 || userId <= 0 {
		return nil, errors.New("invalid tenantId or userId")
	}
	var membership TenantMembership
	err := WithTenantBypass(DB).Unscoped().Where("tenant_id = ? AND user_id = ?", tenantId, userId).First(&membership).Error
	if err != nil {
		return nil, err
	}
	return &membership, nil
}

func EnsureTenantMembership(userId int, tenantId int, role int, invitedBy int) error {
	if userId <= 0 || tenantId <= 0 {
		return errors.New("invalid tenantId or userId")
	}
	if !IsValidTenantRole(role) {
		role = TenantRoleMember
	}

	membership, err := GetTenantMembershipUnscoped(tenantId, userId)
	if err == nil {
		updates := map[string]interface{}{
			"role":       role,
			"status":     TenantMembershipStatusActive,
			"deleted_at": nil,
		}
		if invitedBy > 0 {
			updates["invited_by"] = invitedBy
		}
		return WithTenantBypass(DB).Unscoped().Model(&TenantMembership{}).
			Where("id = ?", membership.Id).
			Updates(updates).Error
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}

	return WithTenantBypass(DB).Create(&TenantMembership{
		TenantId:  tenantId,
		UserId:    userId,
		Role:      role,
		Status:    TenantMembershipStatusActive,
		InvitedBy: invitedBy,
	}).Error
}

func CreateTenantMembership(membership *TenantMembership) error {
	if membership == nil {
		return errors.New("membership is nil")
	}
	if membership.TenantId <= 0 || membership.UserId <= 0 {
		return errors.New("invalid tenantId or userId")
	}
	if !IsValidTenantRole(membership.Role) {
		membership.Role = TenantRoleMember
	}
	if !IsValidTenantMembershipStatus(membership.Status) || membership.Status == TenantMembershipStatusRemoved {
		membership.Status = TenantMembershipStatusActive
	}
	return EnsureTenantMembership(membership.UserId, membership.TenantId, membership.Role, membership.InvitedBy)
}

func UpdateTenantMembershipRole(tenantId int, userId int, role int) error {
	if !IsValidTenantRole(role) {
		return errors.New("invalid tenant role")
	}
	return WithTenantBypass(DB).Model(&TenantMembership{}).
		Where("tenant_id = ? AND user_id = ?", tenantId, userId).
		Updates(map[string]interface{}{"role": role, "deleted_at": nil}).Error
}

func UpdateTenantMembershipStatus(tenantId int, userId int, status int) error {
	if !IsValidTenantMembershipStatus(status) {
		return errors.New("invalid membership status")
	}
	updates := map[string]interface{}{"status": status}
	if status == TenantMembershipStatusRemoved {
		updates["deleted_at"] = gorm.DeletedAt{Time: time.Now(), Valid: true}
	} else {
		updates["deleted_at"] = nil
	}
	return WithTenantBypass(DB).Unscoped().Model(&TenantMembership{}).
		Where("tenant_id = ? AND user_id = ?", tenantId, userId).
		Updates(updates).Error
}

func GetTenantMembershipAuthInfo(tenantId int, user *User) (*MembershipAuthInfo, error) {
	if user == nil || user.Id <= 0 {
		return nil, errors.New("invalid user")
	}
	platformRole := user.Role
	info := &MembershipAuthInfo{
		PlatformRole:  platformRole,
		TenantRole:    TenantRoleMember,
		TenantStatus:  TenantMembershipStatusActive,
		EffectiveRole: platformRole,
	}
	if platformRole >= common.RoleAdminUser && tenantId <= 0 {
		return info, nil
	}

	membership, err := GetTenantMembership(tenantId, user.Id)
	if err != nil {
		if platformRole >= common.RoleAdminUser {
			info.TenantRole = TenantRoleAdmin
			info.EffectiveRole = platformRole
			return info, nil
		}
		return nil, err
	}
	info.TenantRole = membership.Role
	info.TenantStatus = membership.Status
	info.EffectiveRole = EffectiveRole(platformRole, membership.Role)
	return info, nil
}

func TenantMembershipAllowsAccess(user *User, tenantId int) bool {
	info, err := GetTenantMembershipAuthInfo(tenantId, user)
	if err != nil {
		return false
	}
	if user.Status != common.UserStatusEnabled {
		return false
	}
	return info.TenantStatus == TenantMembershipStatusActive
}

// RequireTenantMembership checks that a user belongs to the given tenant.
// Returns nil if membership exists and is not removed; otherwise returns an error.
// Platform root users (role >= RoleRootUser) bypass this check.
func RequireTenantMembership(tenantId int, userId int, callerPlatformRole int) error {
	// Platform root can access any user across tenants
	if callerPlatformRole >= common.RoleRootUser {
		return nil
	}
	if tenantId <= 0 || userId <= 0 {
		return errors.New("user not found in current tenant")
	}
	m, err := GetTenantMembership(tenantId, userId)
	if err != nil {
		return errors.New("user not found in current tenant")
	}
	if m.Status == TenantMembershipStatusRemoved {
		return errors.New("user has been removed from current tenant")
	}
	return nil
}

func CountTenantAdmins(tenantId int) (int64, error) {
	var count int64
	err := WithTenantBypass(DB).Model(&TenantMembership{}).
		Where("tenant_id = ? AND role = ? AND status = ?", tenantId, TenantRoleAdmin, TenantMembershipStatusActive).
		Count(&count).Error
	return count, err
}

// UserTenantSummary 是用户可访问的一个租户的精简信息（租户切换器使用）。
type UserTenantSummary struct {
	TenantId   int    `json:"tenant_id"`
	TenantName string `json:"tenant_name"`
	TenantSlug string `json:"tenant_slug"`
	TenantRole int    `json:"tenant_role"`
	Status     int    `json:"status"`
}

// ListUserAccessibleTenants 返回指定用户有 active 成员身份的所有租户。
// 用于前端租户切换器。
func ListUserAccessibleTenants(userId int) ([]UserTenantSummary, error) {
	if userId <= 0 {
		return nil, errors.New("invalid userId")
	}
	var items []UserTenantSummary
	err := WithTenantBypass(DB).Table("tenant_memberships AS tm").
		Select("tm.tenant_id, t.name AS tenant_name, t.slug AS tenant_slug, tm.role AS tenant_role, tm.status AS status").
		Joins("JOIN tenants t ON t.id = tm.tenant_id").
		Where("tm.user_id = ? AND tm.status = ? AND t.status = ?",
			userId, TenantMembershipStatusActive, TenantStatusActive).
		Order("tm.tenant_id ASC").
		Scan(&items).Error
	return items, err
}

// IsUserTenantMember 检查用户是否是某租户 active 成员。租户切换接口鉴权用。
func IsUserTenantMember(userId, tenantId int) (bool, error) {
	if userId <= 0 || tenantId <= 0 {
		return false, nil
	}
	var count int64
	err := WithTenantBypass(DB).Model(&TenantMembership{}).
		Where("user_id = ? AND tenant_id = ? AND status = ?",
			userId, tenantId, TenantMembershipStatusActive).
		Count(&count).Error
	return count > 0, err
}

// ListTenantAdminEmails 返回租户所有 active 管理员的邮箱，用于告警推送等通知场景。
// 平台级 admin 不纳入（他们不一定关心该租户）。跨租户 bypass 查询 users 表。
func ListTenantAdminEmails(tenantId int) ([]string, error) {
	if tenantId <= 0 {
		return nil, errors.New("invalid tenantId")
	}
	var emails []string
	err := WithTenantBypass(DB).Table("tenant_memberships AS tm").
		Select("u.email").
		Joins("JOIN users u ON u.id = tm.user_id").
		Where("tm.tenant_id = ? AND tm.role = ? AND tm.status = ? AND u.email <> ''",
			tenantId, TenantRoleAdmin, TenantMembershipStatusActive).
		Scan(&emails).Error
	return emails, err
}

// ListTenantAdminUserIds 返回租户所有 active 管理员的 user_id，用于站内信告警等推送场景。
// 平台级 admin 不纳入。跨租户 bypass 查询 tenant_memberships 表。
func ListTenantAdminUserIds(tenantId int) ([]int, error) {
	if tenantId <= 0 {
		return nil, errors.New("invalid tenantId")
	}
	var ids []int
	err := WithTenantBypass(DB).Table("tenant_memberships").
		Where("tenant_id = ? AND role = ? AND status = ?",
			tenantId, TenantRoleAdmin, TenantMembershipStatusActive).
		Pluck("user_id", &ids).Error
	return ids, err
}

// CountActiveTenantMembers returns the number of active (non-removed) members in a tenant.
func CountActiveTenantMembers(tenantId int) (int64, error) {
	var count int64
	err := WithTenantBypass(DB).Model(&TenantMembership{}).
		Where("tenant_id = ? AND status <> ?", tenantId, TenantMembershipStatusRemoved).
		Count(&count).Error
	return count, err
}

// RemoveAllTenantMemberships marks all memberships in a tenant as removed (soft removal).
func RemoveAllTenantMemberships(tenantId int) error {
	if tenantId <= 0 {
		return errors.New("invalid tenantId")
	}
	return WithTenantBypass(DB).Model(&TenantMembership{}).
		Where("tenant_id = ? AND status <> ?", tenantId, TenantMembershipStatusRemoved).
		Updates(map[string]interface{}{
			"status":     TenantMembershipStatusRemoved,
			"updated_at": time.Now().Unix(),
		}).Error
}

func NormalizeTenantMemberKeyword(keyword string) string {
	return strings.TrimSpace(keyword)
}

func ApplyMembershipView(tenantId int, users []*User) error {
	if tenantId <= 0 || len(users) == 0 {
		return nil
	}
	userIds := make([]int, 0, len(users))
	for _, user := range users {
		if user != nil && user.Id > 0 {
			userIds = append(userIds, user.Id)
		}
	}
	if len(userIds) == 0 {
		return nil
	}
	var memberships []TenantMembership
	err := WithTenantBypass(DB).Where("tenant_id = ? AND user_id IN ?", tenantId, userIds).Find(&memberships).Error
	if err != nil {
		return err
	}
	membershipMap := make(map[int]TenantMembership, len(memberships))
	for _, membership := range memberships {
		membershipMap[membership.UserId] = membership
	}
	for _, user := range users {
		if user == nil {
			continue
		}
		if membership, ok := membershipMap[user.Id]; ok {
			user.Role = EffectiveRole(user.Role, membership.Role)
			if membership.Status == TenantMembershipStatusDisabled {
				user.Status = common.UserStatusDisabled
			}
		}
	}
	return nil
}

func ApplyMembershipViewToUser(tenantId int, user *User) error {
	if user == nil {
		return nil
	}
	return ApplyMembershipView(tenantId, []*User{user})
}

type TenantMemberListItem struct {
	Id               int    `json:"id"`
	TenantId         int    `json:"tenant_id"`
	UserId           int    `json:"user_id"`
	Username         string `json:"username"`
	DisplayName      string `json:"display_name"`
	Email            string `json:"email"`
	TenantRole       int    `json:"tenant_role"`
	PlatformRole     int    `json:"platform_role"`
	EffectiveRole    int    `json:"role"`
	MembershipStatus int    `json:"membership_status"`
	UserStatus       int    `json:"status"`
	Group            string `json:"group"`
	Quota            int    `json:"quota"`
	UsedQuota        int    `json:"used_quota"`
	RequestCount     int    `json:"request_count"`
	Remark           string `json:"remark,omitempty"`
	InvitedBy        int    `json:"invited_by"`
	CreatedAt        int64  `json:"created_at"`
	UpdatedAt        int64  `json:"updated_at"`
}

func ListTenantMembers(tenantId int, pageInfo *common.PageInfo, keyword string, status int) ([]TenantMemberListItem, int64, error) {
	if tenantId <= 0 {
		return nil, 0, errors.New("invalid tenantId")
	}
	if pageInfo == nil {
		pageInfo = &common.PageInfo{Page: 1, PageSize: common.ItemsPerPage}
	}
	keyword = NormalizeTenantMemberKeyword(keyword)
	query := WithTenantBypass(DB).Table("tenant_memberships AS tm").
		Joins("JOIN users u ON u.id = tm.user_id").
		Where("tm.tenant_id = ?", tenantId)
	if status > 0 {
		query = query.Where("tm.status = ?", status)
	} else {
		query = query.Where("tm.status <> ?", TenantMembershipStatusRemoved)
	}
	if keyword != "" {
		like := "%" + keyword + "%"
		query = query.Where("u.username LIKE ? OR u.display_name LIKE ? OR u.email LIKE ?", like, like, like)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var items []TenantMemberListItem
	err := query.Select(`
			tm.id,
			tm.tenant_id,
			tm.user_id,
			u.username,
			u.display_name,
			u.email,
			tm.role AS tenant_role,
			u.role AS platform_role,
			tm.status AS membership_status,
			u.status,
			u.remark,
			u.quota,
			u.used_quota,
			u.request_count,
			u.` + commonGroupCol + ` AS ` + commonGroupCol + `,
			tm.invited_by,
			tm.created_at,
			tm.updated_at`).
		Order("tm.id desc").
		Offset(pageInfo.GetStartIdx()).
		Limit(pageInfo.GetPageSize()).
		Scan(&items).Error
	if err != nil {
		return nil, 0, err
	}
	for i := range items {
		items[i].EffectiveRole = EffectiveRole(items[i].PlatformRole, items[i].TenantRole)
		items[i].Id = items[i].UserId
		if items[i].MembershipStatus == TenantMembershipStatusDisabled {
			items[i].UserStatus = common.UserStatusDisabled
		}
	}
	return items, total, nil
}
