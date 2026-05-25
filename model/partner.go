package model

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

type PartnerUser struct {
	Id             int    `json:"id" gorm:"primaryKey"`
	TenantId       int    `json:"tenant_id" gorm:"uniqueIndex:uk_partner_user,priority:1;index;not null;default:1"`
	ClientId       string `json:"client_id" gorm:"uniqueIndex:uk_partner_user,priority:2;type:varchar(128);not null;default:''"`
	ExternalUserId string `json:"external_user_id" gorm:"uniqueIndex:uk_partner_user,priority:3;type:varchar(128);not null"`
	UserId         int    `json:"user_id" gorm:"index;not null"`
	CreatedAt      int64  `json:"created_at" gorm:"bigint;autoCreateTime"`
	UpdatedAt      int64  `json:"updated_at" gorm:"bigint;autoUpdateTime"`
}

type PartnerSSOTicket struct {
	Id        int    `json:"id" gorm:"primaryKey"`
	TenantId  int    `json:"tenant_id" gorm:"index;not null;default:1"`
	ClientId  string `json:"client_id" gorm:"type:varchar(128);index;not null;default:''"`
	UserId    int    `json:"user_id" gorm:"index;not null"`
	TokenHash string `json:"-" gorm:"type:char(64);uniqueIndex;not null"`
	ExpiresAt int64  `json:"expires_at" gorm:"bigint;index;not null"`
	CreatedAt int64  `json:"created_at" gorm:"bigint;autoCreateTime"`
}

type PartnerNonce struct {
	Id        int    `json:"id" gorm:"primaryKey"`
	TenantId  int    `json:"tenant_id" gorm:"uniqueIndex:uk_partner_nonce,priority:1;index;not null;default:1"`
	ClientId  string `json:"client_id" gorm:"uniqueIndex:uk_partner_nonce,priority:2;type:varchar(128);not null;default:''"`
	Nonce     string `json:"nonce" gorm:"uniqueIndex:uk_partner_nonce,priority:3;type:varchar(128);not null"`
	ExpiresAt int64  `json:"expires_at" gorm:"bigint;index;not null"`
	CreatedAt int64  `json:"created_at" gorm:"bigint;autoCreateTime"`
}

func HashPartnerTicket(ticket string) string {
	sum := sha256.Sum256([]byte(ticket))
	return hex.EncodeToString(sum[:])
}

func AcceptPartnerNonce(tenantId int, clientId string, nonce string, expiresAt int64) error {
	if tenantId <= 0 || strings.TrimSpace(clientId) == "" || strings.TrimSpace(nonce) == "" {
		return errors.New("invalid partner nonce")
	}
	now := common.GetTimestamp()
	_ = WithTenantBypass(DB).Where("expires_at < ?", now).Delete(&PartnerNonce{}).Error
	return WithTenantBypass(DB).Create(&PartnerNonce{
		TenantId:  tenantId,
		ClientId:  strings.TrimSpace(clientId),
		Nonce:     strings.TrimSpace(nonce),
		ExpiresAt: expiresAt,
	}).Error
}

func GetPartnerUser(tenantId int, clientId string, externalUserId string) (*PartnerUser, error) {
	if tenantId <= 0 || strings.TrimSpace(clientId) == "" || strings.TrimSpace(externalUserId) == "" {
		return nil, errors.New("invalid partner user")
	}
	var partnerUser PartnerUser
	err := WithTenantBypass(DB).
		Where("tenant_id = ? AND client_id = ? AND external_user_id = ?", tenantId, clientId, externalUserId).
		First(&partnerUser).Error
	return &partnerUser, err
}

func BindPartnerUser(tx *gorm.DB, tenantId int, clientId string, externalUserId string, userId int) error {
	if tenantId <= 0 || userId <= 0 || strings.TrimSpace(clientId) == "" || strings.TrimSpace(externalUserId) == "" {
		return errors.New("invalid partner user binding")
	}
	return WithTenantBypass(tx).Where("tenant_id = ? AND client_id = ? AND external_user_id = ?", tenantId, clientId, externalUserId).
		Assign(map[string]interface{}{"user_id": userId}).
		FirstOrCreate(&PartnerUser{
			TenantId:       tenantId,
			ClientId:       strings.TrimSpace(clientId),
			ExternalUserId: strings.TrimSpace(externalUserId),
			UserId:         userId,
		}).Error
}

func CreatePartnerSSOTicket(tenantId int, clientId string, userId int, ttlSeconds int64) (string, error) {
	if tenantId <= 0 || userId <= 0 || strings.TrimSpace(clientId) == "" {
		return "", errors.New("invalid partner sso ticket")
	}
	if ttlSeconds <= 0 {
		ttlSeconds = 60
	}
	ticket, err := common.GenerateKey()
	if err != nil {
		return "", err
	}
	record := &PartnerSSOTicket{
		TenantId:  tenantId,
		ClientId:  strings.TrimSpace(clientId),
		UserId:    userId,
		TokenHash: HashPartnerTicket(ticket),
		ExpiresAt: common.GetTimestamp() + ttlSeconds,
	}
	if err := WithTenantBypass(DB).Create(record).Error; err != nil {
		return "", err
	}
	return ticket, nil
}

func ConsumePartnerSSOTicket(ticket string) (*PartnerSSOTicket, error) {
	if strings.TrimSpace(ticket) == "" {
		return nil, errors.New("ticket is required")
	}
	now := common.GetTimestamp()
	hash := HashPartnerTicket(strings.TrimSpace(ticket))
	var record PartnerSSOTicket
	err := WithTenantBypass(DB).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("token_hash = ?", hash).First(&record).Error; err != nil {
			return err
		}
		if record.ExpiresAt < now {
			_ = tx.Delete(&record).Error
			return errors.New("ticket expired")
		}
		return tx.Delete(&record).Error
	})
	if err != nil {
		return nil, err
	}
	return &record, nil
}

func GetOrCreatePartnerToken(tenantId int, userId int, clientId string) (*Token, error) {
	if tenantId <= 0 || userId <= 0 || strings.TrimSpace(clientId) == "" {
		return nil, errors.New("invalid partner token")
	}
	name := fmt.Sprintf("partner-sso:%s", strings.TrimSpace(clientId))
	var token Token
	err := DB.Where("tenant_id = ? AND user_id = ? AND name = ?", tenantId, userId, name).
		Order("id asc").
		First(&token).Error
	if err == nil {
		emptyAllowIps := ""
		token.Status = common.TokenStatusEnabled
		token.ExpiredTime = -1
		token.UnlimitedQuota = true
		token.ModelLimitsEnabled = false
		token.ModelLimits = ""
		token.EnableImageGen = true
		token.AllowIps = &emptyAllowIps
		token.AccessedTime = common.GetTimestamp()
		if err := token.Update(); err != nil {
			return nil, err
		}
		return &token, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	key, err := common.GenerateKey()
	if err != nil {
		return nil, err
	}
	token = Token{
		TenantId:           tenantId,
		UserId:             userId,
		Name:               name,
		Key:                key,
		Status:             common.TokenStatusEnabled,
		CreatedTime:        common.GetTimestamp(),
		AccessedTime:       common.GetTimestamp(),
		ExpiredTime:        -1,
		UnlimitedQuota:     true,
		ModelLimitsEnabled: false,
		ModelLimits:        "",
		EnableImageGen:     true,
		Group:              "",
	}
	if err := token.Insert(); err != nil {
		return nil, err
	}
	return &token, nil
}
