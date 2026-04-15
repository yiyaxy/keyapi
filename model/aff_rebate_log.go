package model

import (
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
)

const (
	AffRebateTypeRegister     = 1
	AffRebateTypeTopUp        = 2
	AffRebateTypeSubscription = 3
)

type AffRebateLog struct {
	Id          int    `json:"id" gorm:"primaryKey;autoIncrement"`
	UserId      int    `json:"user_id" gorm:"index"`
	InviteeId   int    `json:"invitee_id"`
	InviteeName string `json:"invitee_name"`
	Type        int    `json:"type" gorm:"index"`
	Quota       int    `json:"quota"`
	Remark      string `json:"remark"`
	CreatedAt   int64  `json:"created_at" gorm:"autoCreateTime"`
}

func CreateAffRebateLog(log *AffRebateLog) error {
	return DB.Create(log).Error
}

func GetAffRebateLogsByUserId(userId int, page *common.PageInfo, rebateType int) ([]*AffRebateLog, int64, error) {
	var logs []*AffRebateLog
	var total int64

	tx := DB.Model(&AffRebateLog{}).Where("user_id = ?", userId)
	if rebateType > 0 {
		tx = tx.Where("type = ?", rebateType)
	}

	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	if err := tx.Order("id DESC").Offset(page.GetStartIdx()).Limit(page.GetPageSize()).Find(&logs).Error; err != nil {
		return nil, 0, err
	}

	return logs, total, nil
}

// parseQuotaFromLogContent parses the quota integer from a log content string
// produced by LogQuota(). It handles four formats:
//   - USD:    "＄0.004000 额度"  → float * QuotaPerUnit
//   - CNY:    "¥0.029200 额度"  → float / exchangeRate * QuotaPerUnit
//   - TOKENS: "2000 点额度"     → the integer directly
//   - Custom: "€0.004000 额度"  → float / customRate * QuotaPerUnit
func parseQuotaFromLogContent(content string, usdExchangeRate float64, customCurrencyRate float64) int {
	// Pattern for TOKENS: a bare integer followed by " 点额度"
	tokensRe := regexp.MustCompile(`(\d+)\s*点额度`)
	if m := tokensRe.FindStringSubmatch(content); len(m) == 2 {
		v, err := strconv.Atoi(m[1])
		if err == nil {
			return v
		}
	}

	// Pattern for USD (full-width ＄ U+FF04): "＄0.004000 额度"
	usdRe := regexp.MustCompile(`＄([\d.]+)\s*额度`)
	if m := usdRe.FindStringSubmatch(content); len(m) == 2 {
		f, err := strconv.ParseFloat(m[1], 64)
		if err == nil {
			return int(math.Round(f * common.QuotaPerUnit))
		}
	}

	// Pattern for CNY: "¥0.029200 额度"
	cnyRe := regexp.MustCompile(`¥([\d.]+)\s*额度`)
	if m := cnyRe.FindStringSubmatch(content); len(m) == 2 {
		f, err := strconv.ParseFloat(m[1], 64)
		if err == nil {
			if usdExchangeRate <= 0 {
				usdExchangeRate = 7.3
			}
			usd := f / usdExchangeRate
			return int(math.Round(usd * common.QuotaPerUnit))
		}
	}

	// Pattern for custom currency: any non-digit symbol(s) followed by float and " 额度"
	// This catches symbols like €, £, ¤, etc.
	customRe := regexp.MustCompile(`[^\d\s＄¥]([\d.]+)\s*额度`)
	if m := customRe.FindStringSubmatch(content); len(m) == 2 {
		f, err := strconv.ParseFloat(m[1], 64)
		if err == nil {
			if customCurrencyRate <= 0 {
				customCurrencyRate = 1.0
			}
			usd := f / customCurrencyRate
			return int(math.Round(usd * common.QuotaPerUnit))
		}
	}

	return 0
}

// BackfillAffRebateLogs populates the aff_rebate_logs table from historical
// system logs. It runs at most once: the options table key "AffRebateLogsBackfilled"
// acts as a run-once guard.
func BackfillAffRebateLogs() {
	// Run-once guard: check if already done
	var opt Option
	result := DB.Where(commonKeyCol+" = ?", "AffRebateLogsBackfilled").First(&opt)
	if result.Error == nil {
		// Already backfilled
		return
	}

	common.SysLog("starting backfill of aff_rebate_logs from historical system logs")

	// Read USD exchange rate from options table
	usdExchangeRate := 7.3
	var exchangeOpt Option
	if err := DB.Where(commonKeyCol+" = ?", "USDExchangeRate").First(&exchangeOpt).Error; err == nil {
		if rate, err := strconv.ParseFloat(exchangeOpt.Value, 64); err == nil && rate > 0 {
			usdExchangeRate = rate
		}
	}

	// Read custom currency exchange rate from options table
	customCurrencyRate := 1.0
	var customRateOpt Option
	if err := DB.Where(commonKeyCol+" = ?", "general_setting.custom_currency_exchange_rate").First(&customRateOpt).Error; err == nil {
		if rate, err := strconv.ParseFloat(customRateOpt.Value, 64); err == nil && rate > 0 {
			customCurrencyRate = rate
		}
	}

	// Query historical system logs (type=4) matching rebate patterns
	// Process in batches to avoid loading too many records at once
	batchSize := 500
	offset := 0
	totalCreated := 0

	for {
		var logs []Log
		err := LOG_DB.Where("type = ?", LogTypeSystem).
			Where("content LIKE ? OR content LIKE ?",
				"%邀请用户充值返利%", "%邀请用户赠送%").
			Order("id ASC").
			Offset(offset).Limit(batchSize).
			Find(&logs).Error
		if err != nil {
			common.SysLog(fmt.Sprintf("backfill aff_rebate_logs: error querying logs at offset %d: %s", offset, err.Error()))
			break
		}

		if len(logs) == 0 {
			break
		}

		var rebateLogs []AffRebateLog
		for _, l := range logs {
			var rebateType int
			if strings.Contains(l.Content, "邀请用户充值返利") {
				rebateType = AffRebateTypeTopUp
			} else if strings.Contains(l.Content, "邀请用户赠送") {
				rebateType = AffRebateTypeRegister
			} else {
				continue
			}

			quota := parseQuotaFromLogContent(l.Content, usdExchangeRate, customCurrencyRate)

			rebateLogs = append(rebateLogs, AffRebateLog{
				UserId:    l.UserId,
				InviteeId: 0,
				Type:      rebateType,
				Quota:     quota,
				Remark:    l.Content,
				CreatedAt: l.CreatedAt,
			})
		}

		if len(rebateLogs) > 0 {
			if err := DB.Create(&rebateLogs).Error; err != nil {
				common.SysLog(fmt.Sprintf("backfill aff_rebate_logs: error creating batch at offset %d: %s", offset, err.Error()))
			} else {
				totalCreated += len(rebateLogs)
			}
		}

		offset += batchSize
	}

	// Mark as done
	doneOpt := Option{
		Key:   "AffRebateLogsBackfilled",
		Value: "true",
	}
	if err := DB.Create(&doneOpt).Error; err != nil {
		common.SysLog("backfill aff_rebate_logs: failed to mark as done: " + err.Error())
	}

	common.SysLog(fmt.Sprintf("backfill aff_rebate_logs completed: %d records created", totalCreated))
}
