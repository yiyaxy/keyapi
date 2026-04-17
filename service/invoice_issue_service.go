package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service/invoice_provider"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// TryAutoIssueInvoice is called asynchronously after admin approves an invoice application.
// It checks if auto-issue is enabled and triggers PiaoTong blue invoice issuance.
func TryAutoIssueInvoice(appId int) {
	if common.InvoiceProvider != common.InvoiceProviderPiaoTong {
		return
	}
	if !common.InvoiceAutoIssueEnabled {
		return
	}
	go func() {
		if err := IssueInvoiceByPiaoTong(context.Background(), appId); err != nil {
			common.SysError(fmt.Sprintf("auto issue invoice failed for app %d: %v", appId, err))
		}
	}()
}

// IssueInvoiceByPiaoTong issues a blue invoice via PiaoTong for the given application.
func IssueInvoiceByPiaoTong(ctx context.Context, appId int) error {
	_ = ctx

	var app model.InvoiceApplication
	var items []model.InvoiceItem

	if err := model.DB.Transaction(func(tx *gorm.DB) error {
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", appId).First(&app).Error
		if err != nil {
			return fmt.Errorf("app not found: %w", err)
		}
		if app.Status != model.InvoiceStatusApproved {
			if !(app.Status == model.InvoiceStatusIssued && strings.TrimSpace(app.RedStatus) == "red_success") {
				return fmt.Errorf("app status is %s, expected approved or issued+red_success", app.Status)
			}
		}
		if app.IssueStatus != model.InvoiceIssueStatusNone &&
			app.IssueStatus != model.InvoiceIssueStatusIssueFailed &&
			app.IssueStatus != model.InvoiceIssueStatusPendingIssue {
			if !(app.Status == model.InvoiceStatusIssued && strings.TrimSpace(app.RedStatus) == "red_success") {
				return fmt.Errorf("app issue_status is %s, cannot issue", app.IssueStatus)
			}
		}

		// Load items
		if err := tx.Where("invoice_id = ?", appId).Find(&items).Error; err != nil {
			return fmt.Errorf("load items failed: %w", err)
		}
		if len(items) == 0 {
			return fmt.Errorf("no invoice items")
		}

		// Mark as issuing
		now := common.GetTimestamp()
		app.IssueStatus = model.InvoiceIssueStatusIssuing
		app.Provider = common.InvoiceProviderPiaoTong
		app.IssueMode = getIssueMode()
		app.IssueAttempts++
		app.LastIssueAttemptAt = now
		app.IssueErrorCode = ""
		app.IssueErrorMessage = ""
		return tx.Save(&app).Error
	}); err != nil {
		return err
	}

	// Read config
	common.OptionMapRWMutex.RLock()
	sellerTaxpayerNum := strings.TrimSpace(common.OptionMap["InvoiceSellerTaxpayerNum"])
	issueKindCode := strings.TrimSpace(common.OptionMap["InvoiceDefaultIssueKindCode"])
	defaultTaxCode := strings.TrimSpace(common.OptionMap["InvoiceDefaultTaxClassificationCode"])
	defaultGoodsName := strings.TrimSpace(common.OptionMap["InvoiceDefaultGoodsName"])
	defaultTaxRate := strings.TrimSpace(common.OptionMap["InvoiceDefaultTaxRateValue"])
	queryInterval := strings.TrimSpace(common.OptionMap["InvoiceQueryRetryIntervalSeconds"])
	common.OptionMapRWMutex.RUnlock()

	if issueKindCode == "" {
		issueKindCode = "82"
	}
	if defaultGoodsName == "" {
		defaultGoodsName = "技术服务费"
	}
	if defaultTaxRate == "" {
		defaultTaxRate = "0.01"
	}

	// Build invoice items (use per-application category if set, else defaults)
	invoiceReq, validationErr := buildValidatedPiaoTongInvoiceRequest(app, items, sellerTaxpayerNum, issueKindCode, defaultGoodsName, defaultTaxCode, defaultTaxRate)
	if validationErr != nil {
		now := common.GetTimestamp()
		_ = model.DB.Model(&model.InvoiceApplication{}).Where("id = ?", appId).Updates(map[string]interface{}{
			"issue_status":           model.InvoiceIssueStatusIssueFailed,
			"issue_error_code":       "",
			"issue_error_message":    validationErr.Error(),
			"last_issue_attempt_at":  now,
			"next_query_at":          0,
			"issue_payload_snapshot": "",
		}).Error
		return validationErr
	}

	invoiceReqSerialNo := invoiceReq.InvoiceReqSerialNo
	issueKindCode = invoiceReq.InvoiceIssueKindCode
	buyerTaxpayerNum := invoiceReq.BuyerTaxpayerNum
	ptItems := invoiceReq.ItemList
	payloadSnapshot := marshalPiaoTongPayloadSnapshot(invoiceReq)

	// Call PiaoTong
	resp, err := invoice_provider.IssueBlueInvoice(
		invoiceReq.TaxpayerNum,
		invoiceReqSerialNo,
		invoiceReq.BuyerName,
		buyerTaxpayerNum,
		invoiceReq.Remark,
		issueKindCode,
		ptItems,
		invoiceReq.InvIssueChannel,
		invoiceReq.PaymentList,
	)

	now := common.GetTimestamp()
	intervalSec, _ := strconv.Atoi(queryInterval)
	if intervalSec <= 0 {
		intervalSec = 60
	}

	return model.DB.Transaction(func(tx *gorm.DB) error {
		var latest model.InvoiceApplication
		if err2 := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", appId).First(&latest).Error; err2 != nil {
			return err2
		}

		latest.PiaoTongInvoiceReqSerialNo = invoiceReqSerialNo
		latest.IssueKindCode = issueKindCode
		latest.IssuePayloadSnapshot = payloadSnapshot

		if err != nil {
			latest.IssueStatus = model.InvoiceIssueStatusIssueFailed
			latest.IssueErrorMessage = err.Error()
			return tx.Save(&latest).Error
		}

		if resp != nil {
			latest.PiaoTongSerialNo = resp.SerialNo
			latest.IssueResultSnapshot = resp.RawContent
		}

		if resp != nil && resp.Code == "0000" {
			// Success - schedule query
			latest.IssueStatus = model.InvoiceIssueStatusQuerying
			latest.NextQueryAt = now + int64(intervalSec)
			latest.IssueErrorCode = ""
			latest.IssueErrorMessage = ""
		} else {
			latest.IssueStatus = model.InvoiceIssueStatusIssueFailed
			if resp != nil {
				latest.IssueErrorCode = resp.Code
				latest.IssueErrorMessage = resp.Msg
			} else {
				latest.IssueErrorMessage = "no response"
			}
		}

		return tx.Save(&latest).Error
	})
}

// SwitchInvoiceToManual resets the issue status so admin can handle manually.
func SwitchInvoiceToManual(ctx context.Context, appId int) (*model.InvoiceApplication, error) {
	_ = ctx
	var out *model.InvoiceApplication
	if err := model.DB.Transaction(func(tx *gorm.DB) error {
		var app model.InvoiceApplication
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", appId).First(&app).Error; err != nil {
			return err
		}
		if app.Status != model.InvoiceStatusApproved {
			return fmt.Errorf("can only switch to manual when status is approved")
		}
		app.Provider = common.InvoiceProviderManual
		app.IssueMode = common.InvoiceIssueModeManual
		app.IssueStatus = model.InvoiceIssueStatusNone
		app.NextQueryAt = 0
		if err := tx.Save(&app).Error; err != nil {
			return err
		}
		out = &app
		return nil
	}); err != nil {
		return nil, err
	}
	return out, nil
}

// QueryInvoiceStatus queries PiaoTong for the invoice status and updates the application.
func QueryInvoiceStatus(ctx context.Context, appId int) (*model.InvoiceApplication, error) {
	_ = ctx

	var app model.InvoiceApplication
	if err := model.DB.Where("id = ?", appId).First(&app).Error; err != nil {
		return nil, err
	}

	if app.PiaoTongInvoiceReqSerialNo == "" {
		return nil, fmt.Errorf("no piaotong invoice req serial no")
	}

	common.OptionMapRWMutex.RLock()
	sellerTaxpayerNum := strings.TrimSpace(common.OptionMap["InvoiceSellerTaxpayerNum"])
	queryInterval := strings.TrimSpace(common.OptionMap["InvoiceQueryRetryIntervalSeconds"])
	maxAttempts := strings.TrimSpace(common.OptionMap["InvoiceQueryMaxAttempts"])
	common.OptionMapRWMutex.RUnlock()

	resp, err := invoice_provider.QueryInvoiceMain(sellerTaxpayerNum, app.PiaoTongInvoiceReqSerialNo)

	now := common.GetTimestamp()
	intervalSec, _ := strconv.Atoi(queryInterval)
	if intervalSec <= 0 {
		intervalSec = 60
	}
	maxAtt, _ := strconv.Atoi(maxAttempts)
	if maxAtt <= 0 {
		maxAtt = 60
	}

	var out *model.InvoiceApplication
	shouldFetchFiles := false
	if err2 := model.DB.Transaction(func(tx *gorm.DB) error {
		var latest model.InvoiceApplication
		if err3 := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", appId).First(&latest).Error; err3 != nil {
			return err3
		}

		latest.QueryAttempts++
		latest.LastQueryAt = now

		if err != nil {
			latest.IssueErrorMessage = err.Error()
			if latest.QueryAttempts >= maxAtt {
				latest.IssueStatus = model.InvoiceIssueStatusIssueFailed
				latest.NextQueryAt = 0
			} else {
				latest.NextQueryAt = now + int64(intervalSec)
			}
			out = &latest
			return tx.Save(&latest).Error
		}

		if resp != nil {
			latest.IssueResultSnapshot = resp.RawContent
			latest.PiaoTongSerialNo = resp.SerialNo
		}

		if resp != nil && resp.Code == "0000" {
			// Parse content for invoice details
			if content := resp.Content; content != nil {
				if v, ok := content["invoiceCode"]; ok {
					latest.PiaoTongInvoiceCode = fmt.Sprintf("%v", v)
				}
				if v, ok := content["invoiceNo"]; ok {
					latest.PiaoTongInvoiceNo = fmt.Sprintf("%v", v)
				}
				if v, ok := content["allEleInvNo"]; ok {
					latest.PiaoTongBlueAllEleInvNo = fmt.Sprintf("%v", v)
				}
				if v, ok := content["invoiceStatus"]; ok {
					latest.PiaoTongInvoiceStatus = fmt.Sprintf("%v", v)
				}
				if v, ok := content["authId"]; ok {
					latest.PiaoTongAuthId = fmt.Sprintf("%v", v)
				}
			}

			// PiaoTong queryInvoice.pt (2.11): code=0000 means "开票成功".
			// The invoiceStatus field may not be present in the 2.11 response,
			// so we treat code=0000 as success regardless of invoiceStatus.
			// If invoiceStatus IS present, also check it for extra safety.
			invoiceStatusOK := latest.PiaoTongInvoiceStatus == "" || isPiaoTongInvoiceIssuedSuccess(latest.PiaoTongInvoiceStatus)
			if invoiceStatusOK {
				latest.IssueStatus = model.InvoiceIssueStatusIssueSuccess
				latest.NextQueryAt = 0
				latest.IssueErrorCode = ""
				latest.IssueErrorMessage = ""
				// Auto-transition to issued
				latest.Status = model.InvoiceStatusIssued
				latest.IssuedAt = now
				shouldFetchFiles = true
			} else {
				// Still processing
				if latest.QueryAttempts >= maxAtt {
					latest.IssueStatus = model.InvoiceIssueStatusIssueFailed
					latest.NextQueryAt = 0
				} else {
					latest.NextQueryAt = now + int64(intervalSec)
				}
			}
		} else {
			if resp != nil {
				latest.IssueErrorCode = resp.Code
				latest.IssueErrorMessage = resp.Msg
			}
			if latest.QueryAttempts >= maxAtt {
				latest.IssueStatus = model.InvoiceIssueStatusIssueFailed
				latest.NextQueryAt = 0
			} else {
				latest.NextQueryAt = now + int64(intervalSec)
			}
		}

		out = &latest
		return tx.Save(&latest).Error
	}); err2 != nil {
		return nil, err2
	}
	if shouldFetchFiles {
		if err := fetchAndStorePiaoTongInvoiceFiles(ctx, appId); err != nil {
			common.SysError(fmt.Sprintf("fetch piaotong invoice files failed for app %d: %v", appId, err))
		}
		var refreshed model.InvoiceApplication
		if err := model.DB.Where("id = ?", appId).First(&refreshed).Error; err == nil {
			out = &refreshed
		}
	}
	return out, nil
}

func fetchAndStorePiaoTongInvoiceFiles(ctx context.Context, appId int) error {
	if ctx == nil {
		ctx = context.Background()
	}

	var app model.InvoiceApplication
	if err := model.DB.Where("id = ?", appId).First(&app).Error; err != nil {
		return err
	}
	if strings.TrimSpace(app.PiaoTongInvoiceReqSerialNo) == "" {
		return fmt.Errorf("missing piaotong invoice req serial no")
	}

	now := common.GetTimestamp()
	if existing, err := countExistingPiaoTongInvoiceFiles(appId); err == nil && existing > 0 {
		updates := map[string]interface{}{
			"file_fetch_status": "ready",
			"file_fetched_at":   now,
		}
		if app.IssueStatus == model.InvoiceIssueStatusIssueSuccess {
			updates["issue_status"] = model.InvoiceIssueStatusFileReady
		}
		return model.DB.Model(&model.InvoiceApplication{}).Where("id = ?", appId).Updates(updates).Error
	}

	common.OptionMapRWMutex.RLock()
	sellerTaxpayerNum := strings.TrimSpace(common.OptionMap["InvoiceSellerTaxpayerNum"])
	common.OptionMapRWMutex.RUnlock()

	// Primary: use API 2.15 (getInvoiceFile.pt / getAllEleInvFile.pt) for PDF retrieval.
	// This is the dedicated file download endpoint and returns clean base64 fileContent.
	files, fetchErr := fetchPiaoTongInvoiceFilesVia215(sellerTaxpayerNum, app.PiaoTongInvoiceReqSerialNo)

	// Fallback: if 2.15 fails, try QueryInvoiceFull (2.12 queryInvoiceInfo.pt) which
	// includes invoicePdf/invoiceXml/downloadUrl in its response content.
	if fetchErr != nil || len(files) == 0 {
		common.SysLog(fmt.Sprintf("invoice file fetch via 2.15 failed for app %d (err=%v, files=%d), trying 2.12 fallback",
			appId, fetchErr, len(files)))
		var fallbackErr error
		files, fallbackErr = fetchPiaoTongInvoiceFilesVia212(ctx, sellerTaxpayerNum, app.PiaoTongInvoiceReqSerialNo)
		if fallbackErr != nil {
			markInvoiceFileFetchFailed(appId, fallbackErr.Error())
			return fallbackErr
		}
	}

	if len(files) == 0 {
		err := fmt.Errorf("no invoice files found from piaotong")
		markInvoiceFileFetchFailed(appId, err.Error())
		return err
	}

	storage, err := defaultInvoiceStorage()
	if err != nil {
		markInvoiceFileFetchFailed(appId, err.Error())
		return err
	}

	createdAt := common.GetTimestamp()
	storedFiles := make([]model.InvoiceFile, 0, len(files))
	for _, file := range files {
		objectKey := buildPiaoTongInvoiceObjectKey(appId, app.PiaoTongInvoiceReqSerialNo, file.FileKind, file.OriginalFilename)
		if err := storage.UploadObject(ctx, objectKey, file.ContentType, file.Data); err != nil {
			markInvoiceFileFetchFailed(appId, fmt.Sprintf("upload %s failed: %v", file.OriginalFilename, err))
			return err
		}
		storedFiles = append(storedFiles, model.InvoiceFile{
			InvoiceId:        appId,
			UploaderId:       0,
			ObjectKey:        objectKey,
			FileKind:         file.FileKind,
			Source:           common.InvoiceProviderPiaoTong,
			IsRed:            false,
			IsUserVisible:    true,
			OriginalFilename: file.OriginalFilename,
			ContentType:      file.ContentType,
			SizeBytes:        int64(len(file.Data)),
			CreatedAt:        createdAt,
		})
	}

	updates := map[string]interface{}{
		"file_fetch_status": "ready",
		"file_fetched_at":   now,
	}
	if app.IssueStatus == model.InvoiceIssueStatusIssueSuccess {
		updates["issue_status"] = model.InvoiceIssueStatusFileReady
	}
	if err := model.DB.Transaction(func(tx *gorm.DB) error {
		for _, file := range storedFiles {
			if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&file).Error; err != nil {
				return err
			}
		}
		return tx.Model(&model.InvoiceApplication{}).Where("id = ?", appId).Updates(updates).Error
	}); err != nil {
		markInvoiceFileFetchFailed(appId, err.Error())
		return err
	}
	return nil
}

// fetchPiaoTongInvoiceFilesVia215 uses PiaoTong API 2.15 (getAllEleInvFile.pt) to fetch
// invoice files. This is the dedicated file download endpoint that returns clean base64
// fileContent for each requested file type.
func fetchPiaoTongInvoiceFilesVia215(sellerTaxpayerNum, invoiceReqSerialNo string) ([]piaotongFetchedInvoiceFile, error) {
	files := make([]piaotongFetchedInvoiceFile, 0, 3)

	for _, fileType := range []string{"PDF", "OFD", "XML"} {
		resp, err := invoice_provider.GetInvoiceFile(sellerTaxpayerNum, invoiceReqSerialNo, fileType)
		if err != nil {
			// PDF is required; OFD/XML are optional
			if fileType == "PDF" {
				return nil, fmt.Errorf("getInvoiceFile(PDF) failed: %w", err)
			}
			continue
		}
		if resp == nil || strings.TrimSpace(resp.Code) != "0000" {
			if fileType == "PDF" {
				msg := "unknown error"
				if resp != nil {
					msg = fmt.Sprintf("code=%s msg=%s", resp.Code, resp.Msg)
				}
				return nil, fmt.Errorf("getInvoiceFile(PDF) failed: %s", msg)
			}
			continue
		}

		// API 2.15 response content has: fileType, resultCode, resultMsg, fileContent (base64)
		content := resp.Content
		if content == nil {
			if fileType == "PDF" {
				return nil, fmt.Errorf("getInvoiceFile(PDF): empty content")
			}
			continue
		}

		fileContent := strings.TrimSpace(stringMapValue(content, "fileContent"))
		if fileContent == "" {
			if fileType == "PDF" {
				return nil, fmt.Errorf("getInvoiceFile(PDF): empty fileContent")
			}
			continue
		}

		data, err := base64.StdEncoding.DecodeString(fileContent)
		if err != nil {
			data, err = base64.RawStdEncoding.DecodeString(fileContent)
		}
		if err != nil {
			if fileType == "PDF" {
				return nil, fmt.Errorf("getInvoiceFile(PDF): decode base64 failed: %w", err)
			}
			continue
		}
		if len(data) == 0 {
			continue
		}

		kind := normalizePiaoTongInvoiceFileKind(fileType)
		files = append(files, piaotongFetchedInvoiceFile{
			FileKind:         kind,
			OriginalFilename: "invoice." + kind,
			ContentType:      defaultContentTypeForPiaoTongFileKind(kind),
			Data:             data,
		})
	}

	return files, nil
}

// fetchPiaoTongInvoiceFilesVia212 uses PiaoTong API 2.12 (queryInvoiceInfo.pt) as a fallback
// to extract invoice files from the response content fields: invoicePdf, invoiceXml, downloadUrl.
// All these fields are base64-encoded strings (NOT URLs despite the name "downloadUrl").
func fetchPiaoTongInvoiceFilesVia212(ctx context.Context, sellerTaxpayerNum, invoiceReqSerialNo string) ([]piaotongFetchedInvoiceFile, error) {
	resp, err := invoice_provider.QueryInvoiceFull(sellerTaxpayerNum, invoiceReqSerialNo)
	if err != nil {
		return nil, err
	}
	if resp == nil {
		return nil, fmt.Errorf("empty piaotong response")
	}
	if strings.TrimSpace(resp.Code) != "0000" {
		return nil, fmt.Errorf("piaotong queryInvoiceFull code=%s msg=%s", strings.TrimSpace(resp.Code), strings.TrimSpace(resp.Msg))
	}

	files, err := extractPiaoTongInvoiceFiles(ctx, resp.Content)
	if err != nil {
		return nil, err
	}
	return files, nil
}

type piaotongFetchedInvoiceFile struct {
	FileKind         string
	OriginalFilename string
	ContentType      string
	Data             []byte
}

func extractPiaoTongInvoiceFiles(ctx context.Context, content map[string]interface{}) ([]piaotongFetchedInvoiceFile, error) {
	if len(content) == 0 {
		return nil, fmt.Errorf("empty piaotong content")
	}

	files := make([]piaotongFetchedInvoiceFile, 0, 4)
	seen := make(map[string]struct{})
	addFile := func(file piaotongFetchedInvoiceFile) {
		if len(file.Data) == 0 {
			return
		}
		key := strings.ToLower(strings.TrimSpace(file.FileKind)) + "|" + strings.TrimSpace(file.OriginalFilename)
		if _, ok := seen[key]; ok {
			return
		}
		seen[key] = struct{}{}
		files = append(files, file)
	}

	// Priority 1: PiaoTong queryInvoiceInfo.pt (2.12) specific field names.
	// These are always base64-encoded file content strings (NOT URLs).
	for _, mapping := range []struct {
		key  string
		kind string
	}{
		{"invoicePdf", "pdf"},
		{"invoiceXml", "xml"},
	} {
		payload := strings.TrimSpace(stringMapValue(content, mapping.key))
		if payload == "" {
			continue
		}
		data, err := base64.StdEncoding.DecodeString(payload)
		if err != nil {
			data, err = base64.RawStdEncoding.DecodeString(payload)
		}
		if err != nil || len(data) == 0 {
			continue
		}
		addFile(piaotongFetchedInvoiceFile{
			FileKind:         mapping.kind,
			OriginalFilename: "invoice." + mapping.kind,
			ContentType:      defaultContentTypeForPiaoTongFileKind(mapping.kind),
			Data:             data,
		})
	}

	// Priority 2: downloadUrl field — this is a Base64-encoded URL string.
	// Decode base64 to get the actual download URL, then HTTP GET to fetch the PDF.
	if dlPayload := strings.TrimSpace(stringMapValue(content, "downloadUrl")); dlPayload != "" {
		// Only try if we don't already have a PDF from invoicePdf
		if _, hasPdf := seen["pdf|invoice.pdf"]; !hasPdf {
			urlBytes, err := base64.StdEncoding.DecodeString(dlPayload)
			if err != nil {
				urlBytes, err = base64.RawStdEncoding.DecodeString(dlPayload)
			}
			if err == nil && len(urlBytes) > 0 {
				dlURL := strings.TrimSpace(string(urlBytes))
				if strings.HasPrefix(strings.ToLower(dlURL), "http://") || strings.HasPrefix(strings.ToLower(dlURL), "https://") {
					// It's a URL — download the file
					data, dlErr := downloadPiaoTongInvoiceFile(ctx, dlURL)
					if dlErr == nil && len(data) > 0 {
						addFile(piaotongFetchedInvoiceFile{
							FileKind:         "pdf",
							OriginalFilename: "invoice.pdf",
							ContentType:      "application/pdf",
							Data:             data,
						})
					}
				} else {
					// Not a URL — treat as raw file content (unlikely but safe fallback)
					addFile(piaotongFetchedInvoiceFile{
						FileKind:         "pdf",
						OriginalFilename: "invoice.pdf",
						ContentType:      "application/pdf",
						Data:             urlBytes,
					})
				}
			}
		}
	}

	// Priority 3: fileList / files arrays (for other response formats)
	if rawList, ok := content["fileList"]; ok {
		for _, file := range extractPiaoTongInvoiceFilesFromList(ctx, rawList) {
			addFile(file)
		}
	}
	if rawList, ok := content["files"]; ok {
		for _, file := range extractPiaoTongInvoiceFilesFromList(ctx, rawList) {
			addFile(file)
		}
	}

	// Priority 4: generic keys (pdf, ofd, xml) for other response formats
	for _, kind := range []string{"pdf", "ofd", "xml"} {
		if raw, ok := content[kind]; ok {
			file, err := buildPiaoTongInvoiceFileFromValue(ctx, kind, raw, content)
			if err == nil {
				addFile(file)
			}
		}
	}

	// Priority 5: generic fallback — try to extract from the entire content map
	if len(files) == 0 {
		if file, err := buildPiaoTongInvoiceFileFromValue(ctx, "", content, content); err == nil {
			addFile(file)
		}
	}

	if len(files) == 0 {
		return nil, fmt.Errorf("unsupported piaotong file payload")
	}
	return files, nil
}

func extractPiaoTongInvoiceFilesFromList(ctx context.Context, raw interface{}) []piaotongFetchedInvoiceFile {
	list, ok := raw.([]interface{})
	if !ok {
		return nil
	}
	files := make([]piaotongFetchedInvoiceFile, 0, len(list))
	for _, item := range list {
		m, ok := item.(map[string]interface{})
		if !ok {
			continue
		}
		file, err := buildPiaoTongInvoiceFileFromValue(ctx, "", m, m)
		if err != nil {
			continue
		}
		files = append(files, file)
	}
	return files
}

func buildPiaoTongInvoiceFileFromValue(ctx context.Context, defaultKind string, raw interface{}, meta map[string]interface{}) (piaotongFetchedInvoiceFile, error) {
	kind := normalizePiaoTongInvoiceFileKind(firstNonEmptyString(
		stringMapValue(meta, "fileKind"),
		stringMapValue(meta, "fileType"),
		stringMapValue(meta, "suffix"),
		defaultKind,
	))
	filename := strings.TrimSpace(firstNonEmptyString(
		stringMapValue(meta, "fileName"),
		stringMapValue(meta, "filename"),
		stringMapValue(meta, "name"),
	))
	contentType := strings.TrimSpace(firstNonEmptyString(
		stringMapValue(meta, "contentType"),
		stringMapValue(meta, "mimeType"),
		stringMapValue(meta, "mime"),
		defaultContentTypeForPiaoTongFileKind(kind),
	))

	var data []byte
	switch value := raw.(type) {
	case string:
		var err error
		data, err = decodeOrDownloadPiaoTongInvoiceData(ctx, value)
		if err != nil {
			return piaotongFetchedInvoiceFile{}, err
		}
	case map[string]interface{}:
		payload := firstNonEmptyString(
			stringMapValue(value, "fileData"),
			stringMapValue(value, "fileContent"),
			stringMapValue(value, "base64"),
			stringMapValue(value, kind),
		)
		if payload == "" {
			payload = firstNonEmptyString(
				stringMapValue(value, "url"),
				stringMapValue(value, "fileUrl"),
				stringMapValue(value, "downloadUrl"),
			)
		}
		if payload == "" {
			return piaotongFetchedInvoiceFile{}, fmt.Errorf("missing file payload")
		}
		var err error
		data, err = decodeOrDownloadPiaoTongInvoiceData(ctx, payload)
		if err != nil {
			return piaotongFetchedInvoiceFile{}, err
		}
		if filename == "" {
			filename = strings.TrimSpace(firstNonEmptyString(
				stringMapValue(value, "fileName"),
				stringMapValue(value, "filename"),
				stringMapValue(value, "name"),
			))
		}
		if kind == "bin" {
			kind = normalizePiaoTongInvoiceFileKind(firstNonEmptyString(
				stringMapValue(value, "fileKind"),
				stringMapValue(value, "fileType"),
				stringMapValue(value, "suffix"),
				defaultKind,
			))
		}
		if contentType == "" || contentType == "application/octet-stream" {
			contentType = strings.TrimSpace(firstNonEmptyString(
				stringMapValue(value, "contentType"),
				stringMapValue(value, "mimeType"),
				stringMapValue(value, "mime"),
				defaultContentTypeForPiaoTongFileKind(kind),
			))
		}
	default:
		return piaotongFetchedInvoiceFile{}, fmt.Errorf("unsupported file payload type")
	}

	if len(data) == 0 {
		return piaotongFetchedInvoiceFile{}, fmt.Errorf("empty file data")
	}
	if filename == "" {
		filename = "invoice"
		if kind != "bin" {
			filename += "." + kind
		}
	}
	if kind == "bin" {
		kind = normalizePiaoTongInvoiceFileKind(path.Ext(filename))
	}
	if contentType == "" {
		contentType = defaultContentTypeForPiaoTongFileKind(kind)
	}
	return piaotongFetchedInvoiceFile{
		FileKind:         kind,
		OriginalFilename: ensurePiaoTongInvoiceFilename(filename, kind),
		ContentType:      contentType,
		Data:             data,
	}, nil
}

func decodeOrDownloadPiaoTongInvoiceData(ctx context.Context, payload string) ([]byte, error) {
	payload = strings.TrimSpace(payload)
	if payload == "" {
		return nil, fmt.Errorf("empty file payload")
	}
	if strings.HasPrefix(strings.ToLower(payload), "http://") || strings.HasPrefix(strings.ToLower(payload), "https://") {
		return downloadPiaoTongInvoiceFile(ctx, payload)
	}
	if idx := strings.Index(payload, ","); strings.HasPrefix(strings.ToLower(payload), "data:") && idx >= 0 {
		payload = payload[idx+1:]
	}
	data, err := base64.StdEncoding.DecodeString(payload)
	if err != nil {
		data, err = base64.RawStdEncoding.DecodeString(payload)
	}
	if err != nil {
		return nil, fmt.Errorf("decode base64 file: %w", err)
	}
	if len(data) > int(maxInvoiceFileBytes()) {
		return nil, fmt.Errorf("file exceeds max size")
	}
	return data, nil
}

func downloadPiaoTongInvoiceFile(ctx context.Context, rawURL string) ([]byte, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	resp, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("download invoice file status %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxInvoiceFileBytes()+1))
	if err != nil {
		return nil, err
	}
	if int64(len(body)) > maxInvoiceFileBytes() {
		return nil, fmt.Errorf("file exceeds max size")
	}
	return body, nil
}

func countExistingPiaoTongInvoiceFiles(appId int) (int64, error) {
	var count int64
	err := model.DB.Model(&model.InvoiceFile{}).Where("invoice_id = ? AND source = ?", appId, common.InvoiceProviderPiaoTong).Count(&count).Error
	return count, err
}

func markInvoiceFileFetchFailed(appId int, message string) {
	updates := map[string]interface{}{
		"file_fetch_status":   "failed",
		"issue_error_message": strings.TrimSpace(message),
	}
	_ = model.DB.Model(&model.InvoiceApplication{}).Where("id = ?", appId).Updates(updates).Error
}

func buildPiaoTongInvoiceObjectKey(appId int, invoiceReqSerialNo, fileKind, originalFilename string) string {
	ext := strings.ToLower(strings.TrimPrefix(path.Ext(strings.TrimSpace(originalFilename)), "."))
	if ext == "" {
		ext = normalizePiaoTongInvoiceFileKind(fileKind)
	}
	if ext == "" || ext == "bin" {
		return fmt.Sprintf("invoices/%d/piaotong/%s_%s", appId, strings.TrimSpace(invoiceReqSerialNo), normalizePiaoTongInvoiceFileKind(fileKind))
	}
	return fmt.Sprintf("invoices/%d/piaotong/%s_%s.%s", appId, strings.TrimSpace(invoiceReqSerialNo), normalizePiaoTongInvoiceFileKind(fileKind), ext)
}

func normalizePiaoTongInvoiceFileKind(v string) string {
	v = strings.ToLower(strings.TrimSpace(strings.TrimPrefix(v, ".")))
	switch v {
	case "pdf", "ofd", "xml":
		return v
	default:
		return "bin"
	}
}

func ensurePiaoTongInvoiceFilename(filename, kind string) string {
	filename = path.Base(strings.TrimSpace(filename))
	if filename == "." || filename == "/" || filename == "" {
		filename = "invoice"
	}
	if path.Ext(filename) == "" && kind != "bin" {
		filename += "." + kind
	}
	return filename
}

func defaultContentTypeForPiaoTongFileKind(kind string) string {
	switch normalizePiaoTongInvoiceFileKind(kind) {
	case "pdf":
		return "application/pdf"
	case "xml":
		return "application/xml"
	default:
		return "application/octet-stream"
	}
}

func stringMapValue(m map[string]interface{}, key string) string {
	if m == nil {
		return ""
	}
	if v, ok := m[key]; ok {
		return strings.TrimSpace(fmt.Sprintf("%v", v))
	}
	return ""
}

type piaoTongBlueInvoiceRequest struct {
	TaxpayerNum          string                             `json:"taxpayerNum"`
	InvoiceReqSerialNo   string                             `json:"invoiceReqSerialNo"`
	BuyerName            string                             `json:"buyerName"`
	BuyerTaxpayerNum     string                             `json:"buyerTaxpayerNum,omitempty"`
	Remark               string                             `json:"remark,omitempty"`
	InvoiceIssueKindCode string                             `json:"invoiceIssueKindCode"`
	ItemList             []invoice_provider.BlueInvoiceItem `json:"itemList"`
	InvIssueChannel      string                             `json:"invIssueChannel,omitempty"`
	PaymentList          []invoice_provider.PaymentItem     `json:"paymentList,omitempty"`
}

func buildValidatedPiaoTongInvoiceRequest(app model.InvoiceApplication, items []model.InvoiceItem, sellerTaxpayerNum, issueKindCode, defaultGoodsName, defaultTaxCode, defaultTaxRate string) (*piaoTongBlueInvoiceRequest, error) {
	sellerTaxpayerNum = strings.TrimSpace(sellerTaxpayerNum)
	buyerName := strings.TrimSpace(app.Title)
	issueKindCode = strings.TrimSpace(issueKindCode)
	// Prefer per-application issue_kind_code if set (user chose 普票82 or 专票81)
	if strings.TrimSpace(app.IssueKindCode) != "" {
		issueKindCode = strings.TrimSpace(app.IssueKindCode)
	}
	goodsName := firstNonEmptyString(app.GoodsName, defaultGoodsName)
	taxClassificationCode := firstNonEmptyString(app.TaxClassificationCode, defaultTaxCode)
	taxRateValue := firstNonEmptyString(app.TaxRateValue, defaultTaxRate)
	invoiceReqSerialNo := strings.TrimSpace(invoice_provider.GenerateSerialNo())

	switch {
	case sellerTaxpayerNum == "":
		return nil, fmt.Errorf("missing seller taxpayer number")
	case buyerName == "":
		return nil, fmt.Errorf("missing invoice title")
	case app.InvoiceType == model.InvoiceTypeCompany && strings.TrimSpace(app.TaxId) == "":
		return nil, fmt.Errorf("missing company tax id")
	case issueKindCode == "":
		return nil, fmt.Errorf("missing issue kind code")
	case goodsName == "":
		return nil, fmt.Errorf("missing goods name")
	case taxClassificationCode == "":
		return nil, fmt.Errorf("missing tax classification code")
	case taxRateValue == "":
		return nil, fmt.Errorf("missing tax rate value")
	case invoiceReqSerialNo == "" || !isValidPiaoTongInvoiceReqSerialNo(invoiceReqSerialNo):
		return nil, fmt.Errorf("invalid invoice request serial number")
	case len(items) == 0:
		return nil, fmt.Errorf("no invoice items")
	}

	ptItems := make([]invoice_provider.BlueInvoiceItem, 0, len(items))
	for _, it := range items {
		ptItems = append(ptItems, invoice_provider.BlueInvoiceItem{
			TaxClassificationCode: taxClassificationCode,
			Quantity:              "1.00",
			GoodsName:             goodsName,
			UnitPrice:             fmt.Sprintf("%.2f", it.Money),
			InvoiceAmount:         fmt.Sprintf("%.2f", it.Money),
			TaxRateValue:          taxRateValue,
			IncludeTaxFlag:        "1",
		})
	}

	tradeNos := make([]string, 0, len(items))
	for _, it := range items {
		if tradeNo := strings.TrimSpace(it.TradeNo); tradeNo != "" {
			tradeNos = append(tradeNos, tradeNo)
		}
	}

	invoiceReq := &piaoTongBlueInvoiceRequest{
		TaxpayerNum:          sellerTaxpayerNum,
		InvoiceReqSerialNo:   invoiceReqSerialNo,
		BuyerName:            buyerName,
		BuyerTaxpayerNum:     "",
		Remark:               buildPiaoTongInvoiceRemark(tradeNos),
		InvoiceIssueKindCode: issueKindCode,
		ItemList:             ptItems,
	}
	if app.InvoiceType == model.InvoiceTypeCompany {
		invoiceReq.BuyerTaxpayerNum = strings.TrimSpace(app.TaxId)
	}

	// 构建乐企联用 paymentList（只要有任意 item 填写了支付信息就进入 invIssueChannel=5）
	if pl := buildPaymentListFromItems(items); len(pl) > 0 {
		invoiceReq.InvIssueChannel = "5"
		invoiceReq.PaymentList = pl
	}

	return invoiceReq, nil
}

func buildPaymentListFromItems(items []model.InvoiceItem) []invoice_provider.PaymentItem {
	var result []invoice_provider.PaymentItem
	for _, it := range items {
		if it.PaymentCode == "" && it.TradeNoThirdParty == "" && it.SubMchid == "" && it.Account == "" {
			continue
		}
		result = append(result, invoice_provider.PaymentItem{
			PaymentCode:       it.PaymentCode,
			TransactionAmount: strconv.FormatFloat(it.Money, 'f', 2, 64),
			PaymentOrderNo:    it.TradeNo,
			TradeNo:          it.TradeNoThirdParty,
			SubMchid:         it.SubMchid,
			Account:          it.Account,
		})
	}
	return result
}

func buildPiaoTongInvoiceRemark(tradeNos []string) string {
	if len(tradeNos) == 0 {
		return ""
	}
	return "订单号: " + strings.Join(tradeNos, ", ")
}

func isValidPiaoTongInvoiceReqSerialNo(serialNo string) bool {
	serialNo = strings.TrimSpace(serialNo)
	if serialNo == "" || len(serialNo) > 64 {
		return false
	}
	for _, r := range serialNo {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			continue
		}
		return false
	}
	return true
}

func marshalPiaoTongPayloadSnapshot(payload *piaoTongBlueInvoiceRequest) string {
	if payload == nil {
		return ""
	}
	data, err := json.Marshal(payload)
	if err != nil {
		common.SysError("marshal piaotong payload snapshot failed: " + err.Error())
		return ""
	}
	return string(data)
}

func isPiaoTongInvoiceIssuedSuccess(invoiceStatus string) bool {
	switch strings.ToUpper(strings.TrimSpace(invoiceStatus)) {
	case "2", "3", "ISSUED", "SUCCESS", "FINISHED", "COMPLETE", "COMPLETED":
		return true
	default:
		return false
	}
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func getIssueMode() string {
	if common.InvoiceAutoIssueEnabled {
		return common.InvoiceIssueModeAuto
	}
	return common.InvoiceIssueModeManual
}

// InvoiceQueryWorker runs in the background and polls for invoices that need status queries.
func InvoiceQueryWorker() {
	for {
		time.Sleep(15 * time.Second)

		if common.InvoiceProvider != common.InvoiceProviderPiaoTong {
			continue
		}

		now := common.GetTimestamp()
		var apps []model.InvoiceApplication
		// 定时轮询跨租户扫描待查询发票，显式 bypass 放行 guardrail。
		err := model.WithTenantBypass(model.DB).
			Where("issue_status = ? AND next_query_at > 0 AND next_query_at <= ?",
				model.InvoiceIssueStatusQuerying, now).
			Limit(10).
			Find(&apps).Error
		if err != nil {
			common.SysError("invoice query worker scan error: " + err.Error())
			continue
		}

		for _, app := range apps {
			_, err := QueryInvoiceStatus(context.Background(), app.Id)
			if err != nil {
				common.SysError(fmt.Sprintf("invoice query worker error for app %d: %v", app.Id, err))
			}
		}
	}
}

// RedInvoiceApplication voids/reds an issued invoice via PiaoTong API 2.10.
func RedInvoiceApplication(ctx context.Context, appId int, redReason string) error {
	redReason = strings.TrimSpace(redReason)
	if redReason == "" {
		return fmt.Errorf("red reason is required")
	}

	var app model.InvoiceApplication
	if err := model.DB.Where("id = ?", appId).First(&app).Error; err != nil {
		return fmt.Errorf("application not found: %w", err)
	}

	if app.Status != model.InvoiceStatusIssued {
		return fmt.Errorf("application status is %s, must be issued", app.Status)
	}
	if strings.TrimSpace(app.RedStatus) != "" {
		return fmt.Errorf("application already red with status: %s", app.RedStatus)
	}
	if strings.TrimSpace(app.PiaoTongInvoiceReqSerialNo) == "" {
		return fmt.Errorf("missing invoice request serial number")
	}
	// PiaoTong requires either (invoiceCode + invoiceNo) for tax-control invoices
	// or blueAllEleInvNo for digital invoices — at least one set must be present.
	hasCodeNo := strings.TrimSpace(app.PiaoTongInvoiceCode) != "" && strings.TrimSpace(app.PiaoTongInvoiceNo) != ""
	hasAllEleInvNo := strings.TrimSpace(app.PiaoTongBlueAllEleInvNo) != ""
	if !hasCodeNo && !hasAllEleInvNo {
		return fmt.Errorf("missing invoice identification: need (invoiceCode + invoiceNo) or blueAllEleInvNo")
	}

	common.OptionMapRWMutex.RLock()
	sellerTaxpayerNum := strings.TrimSpace(common.OptionMap["InvoiceSellerTaxpayerNum"])
	common.OptionMapRWMutex.RUnlock()

	if sellerTaxpayerNum == "" {
		return fmt.Errorf("seller taxpayer number not configured")
	}

	// Generate a unique red invoice request serial number (must differ from blue invoice serial)
	redReqSerialNo := invoice_provider.GenerateSerialNo()
	if redReqSerialNo == "" {
		return fmt.Errorf("failed to generate red invoice serial number")
	}

	redAmount := fmt.Sprintf("-%.2f", app.TotalMoney)
	resp, err := invoice_provider.RedInvoice(
		sellerTaxpayerNum,
		redReqSerialNo,
		app.PiaoTongInvoiceCode,
		app.PiaoTongInvoiceNo,
		app.PiaoTongBlueAllEleInvNo,
		redAmount,
		redReason,
	)

	now := common.GetTimestamp()
	updates := map[string]interface{}{
		"red_reason": redReason,
		"updated_at": now,
	}

	if err != nil {
		updates["red_status"] = "red_failed"
		updates["red_error_message"] = err.Error()
		_ = model.DB.Model(&model.InvoiceApplication{}).Where("id = ?", appId).Updates(updates).Error
		return fmt.Errorf("piaotong red invoice failed: %w", err)
	}

	if resp != nil && resp.Code == "0000" {
		updates["red_status"] = "red_success"
		updates["red_serial_no"] = resp.SerialNo
		updates["red_at"] = now
		updates["red_error_message"] = ""

		if content := resp.Content; content != nil {
			if v, ok := content["invoiceCode"]; ok {
				updates["red_invoice_code"] = fmt.Sprintf("%v", v)
			}
			if v, ok := content["invoiceNo"]; ok {
				updates["red_invoice_no"] = fmt.Sprintf("%v", v)
			}
			if v, ok := content["invoiceReqSerialNo"]; ok {
				updates["red_invoice_req_serial_no"] = fmt.Sprintf("%v", v)
			}
		}
	} else {
		updates["red_status"] = "red_failed"
		if resp != nil {
			updates["red_error_message"] = fmt.Sprintf("code=%s, msg=%s", resp.Code, resp.Msg)
		} else {
			updates["red_error_message"] = "unknown error"
		}
	}

	if err := model.DB.Model(&model.InvoiceApplication{}).Where("id = ?", appId).Updates(updates).Error; err != nil {
		return fmt.Errorf("update application failed: %w", err)
	}

	if updates["red_status"] == "red_success" {
		if err := model.DB.Model(&model.InvoiceFile{}).Where("invoice_id = ?", appId).Updates(map[string]interface{}{
			"is_red":          true,
			"is_user_visible": false,
		}).Error; err != nil {
			return fmt.Errorf("update invoice files failed: %w", err)
		}
		return nil
	}
	return fmt.Errorf("red invoice failed: %s", updates["red_error_message"])
}
