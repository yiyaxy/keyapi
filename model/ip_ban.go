package model

import (
	"net"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
)

type IpBan struct {
	Id        int    `json:"id" gorm:"primaryKey;autoIncrement"`
	Ip        string `json:"ip" gorm:"type:varchar(64);uniqueIndex;not null"`
	Reason    string `json:"reason" gorm:"type:varchar(256)"`
	ExpireAt  int64  `json:"expire_at" gorm:"bigint;index"` // 0 = permanent
	CreatedBy int    `json:"created_by" gorm:"int"`
	CreatedAt int64  `json:"created_at" gorm:"bigint"`
}

func (IpBan) TableName() string {
	return "ip_bans"
}

var (
	ipBanList  []IpBan
	ipBanMutex sync.RWMutex
)

// LoadIpBanCache loads all active bans from DB into memory.
func LoadIpBanCache() {
	var bans []IpBan
	DB.Find(&bans)
	ipBanMutex.Lock()
	ipBanList = bans
	ipBanMutex.Unlock()
}

// IsIpBanned checks whether ip is banned. Returns (banned, reason).
func IsIpBanned(ip string) (bool, string) {
	parsedIP := net.ParseIP(ip)
	if parsedIP == nil {
		return false, ""
	}
	now := time.Now().Unix()
	ipBanMutex.RLock()
	defer ipBanMutex.RUnlock()
	for _, ban := range ipBanList {
		if ban.ExpireAt > 0 && ban.ExpireAt < now {
			continue // expired
		}
		if common.IsIpInCIDRList(parsedIP, []string{ban.Ip}) {
			return true, ban.Reason
		}
	}
	return false, ""
}

// BanIp inserts a ban record and refreshes the cache.
func BanIp(ip, reason string, expireAt int64, createdBy int) error {
	ban := IpBan{
		Ip:        ip,
		Reason:    reason,
		ExpireAt:  expireAt,
		CreatedBy: createdBy,
		CreatedAt: time.Now().Unix(),
	}
	err := DB.Create(&ban).Error
	if err != nil {
		return err
	}
	LoadIpBanCache()
	return nil
}

// UnbanIp deletes a ban record by IP and refreshes the cache.
func UnbanIp(ip string) error {
	err := DB.Where("ip = ?", ip).Delete(&IpBan{}).Error
	if err != nil {
		return err
	}
	LoadIpBanCache()
	return nil
}

// GetIpBanList returns all ban records.
func GetIpBanList() []IpBan {
	var bans []IpBan
	DB.Order("id DESC").Find(&bans)
	return bans
}

// CleanExpiredIpBans removes expired bans from DB and refreshes cache.
func CleanExpiredIpBans() {
	now := time.Now().Unix()
	DB.Where("expire_at > 0 AND expire_at < ?", now).Delete(&IpBan{})
	LoadIpBanCache()
}
