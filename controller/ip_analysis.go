package controller

import (
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

// IpLookup returns geolocation info for a given IP.
func IpLookup(c *gin.Context) {
	ip := c.Query("ip")
	if ip == "" {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "ip is required"})
		return
	}
	info, err := service.LookupIP(ip)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": info})
}

// IpUsers returns users who logged in or made API calls from a given IP.
func IpUsers(c *gin.Context) {
	ip := c.Query("ip")
	if ip == "" {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "ip is required"})
		return
	}

	tenantId := middleware.GetTenantId(c)

	// Get login users
	loginUsers, err := model.GetDistinctUsersByIp(tenantId, ip)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}

	// Get API usage users
	apiUsers, err := model.GetUsersFromLogsByIp(tenantId, ip)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"login_users": loginUsers,
			"api_users":   apiUsers,
		},
	})
}

// IpAnalytics returns aggregated IP analytics data.
func IpAnalytics(c *gin.Context) {
	startTs, _ := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	endTs, _ := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)

	if startTs == 0 || endTs == 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "start_timestamp and end_timestamp are required"})
		return
	}

	tenantId := middleware.GetTenantId(c)
	result, err := model.GetIpAnalytics(tenantId, startTs, endTs)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": result})
}

// IpRecords returns paginated login records for a given IP.
func IpRecords(c *gin.Context) {
	ip := c.Query("ip")
	if ip == "" {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "ip is required"})
		return
	}
	page, _ := strconv.Atoi(c.DefaultQuery("p", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	tenantId := middleware.GetTenantId(c)
	records, total, err := model.GetIpRecordsByIp(tenantId, ip, page, pageSize)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"items": records,
			"total": total,
			"page":  page,
		},
	})
}

// GetUserIpHistory returns paginated IP history for a given user.
func GetUserIpHistory(c *gin.Context) {
	userId, _ := strconv.Atoi(c.Param("id"))
	if userId == 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "invalid user id"})
		return
	}
	page, _ := strconv.Atoi(c.DefaultQuery("p", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	tenantId := middleware.GetTenantId(c)
	records, total, err := model.GetIpRecordsByUserId(tenantId, userId, page, pageSize)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"items": records,
			"total": total,
			"page":  page,
		},
	})
}

// GetUserApiIpHistory returns paginated API usage IP records for a given user.
func GetUserApiIpHistory(c *gin.Context) {
	userId, _ := strconv.Atoi(c.Param("id"))
	if userId == 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "invalid user id"})
		return
	}
	page, _ := strconv.Atoi(c.DefaultQuery("p", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	tenantId := middleware.GetTenantId(c)
	records, total, err := model.GetApiIpRecordsByUserId(tenantId, userId, page, pageSize)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"items": records,
			"total": total,
			"page":  page,
		},
	})
}
