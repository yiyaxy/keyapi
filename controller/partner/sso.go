package partner

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/common/tenant_ctx"
	"github.com/QuantumNous/new-api/constant"
	usercontroller "github.com/QuantumNous/new-api/controller/user"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/system_setting"

	"github.com/bytedance/gopkg/util/gopool"
	"github.com/gin-contrib/sessions"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const partnerSignatureWindowSeconds int64 = 300

type ssoExchangeRequest struct {
	ClientId       string `json:"client_id"`
	ExternalUserId string `json:"external_user_id"`
	Email          string `json:"email"`
	Username       string `json:"username"`
	DisplayName    string `json:"display_name"`
	Timestamp      int64  `json:"timestamp"`
	Nonce          string `json:"nonce"`
	CreateKey      *bool  `json:"create_key"`
	KeyName        string `json:"key_name"`
	Signature      string `json:"signature"`
}

type usersQueryRequest struct {
	ClientId        string   `json:"client_id"`
	ExternalUserIds []string `json:"external_user_ids"`
	StartTime       int64    `json:"start_time"`
	EndTime         int64    `json:"end_time"`
	IncludeTopups   bool     `json:"include_topups"`
	IncludeUsage    bool     `json:"include_usage"`
	Page            int      `json:"page"`
	PageSize        int      `json:"page_size"`
	Timestamp       int64    `json:"timestamp"`
	Nonce           string   `json:"nonce"`
	Signature       string   `json:"signature"`
}

type partnerUserData struct {
	ExternalUserId   string `json:"external_user_id"`
	UserId           int    `json:"user_id"`
	Username         string `json:"username"`
	DisplayName      string `json:"display_name"`
	Email            string `json:"email"`
	Quota            int    `json:"quota"`
	UsedQuota        int    `json:"used_quota"`
	RequestCount     int    `json:"request_count"`
	ApiKeyCount      int    `json:"api_key_count"`
	LastLoginAt      int64  `json:"last_login_at"`
	PeriodTopupQuota int64  `json:"period_topup_quota,omitempty"`
	PeriodUsedQuota  int64  `json:"period_used_quota,omitempty"`
}

func SSOExchange(c *gin.Context) {
	var req ssoExchangeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	req.ClientId = strings.TrimSpace(req.ClientId)
	req.ExternalUserId = strings.TrimSpace(req.ExternalUserId)
	req.Username = strings.TrimSpace(req.Username)
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
	req.DisplayName = strings.TrimSpace(req.DisplayName)
	req.Nonce = strings.TrimSpace(req.Nonce)
	if req.ClientId == "" || req.ExternalUserId == "" || req.Username == "" {
		common.ApiError(c, errors.New("client_id, external_user_id and username are required"))
		return
	}

	tenantId, err := resolveSignedPartnerTenant(c, req.ClientId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if err := verifyPartnerSignedRequest(tenantId, req.ClientId, req.Timestamp, req.Nonce, req.Signature, exchangeCanonical(req)); err != nil {
		common.ApiError(c, err)
		return
	}
	cleanup := setPartnerTenantContext(c, tenantId)
	defer cleanup()

	user, err := getOrCreatePartnerUser(tenantId, req)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	token, err := model.GetOrCreatePartnerToken(tenantId, user.Id, req.ClientId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	ticket, err := model.CreatePartnerSSOTicket(tenantId, req.ClientId, user.Id, 60)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	common.ApiSuccess(c, gin.H{
		"tenant_id":        tenantId,
		"user_id":          user.Id,
		"external_user_id": req.ExternalUserId,
		"login_url":        buildPartnerLoginURL(c, ticket),
		"api_key":          "sk-" + token.Key,
		"api_base":         strings.TrimRight(baseServerAddress(c), "/") + "/v1",
	})
}

func SSOLogin(c *gin.Context) {
	ticket := strings.TrimSpace(c.Query("ticket"))
	record, err := model.ConsumePartnerSSOTicket(ticket)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	cleanup := setPartnerTenantContext(c, record.TenantId)
	defer cleanup()
	user, err := model.GetUserByIdWithContext(c.Request.Context(), record.UserId, true)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.Set("login_type", "partner_sso")
	redirect := sanitizePartnerRedirect(c.Query("redirect"))
	if redirect == "" {
		usercontroller.SetupLogin(user, c)
		return
	}
	if err := setupPartnerSessionOnly(user, c); err != nil {
		common.ApiError(c, err)
		return
	}
	c.Redirect(http.StatusFound, redirect)
}

func QueryUsers(c *gin.Context) {
	var req usersQueryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	req.ClientId = strings.TrimSpace(req.ClientId)
	req.Nonce = strings.TrimSpace(req.Nonce)
	if req.ClientId == "" {
		common.ApiError(c, errors.New("client_id is required"))
		return
	}
	if req.Page <= 0 {
		req.Page = 1
	}
	if req.PageSize <= 0 {
		req.PageSize = 100
	}
	if req.PageSize > 100 {
		req.PageSize = 100
	}
	tenantId, err := resolveSignedPartnerTenant(c, req.ClientId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if err := verifyPartnerSignedRequest(tenantId, req.ClientId, req.Timestamp, req.Nonce, req.Signature, usersQueryCanonical(req)); err != nil {
		common.ApiError(c, err)
		return
	}
	items, total, err := listPartnerUsers(tenantId, req)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{
		"tenant_id":   tenantId,
		"page":        req.Page,
		"page_size":   req.PageSize,
		"total":       total,
		"items":       items,
		"sync_policy": "按客户系统需要调用；我方不强制同步频率。",
	})
}

func getOrCreatePartnerUser(tenantId int, req ssoExchangeRequest) (*model.User, error) {
	if binding, err := model.GetPartnerUser(tenantId, req.ClientId, req.ExternalUserId); err == nil {
		return model.GetUserByIdWithContext(contextWithTenant(tenantId), binding.UserId, true)
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	var created *model.User
	err := model.DB.Transaction(func(tx *gorm.DB) error {
		if binding, err := model.GetPartnerUser(tenantId, req.ClientId, req.ExternalUserId); err == nil {
			u, err := model.GetUserByIdWithContext(contextWithTenant(tenantId), binding.UserId, true)
			if err != nil {
				return err
			}
			created = u
			return nil
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}

		username := normalizePartnerUsername(req.Username, req.ExternalUserId)
		if exists, err := model.CheckUserExistOrDeleted(username, req.Email, tenantId); err != nil {
			return err
		} else if exists {
			username = normalizePartnerUsername("p_"+shortPartnerHash(req.ClientId+":"+req.ExternalUserId), req.ExternalUserId)
		}
		passwordHash, err := common.Password2Hash(common.GetRandomString(20))
		if err != nil {
			return err
		}
		user := &model.User{
			TenantId:    tenantId,
			Username:    username,
			Password:    passwordHash,
			DisplayName: req.DisplayName,
			Email:       req.Email,
			Role:        model.TenantRoleMember,
			Status:      common.UserStatusEnabled,
			Group:       "default",
			Quota:       0,
			AffCode:     common.GetRandomString(4),
		}
		defaultSetting := dto.UserSetting{}
		user.SetSetting(defaultSetting)
		if err := tx.Create(user).Error; err != nil {
			return err
		}
		if err := model.BindPartnerUser(tx, tenantId, req.ClientId, req.ExternalUserId, user.Id); err != nil {
			return err
		}
		if err := model.WithTenantBypass(tx).Create(&model.TenantMembership{
			TenantId: tenantId,
			UserId:   user.Id,
			Role:     model.TenantRoleMember,
			Status:   model.TenantMembershipStatusActive,
		}).Error; err != nil {
			return err
		}
		created = user
		return nil
	})
	if err != nil {
		return nil, err
	}
	return created, nil
}

func listPartnerUsers(tenantId int, req usersQueryRequest) ([]partnerUserData, int64, error) {
	query := model.WithTenantBypass(model.DB).Table("partner_users AS pu").
		Joins("JOIN users u ON u.id = pu.user_id AND u.tenant_id = pu.tenant_id").
		Where("pu.tenant_id = ? AND pu.client_id = ?", tenantId, req.ClientId)
	if len(req.ExternalUserIds) > 0 {
		ids := make([]string, 0, len(req.ExternalUserIds))
		for _, id := range req.ExternalUserIds {
			if trimmed := strings.TrimSpace(id); trimmed != "" {
				ids = append(ids, trimmed)
			}
		}
		if len(ids) > 0 {
			query = query.Where("pu.external_user_id IN ?", ids)
		}
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var items []partnerUserData
	selects := []string{
		"pu.external_user_id",
		"u.id AS user_id",
		"u.username",
		"u.display_name",
		"u.email",
		"u.quota",
		"u.used_quota",
		"u.request_count",
		"(SELECT COUNT(1) FROM tokens t WHERE t.tenant_id = pu.tenant_id AND t.user_id = pu.user_id AND t.deleted_at IS NULL) AS api_key_count",
		"(SELECT COALESCE(MAX(ip.created_at), 0) FROM user_ip_records ip WHERE ip.tenant_id = pu.tenant_id AND ip.user_id = pu.user_id) AS last_login_at",
	}
	if req.IncludeTopups {
		topupFilter := "tu.tenant_id = pu.tenant_id AND tu.user_id = pu.user_id AND tu.status = 'success'"
		if req.StartTime > 0 {
			topupFilter += fmt.Sprintf(" AND tu.complete_time >= %d", req.StartTime)
		}
		if req.EndTime > 0 {
			topupFilter += fmt.Sprintf(" AND tu.complete_time <= %d", req.EndTime)
		}
		selects = append(selects, fmt.Sprintf("(SELECT COALESCE(SUM(COALESCE(NULLIF(tu.raw_quota, 0), NULLIF(tu.base_quota, 0), tu.amount)), 0) FROM top_ups tu WHERE %s) AS period_topup_quota", topupFilter))
	}
	if req.IncludeUsage {
		usageFilter := fmt.Sprintf("l.tenant_id = pu.tenant_id AND l.user_id = pu.user_id AND l.type = %d", model.LogTypeConsume)
		if req.StartTime > 0 {
			usageFilter += fmt.Sprintf(" AND l.created_at >= %d", req.StartTime)
		}
		if req.EndTime > 0 {
			usageFilter += fmt.Sprintf(" AND l.created_at <= %d", req.EndTime)
		}
		selects = append(selects, fmt.Sprintf("(SELECT COALESCE(SUM(l.quota), 0) FROM logs l WHERE %s) AS period_used_quota", usageFilter))
	}
	err := query.Select(strings.Join(selects, ", ")).
		Order("pu.id desc").
		Offset((req.Page - 1) * req.PageSize).
		Limit(req.PageSize).
		Scan(&items).Error
	return items, total, err
}

func verifyPartnerSignedRequest(tenantId int, clientId string, timestamp int64, nonce string, signature string, canonical string) error {
	secret := partnerClientSecret()
	if secret == "" {
		return errors.New("PARTNER_API_CLIENT_SECRET or PARTNER_API_KEY is not configured")
	}
	if timestamp <= 0 {
		return errors.New("timestamp is required")
	}
	now := common.GetTimestamp()
	if timestamp < now-partnerSignatureWindowSeconds || timestamp > now+partnerSignatureWindowSeconds {
		return errors.New("timestamp expired")
	}
	if nonce == "" {
		return errors.New("nonce is required")
	}
	expected := hmacSHA256(secret, canonical)
	if !hmac.Equal([]byte(strings.ToLower(signature)), []byte(expected)) {
		return errors.New("invalid signature")
	}
	if err := model.AcceptPartnerNonce(tenantId, clientId, nonce, timestamp+partnerSignatureWindowSeconds); err != nil {
		return errors.New("nonce has already been used")
	}
	return nil
}

func exchangeCanonical(req ssoExchangeRequest) string {
	return strings.Join([]string{
		"client_id=" + req.ClientId,
		"external_user_id=" + req.ExternalUserId,
		"email=" + req.Email,
		"username=" + req.Username,
		"timestamp=" + strconv.FormatInt(req.Timestamp, 10),
		"nonce=" + req.Nonce,
	}, "\n")
}

func usersQueryCanonical(req usersQueryRequest) string {
	ids := make([]string, 0, len(req.ExternalUserIds))
	for _, id := range req.ExternalUserIds {
		if trimmed := strings.TrimSpace(id); trimmed != "" {
			ids = append(ids, trimmed)
		}
	}
	return strings.Join([]string{
		"client_id=" + req.ClientId,
		"external_user_ids=" + strings.Join(ids, ","),
		"start_time=" + strconv.FormatInt(req.StartTime, 10),
		"end_time=" + strconv.FormatInt(req.EndTime, 10),
		"include_topups=" + strconv.FormatBool(req.IncludeTopups),
		"include_usage=" + strconv.FormatBool(req.IncludeUsage),
		"page=" + strconv.Itoa(req.Page),
		"page_size=" + strconv.Itoa(req.PageSize),
		"timestamp=" + strconv.FormatInt(req.Timestamp, 10),
		"nonce=" + req.Nonce,
	}, "\n")
}

func hmacSHA256(secret string, payload string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(payload))
	return hex.EncodeToString(mac.Sum(nil))
}

func resolveSignedPartnerTenant(c *gin.Context, clientId string) (int, error) {
	if expected := strings.TrimSpace(os.Getenv("PARTNER_API_CLIENT_ID")); expected != "" && clientId != expected {
		return 0, errors.New("invalid client_id")
	}
	if raw := strings.TrimSpace(os.Getenv("PARTNER_API_TENANT_ID")); raw != "" {
		tenantId, err := strconv.Atoi(raw)
		if err != nil || tenantId <= 0 {
			return 0, errors.New("invalid PARTNER_API_TENANT_ID")
		}
		if model.GetTenantById(tenantId) == nil {
			return 0, errors.New("PARTNER_API_TENANT_ID does not exist")
		}
		return tenantId, nil
	}
	tenantId := middleware.GetTenantId(c)
	if tenantId <= 0 {
		return 0, errors.New("X-Tenant-Id is required when PARTNER_API_TENANT_ID is not configured")
	}
	return tenantId, nil
}

func partnerClientSecret() string {
	if secret := strings.TrimSpace(os.Getenv("PARTNER_API_CLIENT_SECRET")); secret != "" {
		return secret
	}
	return strings.TrimSpace(os.Getenv("PARTNER_API_KEY"))
}

func setPartnerTenantContext(c *gin.Context, tenantId int) func() {
	c.Set(string(constant.ContextKeyTenantId), tenantId)
	c.Set("tenant_id", tenantId)
	ctx := context.WithValue(c.Request.Context(), constant.ContextKeyTenantId, tenantId)
	c.Request = c.Request.WithContext(ctx)
	tenant_ctx.Set(tenantId)
	return tenant_ctx.Clear
}

func contextWithTenant(tenantId int) context.Context {
	return context.WithValue(context.Background(), constant.ContextKeyTenantId, tenantId)
}

func buildPartnerLoginURL(c *gin.Context, ticket string) string {
	u := strings.TrimRight(baseServerAddress(c), "/") + "/api/partner/sso/login"
	q := url.Values{}
	q.Set("ticket", ticket)
	return u + "?" + q.Encode()
}

func baseServerAddress(c *gin.Context) string {
	if addr := strings.TrimSpace(system_setting.ServerAddress); addr != "" {
		return addr
	}
	scheme := "http"
	if c.Request.TLS != nil {
		scheme = "https"
	}
	if forwarded := strings.TrimSpace(c.GetHeader("X-Forwarded-Proto")); forwarded != "" {
		scheme = strings.Split(forwarded, ",")[0]
	}
	return scheme + "://" + c.Request.Host
}

func sanitizePartnerRedirect(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" || !strings.HasPrefix(raw, "/") || strings.HasPrefix(raw, "//") {
		return ""
	}
	return raw
}

func setupPartnerSessionOnly(user *model.User, c *gin.Context) error {
	tenantId := middleware.GetTenantId(c)
	if tenantId <= 0 {
		return model.ErrTenantRequired
	}
	info, err := model.GetTenantMembershipAuthInfo(tenantId, user)
	if err != nil {
		return errors.New("当前用户不属于该租户")
	}
	session := sessions.Default(c)
	session.Set("id", user.Id)
	session.Set("username", user.Username)
	session.Set("role", info.EffectiveRole)
	session.Set("platform_role", info.PlatformRole)
	session.Set("tenant_role", info.TenantRole)
	session.Set("status", user.Status)
	session.Set("group", user.Group)
	session.Set("session_version", common.SessionVersion)
	session.Set("tenant_id", tenantId)
	if err := session.Save(); err != nil {
		return err
	}
	ip := c.ClientIP()
	userAgent := c.Request.UserAgent()
	loginType := c.GetString("login_type")
	userId := user.Id
	username := user.Username
	gopool.Go(func() {
		model.RecordLoginIp(tenantId, userId, username, ip, loginType, userAgent)
		service.LookupIPAsync(ip)
	})
	return nil
}

func normalizePartnerUsername(username string, fallback string) string {
	username = strings.TrimSpace(username)
	if username == "" {
		username = fallback
	}
	replacer := strings.NewReplacer("@", "_", ".", "_", ":", "_", "/", "_", "\\", "_", " ", "_")
	username = replacer.Replace(username)
	if len(username) > model.UserNameMaxLength {
		username = username[:model.UserNameMaxLength]
	}
	if username == "" {
		username = "partner_user"
	}
	return username
}

func shortPartnerHash(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])[:16]
}
