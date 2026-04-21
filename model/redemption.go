package model

import (
	"errors"
	"fmt"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"

	"gorm.io/gorm"
)

// ErrRedeemFailed is returned when redemption fails due to database error
var ErrRedeemFailed = errors.New("redeem.failed")

type Redemption struct {
	Id           int            `json:"id"`
	TenantId     int            `json:"tenant_id" gorm:"index;default:1"`
	UserId       int            `json:"user_id"`
	Key          string         `json:"key" gorm:"type:char(32);uniqueIndex"`
	Status       int            `json:"status" gorm:"default:1"`
	Name         string         `json:"name" gorm:"index"`
	Quota        int            `json:"quota" gorm:"default:100"`
	CreatedTime  int64          `json:"created_time" gorm:"bigint"`
	RedeemedTime int64          `json:"redeemed_time" gorm:"bigint"`
	Count        int            `json:"count" gorm:"-:all"` // only for api request
	UsedUserId   int            `json:"used_user_id"`
	DeletedAt    gorm.DeletedAt `gorm:"index"`
	ExpiredTime  int64          `json:"expired_time" gorm:"bigint"` // 过期时间，0 表示不过期
}

func GetAllRedemptions(tenantId int, startIdx int, num int) (redemptions []*Redemption, total int64, err error) {
	// 开始事务
	tx := DB.Begin()
	if tx.Error != nil {
		return nil, 0, tx.Error
	}
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	query := tx.Model(&Redemption{})
	if tenantId > 0 {
		query = query.Where("tenant_id = ?", tenantId)
	}

	// 获取总数
	err = query.Count(&total).Error
	if err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	// 获取分页数据
	err = query.Order("id desc").Limit(num).Offset(startIdx).Find(&redemptions).Error
	if err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	// 提交事务
	if err = tx.Commit().Error; err != nil {
		return nil, 0, err
	}

	return redemptions, total, nil
}

func SearchRedemptions(tenantId int, keyword string, startIdx int, num int) (redemptions []*Redemption, total int64, err error) {
	tx := DB.Begin()
	if tx.Error != nil {
		return nil, 0, tx.Error
	}
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	// Build query based on keyword type
	query := tx.Model(&Redemption{})
	if tenantId > 0 {
		query = query.Where("tenant_id = ?", tenantId)
	}

	// Only try to convert to ID if the string represents a valid integer
	if id, err := strconv.Atoi(keyword); err == nil {
		query = query.Where("id = ? OR name LIKE ?", id, keyword+"%")
	} else {
		query = query.Where("name LIKE ?", keyword+"%")
	}

	// Get total count
	err = query.Count(&total).Error
	if err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	// Get paginated data
	err = query.Order("id desc").Limit(num).Offset(startIdx).Find(&redemptions).Error
	if err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	if err = tx.Commit().Error; err != nil {
		return nil, 0, err
	}

	return redemptions, total, nil
}

func GetRedemptionById(tenantId int, id int) (*Redemption, error) {
	if id == 0 {
		return nil, errors.New("id 为空！")
	}
	redemption := Redemption{Id: id}
	query := DB.Where("id = ?", id)
	if tenantId > 0 {
		query = query.Where("tenant_id = ?", tenantId)
	}
	err := query.First(&redemption).Error
	return &redemption, err
}

func Redeem(key string, userId int) (quota int, err error) {
	if key == "" {
		return 0, errors.New("未提供兑换码")
	}
	if userId == 0 {
		return 0, errors.New("无效的 user id")
	}
	tenantId := GetUserTenantId(userId)
	if tenantId <= 0 {
		return 0, errors.New("无效的租户")
	}
	redemption := &Redemption{}

	keyCol := "`key`"
	if common.UsingPostgreSQL {
		keyCol = `"key"`
	}
	common.RandomSleep()
	err = DB.Transaction(func(tx *gorm.DB) error {
		err := tx.Set("gorm:query_option", "FOR UPDATE").
			Where(keyCol+" = ? AND tenant_id = ?", key, tenantId).
			First(redemption).Error
		if err != nil {
			return errors.New("无效的兑换码")
		}
		if redemption.Status != common.RedemptionCodeStatusEnabled {
			return errors.New("该兑换码已被使用")
		}
		if redemption.ExpiredTime != 0 && redemption.ExpiredTime < common.GetTimestamp() {
			return errors.New("该兑换码已过期")
		}
		err = tx.Model(&User{}).
			Where("id = ? AND tenant_id = ?", userId, tenantId).
			Update("quota", gorm.Expr("quota + ?", redemption.Quota)).Error
		if err != nil {
			return err
		}
		redemption.RedeemedTime = common.GetTimestamp()
		redemption.Status = common.RedemptionCodeStatusUsed
		redemption.UsedUserId = userId
		return tx.Model(&Redemption{}).
			Where("id = ? AND tenant_id = ?", redemption.Id, redemption.TenantId).
			Select("*").Updates(redemption).Error
	})
	if err != nil {
		common.SysError("redemption failed: " + err.Error())
		return 0, ErrRedeemFailed
	}
	RecordTopUpLogWithTenant(tenantId, userId, redemption.Quota, fmt.Sprintf("通过兑换码充值 %s，兑换码ID %d", logger.LogQuota(redemption.Quota), redemption.Id))
	return redemption.Quota, nil
}

func (redemption *Redemption) Insert() error {
	var err error
	err = DB.Create(redemption).Error
	return err
}

func (redemption *Redemption) scopedQuery() (*gorm.DB, error) {
	if redemption.Id == 0 || redemption.TenantId == 0 {
		return nil, errors.New("redemption.Id 和 redemption.TenantId 不能为空")
	}
	return DB.Model(&Redemption{}).Where("id = ? AND tenant_id = ?", redemption.Id, redemption.TenantId), nil
}

func (redemption *Redemption) SelectUpdate() error {
	q, err := redemption.scopedQuery()
	if err != nil {
		return err
	}
	// This can update zero values
	return q.Select("redeemed_time", "status").Updates(redemption).Error
}

// Update Make sure your token's fields is completed, because this will update non-zero values
func (redemption *Redemption) Update() error {
	q, err := redemption.scopedQuery()
	if err != nil {
		return err
	}
	return q.Select("name", "status", "quota", "redeemed_time", "expired_time").Updates(redemption).Error
}

func (redemption *Redemption) Delete() error {
	if redemption.Id == 0 || redemption.TenantId == 0 {
		return errors.New("redemption.Id 和 redemption.TenantId 不能为空")
	}
	return DB.Where("id = ? AND tenant_id = ?", redemption.Id, redemption.TenantId).Delete(&Redemption{}).Error
}

func DeleteRedemptionById(tenantId int, id int) (err error) {
	if tenantId <= 0 || id <= 0 {
		return errors.New("tenantId 和 id 不能为空")
	}
	var redemption Redemption
	err = DB.Where("id = ? AND tenant_id = ?", id, tenantId).First(&redemption).Error
	if err != nil {
		return err
	}
	return redemption.Delete()
}

func DeleteInvalidRedemptions(tenantId int) (int64, error) {
	if tenantId <= 0 {
		return 0, errors.New("tenantId 不能为空")
	}
	now := common.GetTimestamp()
	result := DB.
		Where("tenant_id = ?", tenantId).
		Where("status IN ? OR (status = ? AND expired_time != 0 AND expired_time < ?)", []int{common.RedemptionCodeStatusUsed, common.RedemptionCodeStatusDisabled}, common.RedemptionCodeStatusEnabled, now).
		Delete(&Redemption{})
	return result.RowsAffected, result.Error
}
