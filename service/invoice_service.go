package service

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"net/http"
	"path"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service/ticket_storage"
	system_setting "github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/QuantumNous/new-api/types"

	"github.com/bytedance/gopkg/util/gopool"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type InvoiceObjectMeta struct {
	ContentType string
	SizeBytes   int64
}

type InvoiceStorage interface {
	HeadObject(ctx context.Context, objectKey string) (InvoiceObjectMeta, error)
	UploadObject(ctx context.Context, objectKey, contentType string, body []byte) error
	PresignUpload(ctx context.Context, objectKey, contentType string) (uploadURL string, requiredHeaders map[string]string, expiresAt int64, err error)
	PresignGetWithResponse(ctx context.Context, objectKey string, resp InvoicePresignGetResponseOptions) (url string, expiresAt int64, err error)
}

type InvoicePresignGetResponseOptions struct {
	ContentDisposition string
	ContentType        string
}

type invoiceStorageAdapter struct {
	client ticket_storage.Client
}

func (a invoiceStorageAdapter) HeadObject(ctx context.Context, objectKey string) (InvoiceObjectMeta, error) {
	size, contentType, err := a.client.HeadObject(objectKey)
	if err != nil {
		return InvoiceObjectMeta{}, err
	}
	return InvoiceObjectMeta{ContentType: contentType, SizeBytes: size}, nil
}

func (a invoiceStorageAdapter) UploadObject(ctx context.Context, objectKey, contentType string, body []byte) error {
	return a.client.UploadObject(ctx, objectKey, contentType, body)
}

func (a invoiceStorageAdapter) PresignUpload(ctx context.Context, objectKey, contentType string) (string, map[string]string, int64, error) {
	url, headers, expiresAt, err := a.client.PresignUpload(objectKey, contentType, invoiceStoragePresignExpire())
	if err != nil {
		return "", nil, 0, err
	}
	return url, headers, expiresAt.Unix(), nil
}

func (a invoiceStorageAdapter) PresignGetWithResponse(ctx context.Context, objectKey string, resp InvoicePresignGetResponseOptions) (string, int64, error) {
	url, expiresAt, err := a.client.PresignGetWithResponse(ctx, objectKey, invoiceStoragePresignExpire(), ticket_storage.PresignGetResponseOptions{
		ContentDisposition: resp.ContentDisposition,
		ContentType:        resp.ContentType,
	})
	if err != nil {
		return "", 0, err
	}
	return url, expiresAt.Unix(), nil
}

func defaultInvoiceStorage() (InvoiceStorage, error) {
	client, err := ticket_storage.GetClient()
	if err != nil {
		return nil, err
	}
	return invoiceStorageAdapter{client: client}, nil
}

func invoiceStoragePresignExpire() time.Duration {
	return 15 * time.Minute
}

func maxInvoiceFileBytes() int64 {
	maxMB := constant.MaxFileDownloadMB
	if maxMB <= 0 {
		maxMB = 64
	}
	return int64(maxMB) * 1024 * 1024
}

func normalizeInvoiceDispositionParam(v string) string {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "attachment":
		return "attachment"
	case "inline":
		fallthrough
	default:
		return "inline"
	}
}

const invoiceBase62Alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

func secureRandomInvoiceBase62(n int) (string, error) {
	if n <= 0 {
		return "", fmt.Errorf("invalid length")
	}
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	out := make([]byte, n)
	for i, b := range buf {
		out[i] = invoiceBase62Alphabet[int(b)%len(invoiceBase62Alphabet)]
	}
	return string(out), nil
}

var safeExtRe = regexp.MustCompile(`^\.[A-Za-z0-9]{1,10}$`)

func sanitizeInvoiceExt(originalFilename string) string {
	base := path.Base(strings.TrimSpace(originalFilename))
	ext := path.Ext(base)
	if safeExtRe.MatchString(ext) {
		return ext
	}
	return ""
}

func buildInvoiceContentDisposition(disposition, originalFilename string) (string, error) {
	disposition = normalizeInvoiceDispositionParam(disposition)
	safeName, err := secureRandomInvoiceBase62(12)
	if err != nil {
		return "", err
	}
	ext := sanitizeInvoiceExt(originalFilename)
	return fmt.Sprintf("%s; filename=\"%s%s\"", disposition, safeName, ext), nil
}

func resolveInvoiceResponseContentType(contentType, originalFilename string) string {
	ct := strings.ToLower(strings.TrimSpace(contentType))
	if ct != "" && ct != "application/octet-stream" {
		return ct
	}
	if strings.EqualFold(path.Ext(strings.TrimSpace(originalFilename)), ".pdf") {
		return "application/pdf"
	}
	return ct
}

func ensureInvoiceFileContentType(contentType string) error {
	ct := strings.ToLower(strings.TrimSpace(contentType))
	if ct == "" {
		// Some OSS providers may not return content-type reliably.
		return nil
	}
	switch ct {
	case "application/octet-stream", "application/pdf", "application/xml", "text/xml", "application/ofd", "application/x-ofd":
		return nil
	}
	if strings.HasPrefix(ct, "image/") {
		return nil
	}
	return fmt.Errorf("invalid content type: %s", contentType)
}

func headAndValidateInvoiceFile(ctx context.Context, storage InvoiceStorage, objectKey string) (InvoiceObjectMeta, error) {
	meta, err := storage.HeadObject(ctx, objectKey)
	if err != nil {
		return InvoiceObjectMeta{}, err
	}
	if err := ensureInvoiceFileContentType(meta.ContentType); err != nil {
		return InvoiceObjectMeta{}, err
	}
	maxBytes := maxInvoiceFileBytes()
	if meta.SizeBytes <= 0 || meta.SizeBytes > maxBytes {
		return InvoiceObjectMeta{}, fmt.Errorf("invalid object size: %d (max %d)", meta.SizeBytes, maxBytes)
	}
	return meta, nil
}

// -------- User-facing: invoiceable orders --------

type InvoiceableOrder struct {
	SourceType    string  `json:"source_type"`
	SourceId      int     `json:"source_id"`
	TradeNo       string  `json:"trade_no"`
	Money         float64 `json:"money"`
	Currency      string  `json:"currency"`
	PaymentMethod string  `json:"payment_method"`
	CompleteTime  int64   `json:"complete_time"`
}

// ListInvoiceableOrdersForUser lists eligible successful orders for the user.
// It excludes subscription-mirrored topups (SUB* / sub_ref_*), and excludes orders already invoiced.
func ListInvoiceableOrdersForUser(ctx context.Context, tenantId int, userId int, keyword string, pageInfo *common.PageInfo) ([]InvoiceableOrder, int64, error) {
	_ = ctx
	if userId <= 0 {
		return nil, 0, types.NewErrorWithStatusCode(fmt.Errorf("invalid user id"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}
	keyword = strings.TrimSpace(keyword)
	if pageInfo == nil {
		pageInfo = &common.PageInfo{Page: 1, PageSize: common.ItemsPerPage}
	}

	// Collect IDs already invoiced to filter out.
	// We do this in Go to keep the query simple and cross-db compatible.
	var invoicedTopUpIds []int
	var invoicedSubIds []int
	{
		var items []model.InvoiceItem
		q := model.DB.Model(&model.InvoiceItem{}).Where("user_id = ?", userId)
		if tenantId > 0 {
			q = q.Where("tenant_id = ?", tenantId)
		}
		if err := q.Find(&items).Error; err != nil {
			return nil, 0, err
		}
		for _, it := range items {
			switch it.SourceType {
			case model.InvoiceItemSourceTopUp:
				invoicedTopUpIds = append(invoicedTopUpIds, it.SourceId)
			case model.InvoiceItemSourceSubscription:
				invoicedSubIds = append(invoicedSubIds, it.SourceId)
			}
		}
	}

	// Build two queries then merge + sort in memory.
	// Volume is typically small (per-user), and we already paginate in UI.
	var topups []model.TopUp
	qTop := model.DB.Model(&model.TopUp{}).
		Where("user_id = ?", userId).
		Where("status = ?", common.TopUpStatusSuccess).
		Where("payment_method IN ?", []string{"alipay", "wxpay"}).
		Where("trade_no NOT LIKE ?", "SUB%").
		Where("trade_no NOT LIKE ?", "sub_ref_%")
	if tenantId > 0 {
		qTop = qTop.Where("tenant_id = ?", tenantId)
	}
	if keyword != "" {
		qTop = qTop.Where("trade_no LIKE ?", "%"+keyword+"%")
	}
	if len(invoicedTopUpIds) > 0 {
		qTop = qTop.Where("id NOT IN ?", invoicedTopUpIds)
	}
	if err := qTop.Find(&topups).Error; err != nil {
		return nil, 0, err
	}

	var subs []model.SubscriptionOrder
	qSub := model.DB.Model(&model.SubscriptionOrder{}).
		Where("user_id = ?", userId).
		Where("status = ?", common.TopUpStatusSuccess).
		Where("payment_method IN ?", []string{"alipay", "wxpay"})
	if tenantId > 0 {
		qSub = qSub.Where("tenant_id = ?", tenantId)
	}
	if keyword != "" {
		qSub = qSub.Where("trade_no LIKE ?", "%"+keyword+"%")
	}
	if len(invoicedSubIds) > 0 {
		qSub = qSub.Where("id NOT IN ?", invoicedSubIds)
	}
	if err := qSub.Find(&subs).Error; err != nil {
		return nil, 0, err
	}

	all := make([]InvoiceableOrder, 0, len(topups)+len(subs))
	for _, t := range topups {
		all = append(all, InvoiceableOrder{
			SourceType:    model.InvoiceItemSourceTopUp,
			SourceId:      t.Id,
			TradeNo:       t.TradeNo,
			Money:         t.Money,
			Currency:      model.InvoiceCurrencyCNY,
			PaymentMethod: t.PaymentMethod,
			CompleteTime:  t.CompleteTime,
		})
	}
	for _, o := range subs {
		all = append(all, InvoiceableOrder{
			SourceType:    model.InvoiceItemSourceSubscription,
			SourceId:      o.Id,
			TradeNo:       o.TradeNo,
			Money:         o.Money,
			Currency:      model.InvoiceCurrencyCNY,
			PaymentMethod: o.PaymentMethod,
			CompleteTime:  o.CompleteTime,
		})
	}

	// Sort desc by complete_time then id.
	// Note: stable enough for display; pagination will be applied after sorting.
	sortInvoiceableOrders(all)

	total := int64(len(all))
	start := pageInfo.GetStartIdx()
	end := start + pageInfo.PageSize
	if start >= len(all) {
		return []InvoiceableOrder{}, total, nil
	}
	if end > len(all) {
		end = len(all)
	}
	return all[start:end], total, nil
}

func sortInvoiceableOrders(items []InvoiceableOrder) {
	sort.Slice(items, func(i, j int) bool {
		if items[i].CompleteTime != items[j].CompleteTime {
			return items[i].CompleteTime > items[j].CompleteTime
		}
		if items[i].SourceType != items[j].SourceType {
			return items[i].SourceType < items[j].SourceType
		}
		return items[i].SourceId > items[j].SourceId
	})
}

// -------- User: create/cancel/list application --------

type CreateInvoiceApplicationParams struct {
	UserId                int
	InvoiceType           string
	Title                 string
	TaxId                 string
	Email                 string
	ApplyRemark           string
	GoodsName             string
	TaxClassificationCode string
	TaxRateValue          string
	IssueKindCode         string
	Items                 []CreateInvoiceApplicationItem
}

type CreateInvoiceApplicationItem struct {
	SourceType string
	SourceId   int
}

func CreateInvoiceApplication(ctx context.Context, tenantId int, p CreateInvoiceApplicationParams) (*model.InvoiceApplication, []model.InvoiceItem, error) {
	if p.UserId <= 0 {
		return nil, nil, types.NewErrorWithStatusCode(fmt.Errorf("invalid user id"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}
	p.InvoiceType = strings.TrimSpace(p.InvoiceType)
	switch p.InvoiceType {
	case model.InvoiceTypePersonal, model.InvoiceTypeCompany:
		// ok
	default:
		return nil, nil, types.NewErrorWithStatusCode(fmt.Errorf("invalid invoice type"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}
	p.Title = strings.TrimSpace(p.Title)
	p.Email = strings.TrimSpace(p.Email)
	p.TaxId = strings.TrimSpace(p.TaxId)
	p.ApplyRemark = strings.TrimSpace(p.ApplyRemark)
	if p.Title == "" || p.Email == "" {
		return nil, nil, types.NewErrorWithStatusCode(fmt.Errorf("missing title or email"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}
	if p.InvoiceType == model.InvoiceTypeCompany && p.TaxId == "" {
		return nil, nil, types.NewErrorWithStatusCode(fmt.Errorf("missing tax id"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}

	minInvoiceAmount := getMinInvoiceAmount()

	common.OptionMapRWMutex.RLock()
	defaultPaymentCode := strings.TrimSpace(common.OptionMap["InvoiceDefaultPaymentCode"])
	defaultSubMchid := strings.TrimSpace(common.OptionMap["InvoiceDefaultSubMchid"])
	defaultAccount := strings.TrimSpace(common.OptionMap["InvoiceDefaultAccount"])
	common.OptionMapRWMutex.RUnlock()

	seen := make(map[string]struct{}, len(p.Items))
	uniqueItems := make([]CreateInvoiceApplicationItem, 0, len(p.Items))
	for _, it := range p.Items {
		it.SourceType = strings.TrimSpace(it.SourceType)
		if it.SourceId <= 0 || it.SourceType == "" {
			continue
		}
		key := it.SourceType + ":" + strconv.Itoa(it.SourceId)
		if _, ok := seen[key]; ok {
			return nil, nil, types.NewErrorWithStatusCode(fmt.Errorf("duplicate invoice items are not allowed"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
		}
		seen[key] = struct{}{}
		uniqueItems = append(uniqueItems, it)
	}
	if len(uniqueItems) == 0 {
		return nil, nil, types.NewErrorWithStatusCode(fmt.Errorf("missing invoice items"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}

	var createdApp *model.InvoiceApplication
	var createdItems []model.InvoiceItem
	if err := model.DB.Transaction(func(tx *gorm.DB) error {
		app := &model.InvoiceApplication{
			TenantId:              tenantId,
			UserId:                p.UserId,
			InvoiceType:           p.InvoiceType,
			Title:                 p.Title,
			TaxId:                 p.TaxId,
			Email:                 p.Email,
			ApplyRemark:           p.ApplyRemark,
			GoodsName:             p.GoodsName,
			TaxClassificationCode: p.TaxClassificationCode,
			TaxRateValue:          p.TaxRateValue,
			IssueKindCode:         p.IssueKindCode,
			Status:                model.InvoiceStatusPending,
			Currency:              model.InvoiceCurrencyCNY,
			TotalMoney:            0,
			ApprovedAt:            0,
			IssuedAt:              0,
			CancelledAt:           0,
		}
		if err := tx.Create(app).Error; err != nil {
			return err
		}

		items := make([]model.InvoiceItem, 0, len(uniqueItems))
		totalMoney := 0.0
		now := common.GetTimestamp()

		for _, it := range uniqueItems {
			switch it.SourceType {
			case model.InvoiceItemSourceTopUp:
				var top model.TopUp
				err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
					Where("id = ? AND tenant_id = ?", it.SourceId, tenantId).
					First(&top).Error
				if err != nil {
					if errors.Is(err, gorm.ErrRecordNotFound) {
						return types.NewErrorWithStatusCode(fmt.Errorf("order not found"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
					}
					return err
				}
				if top.UserId != p.UserId {
					return types.NewErrorWithStatusCode(fmt.Errorf("order not owned"), types.ErrorCodeAccessDenied, http.StatusForbidden, types.ErrOptionWithSkipRetry())
				}
				if top.Status != common.TopUpStatusSuccess {
					return types.NewErrorWithStatusCode(fmt.Errorf("invalid order status"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
				}
				if top.PaymentMethod != "alipay" && top.PaymentMethod != "wxpay" {
					return types.NewErrorWithStatusCode(fmt.Errorf("invalid payment method"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
				}
				if strings.HasPrefix(top.TradeNo, "SUB") || strings.HasPrefix(top.TradeNo, "sub_ref_") {
					return types.NewErrorWithStatusCode(fmt.Errorf("invalid topup source"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
				}

				epayPaymentCode := mapEpayTypeToPiaotongPaymentCode(top.EpayType)
				paymentCode := defaultPaymentCode
				if epayPaymentCode != "" {
					paymentCode = epayPaymentCode
				}

				invItem := model.InvoiceItem{
					TenantId:          tenantId,
					InvoiceId:         app.Id,
					UserId:            p.UserId,
					SourceType:        model.InvoiceItemSourceTopUp,
					SourceId:          top.Id,
					TradeNo:           top.TradeNo,
					TradeNoThirdParty: top.EpayOrderIdWxAl,
					Money:             top.Money,
					Currency:          model.InvoiceCurrencyCNY,
					PaymentMethod:     top.PaymentMethod,
					CompleteTime:      top.CompleteTime,
					PaymentCode:       paymentCode,
					SubMchid:          defaultSubMchid,
					Account:           defaultAccount,
					CreatedAt:         now,
				}
				if err := tx.Create(&invItem).Error; err != nil {
					if errors.Is(err, gorm.ErrDuplicatedKey) {
						return types.NewErrorWithStatusCode(fmt.Errorf("invoice item duplicated"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
					}
					if strings.Contains(strings.ToLower(err.Error()), "duplicate") || strings.Contains(strings.ToLower(err.Error()), "unique") {
						return types.NewErrorWithStatusCode(fmt.Errorf("invoice item duplicated"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
					}
					return err
				}
				items = append(items, invItem)
				totalMoney += top.Money

			case model.InvoiceItemSourceSubscription:
				var sub model.SubscriptionOrder
				err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
					Where("id = ? AND tenant_id = ?", it.SourceId, tenantId).
					First(&sub).Error
				if err != nil {
					if errors.Is(err, gorm.ErrRecordNotFound) {
						return types.NewErrorWithStatusCode(fmt.Errorf("order not found"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
					}
					return err
				}
				if sub.UserId != p.UserId {
					return types.NewErrorWithStatusCode(fmt.Errorf("order not owned"), types.ErrorCodeAccessDenied, http.StatusForbidden, types.ErrOptionWithSkipRetry())
				}
				if sub.Status != common.TopUpStatusSuccess {
					return types.NewErrorWithStatusCode(fmt.Errorf("invalid order status"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
				}
				if sub.PaymentMethod != "alipay" && sub.PaymentMethod != "wxpay" {
					return types.NewErrorWithStatusCode(fmt.Errorf("invalid payment method"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
				}

				epayPaymentCode := mapEpayTypeToPiaotongPaymentCode(sub.EpayType)
				paymentCode := defaultPaymentCode
				if epayPaymentCode != "" {
					paymentCode = epayPaymentCode
				}

				invItem := model.InvoiceItem{
					TenantId:          tenantId,
					InvoiceId:         app.Id,
					UserId:            p.UserId,
					SourceType:        model.InvoiceItemSourceSubscription,
					SourceId:          sub.Id,
					TradeNo:           sub.TradeNo,
					TradeNoThirdParty: sub.EpayOrderIdWxAl,
					Money:             sub.Money,
					Currency:          model.InvoiceCurrencyCNY,
					PaymentMethod:     sub.PaymentMethod,
					CompleteTime:      sub.CompleteTime,
					PaymentCode:       paymentCode,
					SubMchid:          defaultSubMchid,
					Account:           defaultAccount,
					CreatedAt:         now,
				}
				if err := tx.Create(&invItem).Error; err != nil {
					if errors.Is(err, gorm.ErrDuplicatedKey) {
						return types.NewErrorWithStatusCode(fmt.Errorf("invoice item duplicated"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
					}
					if strings.Contains(strings.ToLower(err.Error()), "duplicate") || strings.Contains(strings.ToLower(err.Error()), "unique") {
						return types.NewErrorWithStatusCode(fmt.Errorf("invoice item duplicated"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
					}
					return err
				}
				items = append(items, invItem)
				totalMoney += sub.Money

			default:
				return types.NewErrorWithStatusCode(fmt.Errorf("invalid source type"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
			}
		}

		if totalMoney < float64(minInvoiceAmount) {
			return types.NewErrorWithStatusCode(fmt.Errorf("invoice amount below minimum"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
		}

		app.TotalMoney = totalMoney
		if err := tx.Save(app).Error; err != nil {
			return err
		}

		createdApp = app
		createdItems = items
		return nil
	}); err != nil {
		return nil, nil, err
	}
	return createdApp, createdItems, nil
}

func CancelInvoiceApplication(ctx context.Context, tenantId int, userId int, invoiceId int) (*model.InvoiceApplication, error) {
	_ = ctx
	if userId <= 0 || invoiceId <= 0 {
		return nil, types.NewErrorWithStatusCode(fmt.Errorf("invalid params"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}

	var out *model.InvoiceApplication
	if err := model.DB.Transaction(func(tx *gorm.DB) error {
		appQuery := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", invoiceId)
		if tenantId > 0 {
			appQuery = appQuery.Where("tenant_id = ?", tenantId)
		}
		var app model.InvoiceApplication
		err := appQuery.First(&app).Error
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return types.NewErrorWithStatusCode(fmt.Errorf("invoice not found"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
			}
			return err
		}
		if app.UserId != userId {
			return types.NewErrorWithStatusCode(fmt.Errorf("access denied"), types.ErrorCodeAccessDenied, http.StatusForbidden, types.ErrOptionWithSkipRetry())
		}
		if app.Status != model.InvoiceStatusPending {
			return types.NewErrorWithStatusCode(fmt.Errorf("invalid invoice status"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
		}
		app.Status = model.InvoiceStatusCancelled
		app.CancelledAt = common.GetTimestamp()
		if err := tx.Save(&app).Error; err != nil {
			return err
		}
		// Delete associated invoice items so the orders become invoiceable again
		if err := tx.Where("invoice_id = ?", app.Id).Delete(&model.InvoiceItem{}).Error; err != nil {
			return err
		}
		out = &app
		return nil
	}); err != nil {
		return nil, err
	}
	return out, nil
}

// -------- Admin upload + bind + presign --------

type AdminPresignInvoiceUploadParams struct {
	AdminId     int
	InvoiceId   int
	Filename    string
	ContentType string
	SizeBytes   int64
}

type AdminPresignInvoiceUploadResult struct {
	ObjectKey       string            `json:"object_key"`
	UploadURL       string            `json:"upload_url"`
	RequiredHeaders map[string]string `json:"required_headers"`
	ExpiresAt       int64             `json:"expires_at"`
}

func AdminPresignInvoiceUpload(ctx context.Context, tenantId int, p AdminPresignInvoiceUploadParams) (*AdminPresignInvoiceUploadResult, error) {
	if p.AdminId <= 0 || p.InvoiceId <= 0 {
		return nil, types.NewErrorWithStatusCode(fmt.Errorf("invalid admin id or invoice id"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}
	p.Filename = strings.TrimSpace(p.Filename)
	p.ContentType = strings.TrimSpace(p.ContentType)
	if p.Filename == "" || p.ContentType == "" {
		return nil, types.NewErrorWithStatusCode(fmt.Errorf("missing filename or content type"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}
	if p.SizeBytes <= 0 || p.SizeBytes > maxInvoiceFileBytes() {
		return nil, types.NewErrorWithStatusCode(fmt.Errorf("invalid size"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}
	if err := ensureInvoiceFileContentType(p.ContentType); err != nil {
		return nil, types.NewErrorWithStatusCode(err, types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}

	storage, err := defaultInvoiceStorage()
	if err != nil {
		return nil, err
	}

	now := common.GetTimestamp()
	dateStr := time.Unix(now, 0).Format("20060102")
	randStr, err := secureRandomInvoiceBase62(12)
	if err != nil {
		return nil, err
	}
	ext := sanitizeInvoiceExt(p.Filename)
	objectKey := fmt.Sprintf("invoices/%d/%s/%d_%s%s", p.InvoiceId, dateStr, now, randStr, ext)

	var out *AdminPresignInvoiceUploadResult
	if err := model.DB.Transaction(func(tx *gorm.DB) error {
		appQuery := tx.Select("id").Where("id = ?", p.InvoiceId)
		if tenantId > 0 {
			appQuery = appQuery.Where("tenant_id = ?", tenantId)
		}
		var app model.InvoiceApplication
		err := appQuery.First(&app).Error
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return types.NewErrorWithStatusCode(fmt.Errorf("invoice not found"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
			}
			return err
		}

		u := &model.InvoiceUpload{
			TenantId:         tenantId,
			UploaderId:       p.AdminId,
			ObjectKey:        objectKey,
			OriginalFilename: p.Filename,
			ContentType:      "",
			SizeBytes:        0,
			ExpiresAt:        now + int64(invoiceStoragePresignExpire().Seconds()),
			UsedAt:           0,
			CreatedAt:        now,
		}
		if err := tx.Create(u).Error; err != nil {
			if errors.Is(err, gorm.ErrDuplicatedKey) {
				return types.NewErrorWithStatusCode(fmt.Errorf("object key duplicated"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
			}
			low := strings.ToLower(err.Error())
			if strings.Contains(low, "duplicate") || strings.Contains(low, "unique") {
				return types.NewErrorWithStatusCode(fmt.Errorf("object key duplicated"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
			}
			return err
		}

		uploadURL, requiredHeaders, expiresAt, err := storage.PresignUpload(ctx, objectKey, p.ContentType)
		if err != nil {
			return err
		}
		out = &AdminPresignInvoiceUploadResult{
			ObjectKey:       objectKey,
			UploadURL:       uploadURL,
			RequiredHeaders: requiredHeaders,
			ExpiresAt:       expiresAt,
		}
		return nil
	}); err != nil {
		return nil, err
	}
	return out, nil
}

type AdminFinalizeInvoiceFilesParams struct {
	AdminId    int
	InvoiceId  int
	ObjectKeys []string
}

func AdminFinalizeInvoiceFiles(ctx context.Context, tenantId int, p AdminFinalizeInvoiceFilesParams) ([]model.InvoiceFile, error) {
	if p.AdminId <= 0 || p.InvoiceId <= 0 {
		return nil, types.NewErrorWithStatusCode(fmt.Errorf("invalid admin id or invoice id"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}
	p.ObjectKeys = compactUniqueInvoiceObjectKeys(p.ObjectKeys)
	if len(p.ObjectKeys) == 0 {
		return nil, types.NewErrorWithStatusCode(fmt.Errorf("no object keys provided"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}
	if len(p.ObjectKeys) > 10 {
		return nil, types.NewErrorWithStatusCode(fmt.Errorf("too many files"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}

	storage, err := defaultInvoiceStorage()
	if err != nil {
		return nil, err
	}

	var files []model.InvoiceFile
	now := common.GetTimestamp()
	prefix := fmt.Sprintf("invoices/%d/", p.InvoiceId)

	if err := model.DB.Transaction(func(tx *gorm.DB) error {
		appQuery := tx.Select("id").Where("id = ?", p.InvoiceId)
		if tenantId > 0 {
			appQuery = appQuery.Where("tenant_id = ?", tenantId)
		}
		var app model.InvoiceApplication
		err := appQuery.First(&app).Error
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return types.NewErrorWithStatusCode(fmt.Errorf("invoice not found"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
			}
			return err
		}

		created := make([]model.InvoiceFile, 0, len(p.ObjectKeys))
		for _, key := range p.ObjectKeys {
			if !strings.HasPrefix(key, prefix) {
				return types.NewErrorWithStatusCode(fmt.Errorf("invalid object key"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
			}

			uploadQuery := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("object_key = ?", key)
			if tenantId > 0 {
				uploadQuery = uploadQuery.Where("tenant_id = ?", tenantId)
			}
			var upload model.InvoiceUpload
			if err := uploadQuery.First(&upload).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return types.NewErrorWithStatusCode(fmt.Errorf("upload not found"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
				}
				return err
			}
			if upload.UsedAt > 0 {
				return types.NewErrorWithStatusCode(fmt.Errorf("upload already used"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
			}
			if upload.ExpiresAt > 0 && upload.ExpiresAt < now {
				return types.NewErrorWithStatusCode(fmt.Errorf("upload expired"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
			}

			meta, err := headAndValidateInvoiceFile(ctx, storage, key)
			if err != nil {
				return types.NewErrorWithStatusCode(fmt.Errorf("validation failed: %w", err), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
			}

			ct := strings.TrimSpace(meta.ContentType)
			if ct == "" {
				ct = strings.TrimSpace(upload.ContentType)
			}
			if ct == "" {
				ct = "application/octet-stream"
			}

			file := model.InvoiceFile{
				TenantId:         tenantId,
				InvoiceId:        p.InvoiceId,
				UploaderId:       p.AdminId,
				ObjectKey:        key,
				OriginalFilename: upload.OriginalFilename,
				ContentType:      ct,
				SizeBytes:        meta.SizeBytes,
				IsRed:            false,
				IsUserVisible:    true,
				CreatedAt:        now,
			}
			if err := tx.Create(&file).Error; err != nil {
				if errors.Is(err, gorm.ErrDuplicatedKey) {
					return types.NewErrorWithStatusCode(fmt.Errorf("file duplicated"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
				}
				low := strings.ToLower(err.Error())
				if strings.Contains(low, "duplicate") || strings.Contains(low, "unique") {
					return types.NewErrorWithStatusCode(fmt.Errorf("file duplicated"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
				}
				return err
			}

			upload.UsedAt = now
			upload.ContentType = ct
			upload.SizeBytes = meta.SizeBytes
			if err := tx.Save(&upload).Error; err != nil {
				return err
			}

			created = append(created, file)
		}

		files = created

		return nil
	}); err != nil {
		return nil, err
	}

	return files, nil
}

func PresignInvoiceFileForUser(ctx context.Context, tenantId int, userId int, fileId int, disposition string) (string, int64, error) {
	if userId <= 0 || fileId <= 0 {
		return "", 0, types.NewErrorWithStatusCode(fmt.Errorf("invalid userId/fileId"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}
	storage, err := defaultInvoiceStorage()
	if err != nil {
		return "", 0, err
	}

	fileQuery := model.DB.Where("id = ?", fileId)
	if tenantId > 0 {
		fileQuery = fileQuery.Where("tenant_id = ?", tenantId)
	}
	var file model.InvoiceFile
	if err := fileQuery.First(&file).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", 0, types.NewErrorWithStatusCode(fmt.Errorf("file not found"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
		}
		return "", 0, err
	}

	appQuery := model.DB.Where("id = ?", file.InvoiceId)
	if tenantId > 0 {
		appQuery = appQuery.Where("tenant_id = ?", tenantId)
	}
	var app model.InvoiceApplication
	if err := appQuery.First(&app).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", 0, types.NewErrorWithStatusCode(fmt.Errorf("invoice not found"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
		}
		return "", 0, err
	}
	if app.UserId != userId {
		return "", 0, types.NewErrorWithStatusCode(fmt.Errorf("access denied"), types.ErrorCodeAccessDenied, http.StatusForbidden, types.ErrOptionWithSkipRetry())
	}
	if !file.IsUserVisible {
		return "", 0, types.NewErrorWithStatusCode(fmt.Errorf("file not found"), types.ErrorCodeInvalidRequest, http.StatusNotFound, types.ErrOptionWithSkipRetry())
	}

	contentDisposition, err := buildInvoiceContentDisposition(disposition, file.OriginalFilename)
	if err != nil {
		return "", 0, err
	}

	url, expiresAt, err := storage.PresignGetWithResponse(ctx, file.ObjectKey, InvoicePresignGetResponseOptions{
		ContentDisposition: contentDisposition,
		ContentType:        resolveInvoiceResponseContentType(file.ContentType, file.OriginalFilename),
	})
	if err != nil {
		return "", 0, err
	}
	return url, expiresAt, nil
}

func PresignInvoiceFileForAdmin(ctx context.Context, tenantId int, fileId int, disposition string) (string, int64, error) {
	if fileId <= 0 {
		return "", 0, types.NewErrorWithStatusCode(fmt.Errorf("invalid fileId"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}
	storage, err := defaultInvoiceStorage()
	if err != nil {
		return "", 0, err
	}

	fileQuery := model.DB.Where("id = ?", fileId)
	if tenantId > 0 {
		fileQuery = fileQuery.Where("tenant_id = ?", tenantId)
	}
	var file model.InvoiceFile
	if err := fileQuery.First(&file).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", 0, types.NewErrorWithStatusCode(fmt.Errorf("file not found"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
		}
		return "", 0, err
	}

	contentDisposition, err := buildInvoiceContentDisposition(disposition, file.OriginalFilename)
	if err != nil {
		return "", 0, err
	}

	url, expiresAt, err := storage.PresignGetWithResponse(ctx, file.ObjectKey, InvoicePresignGetResponseOptions{
		ContentDisposition: contentDisposition,
		ContentType:        resolveInvoiceResponseContentType(file.ContentType, file.OriginalFilename),
	})
	if err != nil {
		return "", 0, err
	}
	return url, expiresAt, nil
}

func getMinInvoiceAmount() int {
	common.OptionMapRWMutex.RLock()
	value := strings.TrimSpace(common.OptionMap["MinInvoiceAmount"])
	common.OptionMapRWMutex.RUnlock()
	if value == "" {
		return 200
	}
	minAmount, err := strconv.Atoi(value)
	if err != nil || minAmount <= 0 {
		return 200
	}
	return minAmount
}

func mapEpayTypeToPiaotongPaymentCode(epayType string) string {
	switch strings.TrimSpace(strings.ToLower(epayType)) {
	case "alipay":
		return "0901"
	default:
		return ""
	}
}

// -------- User: list/detail applications --------

func ListInvoiceApplicationsForUser(ctx context.Context, tenantId int, userId int, status string, keyword string, pageInfo *common.PageInfo) ([]model.InvoiceApplication, int64, error) {
	_ = ctx
	if userId <= 0 {
		return nil, 0, types.NewErrorWithStatusCode(fmt.Errorf("invalid user id"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}
	if pageInfo == nil {
		pageInfo = &common.PageInfo{Page: 1, PageSize: common.ItemsPerPage}
	}

	q := model.DB.Model(&model.InvoiceApplication{}).Where("user_id = ?", userId)
	if tenantId > 0 {
		q = q.Where("tenant_id = ?", tenantId)
	}
	status = strings.TrimSpace(status)
	if status != "" {
		q = q.Where("status = ?", status)
	}
	keyword = strings.TrimSpace(keyword)
	if keyword != "" {
		q = q.Where("title LIKE ? OR email LIKE ?", "%"+keyword+"%", "%"+keyword+"%")
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var apps []model.InvoiceApplication
	if err := q.Order("created_at DESC").Offset(pageInfo.GetStartIdx()).Limit(pageInfo.GetPageSize()).Find(&apps).Error; err != nil {
		return nil, 0, err
	}
	return apps, total, nil
}

func GetInvoiceApplicationDetailForUser(ctx context.Context, tenantId int, userId int, appId int) (*model.InvoiceApplication, []model.InvoiceItem, []model.InvoiceFile, error) {
	_ = ctx
	if userId <= 0 || appId <= 0 {
		return nil, nil, nil, types.NewErrorWithStatusCode(fmt.Errorf("invalid params"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}

	appQuery := model.DB.Where("id = ?", appId)
	if tenantId > 0 {
		appQuery = appQuery.Where("tenant_id = ?", tenantId)
	}
	var app model.InvoiceApplication
	if err := appQuery.First(&app).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, nil, types.NewErrorWithStatusCode(fmt.Errorf("application not found"), types.ErrorCodeInvalidRequest, http.StatusNotFound, types.ErrOptionWithSkipRetry())
		}
		return nil, nil, nil, err
	}
	if app.UserId != userId {
		return nil, nil, nil, types.NewErrorWithStatusCode(fmt.Errorf("access denied"), types.ErrorCodeAccessDenied, http.StatusForbidden, types.ErrOptionWithSkipRetry())
	}

	itemQuery := model.DB.Where("invoice_id = ?", appId)
	if tenantId > 0 {
		itemQuery = itemQuery.Where("tenant_id = ?", tenantId)
	}
	var items []model.InvoiceItem
	if err := itemQuery.Order("id ASC").Find(&items).Error; err != nil {
		return nil, nil, nil, err
	}

	fileQuery := model.DB.Where("invoice_id = ? AND is_user_visible = ?", appId, true)
	if tenantId > 0 {
		fileQuery = fileQuery.Where("tenant_id = ?", tenantId)
	}
	var files []model.InvoiceFile
	if err := fileQuery.Order("id ASC").Find(&files).Error; err != nil {
		return nil, nil, nil, err
	}

	return &app, items, files, nil
}

// -------- Admin: list/detail/status applications --------

func ListInvoiceApplicationsForAdmin(ctx context.Context, tenantId int, status string, userId int, keyword string, pageInfo *common.PageInfo) ([]model.InvoiceApplication, int64, error) {
	_ = ctx
	if pageInfo == nil {
		pageInfo = &common.PageInfo{Page: 1, PageSize: common.ItemsPerPage}
	}

	q := model.DB.Model(&model.InvoiceApplication{})
	if tenantId > 0 {
		q = q.Where("tenant_id = ?", tenantId)
	}
	status = strings.TrimSpace(status)
	if status != "" {
		q = q.Where("status = ?", status)
	}
	if userId > 0 {
		q = q.Where("user_id = ?", userId)
	}
	keyword = strings.TrimSpace(keyword)
	if keyword != "" {
		q = q.Where("title LIKE ? OR email LIKE ?", "%"+keyword+"%", "%"+keyword+"%")
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var apps []model.InvoiceApplication
	if err := q.Order("created_at DESC").Offset(pageInfo.GetStartIdx()).Limit(pageInfo.GetPageSize()).Find(&apps).Error; err != nil {
		return nil, 0, err
	}
	return apps, total, nil
}

func GetInvoiceApplicationDetailForAdmin(ctx context.Context, tenantId int, appId int) (*model.InvoiceApplication, []model.InvoiceItem, []model.InvoiceFile, error) {
	_ = ctx
	if appId <= 0 {
		return nil, nil, nil, types.NewErrorWithStatusCode(fmt.Errorf("invalid params"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}

	appQuery := model.DB.Where("id = ?", appId)
	if tenantId > 0 {
		appQuery = appQuery.Where("tenant_id = ?", tenantId)
	}
	var app model.InvoiceApplication
	if err := appQuery.First(&app).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, nil, types.NewErrorWithStatusCode(fmt.Errorf("application not found"), types.ErrorCodeInvalidRequest, http.StatusNotFound, types.ErrOptionWithSkipRetry())
		}
		return nil, nil, nil, err
	}

	itemQuery := model.DB.Where("invoice_id = ?", appId)
	if tenantId > 0 {
		itemQuery = itemQuery.Where("tenant_id = ?", tenantId)
	}
	var items []model.InvoiceItem
	if err := itemQuery.Order("id ASC").Find(&items).Error; err != nil {
		return nil, nil, nil, err
	}

	fileQuery := model.DB.Where("invoice_id = ?", appId)
	if tenantId > 0 {
		fileQuery = fileQuery.Where("tenant_id = ?", tenantId)
	}
	var files []model.InvoiceFile
	if err := fileQuery.Order("id ASC").Find(&files).Error; err != nil {
		return nil, nil, nil, err
	}

	return &app, items, files, nil
}

// AdminUpdateInvoiceApplicationStatus updates the status of an invoice application.
// State machine:
//   - pending -> approved (sets ApprovedAt)
//   - pending -> rejected (requires reject_reason, sets RejectReason)
//   - approved -> issued (sets IssuedAt)
//   - pending -> cancelled (sets CancelledAt)
//   - issued/cancelled cannot transition further
func AdminUpdateInvoiceApplicationStatus(ctx context.Context, tenantId int, adminId int, appId int, newStatus string, adminRemark string, rejectReason string, goodsName string, taxClassificationCode string, taxRateValue string) (*model.InvoiceApplication, error) {
	_ = ctx
	if adminId <= 0 || appId <= 0 {
		return nil, types.NewErrorWithStatusCode(fmt.Errorf("invalid params"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}
	newStatus = strings.TrimSpace(newStatus)
	adminRemark = strings.TrimSpace(adminRemark)
	rejectReason = strings.TrimSpace(rejectReason)
	goodsName = strings.TrimSpace(goodsName)
	taxClassificationCode = strings.TrimSpace(taxClassificationCode)
	taxRateValue = strings.TrimSpace(taxRateValue)

	var out *model.InvoiceApplication
	if err := model.DB.Transaction(func(tx *gorm.DB) error {
		appQuery := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", appId)
		if tenantId > 0 {
			appQuery = appQuery.Where("tenant_id = ?", tenantId)
		}
		var app model.InvoiceApplication
		err := appQuery.First(&app).Error
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return types.NewErrorWithStatusCode(fmt.Errorf("application not found"), types.ErrorCodeInvalidRequest, http.StatusNotFound, types.ErrOptionWithSkipRetry())
			}
			return err
		}

		now := common.GetTimestamp()

		if !isValidInvoiceStatusTransition(app.Status, newStatus) {
			return types.NewErrorWithStatusCode(
				fmt.Errorf("invalid status transition: %s -> %s", app.Status, newStatus),
				types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry(),
			)
		}

		if newStatus == model.InvoiceStatusRejected && rejectReason == "" {
			return types.NewErrorWithStatusCode(fmt.Errorf("reject reason is required"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
		}

		app.Status = newStatus
		if adminRemark != "" {
			app.AdminRemark = adminRemark
		}
		if rejectReason != "" {
			app.RejectReason = rejectReason
		}
		if goodsName != "" {
			app.GoodsName = goodsName
		}
		if taxClassificationCode != "" {
			app.TaxClassificationCode = taxClassificationCode
		}
		if taxRateValue != "" {
			app.TaxRateValue = taxRateValue
		}

		switch newStatus {
		case model.InvoiceStatusApproved:
			app.ApprovedAt = now
		case model.InvoiceStatusIssued:
			app.IssuedAt = now
		case model.InvoiceStatusCancelled:
			app.CancelledAt = now
		}

		if err := tx.Save(&app).Error; err != nil {
			return err
		}
		// Release associated orders when cancelled or rejected so they become invoiceable again
		if newStatus == model.InvoiceStatusCancelled || newStatus == model.InvoiceStatusRejected {
			if err := tx.Where("invoice_id = ?", app.Id).Delete(&model.InvoiceItem{}).Error; err != nil {
				return err
			}
		}
		out = &app
		return nil
	}); err != nil {
		return nil, err
	}

	// After successful approval, try auto-issue if configured
	if out != nil && out.Status == model.InvoiceStatusApproved {
		TryAutoIssueInvoice(out.Id)
	}

	// Send email notification when invoice is marked as issued
	if out != nil && out.Status == model.InvoiceStatusIssued && out.Email != "" {
		app := out
		gopool.Go(func() {
			sendInvoiceIssuedEmail(app)
		})
	}

	return out, nil
}

func sendInvoiceIssuedEmail(app *model.InvoiceApplication) {
	if common.SMTPServer == "" {
		return
	}
	serverAddr := system_setting.ServerAddress
	subject := "您的发票已开具"
	body := fmt.Sprintf(`<p style="margin:0 0 16px">尊敬的用户，您好！</p>
<p style="margin:0 0 16px">您提交的发票申请已开具完成，详情如下：</p>
<table style="width:100%%;border-collapse:collapse;margin:16px 0">
<tr><td style="padding:10px 16px;background-color:#f9fafb;border:1px solid #e5e7eb;color:#6b7280;width:100px">申请编号</td><td style="padding:10px 16px;border:1px solid #e5e7eb;font-weight:600">%d</td></tr>
<tr><td style="padding:10px 16px;background-color:#f9fafb;border:1px solid #e5e7eb;color:#6b7280">发票抬头</td><td style="padding:10px 16px;border:1px solid #e5e7eb">%s</td></tr>
<tr><td style="padding:10px 16px;background-color:#f9fafb;border:1px solid #e5e7eb;color:#6b7280">发票金额</td><td style="padding:10px 16px;border:1px solid #e5e7eb;font-weight:600;color:#059669">%.2f %s</td></tr>
</table>
<div style="margin:24px 0;text-align:center">
<a href="%s/console/invoice" style="display:inline-block;padding:12px 32px;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#ffffff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600">查看发票</a>
</div>
<p style="margin:0;color:#6b7280;font-size:13px">如有疑问，请联系客服。</p>`,
		app.Id, app.Title, app.TotalMoney, app.Currency, serverAddr,
	)
	if err := common.SendEmail(subject, app.Email, common.WrapEmailHTML(body)); err != nil {
		common.SysLog(fmt.Sprintf("failed to send invoice issued email to %s: %v", app.Email, err))
	}
}

type AdminUpdateInvoiceFileVisibilityParams struct {
	AdminId       int
	InvoiceId     int
	FileId        int
	IsUserVisible bool
}

func AdminUpdateInvoiceFileVisibility(ctx context.Context, tenantId int, p AdminUpdateInvoiceFileVisibilityParams) (*model.InvoiceFile, error) {
	_ = ctx
	if p.AdminId <= 0 || p.InvoiceId <= 0 || p.FileId <= 0 {
		return nil, types.NewErrorWithStatusCode(fmt.Errorf("invalid params"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}

	var out *model.InvoiceFile
	if err := model.DB.Transaction(func(tx *gorm.DB) error {
		appQuery := tx.Select("id").Where("id = ?", p.InvoiceId)
		if tenantId > 0 {
			appQuery = appQuery.Where("tenant_id = ?", tenantId)
		}
		var app model.InvoiceApplication
		if err := appQuery.First(&app).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return types.NewErrorWithStatusCode(fmt.Errorf("application not found"), types.ErrorCodeInvalidRequest, http.StatusNotFound, types.ErrOptionWithSkipRetry())
			}
			return err
		}

		fileQuery := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND invoice_id = ?", p.FileId, p.InvoiceId)
		if tenantId > 0 {
			fileQuery = fileQuery.Where("tenant_id = ?", tenantId)
		}
		var file model.InvoiceFile
		if err := fileQuery.First(&file).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return types.NewErrorWithStatusCode(fmt.Errorf("file not found"), types.ErrorCodeInvalidRequest, http.StatusNotFound, types.ErrOptionWithSkipRetry())
			}
			return err
		}

		file.IsUserVisible = p.IsUserVisible
		if err := tx.Save(&file).Error; err != nil {
			return err
		}
		out = &file
		return nil
	}); err != nil {
		return nil, err
	}
	return out, nil
}

func isValidInvoiceStatusTransition(from, to string) bool {
	switch from {
	case model.InvoiceStatusPending:
		return to == model.InvoiceStatusApproved || to == model.InvoiceStatusRejected || to == model.InvoiceStatusCancelled || to == model.InvoiceStatusIssued
	case model.InvoiceStatusApproved:
		return to == model.InvoiceStatusIssued
	default:
		return false
	}
}

// BatchLoadUsernamesForInvoice loads usernames for a list of user IDs.
func BatchLoadUsernamesForInvoice(tenantId int, userIds []int) map[int]string {
	if len(userIds) == 0 {
		return nil
	}
	unique := make(map[int]struct{}, len(userIds))
	ids := make([]int, 0, len(userIds))
	for _, id := range userIds {
		if _, ok := unique[id]; ok {
			continue
		}
		unique[id] = struct{}{}
		ids = append(ids, id)
	}

	type userRow struct {
		Id       int    `gorm:"column:id"`
		Username string `gorm:"column:username"`
	}
	var rows []userRow
	query := model.DB.Table("users").Select("id, username").Where("id IN ?", ids)
	if tenantId > 0 {
		query = query.Where("tenant_id = ?", tenantId)
	}
	if err := query.Find(&rows).Error; err != nil {
		return nil
	}
	m := make(map[int]string, len(rows))
	for _, r := range rows {
		m[r.Id] = r.Username
	}
	return m
}

// helpers

func compactUniqueInvoiceObjectKeys(keys []string) []string {
	seen := make(map[string]struct{}, len(keys))
	out := make([]string, 0, len(keys))
	for _, k := range keys {
		k = strings.TrimSpace(k)
		if k == "" {
			continue
		}
		if _, ok := seen[k]; ok {
			continue
		}
		seen[k] = struct{}{}
		out = append(out, k)
	}
	return out
}

// SetInvoiceItemPaymentInfo 更新发票明细项的乐企联用支付信息。
func SetInvoiceItemPaymentInfo(tenantId int, itemId int, req dto.InvoiceAdminSetItemPaymentInfoRequest) error {
	if itemId <= 0 {
		return types.NewErrorWithStatusCode(fmt.Errorf("invalid item id"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}
	query := model.DB.Model(&model.InvoiceItem{}).Where("id = ?", itemId)
	if tenantId > 0 {
		query = query.Where("tenant_id = ?", tenantId)
	}
	return query.Updates(map[string]interface{}{
		"payment_code":         strings.TrimSpace(req.PaymentCode),
		"trade_no_third_party": strings.TrimSpace(req.TradeNoThirdParty),
		"sub_mchid":            strings.TrimSpace(req.SubMchid),
		"account":              strings.TrimSpace(req.Account),
	}).Error
}
