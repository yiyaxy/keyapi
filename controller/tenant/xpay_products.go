package tenant

import (
	"errors"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type xpayProductRequest struct {
	TierCode    string `json:"tier_code"`
	Name        string `json:"name"`
	ProductId   string `json:"product_id"`
	Platform    string `json:"platform"`
	AmountCents int64  `json:"amount_cents"`
	QuotaDelta  int64  `json:"quota_delta"`
	Enabled     *bool  `json:"enabled"`
	SortOrder   int    `json:"sort_order"`
}

func ListTenantXpayProducts(c *gin.Context) {
	tid := middleware.GetTenantId(c)
	if tid <= 0 {
		common.ApiErrorMsg(c, "invalid tenant")
		return
	}
	var rows []model.TenantXpayProduct
	q := model.WithTenantBypass(model.DB).Where("tenant_id = ?", tid)
	if platform := strings.TrimSpace(c.Query("platform")); platform != "" {
		q = q.Where("platform = ?", strings.ToLower(platform))
	}
	if err := q.Order("sort_order ASC, id ASC").Find(&rows).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, rows)
}

func CreateTenantXpayProduct(c *gin.Context) {
	tid := middleware.GetTenantId(c)
	if tid <= 0 {
		common.ApiErrorMsg(c, "invalid tenant")
		return
	}
	var req xpayProductRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "invalid request")
		return
	}
	row, err := buildXpayProductFromRequest(tid, nil, req)
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	if err := model.WithTenantBypass(model.DB).Create(row).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, row)
}

func UpdateTenantXpayProduct(c *gin.Context) {
	tid := middleware.GetTenantId(c)
	id, err := strconv.Atoi(c.Param("id"))
	if tid <= 0 || err != nil || id <= 0 {
		common.ApiErrorMsg(c, "invalid route")
		return
	}
	var existing model.TenantXpayProduct
	err = model.WithTenantBypass(model.DB).
		Where("tenant_id = ? AND id = ?", tid, id).
		First(&existing).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		common.ApiErrorMsg(c, "xpay product not found")
		return
	}
	if err != nil {
		common.ApiError(c, err)
		return
	}
	var req xpayProductRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "invalid request")
		return
	}
	row, err := buildXpayProductFromRequest(tid, &existing, req)
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	if err := model.WithTenantBypass(model.DB).Save(row).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, row)
}

func DeleteTenantXpayProduct(c *gin.Context) {
	tid := middleware.GetTenantId(c)
	id, err := strconv.Atoi(c.Param("id"))
	if tid <= 0 || err != nil || id <= 0 {
		common.ApiErrorMsg(c, "invalid route")
		return
	}
	if err := model.WithTenantBypass(model.DB).
		Where("tenant_id = ? AND id = ?", tid, id).
		Delete(&model.TenantXpayProduct{}).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"deleted": true})
}

func buildXpayProductFromRequest(tid int, existing *model.TenantXpayProduct, req xpayProductRequest) (*model.TenantXpayProduct, error) {
	row := &model.TenantXpayProduct{TenantId: tid}
	if existing != nil {
		cp := *existing
		row = &cp
	}
	if s := strings.TrimSpace(req.TierCode); s != "" {
		row.TierCode = s
	}
	if s := strings.TrimSpace(req.Name); s != "" {
		row.Name = s
	}
	row.ProductId = strings.TrimSpace(req.ProductId)
	if s := strings.TrimSpace(strings.ToLower(req.Platform)); s != "" {
		row.Platform = s
	} else if row.Platform == "" {
		row.Platform = "android"
	}
	if req.AmountCents > 0 {
		row.AmountCents = req.AmountCents
	}
	if req.QuotaDelta > 0 {
		row.QuotaDelta = req.QuotaDelta
	}
	if req.Enabled != nil {
		row.Enabled = *req.Enabled
	}
	row.SortOrder = req.SortOrder
	if row.TierCode == "" || row.Name == "" {
		return nil, errors.New("tier_code and name are required")
	}
	if row.AmountCents <= 0 || row.QuotaDelta <= 0 {
		return nil, errors.New("amount_cents and quota_delta must be positive")
	}
	if row.Enabled && row.ProductId == "" {
		return nil, errors.New("enabled xpay product requires product_id")
	}
	return row, nil
}
