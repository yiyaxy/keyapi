package model

import "errors"

type TenantInvite struct {
	Id        int    `json:"id" gorm:"primaryKey"`
	TenantId  int    `json:"tenant_id" gorm:"index;not null"`
	Email     string `json:"email" gorm:"type:varchar(255);not null"`
	Token     string `json:"token" gorm:"type:varchar(128);uniqueIndex;not null"`
	Role      int    `json:"role" gorm:"type:int;default:1"`
	InvitedBy int    `json:"invited_by" gorm:"type:int;not null"`
	Status    int    `json:"status" gorm:"type:int;default:1"`
	ExpiresAt int64  `json:"expires_at" gorm:"bigint;not null"`
	CreatedAt int64  `json:"created_at" gorm:"bigint;autoCreateTime"`
}

const (
	TenantInviteStatusPending  = 1
	TenantInviteStatusAccepted = 2
	TenantInviteStatusExpired  = 3
)

func CreateTenantInvite(invite *TenantInvite) error {
	if invite == nil {
		return errors.New("invite is nil")
	}
	if invite.TenantId <= 0 || invite.Email == "" || invite.Token == "" {
		return errors.New("invalid invite parameters")
	}
	return WithTenantBypass(DB).Create(invite).Error
}

func GetTenantInviteByToken(token string) (*TenantInvite, error) {
	if token == "" {
		return nil, errors.New("token is empty")
	}
	var invite TenantInvite
	err := WithTenantBypass(DB).Where("token = ?", token).First(&invite).Error
	if err != nil {
		return nil, err
	}
	return &invite, nil
}

func MarkInviteAccepted(id int) error {
	return WithTenantBypass(DB).Model(&TenantInvite{}).
		Where("id = ?", id).
		Update("status", TenantInviteStatusAccepted).Error
}
