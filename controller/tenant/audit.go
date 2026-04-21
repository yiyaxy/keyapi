package tenant

import (
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// GetTenantAuditLogs 返回当前租户的审计日志（分页 + 可选过滤）。
//
// Query 参数：
//   - action：精确匹配的动作类型（可选）
//   - since：起始时间戳（unix 秒，可选）
//   - limit：每页行数，默认 50，最大 200
//   - offset：偏移，默认 0
func GetTenantAuditLogs(c *gin.Context) {
	tenantId := middleware.GetTenantId(c)
	if tenantId <= 0 {
		common.ApiErrorMsg(c, "租户信息无效")
		return
	}

	action := c.Query("action")
	since, _ := strconv.ParseInt(c.Query("since"), 10, 64)

	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}

	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	if offset < 0 {
		offset = 0
	}

	rows, total, err := model.ListTenantAuditLogs(tenantId, action, since, limit, offset)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"items":  rows,
			"total":  total,
			"limit":  limit,
			"offset": offset,
		},
	})
}
