package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	usercontroller "github.com/QuantumNous/new-api/controller/user"
	"io"
	"net/http"
	"sort"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-contrib/sessions"
	"github.com/gin-gonic/gin"
)

func TelegramBind(c *gin.Context) {
	tenantId := middleware.GetTenantId(c)
	if !service.GetConfigBool(tenantId, "TelegramOAuthEnabled", common.TelegramOAuthEnabled) {
		c.JSON(200, gin.H{
			"message": "管理员未开启通过 Telegram 登录以及注册",
			"success": false,
		})
		return
	}
	botToken := service.GetConfig(tenantId, "TelegramBotToken", common.TelegramBotToken)
	params := c.Request.URL.Query()
	if !checkTelegramAuthorization(params, botToken) {
		c.JSON(200, gin.H{
			"message": "无效的请求",
			"success": false,
		})
		return
	}
	telegramId := params["id"][0]
	if model.IsTelegramIdAlreadyTaken(telegramId, tenantId) {
		c.JSON(200, gin.H{
			"message": "该 Telegram 账户已被绑定",
			"success": false,
		})
		return
	}

	session := sessions.Default(c)
	id := session.Get("id")
	user, err := model.GetUserByIdWithContext(c, id.(int), true)
	if err != nil {
		c.JSON(200, gin.H{
			"message": err.Error(),
			"success": false,
		})
		return
	}
	if user.Id == 0 {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "用户已注销",
		})
		return
	}
	user.TelegramId = telegramId
	if err := user.Update(false); err != nil {
		c.JSON(200, gin.H{
			"message": err.Error(),
			"success": false,
		})
		return
	}

	c.Redirect(302, "/console/personal")
}

func TelegramLogin(c *gin.Context) {
	tenantId := middleware.GetTenantId(c)
	if !service.GetConfigBool(tenantId, "TelegramOAuthEnabled", common.TelegramOAuthEnabled) {
		c.JSON(200, gin.H{
			"message": "管理员未开启通过 Telegram 登录以及注册",
			"success": false,
		})
		return
	}
	botToken := service.GetConfig(tenantId, "TelegramBotToken", common.TelegramBotToken)
	params := c.Request.URL.Query()
	if !checkTelegramAuthorization(params, botToken) {
		c.JSON(200, gin.H{
			"message": "无效的请求",
			"success": false,
		})
		return
	}

	telegramId := params["id"][0]
	user := model.User{TelegramId: telegramId}
	if err := user.FillUserByTelegramIdWithTenant(tenantId); err != nil {
		c.JSON(200, gin.H{
			"message": err.Error(),
			"success": false,
		})
		return
	}
	if !model.TenantMembershipAllowsAccess(&user, tenantId) {
		c.JSON(200, gin.H{
			"message": "用户不属于当前租户或成员已被禁用",
			"success": false,
		})
		return
	}
	c.Set("login_type", "oauth_telegram")
	usercontroller.SetupLogin(&user, c)
}

func checkTelegramAuthorization(params map[string][]string, token string) bool {
	strs := []string{}
	var hash = ""
	for k, v := range params {
		if k == "hash" {
			hash = v[0]
			continue
		}
		strs = append(strs, k+"="+v[0])
	}
	sort.Strings(strs)
	var imploded = ""
	for _, s := range strs {
		if imploded != "" {
			imploded += "\n"
		}
		imploded += s
	}
	sha256hash := sha256.New()
	io.WriteString(sha256hash, token)
	hmachash := hmac.New(sha256.New, sha256hash.Sum(nil))
	io.WriteString(hmachash, imploded)
	ss := hex.EncodeToString(hmachash.Sum(nil))
	return hash == ss
}
