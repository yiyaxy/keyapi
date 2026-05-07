package partner

import (
	"errors"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type TopUpRecord struct {
	Id            int     `json:"id"`
	TenantId      int     `json:"tenant_id"`
	UserId        int     `json:"user_id"`
	Username      string  `json:"username"`
	DisplayName   string  `json:"display_name"`
	Amount        int64   `json:"amount"`
	Money         float64 `json:"money"`
	TradeNo       string  `json:"trade_no"`
	PaymentMethod string  `json:"payment_method"`
	Status        string  `json:"status"`
	CreateTime    int64   `json:"create_time"`
	CompleteTime  int64   `json:"complete_time"`
	RawQuota      int64   `json:"raw_quota"`
	BaseQuota     int64   `json:"base_quota"`
	ClientIP      string  `json:"client_ip"`
}

type RebateRecord struct {
	Id                 int    `json:"id"`
	TenantId           int    `json:"tenant_id"`
	UserId             int    `json:"user_id"`
	Username           string `json:"username"`
	UserDisplayName    string `json:"user_display_name"`
	InviteeId          int    `json:"invitee_id"`
	InviteeName        string `json:"invitee_name"`
	InviteeDisplayName string `json:"invitee_display_name"`
	Type               int    `json:"type"`
	Quota              int    `json:"quota"`
	Remark             string `json:"remark"`
	CreatedAt          int64  `json:"created_at"`
}

func Capabilities(c *gin.Context) {
	tenantId := middleware.GetTenantId(c)
	if tenantId <= 0 {
		common.ApiError(c, errors.New("tenant is required"))
		return
	}

	common.ApiSuccess(c, gin.H{
		"tenant_id": tenantId,
		"quota": gin.H{
			"display_type":         operation_setting.GetQuotaDisplayType(),
			"quota_per_unit":       common.QuotaPerUnit,
			"currency_symbol":      operation_setting.GetCurrencySymbol(),
			"usd_exchange_rate":    operation_setting.USDExchangeRate,
			"custom_currency_rate": operation_setting.GetGeneralSetting().CustomCurrencyExchangeRate,
		},
		"data_endpoints": []gin.H{
			{"method": "GET", "path": "/api/partner/topups", "description": "user token purchase records"},
			{"method": "GET", "path": "/api/partner/rebates", "description": "affiliate rebate records"},
		},
		"tool_interfaces": []gin.H{
			{"name": "openai_compatible", "base_path": "/v1", "auth": "Authorization: Bearer sk-..."},
			{"name": "chat", "path": "/v1/chat/completions", "auth": "Authorization: Bearer sk-..."},
			{"name": "responses", "path": "/v1/responses", "auth": "Authorization: Bearer sk-..."},
			{"name": "image_generation", "path": "/v1/images/generations", "auth": "Authorization: Bearer sk-..."},
			{"name": "video_generation", "path": "/api/video/*", "auth": "Authorization: Bearer sk-..."},
		},
	})
}

func ListTopUps(c *gin.Context) {
	tenantId := middleware.GetTenantId(c)
	if tenantId <= 0 {
		common.ApiError(c, errors.New("tenant is required"))
		return
	}

	timeColumn, err := topUpTimeColumn(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	query := model.DB.Table("top_ups").
		Select(strings.Join([]string{
			"top_ups.id",
			"top_ups.tenant_id",
			"top_ups.user_id",
			"COALESCE(users.username, '') AS username",
			"COALESCE(users.display_name, '') AS display_name",
			"top_ups.amount",
			"top_ups.money",
			"top_ups.trade_no",
			"top_ups.payment_method",
			"top_ups.status",
			"top_ups.create_time",
			"top_ups.complete_time",
			"top_ups.raw_quota",
			"top_ups.base_quota",
			"top_ups.client_ip",
		}, ", ")).
		Joins("LEFT JOIN users ON users.id = top_ups.user_id AND users.tenant_id = top_ups.tenant_id").
		Where("top_ups.tenant_id = ?", tenantId).
		Where("top_ups.trade_no NOT LIKE ? AND top_ups.trade_no NOT LIKE ?", "SUB%", "sub_ref_%")

	query, err = applyCommonTopUpFilters(c, query, timeColumn)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	pageInfo := common.GetPageQuery(c)
	var total int64
	if err := query.Count(&total).Error; err != nil {
		common.ApiError(c, err)
		return
	}

	var records []TopUpRecord
	if err := query.Order("top_ups.id DESC").
		Limit(pageInfo.GetPageSize()).
		Offset(pageInfo.GetStartIdx()).
		Scan(&records).Error; err != nil {
		common.ApiError(c, err)
		return
	}

	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(records)
	common.ApiSuccess(c, pageInfo)
}

func ListRebates(c *gin.Context) {
	tenantId := middleware.GetTenantId(c)
	if tenantId <= 0 {
		common.ApiError(c, errors.New("tenant is required"))
		return
	}

	query := model.DB.Table("aff_rebate_logs").
		Select(strings.Join([]string{
			"aff_rebate_logs.id",
			"aff_rebate_logs.tenant_id",
			"aff_rebate_logs.user_id",
			"COALESCE(inviter.username, '') AS username",
			"COALESCE(inviter.display_name, '') AS user_display_name",
			"aff_rebate_logs.invitee_id",
			"COALESCE(invitee.username, aff_rebate_logs.invitee_name, '') AS invitee_name",
			"COALESCE(invitee.display_name, '') AS invitee_display_name",
			"aff_rebate_logs.type",
			"aff_rebate_logs.quota",
			"aff_rebate_logs.remark",
			"aff_rebate_logs.created_at",
		}, ", ")).
		Joins("LEFT JOIN users AS inviter ON inviter.id = aff_rebate_logs.user_id AND inviter.tenant_id = aff_rebate_logs.tenant_id").
		Joins("LEFT JOIN users AS invitee ON invitee.id = aff_rebate_logs.invitee_id AND invitee.tenant_id = aff_rebate_logs.tenant_id").
		Where("aff_rebate_logs.tenant_id = ?", tenantId)

	query, err := applyCommonRebateFilters(c, query)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	pageInfo := common.GetPageQuery(c)
	var total int64
	if err := query.Count(&total).Error; err != nil {
		common.ApiError(c, err)
		return
	}

	var records []RebateRecord
	if err := query.Order("aff_rebate_logs.id DESC").
		Limit(pageInfo.GetPageSize()).
		Offset(pageInfo.GetStartIdx()).
		Scan(&records).Error; err != nil {
		common.ApiError(c, err)
		return
	}

	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(records)
	common.ApiSuccess(c, pageInfo)
}

func topUpTimeColumn(c *gin.Context) (string, error) {
	field := strings.TrimSpace(c.DefaultQuery("time_field", "complete_time"))
	switch field {
	case "create", "create_time":
		return "top_ups.create_time", nil
	case "complete", "complete_time":
		return "top_ups.complete_time", nil
	default:
		return "", errors.New("time_field must be create_time or complete_time")
	}
}

func applyCommonTopUpFilters(c *gin.Context, query *gorm.DB, timeColumn string) (*gorm.DB, error) {
	if status := strings.TrimSpace(c.Query("status")); status != "" {
		query = query.Where("top_ups.status = ?", status)
	}
	if userId, err := optionalPositiveInt(c.Query("user_id")); err != nil {
		return nil, err
	} else if userId > 0 {
		query = query.Where("top_ups.user_id = ?", userId)
	}
	if tradeNo := strings.TrimSpace(c.Query("trade_no")); tradeNo != "" {
		query = query.Where("top_ups.trade_no = ?", tradeNo)
	}
	if keyword := strings.TrimSpace(c.Query("keyword")); keyword != "" {
		like := "%" + keyword + "%"
		query = query.Where("top_ups.trade_no LIKE ? OR users.username LIKE ? OR users.display_name LIKE ?", like, like, like)
	}
	return applyUnixRange(c, query, timeColumn)
}

func applyCommonRebateFilters(c *gin.Context, query *gorm.DB) (*gorm.DB, error) {
	if rebateType, err := optionalPositiveInt(c.Query("type")); err != nil {
		return nil, err
	} else if rebateType > 0 {
		query = query.Where("aff_rebate_logs.type = ?", rebateType)
	}
	if userId, err := optionalPositiveInt(c.Query("user_id")); err != nil {
		return nil, err
	} else if userId > 0 {
		query = query.Where("aff_rebate_logs.user_id = ?", userId)
	}
	if inviteeId, err := optionalPositiveInt(c.Query("invitee_id")); err != nil {
		return nil, err
	} else if inviteeId > 0 {
		query = query.Where("aff_rebate_logs.invitee_id = ?", inviteeId)
	}
	return applyUnixRange(c, query, "aff_rebate_logs.created_at")
}

func applyUnixRange(c *gin.Context, query *gorm.DB, column string) (*gorm.DB, error) {
	if since, err := optionalPositiveInt64(c.Query("since")); err != nil {
		return nil, err
	} else if since > 0 {
		query = query.Where(column+" >= ?", since)
	}
	if until, err := optionalPositiveInt64(c.Query("until")); err != nil {
		return nil, err
	} else if until > 0 {
		query = query.Where(column+" <= ?", until)
	}
	return query, nil
}

func optionalPositiveInt(raw string) (int, error) {
	if strings.TrimSpace(raw) == "" {
		return 0, nil
	}
	value, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || value < 0 {
		return 0, errors.New("query parameter must be a non-negative integer")
	}
	return value, nil
}

func optionalPositiveInt64(raw string) (int64, error) {
	if strings.TrimSpace(raw) == "" {
		return 0, nil
	}
	value, err := strconv.ParseInt(strings.TrimSpace(raw), 10, 64)
	if err != nil || value < 0 {
		return 0, errors.New("time query parameter must be a non-negative unix timestamp")
	}
	return value, nil
}
