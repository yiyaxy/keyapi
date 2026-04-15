package controller

import (
	"crypto/sha256"
	"fmt"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/console_setting"
	"github.com/gin-gonic/gin"
)

// stableContentId generates a hash-based ID from content fields
func stableContentId(fields map[string]string) string {
	var s string
	for _, v := range fields {
		s += v
	}
	h := sha256.Sum256([]byte(s))
	return fmt.Sprintf("%x", h[:6])
}

func GetTranslatedConsole(c *gin.Context) {
	lang := c.Query("lang")
	if lang == "" || lang == "zh" {
		common.ApiSuccess(c, gin.H{
			"announcements": console_setting.GetAnnouncements(),
			"faq":           console_setting.GetFAQ(),
			"api_info":      console_setting.GetApiInfo(),
		})
		return
	}

	announcements := console_setting.GetAnnouncements()
	faq := console_setting.GetFAQ()
	apiInfo := console_setting.GetApiInfo()

	// Collect all items for batch translation
	var items []service.TranslateItem
	type itemRef struct {
		resultKey string
		index     int
	}
	var refs []itemRef

	for i, item := range announcements {
		fields := map[string]string{}
		if v, ok := item["content"].(string); ok && v != "" {
			fields["content"] = v
		}
		if v, ok := item["extra"].(string); ok && v != "" {
			fields["extra"] = v
		}
		if len(fields) > 0 {
			items = append(items, service.TranslateItem{
				ContentType: "announcement",
				ContentId:   stableContentId(fields),
				Fields:      fields,
			})
			refs = append(refs, itemRef{"announcements", i})
		}
	}

	for i, item := range faq {
		fields := map[string]string{}
		if v, ok := item["question"].(string); ok && v != "" {
			fields["question"] = v
		}
		if v, ok := item["answer"].(string); ok && v != "" {
			fields["answer"] = v
		}
		if len(fields) > 0 {
			items = append(items, service.TranslateItem{
				ContentType: "faq",
				ContentId:   stableContentId(fields),
				Fields:      fields,
			})
			refs = append(refs, itemRef{"faq", i})
		}
	}

	for i, item := range apiInfo {
		fields := map[string]string{}
		if v, ok := item["route"].(string); ok && v != "" {
			fields["route"] = v
		}
		if v, ok := item["description"].(string); ok && v != "" {
			fields["description"] = v
		}
		if len(fields) > 0 {
			items = append(items, service.TranslateItem{
				ContentType: "api_info",
				ContentId:   stableContentId(fields),
				Fields:      fields,
			})
			refs = append(refs, itemRef{"api_info", i})
		}
	}

	// Batch translate all items (merged LLM calls)
	translated := service.TranslateContentBatchMerged(items, lang)

	// Apply results
	for idx, ref := range refs {
		t := translated[idx]
		switch ref.resultKey {
		case "announcements":
			for k, v := range t {
				announcements[ref.index][k] = v
			}
		case "faq":
			for k, v := range t {
				faq[ref.index][k] = v
			}
		case "api_info":
			for k, v := range t {
				apiInfo[ref.index][k] = v
			}
		}
	}

	common.ApiSuccess(c, gin.H{
		"announcements": announcements,
		"faq":           faq,
		"api_info":      apiInfo,
	})
}
