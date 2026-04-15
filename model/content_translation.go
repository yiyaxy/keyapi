package model

type ContentTranslation struct {
	Id          int    `json:"id" gorm:"primaryKey;autoIncrement"`
	ContentType string `json:"content_type" gorm:"type:varchar(64);uniqueIndex:idx_ct_lang"`
	ContentId   string `json:"content_id" gorm:"type:varchar(128);uniqueIndex:idx_ct_lang"`
	Language    string `json:"language" gorm:"type:varchar(10);uniqueIndex:idx_ct_lang"`
	Fields      string `json:"fields" gorm:"type:text"`
	SourceHash  string `json:"source_hash" gorm:"type:varchar(64)"`
	CreatedAt   int64  `json:"created_at" gorm:"bigint;autoCreateTime"`
}

func GetContentTranslation(contentType, contentId, lang string) (*ContentTranslation, error) {
	var t ContentTranslation
	err := DB.Where("content_type = ? AND content_id = ? AND language = ?", contentType, contentId, lang).First(&t).Error
	if err != nil {
		return nil, err
	}
	return &t, nil
}

func SaveContentTranslation(t *ContentTranslation) error {
	var existing ContentTranslation
	err := DB.Where("content_type = ? AND content_id = ? AND language = ?",
		t.ContentType, t.ContentId, t.Language).First(&existing).Error
	if err == nil {
		return DB.Model(&existing).Updates(map[string]interface{}{
			"fields":      t.Fields,
			"source_hash": t.SourceHash,
		}).Error
	}
	return DB.Create(t).Error
}

func DeleteContentTranslationsByType(contentType string) error {
	return DB.Where("content_type = ?", contentType).Delete(&ContentTranslation{}).Error
}

func DeleteContentTranslationsByTypeAndId(contentType, contentId string) error {
	return DB.Where("content_type = ? AND content_id = ?", contentType, contentId).Delete(&ContentTranslation{}).Error
}
