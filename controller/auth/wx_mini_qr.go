package auth

import (
	"encoding/base64"
	usercontroller "github.com/QuantumNous/new-api/controller/user"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
)

// WeChat mini-program scan-to-login flow (PC web):
//   1. Web POSTs /api/oauth/wx_qr/ticket              → server returns {ticket, qr_image}
//   2. Web polls GET /api/oauth/wx_qr/poll?ticket=... → {status: pending|confirmed|expired}
//   3. User scans; mini-program `pages/qr-confirm/index` reads scene=<ticket>
//      and POSTs /api/oauth/wx_qr/confirm {ticket, code}
//   4. Web POSTs /api/oauth/wx_qr/login {ticket} → setupLogin (session cookie)

// wxQrMiniPage is the mini-program page that receives scanned QR.
// Keep in sync with wxapp/src/pages.json.
const wxQrMiniPage = "pages/qr-confirm/index"

type wxQrTicketResponse struct {
	Ticket    string `json:"ticket"`
	QrImage   string `json:"qr_image"` // data URL: "data:image/png;base64,..."
	ExpiresIn int    `json:"expires_in"`
}

type wxQrPollResponse struct {
	Status string `json:"status"` // "pending" | "confirmed" | "expired"
}

type wxQrConfirmRequest struct {
	Ticket string `json:"ticket"`
	Code   string `json:"code"`
}

type wxQrLoginRequest struct {
	Ticket string `json:"ticket"`
}

// GenerateWxQrTicket handles POST /api/oauth/wx_qr/ticket.
// Called by the PC web app to start a scan-login session.
// The ticket is scoped to the resolved tenant so scanned users log in
// to the correct tenant even if multiple tenants share the mini-program.
func GenerateWxQrTicket(c *gin.Context) {
	tenantId := middleware.GetTenantId(c)
	if !service.IsWxMiniLoginEnabled(tenantId) {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "管理员未开启微信小程序登录",
		})
		return
	}

	ticket, err := service.CreateWxQrTicket(tenantId)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	envVersion := strings.TrimSpace(common.OptionMap["WxMiniEnvVersion"])
	png, err := service.GetWxaCodeUnlimited(tenantId, ticket.Ticket, wxQrMiniPage, envVersion)
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}

	dataURL := "data:image/png;base64," + base64.StdEncoding.EncodeToString(png)

	common.ApiSuccess(c, wxQrTicketResponse{
		Ticket:    ticket.Ticket,
		QrImage:   dataURL,
		ExpiresIn: service.WxQrTicketTTLSeconds,
	})
}

// PollWxQrTicket handles GET /api/oauth/wx_qr/poll?ticket=...
// Cheap, frequent call used by the web frontend to watch for confirmation.
func PollWxQrTicket(c *gin.Context) {
	ticket := c.Query("ticket")
	t, err := service.GetWxQrTicket(ticket)
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	if t == nil {
		common.ApiSuccess(c, wxQrPollResponse{Status: "expired"})
		return
	}
	common.ApiSuccess(c, wxQrPollResponse{Status: t.Status})
}

// ConfirmWxQrTicket handles POST /api/oauth/wx_qr/confirm.
// Called from the mini-program after the user scans and taps "confirm".
// Body: {ticket, code}. No session auth — the WeChat code itself proves
// identity via jscode2session.
//
// Dispatches by ticket.Purpose:
//   - login (default): resolve/create a user, mark ticket confirmed with that
//     user id so the PC /login endpoint can issue a session.
//   - bind: resolve openid only (no user creation), decide if binding is a
//     clean add or requires a merge (another account in the same tenant
//     already holds this openid), and record that decision on the ticket.
func ConfirmWxQrTicket(c *gin.Context) {
	var req wxQrConfirmRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorMsg(c, "无效的请求")
		return
	}
	if req.Ticket == "" || req.Code == "" {
		common.ApiErrorMsg(c, "ticket 或 code 为空")
		return
	}

	t, err := service.GetWxQrTicket(req.Ticket)
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	if t == nil {
		common.ApiErrorMsg(c, service.ErrWxQrTicketNotFound.Error())
		return
	}

	// Ticket carries the originating tenant; use it as the authority,
	// not the mini-program's default tenant context.
	if !service.IsWxMiniLoginEnabled(t.TenantId) {
		common.ApiErrorMsg(c, "管理员未开启微信小程序登录")
		return
	}

	if t.Purpose == service.WxQrPurposeBind {
		confirmWxQrBindTicket(c, t, req.Code)
		return
	}

	// Default: login purpose (ticket.Purpose empty = legacy login ticket).
	// Scoped to the tenant the web session belongs to, NOT the tenant of the
	// mini-program request (mini-program has no real tenant context).
	user, err := wxMiniResolveUser(req.Code, t.TenantId, 0)
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	if user.Status != common.UserStatusEnabled {
		common.ApiErrorMsg(c, "用户已被封禁")
		return
	}

	if err := service.ConfirmWxQrTicket(req.Ticket, user.Id); err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	common.ApiSuccess(c, gin.H{"confirmed": true})
}

// confirmWxQrBindTicket decides whether the scan produces a clean bind, an
// idempotent no-op, or a merge-required state. Never creates a user.
func confirmWxQrBindTicket(c *gin.Context, t *service.WxQrTicket, code string) {
	openid, err := service.ExchangeWxMiniCode(t.TenantId, code)
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	wechatId := wxMiniIdPrefix + openid

	// Initiator (A): the PC-logged-in user who created the ticket. The
	// ticket only makes sense while that user is still active on the web.
	initiator, err := model.GetUserByIdGlobal(t.UserId, true)
	if err != nil {
		common.ApiErrorMsg(c, "发起绑定的账户已失效，请刷新")
		return
	}
	if initiator.TenantId != t.TenantId {
		common.ApiErrorMsg(c, "站点与绑定会话不匹配")
		return
	}
	if initiator.Status != common.UserStatusEnabled {
		common.ApiErrorMsg(c, "发起绑定的账户已被禁用")
		return
	}

	t.MergeCandidateOpenId = wechatId

	// Idempotent: A already bound to this WeChat — just mark confirmed so PC
	// finalize resolves to "already bound, nothing to do" (or a no-op write).
	if initiator.WeChatId == wechatId {
		t.Status = service.WxQrStatusConfirmed
		if err := service.UpdateWxQrTicket(t); err != nil {
			common.ApiErrorMsg(c, err.Error())
			return
		}
		common.ApiSuccess(c, gin.H{"confirmed": true})
		return
	}

	if !model.IsWeChatIdAlreadyTaken(wechatId, t.TenantId) {
		// Clean path: no conflict, PC finalize will just write wechat_id.
		t.Status = service.WxQrStatusConfirmed
		if err := service.UpdateWxQrTicket(t); err != nil {
			common.ApiErrorMsg(c, err.Error())
			return
		}
		common.ApiSuccess(c, gin.H{"confirmed": true})
		return
	}

	// Conflict path: another same-tenant user holds this openid. Find them
	// and stash their id; PC polls, sees merge_required, asks the user.
	other := model.User{TenantId: t.TenantId, WeChatId: wechatId}
	if err := other.FillUserByWeChatIdWithTenant(t.TenantId); err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	if other.Id == 0 || other.Id == initiator.Id {
		// Shouldn't happen (IsWeChatIdAlreadyTaken said someone exists) but
		// guard so we don't enqueue a merge against self.
		t.Status = service.WxQrStatusConfirmed
		if err := service.UpdateWxQrTicket(t); err != nil {
			common.ApiErrorMsg(c, err.Error())
			return
		}
		common.ApiSuccess(c, gin.H{"confirmed": true})
		return
	}

	t.Status = service.WxQrStatusMergeRequired
	t.MergeCandidateUserId = other.Id
	if err := service.UpdateWxQrTicket(t); err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	common.ApiSuccess(c, gin.H{"confirmed": true, "merge_required": true})
}

// LoginWithWxQrTicket handles POST /api/oauth/wx_qr/login.
// Called by the web after polling shows status=confirmed; exchanges the
// ticket for a real session cookie. The ticket is consumed (one-shot).
func LoginWithWxQrTicket(c *gin.Context) {
	if !service.IsWxMiniLoginEnabled(middleware.GetTenantId(c)) {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "管理员未开启微信小程序登录",
		})
		return
	}

	var req wxQrLoginRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorMsg(c, "无效的请求")
		return
	}

	t, err := service.ConsumeWxQrTicket(req.Ticket)
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}

	// Web's current tenant must match the tenant the ticket was created under.
	// Protects against cross-tenant ticket replay in a multi-tenant deployment.
	webTenantId := middleware.GetTenantId(c)
	if webTenantId != t.TenantId {
		common.ApiErrorMsg(c, "登录凭证与当前站点不匹配")
		return
	}

	user, err := model.GetUserByIdWithContext(c.Request.Context(), t.UserId, true)
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	if user.Status != common.UserStatusEnabled {
		common.ApiErrorMsg(c, "用户已被封禁")
		return
	}

	c.Set("login_type", "oauth_wx_mini_qr")
	usercontroller.SetupLogin(user, c)
}
