// Per-tenant feature toggles managed by platform admins.
//
// Currently exposes a single flag — chat_history — which controls whether
// tenant admins of the target tenant may view captured chat history (the
// /admin/chat-history page + /api/chat_history/admin/* endpoints). Default
// is OFF so a fresh tenant has no access to anyone else's prompts; the
// platform admin must explicitly grant access per tenant.
//
// Routes (under platformTenantRoute, behind PlatformAdminAuth):
//   GET  /api/platform/tenants/:id/features
//   PUT  /api/platform/tenants/:id/features
package tenant

import (
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

// tenantFeaturesPayload mirrors the JSON shape used by both GET (response) and
// PUT (request). All fields are optional on PUT — only those present in the
// request body are applied, others are left untouched.
type tenantFeaturesPayload struct {
	ChatHistory *bool `json:"chat_history,omitempty"`
}

// tenantFeaturesView is the GET response. All fields are concrete bool —
// even ones never explicitly set are returned as their default (false).
type tenantFeaturesView struct {
	ChatHistory bool `json:"chat_history"`
}

func parseTenantId(c *gin.Context) (int, bool) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorMsg(c, "invalid tenant id")
		return 0, false
	}
	if model.GetTenantById(id) == nil {
		common.ApiErrorMsg(c, "tenant not found")
		return 0, false
	}
	return id, true
}

// GetTenantFeatures returns the current feature toggle snapshot for a tenant.
func GetTenantFeatures(c *gin.Context) {
	id, ok := parseTenantId(c)
	if !ok {
		return
	}
	common.ApiSuccess(c, tenantFeaturesView{
		ChatHistory: model.IsChatHistoryViewEnabled(id),
	})
}

// UpdateTenantFeatures applies the subset of feature toggles present in the
// request body. Omitted fields are not touched — a PUT with {} is a no-op.
func UpdateTenantFeatures(c *gin.Context) {
	id, ok := parseTenantId(c)
	if !ok {
		return
	}
	var req tenantFeaturesPayload
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "invalid request body")
		return
	}
	if req.ChatHistory != nil {
		if err := model.SetChatHistoryViewEnabled(id, *req.ChatHistory); err != nil {
			common.ApiError(c, err)
			return
		}
	}
	common.ApiSuccess(c, tenantFeaturesView{
		ChatHistory: model.IsChatHistoryViewEnabled(id),
	})
}
