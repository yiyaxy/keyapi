package model

import (
	"errors"
	"fmt"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
)

const (
	AffTransferStatusPending  = 1
	AffTransferStatusApproved = 2
	AffTransferStatusRejected = 3
)

type AffTransferRequest struct {
	Id          int    `json:"id" gorm:"primaryKey;autoIncrement"`
	UserId      int    `json:"user_id" gorm:"index"`
	Username    string `json:"username" gorm:"type:varchar(64)"`
	Quota       int    `json:"quota"`
	Status      int    `json:"status" gorm:"default:1;index"` // 1=pending 2=approved 3=rejected
	AdminId     int    `json:"admin_id" gorm:"default:0"`
	AdminRemark string `json:"admin_remark" gorm:"type:varchar(255)"`
	CreatedAt   int64  `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt   int64  `json:"updated_at" gorm:"autoUpdateTime"`
}

func CreateAffTransferRequest(req *AffTransferRequest) error {
	return DB.Create(req).Error
}

// GetPendingQuotaByUserId returns the total quota in pending transfer requests for a user
func GetPendingQuotaByUserId(userId int) (int, error) {
	var result struct{ Total int64 }
	err := DB.Model(&AffTransferRequest{}).
		Select("COALESCE(SUM(quota), 0) as total").
		Where("user_id = ? AND status = ?", userId, AffTransferStatusPending).
		Scan(&result).Error
	return int(result.Total), err
}

func GetAffTransferRequestsByUserId(userId int, page *common.PageInfo, status int) ([]AffTransferRequest, int64, error) {
	var requests []AffTransferRequest
	var total int64

	query := DB.Model(&AffTransferRequest{}).Where("user_id = ?", userId)
	if status > 0 {
		query = query.Where("status = ?", status)
	}

	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	if err := query.Order("id DESC").Offset(page.GetStartIdx()).Limit(page.GetPageSize()).Find(&requests).Error; err != nil {
		return nil, 0, err
	}

	return requests, total, nil
}

func GetAllAffTransferRequests(page *common.PageInfo, keyword string, status int) ([]AffTransferRequest, int64, error) {
	var requests []AffTransferRequest
	var total int64

	query := DB.Model(&AffTransferRequest{})
	if keyword != "" {
		query = query.Where("username LIKE ?", "%"+keyword+"%")
	}
	if status > 0 {
		query = query.Where("status = ?", status)
	}

	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	if err := query.Order("id DESC").Offset(page.GetStartIdx()).Limit(page.GetPageSize()).Find(&requests).Error; err != nil {
		return nil, 0, err
	}

	return requests, total, nil
}

func ApproveAffTransferRequest(id int, adminId int, remark string) error {
	tx := DB.Begin()
	defer tx.Rollback()

	var req AffTransferRequest
	if err := tx.Set("gorm:query_option", "FOR UPDATE").First(&req, id).Error; err != nil {
		return err
	}
	if req.Status != AffTransferStatusPending {
		return errors.New("该请求已处理")
	}

	var user User
	if err := tx.Set("gorm:query_option", "FOR UPDATE").First(&user, req.UserId).Error; err != nil {
		return err
	}
	if user.AffQuota < req.Quota {
		return fmt.Errorf("用户邀请额度不足，当前: %s，需要: %s", logger.LogQuota(user.AffQuota), logger.LogQuota(req.Quota))
	}

	user.AffQuota -= req.Quota
	user.Quota += req.Quota
	if err := tx.Save(&user).Error; err != nil {
		return err
	}

	req.Status = AffTransferStatusApproved
	req.AdminId = adminId
	req.AdminRemark = remark
	if err := tx.Save(&req).Error; err != nil {
		return err
	}

	return tx.Commit().Error
}

func RejectAffTransferRequest(id int, adminId int, remark string) error {
	result := DB.Model(&AffTransferRequest{}).Where("id = ? AND status = ?", id, AffTransferStatusPending).Updates(map[string]interface{}{
		"status":       AffTransferStatusRejected,
		"admin_id":     adminId,
		"admin_remark": remark,
	})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return errors.New("该请求已处理或不存在")
	}
	return nil
}

func GetAffTransferStats() (map[string]interface{}, error) {
	var pendingCount int64
	if err := DB.Model(&AffTransferRequest{}).Where("status = ?", AffTransferStatusPending).Count(&pendingCount).Error; err != nil {
		return nil, err
	}

	var approvedCount int64
	if err := DB.Model(&AffTransferRequest{}).Where("status = ?", AffTransferStatusApproved).Count(&approvedCount).Error; err != nil {
		return nil, err
	}

	var result struct{ Total int64 }
	if err := DB.Model(&AffTransferRequest{}).Select("COALESCE(SUM(quota), 0) as total").Where("status = ?", AffTransferStatusApproved).Scan(&result).Error; err != nil {
		return nil, err
	}

	return map[string]interface{}{
		"pending_count":        pendingCount,
		"approved_count":       approvedCount,
		"approved_total_quota": result.Total,
	}, nil
}

// BatchApproveAllPendingRequests approves all pending transfer requests
func BatchApproveAllPendingRequests(adminId int, remark string) (int, error) {
	tx := DB.Begin()
	defer tx.Rollback()

	var pendingRequests []AffTransferRequest
	if err := tx.Where("status = ?", AffTransferStatusPending).Order("id ASC").Find(&pendingRequests).Error; err != nil {
		return 0, err
	}

	successCount := 0
	for _, req := range pendingRequests {
		// Lock user row
		var user User
		if err := tx.Set("gorm:query_option", "FOR UPDATE").First(&user, req.UserId).Error; err != nil {
			common.SysLog(fmt.Sprintf("batch approve: skip request %d, user %d not found: %s", req.Id, req.UserId, err.Error()))
			continue
		}

		// Check if user has enough aff_quota
		if user.AffQuota < req.Quota {
			common.SysLog(fmt.Sprintf("batch approve: skip request %d, user %d insufficient quota (has %d, needs %d)", req.Id, req.UserId, user.AffQuota, req.Quota))
			continue
		}

		// Transfer quota
		user.AffQuota -= req.Quota
		user.Quota += req.Quota
		if err := tx.Save(&user).Error; err != nil {
			common.SysLog(fmt.Sprintf("batch approve: skip request %d, failed to update user %d: %s", req.Id, req.UserId, err.Error()))
			continue
		}

		// Update request status
		req.Status = AffTransferStatusApproved
		req.AdminId = adminId
		req.AdminRemark = remark
		if err := tx.Save(&req).Error; err != nil {
			common.SysLog(fmt.Sprintf("batch approve: skip request %d, failed to update request: %s", req.Id, err.Error()))
			continue
		}

		successCount++
	}

	if err := tx.Commit().Error; err != nil {
		return 0, err
	}

	return successCount, nil
}
