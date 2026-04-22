package auth

import (
	"encoding/base64"
	"errors"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-contrib/sessions"
	"github.com/gin-gonic/gin"
)

// Scan-to-bind WeChat flow (PC web, user already logged in):
//   1. PC calls POST /api/oauth/wx_qr/bind/ticket   → returns {ticket, qr_image, expires_in}
//      Ticket carries purpose=bind + initiator user_id.
//   2. PC polls GET /api/oauth/wx_qr/bind/poll?ticket=...
//      Status transitions: pending → confirmed (no conflict) | merge_required (another
//      account in same tenant holds this wechat) | expired.
//   3. Mini-program (after scan) calls existing POST /api/oauth/wx_qr/confirm
//      which dispatches by ticket.Purpose (see wx_mini_qr.go). For bind it resolves
//      openid, checks conflict, updates ticket status.
//   4. PC sees confirmed or merge_required; for merge_required shows B's info and
//      asks the user to confirm, then calls POST /api/oauth/wx_qr/bind/finalize
//      with {ticket, confirm_merge?: bool}.
//      - confirmed (no conflict) → simple UPDATE users.wechat_id
//      - merge_required + confirm_merge=true → model.MergeUserInto, source=B,
//        target=initiator; balances add, B's data reassigned, B soft-deleted.
//
// GetWxQrTicketInfo (no auth) lets the mini-program branch its copy between
// "confirm login" and "confirm bind".

// GenerateWxQrBindTicket handles POST /api/oauth/wx_qr/bind/ticket.
// Requires login: the ticket is scoped to the caller's user id so only they
// can later finalize the bind.
func GenerateWxQrBindTicket(c *gin.Context) {
	tenantId := middleware.GetTenantId(c)
	if !service.IsWxMiniLoginEnabled(tenantId) {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "管理员未开启微信小程序登录",
		})
		return
	}

	session := sessions.Default(c)
	rawId := session.Get("id")
	if rawId == nil {
		common.ApiErrorMsg(c, "请先登录")
		return
	}
	userId, ok := rawId.(int)
	if !ok || userId <= 0 {
		common.ApiErrorMsg(c, "请先登录")
		return
	}

	ticket, err := service.CreateWxQrBindTicket(tenantId, userId)
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

// wxQrBindPollCandidate 是合并确认弹窗要给用户看的 B 账户摘要。
// 脱敏：用户名/邮箱只露少量字符，足够让用户识别是不是"自己那个号"，
// 但不暴露完整 PII 给可能被截屏分享的弹窗。
type wxQrBindPollCandidate struct {
	UserId      int    `json:"user_id"`
	Username    string `json:"username"`     // 脱敏
	DisplayName string `json:"display_name"` // 原样
	Email       string `json:"email"`        // 脱敏
	Quota       int    `json:"quota"`
	UsedQuota   int    `json:"used_quota"`
	TokenCount  int    `json:"token_count"`
}

type wxQrBindPollResponse struct {
	Status         string                 `json:"status"` // pending | confirmed | merge_required | expired
	MergeCandidate *wxQrBindPollCandidate `json:"merge_candidate,omitempty"`
}

// PollWxQrBindTicket handles GET /api/oauth/wx_qr/bind/poll?ticket=...
// Mirrors the login poll but also surfaces the merge candidate when the
// mini-program confirmation flagged a cross-account conflict.
func PollWxQrBindTicket(c *gin.Context) {
	ticketStr := c.Query("ticket")
	t, err := service.GetWxQrTicket(ticketStr)
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	if t == nil {
		common.ApiSuccess(c, wxQrBindPollResponse{Status: "expired"})
		return
	}
	// 只有发起人自己能看自己的 bind ticket 状态。
	session := sessions.Default(c)
	rawId := session.Get("id")
	userId, _ := rawId.(int)
	if t.Purpose != service.WxQrPurposeBind || t.UserId != userId {
		common.ApiErrorMsg(c, "无效的绑定会话")
		return
	}

	resp := wxQrBindPollResponse{Status: t.Status}
	if t.Status == service.WxQrStatusMergeRequired && t.MergeCandidateUserId > 0 {
		cand, err := buildMergeCandidate(t.MergeCandidateUserId, t.TenantId)
		if err == nil {
			resp.MergeCandidate = cand
		}
	}
	common.ApiSuccess(c, resp)
}

type wxQrBindFinalizeRequest struct {
	Ticket       string `json:"ticket"`
	ConfirmMerge bool   `json:"confirm_merge"`
}

type wxQrBindFinalizeResponse struct {
	Bound       bool                   `json:"bound"`
	Merged      bool                   `json:"merged"`
	MergedQuota int                    `json:"merged_quota,omitempty"`
	Candidate   *wxQrBindPollCandidate `json:"merge_candidate,omitempty"`
}

// FinalizeWxQrBind handles POST /api/oauth/wx_qr/bind/finalize.
//   - status=confirmed: writes wechat_id on the current user, consumes ticket.
//   - status=merge_required + confirm_merge=true: runs MergeUserInto and writes
//     wechat_id (already handled by MergeUserInto). Consumes ticket.
//   - status=merge_required + confirm_merge=false: returns candidate info again
//     without consuming, so the frontend can render the confirmation dialog.
func FinalizeWxQrBind(c *gin.Context) {
	var req wxQrBindFinalizeRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorMsg(c, "无效的请求")
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
	if t.Purpose != service.WxQrPurposeBind {
		common.ApiErrorMsg(c, "票据类型不正确")
		return
	}

	session := sessions.Default(c)
	rawId := session.Get("id")
	userId, _ := rawId.(int)
	if userId <= 0 || t.UserId != userId {
		common.ApiErrorMsg(c, "登录状态与绑定会话不匹配")
		return
	}
	if middleware.GetTenantId(c) != t.TenantId {
		common.ApiErrorMsg(c, "站点与绑定会话不匹配")
		return
	}

	switch t.Status {
	case service.WxQrStatusConfirmed:
		// 无冲突路径：直接把 wechat_id 写到当前用户。
		if t.MergeCandidateOpenId == "" {
			// 正常情况下 confirm 分支会把 openid 记下来；若没有说明 ticket 状态异常。
			common.ApiErrorMsg(c, "会话数据缺失，请重新扫码")
			return
		}
		if err := bindWeChatIdToUser(userId, t.TenantId, t.MergeCandidateOpenId); err != nil {
			common.ApiErrorMsg(c, err.Error())
			return
		}
		_, _ = service.ConsumeWxQrTicket(req.Ticket)
		common.ApiSuccess(c, wxQrBindFinalizeResponse{Bound: true})
		return

	case service.WxQrStatusMergeRequired:
		if !req.ConfirmMerge {
			// 未确认：把候选信息再吐一次，PC 据此弹合并确认框。
			cand, _ := buildMergeCandidate(t.MergeCandidateUserId, t.TenantId)
			common.ApiSuccess(c, wxQrBindFinalizeResponse{
				Bound:     false,
				Candidate: cand,
			})
			return
		}
		result, err := model.MergeUserInto(t.MergeCandidateUserId, userId, userId, "wechat_bind")
		if err != nil {
			common.ApiErrorMsg(c, err.Error())
			return
		}
		_, _ = service.ConsumeWxQrTicket(req.Ticket)
		common.ApiSuccess(c, wxQrBindFinalizeResponse{
			Bound:       true,
			Merged:      true,
			MergedQuota: result.MergedQuota,
		})
		return

	default:
		common.ApiErrorMsg(c, "尚未扫码确认，请稍候")
		return
	}
}

// GetWxQrTicketInfo handles GET /api/oauth/wx_qr/info?ticket=...
// Mini-program calls this before rendering the confirm screen so it knows
// whether to show "确认登录" or "确认绑定"。No auth (the ticket itself is the
// capability token). Intentionally narrow — returns only purpose, not user ids.
func GetWxQrTicketInfo(c *gin.Context) {
	t, err := service.GetWxQrTicket(c.Query("ticket"))
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	if t == nil {
		common.ApiErrorMsg(c, service.ErrWxQrTicketNotFound.Error())
		return
	}
	purpose := t.Purpose
	if purpose == "" {
		purpose = service.WxQrPurposeLogin
	}
	common.ApiSuccess(c, gin.H{"purpose": purpose})
}

// bindWeChatIdToUser 直接绑定（无合并路径）。包装成小函数是因为 MergeUserInto
// 内部已经会把 wechat_id 写到 target，这里仅处理无冲突路径。
func bindWeChatIdToUser(userId, tenantId int, wechatId string) error {
	// 防御：确认没有别人在极短时间内占用了这个 wechat_id（confirm 后 finalize 前的窗口）。
	if model.IsWeChatIdAlreadyTaken(wechatId, tenantId) {
		return errors.New("该微信账号已被其他账户绑定，请刷新后重试")
	}
	if err := model.DB.Model(&model.User{}).
		Where("id = ? AND tenant_id = ?", userId, tenantId).
		Update("wechat_id", wechatId).Error; err != nil {
		return err
	}
	return nil
}

// buildMergeCandidate 拉取 B 账户的脱敏摘要，供 PC 弹窗展示。
func buildMergeCandidate(userId, tenantId int) (*wxQrBindPollCandidate, error) {
	user, err := model.GetUserByIdGlobal(userId, true)
	if err != nil {
		return nil, err
	}
	if user.TenantId != tenantId {
		return nil, errors.New("候选账户不在当前租户")
	}
	var tokenCount int64
	_ = model.DB.Table("tokens").Where("user_id = ?", userId).Count(&tokenCount).Error
	return &wxQrBindPollCandidate{
		UserId:      user.Id,
		Username:    maskUsername(user.Username),
		DisplayName: user.DisplayName,
		Email:       maskEmail(user.Email),
		Quota:       user.Quota,
		UsedQuota:   user.UsedQuota,
		TokenCount:  int(tokenCount),
	}, nil
}

// maskUsername 保留首末字符，中间打星；过短的用户名整串打星。
func maskUsername(s string) string {
	r := []rune(s)
	if len(r) <= 2 {
		return strings.Repeat("*", len(r))
	}
	if len(r) <= 4 {
		return string(r[0]) + strings.Repeat("*", len(r)-2) + string(r[len(r)-1])
	}
	return string(r[:2]) + strings.Repeat("*", len(r)-4) + string(r[len(r)-2:])
}

// maskEmail: a***@example.com 格式；无 @ 则走 maskUsername 兜底。
func maskEmail(s string) string {
	at := strings.Index(s, "@")
	if at <= 0 {
		return maskUsername(s)
	}
	local := s[:at]
	domain := s[at:]
	if len(local) <= 1 {
		return local + strings.Repeat("*", 3) + domain
	}
	stars := len(local) - 1
	if stars > 5 {
		stars = 5
	}
	return string(local[0]) + strings.Repeat("*", stars) + domain
}
