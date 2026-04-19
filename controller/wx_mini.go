package controller

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// WeChat Mini-Program (wx.login) login flow:
//   1. Client calls uni.login() / wx.login() → gets js_code
//   2. Client POSTs {code} here
//   3. Server calls jscode2session → gets openid (+ optional unionid)
//   4. Server finds/creates user keyed by WeChatId = "wxmini:<openid>"
//      The prefix avoids colliding with the WeChatServerAddress (OA) flow,
//      which stores raw server-returned ids in the same column.

const wxMiniIdPrefix = "wxmini:"

type wxMiniLoginRequest struct {
	Code string `json:"code"`
}

type wxMiniCode2SessionResponse struct {
	OpenId     string `json:"openid"`
	SessionKey string `json:"session_key"`
	UnionId    string `json:"unionid,omitempty"`
	ErrCode    int    `json:"errcode,omitempty"`
	ErrMsg     string `json:"errmsg,omitempty"`
}

// exchangeWxMiniCode calls WeChat's jscode2session endpoint and returns the openid.
func exchangeWxMiniCode(code string) (string, error) {
	if code == "" {
		return "", errors.New("微信登录凭证为空")
	}
	if common.WxMiniAppId == "" || common.WxMiniAppSecret == "" {
		return "", errors.New("管理员尚未配置小程序 AppId/AppSecret")
	}

	endpoint := fmt.Sprintf(
		"https://api.weixin.qq.com/sns/jscode2session?appid=%s&secret=%s&js_code=%s&grant_type=authorization_code",
		url.QueryEscape(common.WxMiniAppId),
		url.QueryEscape(common.WxMiniAppSecret),
		url.QueryEscape(code),
	)

	client := http.Client{Timeout: 5 * time.Second}
	httpResp, err := client.Get(endpoint)
	if err != nil {
		return "", fmt.Errorf("调用微信接口失败: %w", err)
	}
	defer httpResp.Body.Close()

	body, err := io.ReadAll(httpResp.Body)
	if err != nil {
		return "", fmt.Errorf("读取微信响应失败: %w", err)
	}

	var resp wxMiniCode2SessionResponse
	if err := common.Unmarshal(body, &resp); err != nil {
		return "", fmt.Errorf("解析微信响应失败: %w", err)
	}

	if resp.ErrCode != 0 {
		return "", fmt.Errorf("微信登录失败: %s (errcode=%d)", resp.ErrMsg, resp.ErrCode)
	}
	if resp.OpenId == "" {
		return "", errors.New("微信未返回 openid")
	}
	return resp.OpenId, nil
}

// wxMiniResolveUser exchanges a login code for a ready-to-login user,
// auto-creating the account on first use (when registration is enabled).
// The returned user is scoped to tenantId.
func wxMiniResolveUser(code string, tenantId int) (*model.User, error) {
	openid, err := exchangeWxMiniCode(code)
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

	if !common.RegisterEnabled {
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
	if !common.WxMiniAuthEnabled {
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

	user, err := wxMiniResolveUser(req.Code, middleware.GetTenantId(c))
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
	setupLogin(user, c)
}
