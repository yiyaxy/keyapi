package model

type MessageTranslation struct {
	Id        int    `json:"id" gorm:"primaryKey;autoIncrement"`
	MessageId int    `json:"message_id" gorm:"uniqueIndex:idx_msg_lang"`
	Language  string `json:"language" gorm:"type:varchar(10);uniqueIndex:idx_msg_lang"`
	Title     string `json:"title" gorm:"type:varchar(255)"`
	Content   string `json:"content" gorm:"type:text"`
	CreatedAt int64  `json:"created_at" gorm:"bigint;autoCreateTime"`
}

func GetTranslation(messageId int, lang string) (*MessageTranslation, error) {
	var t MessageTranslation
	err := DB.Where("message_id = ? AND language = ?", messageId, lang).First(&t).Error
	if err != nil {
		return nil, err
	}
	return &t, nil
}

func SaveTranslation(t *MessageTranslation) error {
	return DB.Create(t).Error
}

func DeleteTranslationsByMessageId(id int) error {
	return DB.Where("message_id = ?", id).Delete(&MessageTranslation{}).Error
}
