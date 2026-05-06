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

// xpayProductRequest is the body for both CREATE and UPDATE. UPDATE has
// strict PUT-replace semantics: every writable field on the row is taken
// from the request unconditionally. Frontends must round-trip the full row
// (read the existing record, mutate, send back).
//
// TierCode + Platform form the unique identity (tenant_id, tier_code,
// platform) and are IMMUTABLE on UPDATE — buildXpayProductFromRequest
// preserves the existing values and ignores any incoming change.
type xpayProductRequest struct {
	TierCode    string `json:"tier_code"`
	Name        string `json:"name"`
	ProductId   string `json:"product_id"`
	Platform    string `json:"platform"`
	AmountCents int64  `json:"amount_cents"`
	QuotaDelta  int64  `json:"quota_delta"`
	Enabled     bool   `json:"enabled"`
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

// buildXpayProductFromRequest validates the request as a complete record and
// produces a row ready to persist. CREATE and UPDATE share validation; the
// only difference is identity:
//   - CREATE: TierCode + Platform come from the request
//   - UPDATE: TierCode + Platform are taken from `existing` (immutable —
//     they're part of the row's unique identity and changing them would
//     either silently break (tenant_id, tier_code, platform) uniqueness or
//     orphan in-flight orders that reference the old tier).
//
// All other writable fields are overwritten unconditionally so partial
// updates can't accidentally clobber unrelated columns.
func buildXpayProductFromRequest(tid int, existing *model.TenantXpayProduct, req xpayProductRequest) (*model.TenantXpayProduct, error) {
	row := &model.TenantXpayProduct{TenantId: tid}
	if existing != nil {
		cp := *existing
		row = &cp
	}

	if existing == nil {
		row.TierCode = strings.TrimSpace(req.TierCode)
		row.Platform = strings.TrimSpace(strings.ToLower(req.Platform))
		if row.Platform == "" {
			row.Platform = "android"
		}
	}
	row.Name = strings.TrimSpace(req.Name)
	row.ProductId = strings.TrimSpace(req.ProductId)
	row.AmountCents = req.AmountCents
	row.QuotaDelta = req.QuotaDelta
	row.Enabled = req.Enabled
	row.SortOrder = req.SortOrder

	if row.TierCode == "" || row.Name == "" {
		return nil, errors.New("tier_code and name are required")
	}
	if row.Platform != "android" && row.Platform != "ios" {
		return nil, errors.New("platform must be android or ios")
	}
	if row.AmountCents <= 0 || row.QuotaDelta <= 0 {
		return nil, errors.New("amount_cents and quota_delta must be positive")
	}
	if row.Enabled && row.ProductId == "" {
		return nil, errors.New("enabled xpay product requires product_id")
	}
	return row, nil
}
