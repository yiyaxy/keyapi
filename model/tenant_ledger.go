package model

import (
	"errors"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

// TenantLedger 是租户级资金变更流水（账本）。
// 每条记录对应一笔进出：充值 / 消费 / 退款 / 人工调整。
//
// balance_after 字段记录本笔变更后的租户总余额快照；写入时由业务方计算并传入
// （本包不提供加锁自增，业务方用事务保证一致性）。
type TenantLedger struct {
	Id           int            `json:"id" gorm:"primaryKey"`
	TenantId     int            `json:"tenant_id" gorm:"index;not null"`
	UserId       int            `json:"user_id" gorm:"default:0"` // 操作人（对于租户级不关联用户时填 0）
	LedgerType   string         `json:"ledger_type" gorm:"type:varchar(24);not null;index"`
	Amount       int64          `json:"amount" gorm:"bigint;not null"`        // 正数为收入/可用额度增，负数为支出
	BalanceAfter int64          `json:"balance_after" gorm:"bigint;not null"`
	Description  string         `json:"description" gorm:"type:varchar(512)"`
	RefType      string         `json:"ref_type" gorm:"type:varchar(24)"`  // 关联业务类型：topup / bill / order / manual
	RefId        int            `json:"ref_id" gorm:"default:0"`           // 关联业务记录 id
	CreatedAt    int64          `json:"created_at" gorm:"bigint;autoCreateTime;index"`
	DeletedAt    gorm.DeletedAt `json:"-" gorm:"index"`
}

const (
	TenantLedgerTypeTopup      = "topup"      // 租户充值
	TenantLedgerTypeConsume    = "consume"    // 租户消费（周期账单结转）
	TenantLedgerTypeRefund     = "refund"     // 退款
	TenantLedgerTypeAdjustment = "adjustment" // 平台调账
)

// IsValidLedgerType 校验 ledger_type 合法性。
func IsValidLedgerType(s string) bool {
	switch s {
	case TenantLedgerTypeTopup, TenantLedgerTypeConsume, TenantLedgerTypeRefund, TenantLedgerTypeAdjustment:
		return true
	}
	return false
}

// AppendTenantLedger 追加一条账本条目。
func AppendTenantLedger(entry *TenantLedger) error {
	if entry.TenantId <= 0 {
		return errors.New("invalid tenantId")
	}
	if !IsValidLedgerType(entry.LedgerType) {
		return errors.New("invalid ledger type")
	}
	return DB.Create(entry).Error
}

// ListTenantLedger 分页列出租户账本。
func ListTenantLedger(tenantId int, pageInfo *common.PageInfo, ledgerType string) ([]TenantLedger, int64, error) {
	if tenantId <= 0 {
		return nil, 0, errors.New("invalid tenantId")
	}
	if pageInfo == nil {
		pageInfo = &common.PageInfo{Page: 1, PageSize: common.ItemsPerPage}
	}
	query := DB.Model(&TenantLedger{}).Where("tenant_id = ?", tenantId)
	if ledgerType != "" {
		if !IsValidLedgerType(ledgerType) {
			return nil, 0, errors.New("invalid ledger type filter")
		}
		query = query.Where("ledger_type = ?", ledgerType)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var items []TenantLedger
	err := query.Order("created_at DESC").
		Offset(pageInfo.GetStartIdx()).Limit(pageInfo.PageSize).
		Find(&items).Error
	return items, total, err
}

// SumTenantLedgerBalance 基于账本流水计算租户当前余额。
// 通常仅用于对账/调试 —— 写路径应维护 BalanceAfter 字段。
func SumTenantLedgerBalance(tenantId int) (int64, error) {
	if tenantId <= 0 {
		return 0, errors.New("invalid tenantId")
	}
	var total int64
	err := DB.Model(&TenantLedger{}).
		Where("tenant_id = ?", tenantId).
		Select("COALESCE(SUM(amount), 0)").Scan(&total).Error
	return total, err
}
