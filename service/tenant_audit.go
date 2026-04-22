package service

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// tenantIdFromContext mirrors middleware.GetTenantId without creating an import cycle
// (middleware → service is the existing direction; service must not import middleware).
func tenantIdFromContext(c *gin.Context) int {
	if tid, exists := c.Get(string(constant.ContextKeyTenantId)); exists {
		if id, ok := tid.(int); ok && id > 0 {
			return id
		}
	}
	return 0
}

// 敏感 key 匹配（用于 detail 脱敏和 GET /api/tenant/config 脱敏）
var sensitiveKeyPattern = regexp.MustCompile(`(?i)password|secret|token|api[_-]?key|private[_-]?key|public[_-]?key|3?des[_-]?key`)

// roleLabel 把数值 role 转换为可读字符串。
func roleLabel(r int) string {
	switch r {
	case model.TenantRoleAdmin:
		return "tenant_admin"
	case model.TenantRoleMember:
		return "tenant_member"
	default:
		if r >= common.RoleRootUser {
			return "root"
		}
		if r >= common.RoleAdminUser {
			return "platform_admin"
		}
		if r > 0 {
			return fmt.Sprintf("role_%d", r)
		}
		return ""
	}
}

// RecordAudit 写入一条租户审计日志。Best-effort：失败仅记录系统日志，
// 绝不阻断主业务流程。
//
//   - action：动作类型（如 membership.invite / config.set / plan.update）
//   - target：目标实体类别（user / option / plan / alert / ...）
//   - targetId：目标实体 ID（无则传 0）
//   - detail：JSON-serializable 对象，用于补充上下文
func RecordAudit(c *gin.Context, action, target string, targetId int, detail any) {
	if c == nil || action == "" {
		return
	}
	tenantId := tenantIdFromContext(c)
	if tenantId <= 0 {
		return
	}

	actorUserId := c.GetInt("id")
	actorRole := ""
	if v, ok := c.Get("tenant_role"); ok {
		if r, ok := v.(int); ok {
			actorRole = roleLabel(r)
		}
	}
	if actorRole == "" {
		// fallback to platform role
		if v, ok := c.Get("platform_role"); ok {
			if r, ok := v.(int); ok {
				actorRole = roleLabel(r)
			}
		}
	}

	detailJSON := encodeAuditDetail(detail)

	if err := model.CreateTenantAuditLog(&model.TenantAuditLog{
		TenantId:    tenantId,
		ActorUserId: actorUserId,
		ActorRole:   actorRole,
		Action:      action,
		Target:      target,
		TargetId:    targetId,
		Detail:      detailJSON,
		ClientIP:    c.ClientIP(),
	}); err != nil {
		common.SysError(fmt.Sprintf(
			"tenant audit write failed (tenant=%d action=%s target=%s/%d): %s",
			tenantId, action, target, targetId, err.Error(),
		))
	}
}

// encodeAuditDetail JSON 编码，并对常见敏感字段做脱敏处理。
// 顶层 map 的 key 命中 sensitiveKeyPattern 时，对应 value 会被替换为 "(redacted)"。
func encodeAuditDetail(detail any) string {
	if detail == nil {
		return ""
	}
	// 尝试把 detail 转成 map 以便扫描敏感字段；若失败直接序列化原值
	b, err := json.Marshal(detail)
	if err != nil {
		return ""
	}
	var asMap map[string]any
	if err := json.Unmarshal(b, &asMap); err == nil && asMap != nil {
		redacted := false
		for k, v := range asMap {
			if sensitiveKeyPattern.MatchString(k) {
				asMap[k] = "(redacted)"
				redacted = true
				continue
			}
			// 长字符串截断到 200 字符，避免审计表暴涨
			if s, ok := v.(string); ok && len(s) > 200 {
				asMap[k] = s[:200] + "...(truncated)"
				redacted = true
			}
		}
		if redacted {
			if nb, err := json.Marshal(asMap); err == nil {
				return string(nb)
			}
		}
		return string(b)
	}
	// 非对象（数组/字符串/数字）直接返回；超长截断
	s := string(b)
	if len(s) > 2000 {
		return s[:2000] + "...(truncated)"
	}
	return s
}

// IsSensitiveConfigKey 暴露给 controller 用于判断 config.set 是否应脱敏 value。
func IsSensitiveConfigKey(key string) bool {
	return sensitiveKeyPattern.MatchString(strings.ToLower(key))
}
