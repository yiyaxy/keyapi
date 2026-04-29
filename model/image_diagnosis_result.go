package model

import (
	"errors"

	"gorm.io/gorm/clause"
)

const ImageDiagnosisResultTTLSeconds int64 = 72 * 60 * 60

type ImageDiagnosisResult struct {
	Id             int    `json:"id"`
	TenantId       int    `json:"tenant_id" gorm:"index;not null;default:1"`
	OwnerKey       string `json:"owner_key" gorm:"type:varchar(128);index;not null"`
	ResultId       string `json:"result_id" gorm:"type:varchar(80);uniqueIndex;not null"`
	TaskId         string `json:"task_id" gorm:"type:varchar(80);index;default:''"`
	UpstreamTaskId string `json:"upstream_task_id" gorm:"type:varchar(128);index;default:''"`
	AppType        string `json:"app_type" gorm:"type:varchar(64);index;not null"`
	AppTitle       string `json:"app_title" gorm:"type:varchar(128);default:''"`
	ImageUrl       string `json:"image_url" gorm:"type:text"`
	PosterUrl      string `json:"poster_url" gorm:"type:text"`
	Status         string `json:"status" gorm:"type:varchar(32);index;default:'pending'"`
	Progress       int    `json:"progress" gorm:"default:0"`
	Message        string `json:"message" gorm:"type:varchar(512);default:''"`
	Option         string `json:"option" gorm:"type:varchar(64);default:''"`
	OptionLabel    string `json:"option_label" gorm:"type:varchar(128);default:''"`
	Model          string `json:"model" gorm:"type:varchar(128);default:''"`
	Prompt         string `json:"prompt" gorm:"type:text"`
	Settings       string `json:"settings" gorm:"type:text"`
	CreatedAtMs    int64  `json:"created_at" gorm:"bigint;index"`
	ExpiresAtMs    int64  `json:"expires_at" gorm:"bigint;index"`
	UpdatedAt      int64  `json:"updated_at" gorm:"bigint;autoUpdateTime"`
}

func (ImageDiagnosisResult) TableName() string {
	return "image_diagnosis_results"
}

func UpsertImageDiagnosisResult(record *ImageDiagnosisResult) error {
	if record == nil {
		return errors.New("record is nil")
	}
	return WithTenantBypass(DB).Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "result_id"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"tenant_id",
			"owner_key",
			"task_id",
			"upstream_task_id",
			"app_type",
			"app_title",
			"image_url",
			"poster_url",
			"status",
			"progress",
			"message",
			"option",
			"option_label",
			"model",
			"prompt",
			"settings",
			"created_at_ms",
			"expires_at_ms",
		}),
	}).Create(record).Error
}

func ListImageDiagnosisResults(tenantId int, ownerKey string, nowMs int64) ([]ImageDiagnosisResult, error) {
	var records []ImageDiagnosisResult
	err := WithTenantBypass(DB).
		Where("tenant_id = ? AND owner_key = ? AND expires_at_ms > ?", tenantId, ownerKey, nowMs).
		Order("created_at_ms DESC").
		Limit(50).
		Find(&records).Error
	return records, err
}

func GetImageDiagnosisResult(tenantId int, ownerKey string, resultId string, nowMs int64) (*ImageDiagnosisResult, error) {
	var record ImageDiagnosisResult
	err := WithTenantBypass(DB).
		Where("tenant_id = ? AND owner_key = ? AND result_id = ? AND expires_at_ms > ?", tenantId, ownerKey, resultId, nowMs).
		First(&record).Error
	if err != nil {
		return nil, err
	}
	return &record, nil
}

func DeleteExpiredImageDiagnosisResults(nowMs int64) error {
	return WithTenantBypass(DB).Where("expires_at_ms <= ?", nowMs).Delete(&ImageDiagnosisResult{}).Error
}
