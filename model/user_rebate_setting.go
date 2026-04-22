package model

import (
	"errors"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

func getTenantOptionIntDefault(tenantId int, key string, codeDefault int) int {
	if tenantId > 0 {
		if value, found := GetTenantOption(tenantId, key); found {
			if parsed, err := strconv.Atoi(strings.TrimSpace(value)); err == nil {
				return parsed
			}
		}
	}

	common.OptionMapRWMutex.RLock()
	value, ok := common.OptionMap[key]
	common.OptionMapRWMutex.RUnlock()
	if ok {
		if parsed, err := strconv.Atoi(strings.TrimSpace(value)); err == nil {
			return parsed
		}
	}

	return codeDefault
}

func getNewUserQuotaForTenant(tenantId int) int {
	return getTenantOptionIntDefault(tenantId, "QuotaForNewUser", common.QuotaForNewUser)
}

type UserRebateSetting struct {
	Id                      int    `json:"id" gorm:"primaryKey;autoIncrement"`
	InviterId               int    `json:"inviter_id" gorm:"uniqueIndex;not null"`
	InviterUsername         string `json:"inviter_username" gorm:"-"`
	RegisterReward          int    `json:"register_reward" gorm:"column:register_reward;default:0"`
	InviteeReward           int    `json:"invitee_reward" gorm:"column:invitee_reward;default:0"`
	TopUpRebateCount        int    `json:"top_up_rebate_count" gorm:"column:top_up_rebate_count;default:0"`
	TopUpRebatePercent      int    `json:"top_up_rebate_percent" gorm:"column:top_up_rebate_percent;default:0"`
	SubscriptionRebateCount int    `json:"subscription_rebate_count" gorm:"column:subscription_rebate_count;default:0"`
	CreatedAt               int64  `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt               int64  `json:"updated_at" gorm:"autoUpdateTime"`
}

func GetDefaultRebateSetting(inviterId int, tenantId int) *UserRebateSetting {
	return &UserRebateSetting{
		InviterId:               inviterId,
		RegisterReward:          getTenantOptionIntDefault(tenantId, "QuotaForInviter", common.QuotaForInviter),
		InviteeReward:           getTenantOptionIntDefault(tenantId, "QuotaForInvitee", common.QuotaForInvitee),
		TopUpRebateCount:        getTenantOptionIntDefault(tenantId, "TopUpRebateCount", common.TopUpRebateCount),
		TopUpRebatePercent:      getTenantOptionIntDefault(tenantId, "TopUpRebatePercent", common.TopUpRebatePercent),
		SubscriptionRebateCount: getTenantOptionIntDefault(tenantId, "SubscriptionRebateCount", common.SubscriptionRebateCount),
	}
}

func GetEffectiveRebateSetting(inviterId int, tenantId int) *UserRebateSetting {
	setting := GetDefaultRebateSetting(inviterId, tenantId)
	if inviterId <= 0 {
		return setting
	}
	var customSetting UserRebateSetting
	err := DB.Where("inviter_id = ?", inviterId).First(&customSetting).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return setting
		}
		common.SysError("failed to get user rebate setting: " + err.Error())
		return setting
	}
	return &customSetting
}

func GetAllUserRebateSettings(pageInfo *common.PageInfo, keyword string) (settings []*UserRebateSetting, total int64, err error) {
	query := DB.Model(&UserRebateSetting{}).
		Select("user_rebate_settings.*, users.username as inviter_username").
		Joins("left join users on users.id = user_rebate_settings.inviter_id")
	if keyword = strings.TrimSpace(keyword); keyword != "" {
		like := "%" + keyword + "%"
		query = query.Where("users.username LIKE ?", like)
		if inviterId, convErr := strconv.Atoi(keyword); convErr == nil {
			query = query.Or("user_rebate_settings.inviter_id = ?", inviterId)
		}
	}
	if err = query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	err = query.Order("user_rebate_settings.id desc").Offset(pageInfo.GetStartIdx()).Limit(pageInfo.GetPageSize()).Find(&settings).Error
	return settings, total, err
}

func CreateUserRebateSetting(setting *UserRebateSetting) error {
	return DB.Create(setting).Error
}

func UpdateUserRebateSetting(setting *UserRebateSetting) error {
	return DB.Model(&UserRebateSetting{}).Where("id = ?", setting.Id).Updates(map[string]interface{}{
		"inviter_id":                setting.InviterId,
		"register_reward":           setting.RegisterReward,
		"invitee_reward":            setting.InviteeReward,
		"top_up_rebate_count":       setting.TopUpRebateCount,
		"top_up_rebate_percent":     setting.TopUpRebatePercent,
		"subscription_rebate_count": setting.SubscriptionRebateCount,
	}).Error
}

func DeleteUserRebateSetting(id int) error {
	return DB.Delete(&UserRebateSetting{}, id).Error
}
