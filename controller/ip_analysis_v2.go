package controller

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

// parseTimestamps extracts and validates start_timestamp and end_timestamp from query params.
func parseTimestamps(c *gin.Context) (int64, int64, bool) {
	startStr := c.Query("start_timestamp")
	endStr := c.Query("end_timestamp")
	start, err1 := strconv.ParseInt(startStr, 10, 64)
	end, err2 := strconv.ParseInt(endStr, 10, 64)
	if err1 != nil || err2 != nil || start >= end {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "invalid time range"})
		return 0, 0, false
	}
	return start, end, true
}

// IpOverviewV2 returns aggregated IP analytics overview for the given time range.
func IpOverviewV2(c *gin.Context) {
	start, end, ok := parseTimestamps(c)
	if !ok {
		return
	}
	data, err := model.GetIpAnalyticsOverviewV2(start, end)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

// LoginGeoDist returns login geographic distribution for the given time range.
func LoginGeoDist(c *gin.Context) {
	start, end, ok := parseTimestamps(c)
	if !ok {
		return
	}
	data, err := model.GetLoginGeoDist(start, end)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

// LoginTimePattern returns login time pattern analysis for the given time range.
func LoginTimePattern(c *gin.Context) {
	start, end, ok := parseTimestamps(c)
	if !ok {
		return
	}
	data, err := model.GetLoginTimePattern(start, end)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

// LoginTypeDetail returns login type breakdown for the given time range.
func LoginTypeDetail(c *gin.Context) {
	start, end, ok := parseTimestamps(c)
	if !ok {
		return
	}
	data, err := model.GetLoginTypeDetail(start, end)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

// MultiAccountIps returns IPs associated with multiple user accounts.
func MultiAccountIps(c *gin.Context) {
	start, end, ok := parseTimestamps(c)
	if !ok {
		return
	}
	minUsers, _ := strconv.Atoi(c.DefaultQuery("min_users", "2"))
	if minUsers < 2 {
		minUsers = 2
	}
	page, _ := strconv.Atoi(c.DefaultQuery("p", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	items, total, err := model.GetMultiAccountIps(start, end, minUsers, page, pageSize)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    gin.H{"items": items, "total": total},
	})
}

// ApiTopIps returns the top IPs by API usage for the given time range.
func ApiTopIps(c *gin.Context) {
	start, end, ok := parseTimestamps(c)
	if !ok {
		return
	}
	data, err := model.GetApiTopIps(start, end)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    gin.H{"items": data},
	})
}

// ApiGeoDist returns API usage geographic distribution for the given time range.
func ApiGeoDist(c *gin.Context) {
	start, end, ok := parseTimestamps(c)
	if !ok {
		return
	}
	data, err := model.GetApiGeoDist(start, end)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

// ApiTimePattern returns API usage time pattern analysis for the given time range.
func ApiTimePattern(c *gin.Context) {
	start, end, ok := parseTimestamps(c)
	if !ok {
		return
	}
	data, err := model.GetApiTimePattern(start, end)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

// HighFreqIps returns IPs with request frequency above the given threshold.
func HighFreqIps(c *gin.Context) {
	start, end, ok := parseTimestamps(c)
	if !ok {
		return
	}
	threshold, _ := strconv.Atoi(c.DefaultQuery("threshold", "100"))
	if threshold < 1 {
		threshold = 100
	}
	data, err := model.GetHighFreqIps(start, end, threshold)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    gin.H{"items": data},
	})
}

// ApiIpModelUsage returns model usage breakdown for a specific IP.
func ApiIpModelUsage(c *gin.Context) {
	ip := c.Query("ip")
	if ip == "" {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "ip is required"})
		return
	}
	start, end, ok := parseTimestamps(c)
	if !ok {
		return
	}
	data, err := model.GetApiIpModelUsage(ip, start, end)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

// IpMismatch returns IPs where login and API usage locations differ significantly.
func IpMismatch(c *gin.Context) {
	start, end, ok := parseTimestamps(c)
	if !ok {
		return
	}
	data, err := model.GetIpMismatch(start, end)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    gin.H{"items": data},
	})
}

// IpRiskScores returns risk scores for IPs based on behavioral analysis.
func IpRiskScores(c *gin.Context) {
	start, end, ok := parseTimestamps(c)
	if !ok {
		return
	}
	data, err := model.GetIpRiskScores(start, end)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    gin.H{"items": data},
	})
}

// UserIpSummary returns per-user IP count summary (login + API), sorted by total descending.
func UserIpSummary(c *gin.Context) {
	start, end, ok := parseTimestamps(c)
	if !ok {
		return
	}
	data, err := model.GetUserIpSummary(start, end)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    gin.H{"items": data},
	})
}

// NewIps returns IPs that appeared for the first time within the given time range.
func NewIps(c *gin.Context) {
	start, end, ok := parseTimestamps(c)
	if !ok {
		return
	}
	data, err := model.GetNewIps(start, end)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    gin.H{"items": data},
	})
}

// DisableMultiAccountUsersRequest is the request payload for disabling users sharing the same IP.
type DisableMultiAccountUsersRequest struct {
	Ip        string `json:"ip" binding:"required"`
	MinUsers  int    `json:"min_users"`
	DryRun    *bool  `json:"dry_run"`
	AlsoBanIp bool   `json:"also_ban_ip"`
	Reason    string `json:"reason"`
}

// disablePreviewItem represents a user candidate for IP-based bulk disable.
type disablePreviewItem struct {
	UserId      int    `json:"user_id"`
	Username    string `json:"username"`
	Role        int    `json:"role"`
	Status      int    `json:"status"`
	LoginCount  int64  `json:"login_count"`
	LastLogin   int64  `json:"last_login"`
	ApiCount    int64  `json:"api_count"`
	LastApi     int64  `json:"last_api"`
	LastSeen    int64  `json:"last_seen"`
	WillDisable bool   `json:"will_disable"`
	SkipReason  string `json:"skip_reason,omitempty"`
	WasDisabled bool   `json:"was_disabled"`
	IsProtected bool   `json:"is_protected"`
	IsAdminOrUp bool   `json:"is_admin_or_up"`
	IsRoot      bool   `json:"is_root"`
	SelfProtect bool   `json:"self_protect"`
}

// DisableMultiAccountUsersByIp disables multiple user accounts that share a login/API IP within a time window.
// Route: POST /api/ip/v2/login/multi_account/disable_users
func DisableMultiAccountUsersByIp(c *gin.Context) {
	start, end, ok := parseTimestamps(c)
	if !ok {
		return
	}

	var req DisableMultiAccountUsersRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "invalid request: " + err.Error()})
		return
	}
	if strings.TrimSpace(req.Ip) == "" {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "ip is required"})
		return
	}

	minUsers := req.MinUsers
	if minUsers == 0 {
		minUsers = 2
	}
	if minUsers < 2 {
		minUsers = 2
	}

	dryRun := true
	if req.DryRun != nil {
		dryRun = *req.DryRun
	}

	reason := strings.TrimSpace(req.Reason)
	if reason == "" {
		reason = "disable users sharing IP " + req.Ip + " within [" + strconv.FormatInt(start, 10) + "," + strconv.FormatInt(end, 10) + "]"
	}

	activity, err := model.GetIpUserActivityV2(req.Ip, start, end)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}

	distinctUsers := len(activity)
	if distinctUsers < minUsers {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "distinct users below threshold",
			"data": gin.H{
				"ip":                  req.Ip,
				"distinct_user_count": distinctUsers,
				"min_users":           minUsers,
			},
		})
		return
	}

	userIds := make([]int, 0, distinctUsers)
	for uid := range activity {
		userIds = append(userIds, uid)
	}

	var users []model.User
	if err := model.DB.Unscoped().Select("id, username, role, status").Where("id IN ?", userIds).Find(&users).Error; err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	userById := make(map[int]model.User, len(users))
	for _, u := range users {
		userById[u.Id] = u
	}

	operatorId := c.GetInt("id")
	operatorRole := c.GetInt("role")

	preview := make([]disablePreviewItem, 0, distinctUsers)
	disableTargets := make([]int, 0, distinctUsers)
	for uid, a := range activity {
		u, ok := userById[uid]
		if !ok {
			continue
		}
		p := disablePreviewItem{
			UserId:      uid,
			Username:    u.Username,
			Role:        u.Role,
			Status:      u.Status,
			LoginCount:  a.LoginCount,
			LastLogin:   a.LastLogin,
			ApiCount:    a.ApiCount,
			LastApi:     a.LastApi,
			LastSeen:    a.LastSeen,
			WasDisabled: u.Status != common.UserStatusEnabled,
			IsRoot:      u.Role == common.RoleRootUser,
			IsAdminOrUp: u.Role >= common.RoleAdminUser,
		}
		if p.IsRoot {
			p.IsProtected = true
			p.SkipReason = "root user"
		} else if p.IsAdminOrUp {
			p.IsProtected = true
			p.SkipReason = "admin user"
		} else if u.Status != common.UserStatusEnabled {
			p.SkipReason = "already disabled"
		} else if operatorRole != common.RoleRootUser && uid == operatorId {
			p.SelfProtect = true
			p.SkipReason = "self protect"
		} else {
			p.WillDisable = true
			disableTargets = append(disableTargets, uid)
		}
		preview = append(preview, p)
	}

	// dry run: return preview only
	if dryRun {
		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"data": gin.H{
				"ip":                  req.Ip,
				"start_timestamp":      start,
				"end_timestamp":        end,
				"distinct_user_count":  distinctUsers,
				"min_users":            minUsers,
				"dry_run":              true,
				"also_ban_ip":          req.AlsoBanIp,
				"reason":               reason,
				"items":                preview,
				"targets":              preview,
				"will_disable_user_ids": disableTargets,
				"summary": gin.H{
					"will_disable_count":    len(disableTargets),
					"already_disabled":      countSkipReason(preview, "already disabled"),
					"skipped":               len(preview) - len(disableTargets),
				},
			},
		})
		return
	}

	// execute
	disabled := make([]int, 0, len(disableTargets))
	skipped := make([]int, 0, len(preview))
	for _, p := range preview {
		if !p.WillDisable {
			skipped = append(skipped, p.UserId)
			continue
		}
		u := model.User{Id: p.UserId}
		model.DB.Unscoped().Where(&u).First(&u)
		if u.Id == 0 {
			skipped = append(skipped, p.UserId)
			continue
		}
		if u.Status != common.UserStatusEnabled {
			skipped = append(skipped, p.UserId)
			continue
		}
		u.Status = common.UserStatusDisabled
		if err := u.Update(false); err != nil {
			c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
			return
		}
		disabled = append(disabled, p.UserId)
	}

	banBefore := false
	banReason := ""
	banAfter := false
	if req.AlsoBanIp {
		banBefore, banReason = model.IsIpBanned(req.Ip)
		err := model.BanIp(req.Ip, reason, 0, operatorId)
		if err != nil {
			c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
			return
		}
		banAfter, _ = model.IsIpBanned(req.Ip)
	}

	// audit/manage log
	auditSummary := "disable multi-account users by ip=" + req.Ip + ", window=[" + strconv.FormatInt(start, 10) + "," + strconv.FormatInt(end, 10) + "]" + ", disabled=" + strconv.Itoa(len(disabled)) + ", skipped=" + strconv.Itoa(len(skipped))
	model.RecordLog(operatorId, model.LogTypeManage, auditSummary)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "已禁用 " + strconv.Itoa(len(disabled)) + " 个账号",
		"data": gin.H{
			"ip":                  req.Ip,
			"start_timestamp":      start,
			"end_timestamp":        end,
			"distinct_user_count":  distinctUsers,
			"min_users":            minUsers,
			"dry_run":              false,
			"also_ban_ip":          req.AlsoBanIp,
			"reason":               reason,
			"disabled_user_ids":     disabled,
			"skipped_user_ids":      skipped,
			"summary": gin.H{
				"will_disable_count": len(disabled),
				"already_disabled":   countSkipReason(preview, "already disabled"),
				"skipped":            len(skipped),
			},
			"ip_ban_before":         banBefore,
			"ip_ban_before_reason":  banReason,
			"ip_ban_after":          banAfter,
		},
	})
}

func countSkipReason(items []disablePreviewItem, reason string) int {
	n := 0
	for _, p := range items {
		if p.SkipReason == reason {
			n++
		}
	}
	return n
}
