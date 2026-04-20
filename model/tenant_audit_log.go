package model

import (
	"errors"

	"gorm.io/gorm"
)

// TenantAuditLog 是租户级管理操作的审计记录。
//
// 范围：仅记录租户管理员（或平台管理员代为操作）执行的关键管理动作，
// 不记录普通业务请求（普通请求请使用 logs 表）。
//
// 写入策略：best-effort —— 写入失败仅记录系统日志，不影响主业务流程。
type TenantAuditLog struct {
	Id          int            `json:"id" gorm:"primaryKey"`
	TenantId    int            `json:"tenant_id" gorm:"index;not null"`
	ActorUserId int            `json:"actor_user_id" gorm:"index"`
	ActorRole   string         `json:"actor_role" gorm:"type:varchar(32)"`
	Action      string         `json:"action" gorm:"type:varchar(64);index"`  // e.g. membership.invite
	Target      string         `json:"target" gorm:"type:varchar(128)"`       // e.g. user / config / plan
	TargetId    int            `json:"target_id"`
	Detail      string         `json:"detail" gorm:"type:text"` // JSON-encoded
	ClientIP    string         `json:"client_ip" gorm:"type:varchar(64)"`
	CreatedAt   int64          `json:"created_at" gorm:"autoCreateTime;index"`
	DeletedAt   gorm.DeletedAt `json:"-" gorm:"index"`
}

// CreateTenantAuditLog 写入一条审计记录。
// tenantId 必填且 > 0，否则视为非租户上下文，跳过写入。
func CreateTenantAuditLog(log *TenantAuditLog) error {
	if log == nil {
		return errors.New("nil audit log")
	}
	if log.TenantId <= 0 {
		return errors.New("invalid tenantId")
	}
	if log.Action == "" {
		return errors.New("action required")
	}
	return DB.Create(log).Error
}

// CreateTenantAuditLogTx writes an audit record on the caller-supplied
// transaction. Required for any audit write that must be atomic with a
// business state change — e.g. payment success in
// service/payment/order.go. Plain CreateTenantAuditLog uses the global
// DB and would persist even if the outer tx rolls back.
func CreateTenantAuditLogTx(tx *gorm.DB, log *TenantAuditLog) error {
	if log == nil {
		return errors.New("nil audit log")
	}
	if log.TenantId <= 0 {
		return errors.New("invalid tenantId")
	}
	if log.Action == "" {
		return errors.New("action required")
	}
	if tx == nil {
		return errors.New("nil tx; use CreateTenantAuditLog for non-tx writes")
	}
	return tx.Create(log).Error
}

// ListTenantAuditLogs 返回租户审计记录（按时间倒序，分页）。
//
// 参数：
//   - tenantId：必填，强制隔离
//   - action：可选，按动作精确匹配（空字符串表示不过滤）
//   - since：可选，仅返回 created_at >= since 的记录（0 表示不过滤）
//   - limit：单次最大返回行数（caller 已限制 ≤ 200）
//   - offset：偏移
//
// 返回 (records, totalCount, error)。
func ListTenantAuditLogs(tenantId int, action string, since int64, limit, offset int) ([]TenantAuditLog, int64, error) {
	if tenantId <= 0 {
		return nil, 0, errors.New("invalid tenantId")
	}
	if limit <= 0 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	query := DB.Model(&TenantAuditLog{}).Where("tenant_id = ?", tenantId)
	if action != "" {
		query = query.Where("action = ?", action)
	}
	if since > 0 {
		query = query.Where("created_at >= ?", since)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var items []TenantAuditLog
	err := query.Order("created_at DESC").Offset(offset).Limit(limit).Find(&items).Error
	return items, total, err
}
