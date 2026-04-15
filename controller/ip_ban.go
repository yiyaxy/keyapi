package controller

import (
	"net"
	"net/http"

	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

type BanIpRequest struct {
	Ip       string `json:"ip" binding:"required"`
	Reason   string `json:"reason"`
	ExpireAt int64  `json:"expire_at"` // 0 = permanent
}

type UnbanIpRequest struct {
	Ip string `json:"ip" binding:"required"`
}

func BanIp(c *gin.Context) {
	var req BanIpRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "invalid request: " + err.Error()})
		return
	}
	// Validate IP or CIDR format
	if net.ParseIP(req.Ip) == nil {
		if _, _, err := net.ParseCIDR(req.Ip); err != nil {
			c.JSON(http.StatusOK, gin.H{"success": false, "message": "invalid IP or CIDR format"})
			return
		}
	}
	createdBy := c.GetInt("id")
	err := model.BanIp(req.Ip, req.Reason, req.ExpireAt, createdBy)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "IP banned successfully"})
}

func UnbanIp(c *gin.Context) {
	var req UnbanIpRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "invalid request: " + err.Error()})
		return
	}
	err := model.UnbanIp(req.Ip)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "IP unbanned successfully"})
}

func GetIpBans(c *gin.Context) {
	bans := model.GetIpBanList()
	c.JSON(http.StatusOK, gin.H{"success": true, "data": bans})
}
