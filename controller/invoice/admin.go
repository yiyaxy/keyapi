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

// InvoiceAdminListApplications handles GET /api/invoice/admin/applications (AdminAuth)
func InvoiceAdminListApplications(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	status := strings.TrimSpace(c.Query("status"))
	keyword := strings.TrimSpace(c.Query("keyword"))
	userIdStr := strings.TrimSpace(c.Query("user_id"))
	userId := 0
	if userIdStr != "" {
		if v, err := strconv.Atoi(userIdStr); err == nil && v > 0 {
			userId = v
		}
	}

	tenantId := middleware.GetTenantId(c)
	apps, total, err := service.ListInvoiceApplicationsForAdmin(c.Request.Context(), tenantId, status, userId, keyword, pageInfo)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	// Batch load usernames
	userIds := make([]int, 0, len(apps))
	for _, a := range apps {
		userIds = append(userIds, a.UserId)
	}
	usernameMap := service.BatchLoadUsernamesForInvoice(tenantId, userIds)

	items := make([]dto.InvoiceApplicationListItem, 0, len(apps))
	for _, a := range apps {
		items = append(items, toApplicationListItem(a, usernameMap[a.UserId]))
	}

	common.ApiSuccess(c, gin.H{
		"items":     items,
		"total":     total,
		"page":      pageInfo.GetPage(),
		"page_size": pageInfo.GetPageSize(),
	})
}

// InvoiceAdminGetApplicationDetail handles GET /api/invoice/admin/applications/:id (AdminAuth)
func InvoiceAdminGetApplicationDetail(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}

	app, appItems, appFiles, err := service.GetInvoiceApplicationDetailForAdmin(c.Request.Context(), middleware.GetTenantId(c), id)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	// Resolve username for admin detail view
	username, _ := model.GetUsernameById(app.UserId, false)
	common.ApiSuccess(c, buildDetailResponse(app, appItems, appFiles, username))
}

// InvoiceAdminUpdateApplicationStatus handles POST /api/invoice/admin/applications/:id/status (AdminAuth)
func InvoiceAdminUpdateApplicationStatus(c *gin.Context) {
	adminId := c.GetInt("id")

	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}

	var req dto.InvoiceAdminUpdateStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.Status) == "" {
		common.ApiErrorMsg(c, "参数错误")
		return
	}

	app, err := service.AdminUpdateInvoiceApplicationStatus(
		c.Request.Context(),
		middleware.GetTenantId(c),
		adminId,
		id,
		strings.TrimSpace(req.Status),
		strings.TrimSpace(req.AdminRemark),
		strings.TrimSpace(req.RejectReason),
		strings.TrimSpace(req.GoodsName),
		strings.TrimSpace(req.TaxClassificationCode),
		strings.TrimSpace(req.TaxRateValue),
	)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	common.ApiSuccess(c, app)
}

// InvoiceAdminPresignUpload handles POST /api/invoice/admin/uploads/presign (AdminAuth)
func InvoiceAdminPresignUpload(c *gin.Context) {
	adminId := c.GetInt("id")

	var req dto.InvoiceAdminPresignUploadRequest
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.Filename) == "" || strings.TrimSpace(req.ContentType) == "" || req.InvoiceId <= 0 || req.SizeBytes <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}

	out, err := service.AdminPresignInvoiceUpload(c.Request.Context(), middleware.GetTenantId(c), service.AdminPresignInvoiceUploadParams{
		AdminId:     adminId,
		InvoiceId:   req.InvoiceId,
		Filename:    strings.TrimSpace(req.Filename),
		ContentType: strings.TrimSpace(req.ContentType),
		SizeBytes:   req.SizeBytes,
	})
	if err != nil {
		common.ApiError(c, err)
		return
	}

	common.ApiSuccess(c, out)
}

// InvoiceAdminFinalizeInvoiceFiles handles POST /api/invoice/admin/applications/:id/files (AdminAuth)
func InvoiceAdminFinalizeInvoiceFiles(c *gin.Context) {
	adminId := c.GetInt("id")

	invoiceId, err := strconv.Atoi(c.Param("id"))
	if err != nil || invoiceId <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}

	var req dto.InvoiceAdminFinalizeFilesRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}

	files, err := service.AdminFinalizeInvoiceFiles(c.Request.Context(), middleware.GetTenantId(c), service.AdminFinalizeInvoiceFilesParams{
		AdminId:    adminId,
		InvoiceId:  invoiceId,
		ObjectKeys: req.ObjectKeys,
	})
	if err != nil {
		common.ApiError(c, err)
		return
	}

	common.ApiSuccess(c, gin.H{
		"files": files,
	})
}

// InvoiceAdminUpdateFileVisibility handles POST /api/invoice/admin/applications/:id/files/:file_id/visibility (AdminAuth)
func InvoiceAdminUpdateFileVisibility(c *gin.Context) {
	adminId := c.GetInt("id")

	invoiceId, err := strconv.Atoi(c.Param("id"))
	if err != nil || invoiceId <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	fileId, err := strconv.Atoi(c.Param("file_id"))
	if err != nil || fileId <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}

	var req dto.InvoiceAdminUpdateFileVisibilityRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}

	file, err := service.AdminUpdateInvoiceFileVisibility(c.Request.Context(), middleware.GetTenantId(c), service.AdminUpdateInvoiceFileVisibilityParams{
		AdminId:       adminId,
		InvoiceId:     invoiceId,
		FileId:        fileId,
		IsUserVisible: req.IsUserVisible,
	})
	if err != nil {
		common.ApiError(c, err)
		return
	}

	common.ApiSuccess(c, file)
}

// InvoiceAdminPresignFile handles GET /api/invoice/admin/files/:file_id/presign (AdminAuth)
func InvoiceAdminPresignFile(c *gin.Context) {
	fileId, err := strconv.Atoi(c.Param("file_id"))
	if err != nil || fileId <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}

	disposition := strings.TrimSpace(c.Query("disposition"))
	if disposition == "" {
		disposition = "inline"
	}

	url, expiresAt, err := service.PresignInvoiceFileForAdmin(c.Request.Context(), middleware.GetTenantId(c), fileId, disposition)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	common.ApiSuccess(c, dto.InvoicePresignFileResponse{
		URL:              url,
		ExpiresAtUnixSec: expiresAt,
	})
}

// InvoiceAdminIssue handles POST /api/invoice/admin/applications/:id/issue (AdminAuth)
func InvoiceAdminIssue(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}

	err = service.IssueInvoiceByPiaoTong(c.Request.Context(), id)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	common.ApiSuccess(c, gin.H{"message": "开票请求已发起"})
}

// InvoiceAdminQuery handles POST /api/invoice/admin/applications/:id/query (AdminAuth)
func InvoiceAdminQuery(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}

	app, err := service.QueryInvoiceStatus(c.Request.Context(), id)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	common.ApiSuccess(c, app)
}

// InvoiceAdminSwitchManual handles POST /api/invoice/admin/applications/:id/switch_manual (AdminAuth)
func InvoiceAdminSwitchManual(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}

	app, err := service.SwitchInvoiceToManual(c.Request.Context(), id)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	common.ApiSuccess(c, app)
}

// InvoiceAdminRedInvoice handles POST /api/invoice/admin/applications/:id/red (AdminAuth)
func InvoiceAdminRedInvoice(c *gin.Context) {
	appId, err := strconv.Atoi(c.Param("id"))
	if err != nil || appId <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}

	var req dto.InvoiceRedRequest
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.RedReason) == "" {
		common.ApiErrorMsg(c, "冲红原因不能为空")
		return
	}

	if err := service.RedInvoiceApplication(c.Request.Context(), appId, req.RedReason); err != nil {
		common.ApiError(c, err)
		return
	}

	common.ApiSuccess(c, gin.H{"message": "冲红成功"})
}

// InvoiceAdminSetItemPaymentInfo handles POST /api/invoice/admin/applications/:id/items/:item_id/payment_info (AdminAuth)
func InvoiceAdminSetItemPaymentInfo(c *gin.Context) {
	_, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	itemId, err := strconv.Atoi(c.Param("item_id"))
	if err != nil || itemId <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	var req dto.InvoiceAdminSetItemPaymentInfoRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	if err := service.SetInvoiceItemPaymentInfo(middleware.GetTenantId(c), itemId, req); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}
