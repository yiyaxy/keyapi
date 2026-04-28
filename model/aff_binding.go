package model

import (
	"errors"
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"gorm.io/gorm"
)

type BindInviteResult struct {
	InviterId      int
	InviterName    string
	InviteeId      int
	InviteeName    string
	InviteeReward  int
	RegisterReward int
}

func BindInviteCode(tenantId int, userId int, affCode string) (*BindInviteResult, error) {
	affCode = strings.TrimSpace(affCode)
	if tenantId <= 0 || userId <= 0 {
		return nil, errors.New("tenantId and userId are required")
	}
	if affCode == "" {
		return nil, errors.New("邀请码不能为空")
	}

	var result BindInviteResult
	err := DB.Transaction(func(tx *gorm.DB) error {
		var invitee User
		if err := tx.Set("gorm:query_option", "FOR UPDATE").
			Where("id = ? AND tenant_id = ?", userId, tenantId).
			First(&invitee).Error; err != nil {
			return err
		}
		if invitee.InviterId > 0 {
			return errors.New("当前账号已绑定邀请码")
		}

		var inviter User
		if err := tx.Where("aff_code = ? AND tenant_id = ?", affCode, tenantId).First(&inviter).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return errors.New("邀请码不存在")
			}
			return err
		}
		if inviter.Id == invitee.Id {
			return errors.New("不能绑定自己的邀请码")
		}
		if inviter.Status != common.UserStatusEnabled {
			return errors.New("邀请人账号不可用")
		}

		rebateSetting := GetEffectiveRebateSetting(inviter.Id, tenantId)
		if err := tx.Model(&User{}).
			Where("id = ? AND tenant_id = ?", invitee.Id, tenantId).
			Update("inviter_id", inviter.Id).Error; err != nil {
			return err
		}
		if rebateSetting.InviteeReward > 0 {
			if err := tx.Model(&User{}).
				Where("id = ? AND tenant_id = ?", invitee.Id, tenantId).
				Update("quota", gorm.Expr("quota + ?", rebateSetting.InviteeReward)).Error; err != nil {
				return err
			}
		}

		registerRewardGranted, err := applyInviteRegisterRewardTx(tx, tenantId, inviter.Id, rebateSetting.RegisterReward)
		if err != nil {
			return err
		}
		registerReward := 0
		if registerRewardGranted {
			registerReward = rebateSetting.RegisterReward
		}
		if registerReward > 0 {
			if err := tx.Create(&AffRebateLog{
				TenantId:    tenantId,
				UserId:      inviter.Id,
				InviteeId:   invitee.Id,
				InviteeName: invitee.Username,
				Type:        AffRebateTypeRegister,
				Quota:       registerReward,
				Remark:      fmt.Sprintf("邀请绑定奖励 %s", logger.LogQuota(registerReward)),
			}).Error; err != nil {
				return err
			}
		}

		result = BindInviteResult{
			InviterId:      inviter.Id,
			InviterName:    inviter.Username,
			InviteeId:      invitee.Id,
			InviteeName:    invitee.Username,
			InviteeReward:  rebateSetting.InviteeReward,
			RegisterReward: registerReward,
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	if result.InviteeReward > 0 {
		RecordLogWithTenant(tenantId, userId, LogTypeSystem, fmt.Sprintf("绑定邀请码赠送 %s", logger.LogQuota(result.InviteeReward)))
	}
	if result.RegisterReward > 0 {
		RecordLogWithTenant(tenantId, result.InviterId, LogTypeSystem, fmt.Sprintf("邀请用户绑定赠送 %s", logger.LogQuota(result.RegisterReward)))
	}
	return &result, nil
}

func GetInviteesByInviterId(tenantId int, inviterId int, pageInfo *common.PageInfo) ([]*User, int64, error) {
	if tenantId <= 0 || inviterId <= 0 {
		return nil, 0, errors.New("tenantId and inviterId are required")
	}
	var users []*User
	var total int64
	query := DB.Model(&User{}).
		Where("tenant_id = ? AND inviter_id = ?", tenantId, inviterId)
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	err := query.
		Select("id", "tenant_id", "username", "display_name", "status", "quota", "used_quota", "request_count", "top_up_count", "subscription_purchase_count", "inviter_id").
		Order("id desc").
		Offset(pageInfo.GetStartIdx()).
		Limit(pageInfo.GetPageSize()).
		Find(&users).Error
	return users, total, err
}
