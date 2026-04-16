package model

import (
	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

const (
	AgentLogStatusRunning = "running"
	AgentLogStatusSuccess = "success"
	AgentLogStatusFailed  = "failed"
)

const (
	AgentLogCategoryProduction = "production"
	AgentLogCategoryLocal      = "local"
	AgentLogCategoryReadonly   = "readonly"
)

type AgentLog struct {
	Id          int    `json:"id" gorm:"primaryKey;autoIncrement"`
	TenantId    int    `json:"tenant_id" gorm:"index;default:1"`
	AdminId     int    `json:"admin_id" gorm:"index;not null"`
	AgentName   string `json:"agent_name" gorm:"type:varchar(64);index;not null"`
	Category    string `json:"category" gorm:"type:varchar(32);index;not null;default:'readonly'"`
	Action      string `json:"action" gorm:"type:varchar(512);not null"`
	Description string `json:"description" gorm:"type:varchar(255);default:''"`
	Status      string `json:"status" gorm:"type:varchar(16);index;not null;default:'running'"`
	Detail      string `json:"detail" gorm:"type:text"`
	CreatedAt   int64  `json:"created_at" gorm:"type:bigint;index"`
	UpdatedAt   int64  `json:"updated_at" gorm:"type:bigint"`
}

func (AgentLog) TableName() string {
	return "agent_logs"
}

func (l *AgentLog) BeforeCreate(tx *gorm.DB) error {
	if l.CreatedAt == 0 {
		l.CreatedAt = common.GetTimestamp()
	}
	l.UpdatedAt = common.GetTimestamp()
	return nil
}

func CreateAgentLog(log *AgentLog) error {
	return DB.Create(log).Error
}

func UpdateAgentLog(tenantId int, id int, updates map[string]interface{}) error {
	updates["updated_at"] = common.GetTimestamp()
	tx := DB.Model(&AgentLog{}).Where("id = ?", id)
	if tenantId > 0 {
		tx = tx.Where("tenant_id = ?", tenantId)
	}
	return tx.Updates(updates).Error
}

func GetAgentLogs(tenantId int, page, pageSize int, agentName, category, status, keyword string) ([]*AgentLog, int64, error) {
	var logs []*AgentLog
	var total int64

	q := DB.Model(&AgentLog{})
	if tenantId > 0 {
		q = q.Where("tenant_id = ?", tenantId)
	}
	if agentName != "" {
		q = q.Where("agent_name = ?", agentName)
	}
	if category != "" {
		q = q.Where("category = ?", category)
	}
	if status != "" {
		q = q.Where("status = ?", status)
	}
	if keyword != "" {
		q = q.Where("action LIKE ? OR detail LIKE ?", "%"+keyword+"%", "%"+keyword+"%")
	}

	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	offset := (page - 1) * pageSize
	if err := q.Order("id DESC").Offset(offset).Limit(pageSize).Find(&logs).Error; err != nil {
		return nil, 0, err
	}

	return logs, total, nil
}

func DeleteAgentLog(tenantId int, id int) error {
	tx := DB.Where("id = ?", id)
	if tenantId > 0 {
		tx = tx.Where("tenant_id = ?", tenantId)
	}
	return tx.Delete(&AgentLog{}).Error
}
