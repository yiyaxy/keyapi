package invoice

import (
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
)

func respondInvoiceableOrdersList(c *gin.Context, pageInfo *common.PageInfo, items any, total int64) {
	common.ApiSuccess(c, gin.H{
		"items":     items,
		"total":     total,
		"page":      pageInfo.GetPage(),
		"page_size": pageInfo.GetPageSize(),
	})
}

// InvoiceSelfInvoiceableOrders handles GET /api/invoice/self/invoiceable_orders (UserAuth)
func InvoiceSelfInvoiceableOrders(c *gin.Context) {
	userId := c.GetInt("id")
	pageInfo := common.GetPageQuery(c)
	keyword := strings.TrimSpace(c.Query("keyword"))

	items, total, err := service.ListInvoiceableOrdersForUser(c.Request.Context(), middleware.GetTenantId(c), userId, keyword, pageInfo)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	respondInvoiceableOrdersList(c, pageInfo, items, total)
}

// InvoiceSelfCreateApplication handles POST /api/invoice/self/applications (UserAuth)
func InvoiceSelfCreateApplication(c *gin.Context) {
	userId := c.GetInt("id")

	var req dto.InvoiceApplicationCreateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}

	items := make([]service.CreateInvoiceApplicationItem, 0, len(req.Items))
	for _, it := range req.Items {
		items = append(items, service.CreateInvoiceApplicationItem{
			SourceType: strings.TrimSpace(it.SourceType),
			SourceId:   it.SourceId,
		})
	}

	app, createdItems, err := service.CreateInvoiceApplication(c.Request.Context(), middleware.GetTenantId(c), service.CreateInvoiceApplicationParams{
		UserId:                userId,
		InvoiceType:           strings.TrimSpace(req.InvoiceType),
		Title:                 strings.TrimSpace(req.Title),
		TaxId:                 strings.TrimSpace(req.TaxId),
		Email:                 strings.TrimSpace(req.Email),
		ApplyRemark:           strings.TrimSpace(req.ApplyRemark),
		GoodsName:             strings.TrimSpace(req.GoodsName),
		TaxClassificationCode: strings.TrimSpace(req.TaxClassificationCode),
		TaxRateValue:          strings.TrimSpace(req.TaxRateValue),
		IssueKindCode:         strings.TrimSpace(req.IssueKindCode),
		Items:                 items,
	})
	if err != nil {
		common.ApiError(c, err)
		return
	}

	common.ApiSuccess(c, gin.H{
		"application": app,
		"items":       createdItems,
	})
}

// InvoiceSelfCancelApplication handles POST /api/invoice/self/applications/:id/cancel (UserAuth)
func InvoiceSelfCancelApplication(c *gin.Context) {
	userId := c.GetInt("id")

	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}

	app, err := service.CancelInvoiceApplication(c.Request.Context(), middleware.GetTenantId(c), userId, id)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	common.ApiSuccess(c, app)
}

// -------- shared DTO converters --------

func toApplicationListItem(a model.InvoiceApplication, username string) dto.InvoiceApplicationListItem {
	return dto.InvoiceApplicationListItem{
		Id:                         a.Id,
		UserId:                     a.UserId,
		InvoiceType:                a.InvoiceType,
		Title:                      a.Title,
		TaxId:                      a.TaxId,
		Email:                      a.Email,
		Status:                     a.Status,
		IssueStatus:                a.IssueStatus,
		Provider:                   a.Provider,
		IssueMode:                  a.IssueMode,
		TotalMoney:                 a.TotalMoney,
		Currency:                   a.Currency,
		ApplyRemark:                a.ApplyRemark,
		AdminRemark:                a.AdminRemark,
		RejectReason:               a.RejectReason,
		GoodsName:                  a.GoodsName,
		TaxClassificationCode:      a.TaxClassificationCode,
		TaxRateValue:               a.TaxRateValue,
		IssueKindCode:              a.IssueKindCode,
		PiaoTongSerialNo:           a.PiaoTongSerialNo,
		PiaoTongInvoiceReqSerialNo: a.PiaoTongInvoiceReqSerialNo,
		PiaoTongInvoiceCode:        a.PiaoTongInvoiceCode,
		PiaoTongInvoiceNo:          a.PiaoTongInvoiceNo,
		PiaoTongBlueAllEleInvNo:    a.PiaoTongBlueAllEleInvNo,
		PiaoTongInvoiceStatus:      a.PiaoTongInvoiceStatus,
		PiaoTongAuthId:             a.PiaoTongAuthId,
		IssueAttempts:              a.IssueAttempts,
		QueryAttempts:              a.QueryAttempts,
		LastIssueAttemptAt:         a.LastIssueAttemptAt,
		LastQueryAt:                a.LastQueryAt,
		NextQueryAt:                a.NextQueryAt,
		IssueErrorCode:             a.IssueErrorCode,
		IssueErrorMessage:          a.IssueErrorMessage,
		FileFetchStatus:            a.FileFetchStatus,
		FileFetchedAt:              a.FileFetchedAt,
		RedStatus:                  a.RedStatus,
		RedReason:                  a.RedReason,
		RedErrorMessage:            a.RedErrorMessage,
		RedAt:                      a.RedAt,
		CreatedAt:                  a.CreatedAt,
		UpdatedAt:                  a.UpdatedAt,
		ApprovedAt:                 a.ApprovedAt,
		IssuedAt:                   a.IssuedAt,
		CancelledAt:                a.CancelledAt,
		Username:                   username,
	}
}

func buildDetailResponse(app *model.InvoiceApplication, items []model.InvoiceItem, files []model.InvoiceFile, username string) dto.InvoiceApplicationDetailResponse {
	dtoItems := make([]dto.InvoiceApplicationDetailItem, 0, len(items))
	for _, it := range items {
		dtoItems = append(dtoItems, dto.InvoiceApplicationDetailItem{
			Id:            it.Id,
			SourceType:    it.SourceType,
			SourceId:      it.SourceId,
			TradeNo:       it.TradeNo,
			Money:         it.Money,
			Currency:      it.Currency,
			PaymentMethod: it.PaymentMethod,
			CompleteTime:  it.CompleteTime,
			// 支付宝乐企联用支付信息
			PaymentCode:       it.PaymentCode,
			TradeNoThirdParty: it.TradeNoThirdParty,
			SubMchid:          it.SubMchid,
			Account:           it.Account,
		})
	}
	dtoFiles := make([]dto.InvoiceApplicationDetailFile, 0, len(files))
	for _, f := range files {
		dtoFiles = append(dtoFiles, dto.InvoiceApplicationDetailFile{
			Id:               f.Id,
			OriginalFilename: f.OriginalFilename,
			ContentType:      f.ContentType,
			SizeBytes:        f.SizeBytes,
			FileKind:         f.FileKind,
			Source:           f.Source,
			IsRed:            f.IsRed,
			IsUserVisible:    f.IsUserVisible,
			CreatedAt:        f.CreatedAt,
		})
	}
	return dto.InvoiceApplicationDetailResponse{
		Application: toApplicationListItem(*app, username),
		Items:       dtoItems,
		Files:       dtoFiles,
	}
}

// InvoiceSelfListApplications handles GET /api/invoice/self/applications (UserAuth)
func InvoiceSelfListApplications(c *gin.Context) {
	userId := c.GetInt("id")
	pageInfo := common.GetPageQuery(c)
	status := strings.TrimSpace(c.Query("status"))
	keyword := strings.TrimSpace(c.Query("keyword"))

	apps, total, err := service.ListInvoiceApplicationsForUser(c.Request.Context(), middleware.GetTenantId(c), userId, status, keyword, pageInfo)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	items := make([]dto.InvoiceApplicationListItem, 0, len(apps))
	for _, a := range apps {
		items = append(items, toApplicationListItem(a, ""))
	}

	common.ApiSuccess(c, gin.H{
		"items":     items,
		"total":     total,
		"page":      pageInfo.GetPage(),
		"page_size": pageInfo.GetPageSize(),
	})
}

// InvoiceSelfGetApplicationDetail handles GET /api/invoice/self/applications/:id (UserAuth)
func InvoiceSelfGetApplicationDetail(c *gin.Context) {
	userId := c.GetInt("id")

	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}

	app, appItems, appFiles, err := service.GetInvoiceApplicationDetailForUser(c.Request.Context(), middleware.GetTenantId(c), userId, id)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	common.ApiSuccess(c, buildDetailResponse(app, appItems, appFiles, ""))
}

// InvoiceSelfPresignFile handles GET /api/invoice/self/files/:file_id/presign (UserAuth)
func InvoiceSelfPresignFile(c *gin.Context) {
	userId := c.GetInt("id")

	fileId, err := strconv.Atoi(c.Param("file_id"))
	if err != nil || fileId <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}

	disposition := strings.TrimSpace(c.Query("disposition"))
	if disposition == "" {
		disposition = "inline"
	}

	url, expiresAt, err := service.PresignInvoiceFileForUser(c.Request.Context(), middleware.GetTenantId(c), userId, fileId, disposition)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	common.ApiSuccess(c, dto.InvoicePresignFileResponse{
		URL:              url,
		ExpiresAtUnixSec: expiresAt,
	})
}
