package model

import (
	"errors"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

// TenantBill 是租户的月度（或自定义周期）账单快照。
// 一个租户一个周期只有一条 open 状态记录；关闭后产生 closed 状态留档。
type TenantBill struct {
	Id             int            `json:"id" gorm:"primaryKey"`
	TenantId       int            `json:"tenant_id" gorm:"index;not null"`
	PeriodStart    int64          `json:"period_start" gorm:"bigint;not null;index"` // unix 秒
	PeriodEnd      int64          `json:"period_end" gorm:"bigint;not null"`
	QuotaUsed      int64          `json:"quota_used" gorm:"bigint;default:0"`
	RequestCount   int64          `json:"request_count" gorm:"bigint;default:0"`
	PlanName       string         `json:"plan_name" gorm:"type:varchar(64)"`
	PlanSnapshot   string         `json:"plan_snapshot" gorm:"type:text"` // JSON 序列化的 TenantPlan
	Status         string         `json:"status" gorm:"type:varchar(16);default:'open';index"`
	ClosedAt       int64          `json:"closed_at,omitempty" gorm:"bigint;default:0"`
	CreatedAt      int64          `json:"created_at" gorm:"bigint;autoCreateTime"`
	UpdatedAt      int64          `json:"updated_at" gorm:"bigint;autoUpdateTime"`
	DeletedAt      gorm.DeletedAt `json:"-" gorm:"index"`
}

const (
	TenantBillStatusOpen   = "open"
	TenantBillStatusClosed = "closed"
	TenantBillStatusPaid   = "paid" // 预留：未来若引入自助续费支付
)

// UpsertTenantBill 创建或更新一个 open 状态的账单快照。
// 若同租户同周期已存在 closed 账单则拒绝（历史不可变）。
func UpsertTenantBill(bill *TenantBill) error {
	if bill.TenantId <= 0 {
		return errors.New("invalid tenantId")
	}
	if bill.PeriodStart <= 0 || bill.PeriodEnd <= 0 || bill.PeriodEnd <= bill.PeriodStart {
		return errors.New("invalid period range")
	}
	var existing TenantBill
	err := DB.Where("tenant_id = ? AND period_start = ?", bill.TenantId, bill.PeriodStart).
		First(&existing).Error
	if err == nil {
		if existing.Status == TenantBillStatusClosed || existing.Status == TenantBillStatusPaid {
			return errors.New("该周期账单已关闭，不能再更新")
		}
		updates := map[string]interface{}{
			"quota_used":    bill.QuotaUsed,
			"request_count": bill.RequestCount,
			"plan_name":     bill.PlanName,
			"plan_snapshot": bill.PlanSnapshot,
			"period_end":    bill.PeriodEnd,
			"updated_at":    time.Now().Unix(),
		}
		return DB.Model(&existing).Where("tenant_id = ?", bill.TenantId).Updates(updates).Error
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	if bill.Status == "" {
		bill.Status = TenantBillStatusOpen
	}
	return DB.Create(bill).Error
}

// CloseTenantBill 关闭某条账单（open → closed）。
func CloseTenantBill(tenantId, billId int) error {
	if tenantId <= 0 || billId <= 0 {
		return errors.New("invalid params")
	}
	now := time.Now().Unix()
	res := DB.Model(&TenantBill{}).
		Where("id = ? AND tenant_id = ? AND status = ?", billId, tenantId, TenantBillStatusOpen).
		Updates(map[string]interface{}{
			"status":     TenantBillStatusClosed,
			"closed_at":  now,
			"updated_at": now,
		})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return errors.New("账单不存在、不属于当前租户或已关闭")
	}
	return nil
}

// ListTenantBills 分页列出租户账单。
func ListTenantBills(tenantId int, pageInfo *common.PageInfo, status string) ([]TenantBill, int64, error) {
	if tenantId <= 0 {
		return nil, 0, errors.New("invalid tenantId")
	}
	if pageInfo == nil {
		pageInfo = &common.PageInfo{Page: 1, PageSize: common.ItemsPerPage}
	}
	query := DB.Model(&TenantBill{}).Where("tenant_id = ?", tenantId)
	if status != "" {
		query = query.Where("status = ?", status)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var items []TenantBill
	err := query.Order("period_start DESC").
		Offset(pageInfo.GetStartIdx()).Limit(pageInfo.PageSize).
		Find(&items).Error
	return items, total, err
}

// GetCurrentBillPeriodRange 返回当前月份 [start, end) 的 unix 秒范围。
// 用于 generate-bill 默认周期（当前月初到当前时刻或当前月末）。
func GetCurrentBillPeriodRange(t time.Time) (int64, int64) {
	year, month, _ := t.Date()
	loc := t.Location()
	start := time.Date(year, month, 1, 0, 0, 0, 0, loc)
	end := start.AddDate(0, 1, 0)
	return start.Unix(), end.Unix()
}
