package auth

import (
	"errors"
	usercontroller "github.com/QuantumNous/new-api/controller/user"
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
)

// WeChat Mini-Program (wx.login) login flow:
//   1. Client calls uni.login() / wx.login() → gets js_code
//   2. Client POSTs {code} here
//   3. Server calls jscode2session → gets openid (+ optional unionid)
//   4. Server finds/creates user keyed by WeChatId = "wxmini:<openid>"
//      The prefix avoids colliding with the WeChatServerAddress (OA) flow,
//      which stores raw server-returned ids in the same column.
//
// Credentials (AppId + AppSecret) and the enable flag live on the tenant's
// payment config row (tenant_payment_configs) — one place, one source of
// truth. The flag is `mini_login_enabled`; the AppId/AppSecret fields are
// shared with the WeChat Pay JSAPI flow.

const wxMiniIdPrefix = "wxmini:"

type wxMiniLoginRequest struct {
	Code string `json:"code"`
}

// wxMiniResolveUser exchanges a login code for a ready-to-login user,
// auto-creating the account on first use (when registration is enabled).
// The returned user is scoped to tenantId.
func wxMiniResolveUser(code string, tenantId int) (*model.User, error) {
	openid, err := service.ExchangeWxMiniCode(tenantId, code)
	if err != nil {
		return nil, err
	}
	wechatId := wxMiniIdPrefix + openid

	user := model.User{
		TenantId: tenantId,
		WeChatId: wechatId,
	}

	if model.IsWeChatIdAlreadyTaken(wechatId, tenantId) {
		if err := user.FillUserByWeChatIdWithTenant(tenantId); err != nil {
			return nil, err
		}
		if user.Id == 0 {
			return nil, errors.New("用户已注销")
		}
		if !model.TenantMembershipAllowsAccess(&user, tenantId) {
			return nil, errors.New("用户不属于当前租户或成员已被禁用")
		}
		return &user, nil
	}

	if !service.GetConfigBool(tenantId, "RegisterEnabled", common.RegisterEnabled) {
		return nil, errors.New("管理员关闭了新用户注册")
	}

	user.Username = "wxmini_" + strconv.Itoa(model.GetMaxUserId()+1)
	user.DisplayName = "WeChat User"
	user.Role = common.RoleCommonUser
	user.Status = common.UserStatusEnabled

	if err := user.Insert(0); err != nil {
		return nil, err
	}
	if err := model.EnsureTenantMembership(user.Id, user.TenantId, model.TenantRoleMember, 0); err != nil {
		return nil, err
	}
	return &user, nil
}

// WxMiniLogin handles POST /api/oauth/wx_mini/login.
// Body: {"code": "<uni.login code>"}
func WxMiniLogin(c *gin.Context) {
	tenantId := middleware.GetTenantId(c)
	if !service.IsWxMiniLoginEnabled(tenantId) {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "管理员未开启微信小程序登录",
		})
		return
	}

	var req wxMiniLoginRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "无效的请求",
		})
		return
	}

	user, err := wxMiniResolveUser(req.Code, tenantId)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	if user.Status != common.UserStatusEnabled {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "用户已被封禁",
		})
		return
	}

	c.Set("login_type", "oauth_wx_mini")
	usercontroller.SetupLogin(user, c)
}
