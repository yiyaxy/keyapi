package model

import (
	"errors"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

type UserLevel struct {
	Id                      int    `json:"id" gorm:"primaryKey;autoIncrement"`
	TenantId                int    `json:"tenant_id" gorm:"uniqueIndex:uk_user_level_tenant_code,priority:1;index;not null;default:1"`
	Code                    string `json:"code" gorm:"uniqueIndex:uk_user_level_tenant_code,priority:2;type:varchar(64);not null"`
	Name                    string `json:"name" gorm:"type:varchar(64);not null"`
	Description             string `json:"description" gorm:"type:varchar(255);default:''"`
	RegisterReward          int    `json:"register_reward" gorm:"column:register_reward;default:0"`
	InviteeReward           int    `json:"invitee_reward" gorm:"column:invitee_reward;default:0"`
	TopUpBonusPercent       int    `json:"top_up_bonus_percent" gorm:"column:top_up_bonus_percent;default:0"`
	TopUpRebateCount        int    `json:"top_up_rebate_count" gorm:"column:top_up_rebate_count;default:0"`
	TopUpRebatePercent      int    `json:"top_up_rebate_percent" gorm:"column:top_up_rebate_percent;default:0"`
	SubscriptionRebateCount int    `json:"subscription_rebate_count" gorm:"column:subscription_rebate_count;default:0"`
	Enabled                 bool   `json:"enabled" gorm:"not null;default:true"`
	SortOrder               int    `json:"sort_order" gorm:"default:0"`
	CreatedAt               int64  `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt               int64  `json:"updated_at" gorm:"autoUpdateTime"`
}

func normalizeUserLevel(level *UserLevel) {
	level.Code = strings.TrimSpace(level.Code)
	level.Name = strings.TrimSpace(level.Name)
	level.Description = strings.TrimSpace(level.Description)
}

func GetAllUserLevels(tenantId int, includeDisabled bool) ([]*UserLevel, error) {
	var levels []*UserLevel
	query := DB.Model(&UserLevel{})
	if tenantId > 0 {
		query = query.Where("tenant_id = ?", tenantId)
	}
	if !includeDisabled {
		query = query.Where("enabled = ?", true)
	}
	err := query.Order("sort_order asc, id asc").Find(&levels).Error
	return levels, err
}

func GetUserLevelById(tenantId int, id int) (*UserLevel, error) {
	if id <= 0 {
		return nil, errors.New("invalid user level id")
	}
	var level UserLevel
	query := DB.Where("id = ?", id)
	if tenantId > 0 {
		query = query.Where("tenant_id = ?", tenantId)
	}
	if err := query.First(&level).Error; err != nil {
		return nil, err
	}
	return &level, nil
}

func GetEnabledUserLevelById(tenantId int, id int) (*UserLevel, error) {
	level, err := GetUserLevelById(tenantId, id)
	if err != nil {
		return nil, err
	}
	if !level.Enabled {
		return nil, gorm.ErrRecordNotFound
	}
	return level, nil
}

func CreateUserLevel(level *UserLevel) error {
	normalizeUserLevel(level)
	if level.TenantId <= 0 {
		level.TenantId = DefaultTenantId
	}
	if level.Code == "" || level.Name == "" {
		return errors.New("level code and name are required")
	}
	return DB.Create(level).Error
}

func UpdateUserLevel(level *UserLevel) error {
	normalizeUserLevel(level)
	if level.Id <= 0 {
		return errors.New("level id is required")
	}
	if level.Code == "" || level.Name == "" {
		return errors.New("level code and name are required")
	}
	return DB.Model(&UserLevel{}).
		Where("id = ? AND tenant_id = ?", level.Id, level.TenantId).
		Updates(map[string]interface{}{
			"code":                      level.Code,
			"name":                      level.Name,
			"description":               level.Description,
			"register_reward":           level.RegisterReward,
			"invitee_reward":            level.InviteeReward,
			"top_up_bonus_percent":      level.TopUpBonusPercent,
			"top_up_rebate_count":       level.TopUpRebateCount,
			"top_up_rebate_percent":     level.TopUpRebatePercent,
			"subscription_rebate_count": level.SubscriptionRebateCount,
			"enabled":                   level.Enabled,
			"sort_order":                level.SortOrder,
		}).Error
}

func DeleteUserLevel(tenantId int, id int) error {
	if id <= 0 {
		return errors.New("level id is required")
	}
	err := DB.Transaction(func(tx *gorm.DB) error {
		query := tx.Where("id = ?", id)
		if tenantId > 0 {
			query = query.Where("tenant_id = ?", tenantId)
		}
		if err := query.Delete(&UserLevel{}).Error; err != nil {
			return err
		}
		update := tx.Model(&User{}).Where("user_level_id = ?", id)
		if tenantId > 0 {
			update = update.Where("tenant_id = ?", tenantId)
		}
		return update.Update("user_level_id", 0).Error
	})
	return err
}

func FillUserLevelNames(tenantId int, users []*User) error {
	levelIds := make([]int, 0)
	seen := map[int]bool{}
	for _, user := range users {
		if user == nil || user.LevelId <= 0 || seen[user.LevelId] {
			continue
		}
		seen[user.LevelId] = true
		levelIds = append(levelIds, user.LevelId)
	}
	if len(levelIds) == 0 {
		return nil
	}
	var levels []UserLevel
	query := DB.Where("id IN ?", levelIds)
	if tenantId > 0 {
		query = query.Where("tenant_id = ?", tenantId)
	}
	if err := query.Find(&levels).Error; err != nil {
		return err
	}
	names := map[int]string{}
	for _, level := range levels {
		names[level.Id] = level.Name
	}
	for _, user := range users {
		if user != nil {
			user.LevelName = names[user.LevelId]
		}
	}
	return nil
}

func userLevelToRebateSetting(inviterId int, level *UserLevel) *UserRebateSetting {
	return &UserRebateSetting{
		InviterId:               inviterId,
		RegisterReward:          level.RegisterReward,
		InviteeReward:           level.InviteeReward,
		TopUpRebateCount:        level.TopUpRebateCount,
		TopUpRebatePercent:      level.TopUpRebatePercent,
		SubscriptionRebateCount: level.SubscriptionRebateCount,
	}
}

func getUserLevelRebateSetting(inviterId int, tenantId int) (*UserRebateSetting, bool) {
	if inviterId <= 0 {
		return nil, false
	}
	var inviter User
	query := WithTenantBypass(DB).Select("id", "tenant_id", "user_level_id").Where("id = ?", inviterId)
	if tenantId > 0 {
		query = query.Where("tenant_id = ?", tenantId)
	}
	if err := query.First(&inviter).Error; err != nil || inviter.LevelId <= 0 {
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			common.SysError("failed to get inviter level: " + err.Error())
		}
		return nil, false
	}
	level, err := GetEnabledUserLevelById(inviter.TenantId, inviter.LevelId)
	if err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			common.SysError("failed to get user level rebate setting: " + err.Error())
		}
		return nil, false
	}
	return userLevelToRebateSetting(inviterId, level), true
}

type TopUpBonusPreview struct {
	BaseQuota    int64  `json:"base_quota"`
	BonusQuota   int64  `json:"bonus_quota"`
	TotalQuota   int64  `json:"total_quota"`
	BonusPercent int    `json:"bonus_percent"`
	LevelId      int    `json:"level_id"`
	LevelName    string `json:"level_name"`
}

func GetUserLevelTopUpBonusPreview(userId int, tenantId int, baseQuota int64) TopUpBonusPreview {
	preview := TopUpBonusPreview{
		BaseQuota:  baseQuota,
		TotalQuota: baseQuota,
	}
	if userId <= 0 || baseQuota <= 0 {
		return preview
	}

	var user User
	query := WithTenantBypass(DB).Select("id", "tenant_id", "user_level_id").Where("id = ?", userId)
	if tenantId > 0 {
		query = query.Where("tenant_id = ?", tenantId)
	}
	if err := query.First(&user).Error; err != nil || user.LevelId <= 0 {
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			common.SysError("failed to get user level for topup bonus: " + err.Error())
		}
		return preview
	}

	level, err := GetEnabledUserLevelById(user.TenantId, user.LevelId)
	if err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			common.SysError("failed to get user level topup bonus: " + err.Error())
		}
		return preview
	}

	preview.LevelId = level.Id
	preview.LevelName = level.Name
	preview.BonusPercent = level.TopUpBonusPercent
	if level.TopUpBonusPercent <= 0 {
		return preview
	}

	preview.BonusQuota = baseQuota * int64(level.TopUpBonusPercent) / 100
	preview.TotalQuota = preview.BaseQuota + preview.BonusQuota
	return preview
}
