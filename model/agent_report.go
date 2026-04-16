package model

import (
	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

const (
	ReportTypeDaily   = "daily"
	ReportTypeWeekly  = "weekly"
	ReportTypeMonthly = "monthly"
	ReportTypeTrend   = "trend"
	ReportTypeManual  = "manual"
)

const (
	ReportStatusGenerating = "generating"
	ReportStatusCompleted  = "completed"
	ReportStatusFailed     = "failed"
)

type AgentReport struct {
	Id          int    `json:"id" gorm:"primaryKey;autoIncrement"`
	TenantId    int    `json:"tenant_id" gorm:"index;default:1"`
	Title       string `json:"title" gorm:"type:varchar(255);not null"`
	ReportType  string `json:"report_type" gorm:"type:varchar(32);index;not null;default:'manual'"`
	Summary     string `json:"summary" gorm:"type:text"`
	HtmlContent string `json:"html_content,omitempty" gorm:"type:text"`
	AgentName   string `json:"agent_name" gorm:"type:varchar(64);index;not null"`
	Status      string `json:"status" gorm:"type:varchar(16);index;not null;default:'generating'"`
	CreatedAt   int64  `json:"created_at" gorm:"type:bigint;index"`
	UpdatedAt   int64  `json:"updated_at" gorm:"type:bigint"`
}

func (AgentReport) TableName() string {
	return "agent_reports"
}

func (r *AgentReport) BeforeCreate(tx *gorm.DB) error {
	if r.CreatedAt == 0 {
		r.CreatedAt = common.GetTimestamp()
	}
	r.UpdatedAt = common.GetTimestamp()
	return nil
}

func CreateAgentReport(report *AgentReport) error {
	return DB.Create(report).Error
}

func UpdateAgentReport(tenantId int, id int, updates map[string]interface{}) error {
	updates["updated_at"] = common.GetTimestamp()
	tx := DB.Model(&AgentReport{}).Where("id = ?", id)
	if tenantId > 0 {
		tx = tx.Where("tenant_id = ?", tenantId)
	}
	return tx.Updates(updates).Error
}

// GetAgentReports returns list WITHOUT html_content (too large for list view)
func GetAgentReports(tenantId int, page, pageSize int, reportType, keyword string) ([]AgentReport, int64, error) {
	var reports []AgentReport
	var total int64

	q := DB.Model(&AgentReport{})
	if tenantId > 0 {
		q = q.Where("tenant_id = ?", tenantId)
	}
	if reportType != "" {
		q = q.Where("report_type = ?", reportType)
	}
	if keyword != "" {
		q = q.Where("title LIKE ? OR summary LIKE ?", "%"+keyword+"%", "%"+keyword+"%")
	}

	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	offset := (page - 1) * pageSize
	if err := q.Select("id, title, report_type, summary, agent_name, status, created_at, updated_at").
		Order("id DESC").Offset(offset).Limit(pageSize).Find(&reports).Error; err != nil {
		return nil, 0, err
	}

	return reports, total, nil
}

// GetAgentReportById returns full report INCLUDING html_content
func GetAgentReportById(tenantId int, id int) (*AgentReport, error) {
	var report AgentReport
	tx := DB.Where("id = ?", id)
	if tenantId > 0 {
		tx = tx.Where("tenant_id = ?", tenantId)
	}
	if err := tx.First(&report).Error; err != nil {
		return nil, err
	}
	return &report, nil
}

func DeleteAgentReport(tenantId int, id int) error {
	tx := DB.Where("id = ?", id)
	if tenantId > 0 {
		tx = tx.Where("tenant_id = ?", tenantId)
	}
	return tx.Delete(&AgentReport{}).Error
}
