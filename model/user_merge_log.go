package model

// UserMergeLog 记录一次账户合并事件，用于审计/客服排查。
// 合并是不可逆操作，这里保留关键的身份 & 额度快照，万一用户投诉
// 能迅速定位到源账户、目标账户以及合并前的余额情况。
type UserMergeLog struct {
	Id                int    `json:"id" gorm:"primaryKey"`
	TenantId          int    `json:"tenant_id" gorm:"index;not null;default:1"`
	SourceUserId      int    `json:"source_user_id" gorm:"index;not null"` // 被合并走的账户 (B)
	TargetUserId      int    `json:"target_user_id" gorm:"index;not null"` // 主账户 (A, PC)
	OperatorUserId    int    `json:"operator_user_id" gorm:"index;default:0"`
	WeChatId          string `json:"wechat_id" gorm:"type:varchar(128)"`
	MergedQuota       int    `json:"merged_quota" gorm:"default:0"`
	MergedUsedQuota   int    `json:"merged_used_quota" gorm:"default:0"`
	SourceUsername    string `json:"source_username" gorm:"type:varchar(64)"`
	SourceDisplayName string `json:"source_display_name" gorm:"type:varchar(64)"`
	SourceEmail       string `json:"source_email" gorm:"type:varchar(128)"`
	Reason            string `json:"reason" gorm:"type:varchar(64)"` // e.g. "wechat_bind"
	CreatedAt         int64  `json:"created_at" gorm:"bigint;autoCreateTime"`
}

func (UserMergeLog) TableName() string {
	return "user_merge_logs"
}
