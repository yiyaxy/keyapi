package model

import (
	"errors"
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"

	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

type TopUp struct {
	Id            int     `json:"id"`
	UserId        int     `json:"user_id" gorm:"index"`
	Amount        int64   `json:"amount"`
	Money         float64 `json:"money"`
	TradeNo       string  `json:"trade_no" gorm:"unique;type:varchar(255);index"`
	PaymentMethod string  `json:"payment_method" gorm:"type:varchar(50)"`
	CreateTime    int64   `json:"create_time"`
	CompleteTime  int64   `json:"complete_time"`
	Status        string  `json:"status"`
	ClientIP      string  `json:"client_ip" gorm:"type:varchar(64);default:''"`

	// Epay callback snapshot fields (populated on success notify)
	EpayTradeNo      string `json:"epay_trade_no" gorm:"type:varchar(128);default:''"`
	EpayOrderIdWxAl  string `json:"epay_order_id_wx_al" gorm:"type:varchar(128);default:''"`
	EpayType         string `json:"epay_type" gorm:"type:varchar(32);default:''"`
	EpayTdid         string `json:"epay_tdid" gorm:"type:varchar(128);default:''"`
	EpayPid          string `json:"epay_pid" gorm:"type:varchar(64);default:''"`
	EpayTradeStatus  string `json:"epay_trade_status" gorm:"type:varchar(64);default:''"`
	EpayNotifyPayload string `json:"epay_notify_payload" gorm:"type:text;default:''"`
}

// TopUpWithUser is a DTO for admin queries that includes the username.
type TopUpWithUser struct {
	TopUp
	Username string `json:"username"`
}

func (topUp *TopUp) Insert() error {
	var err error
	err = DB.Create(topUp).Error
	return err
}

func (topUp *TopUp) Update() error {
	var err error
	err = DB.Save(topUp).Error
	return err
}

func GetTopUpById(id int) *TopUp {
	var topUp *TopUp
	var err error
	err = DB.Where("id = ?", id).First(&topUp).Error
	if err != nil {
		return nil
	}
	return topUp
}

func GetTopUpByTradeNo(tradeNo string) *TopUp {
	var topUp *TopUp
	var err error
	err = DB.Where("trade_no = ?", tradeNo).First(&topUp).Error
	if err != nil {
		return nil
	}
	return topUp
}

func Recharge(referenceId string, customerId string) (err error) {
	if referenceId == "" {
		return errors.New("未提供支付单号")
	}

	var quota float64
	topUp := &TopUp{}

	refCol := "`trade_no`"
	if common.UsingPostgreSQL {
		refCol = `"trade_no"`
	}

	err = DB.Transaction(func(tx *gorm.DB) error {
		err := tx.Set("gorm:query_option", "FOR UPDATE").Where(refCol+" = ?", referenceId).First(topUp).Error
		if err != nil {
			return errors.New("充值订单不存在")
		}

		if topUp.Status != common.TopUpStatusPending {
			return errors.New("充值订单状态错误")
		}

		topUp.CompleteTime = common.GetTimestamp()
		topUp.Status = common.TopUpStatusSuccess
		err = tx.Save(topUp).Error
		if err != nil {
			return err
		}

		quota = topUp.Money * common.QuotaPerUnit
		err = tx.Model(&User{}).Where("id = ?", topUp.UserId).Updates(map[string]interface{}{"stripe_customer": customerId, "quota": gorm.Expr("quota + ?", quota)}).Error
		if err != nil {
			return err
		}

		return nil
	})

	if err != nil {
		common.SysError("topup failed: " + err.Error())
		return errors.New("充值失败，请稍后重试")
	}

	RecordTopUpLog(topUp.UserId, int(quota), fmt.Sprintf("使用在线充值成功，充值金额: %v，支付金额：%d", logger.FormatQuota(int(quota)), topUp.Amount))

	// 处理充值返利
	ProcessTopUpRebate(topUp.UserId, int(quota))

	return nil
}

func GetUserTopUps(userId int, pageInfo *common.PageInfo) (topups []*TopUp, total int64, err error) {
	// Start transaction
	tx := DB.Begin()
	if tx.Error != nil {
		return nil, 0, tx.Error
	}
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	// Get total count within transaction
	err = tx.Model(&TopUp{}).Where("user_id = ?", userId).Count(&total).Error
	if err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	// Get paginated topups within same transaction
	err = tx.Where("user_id = ?", userId).Order("id desc").Limit(pageInfo.GetPageSize()).Offset(pageInfo.GetStartIdx()).Find(&topups).Error
	if err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	// Commit transaction
	if err = tx.Commit().Error; err != nil {
		return nil, 0, err
	}

	return topups, total, nil
}

// GetAllTopUps 获取全平台的充值记录（管理员使用）
func GetAllTopUps(pageInfo *common.PageInfo) (topups []*TopUp, total int64, err error) {
	tx := DB.Begin()
	if tx.Error != nil {
		return nil, 0, tx.Error
	}
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	if err = tx.Model(&TopUp{}).Count(&total).Error; err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	if err = tx.Order("id desc").Limit(pageInfo.GetPageSize()).Offset(pageInfo.GetStartIdx()).Find(&topups).Error; err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	if err = tx.Commit().Error; err != nil {
		return nil, 0, err
	}

	return topups, total, nil
}

// SearchUserTopUps 按订单号搜索某用户的充值记录
func SearchUserTopUps(userId int, keyword string, pageInfo *common.PageInfo) (topups []*TopUp, total int64, err error) {
	tx := DB.Begin()
	if tx.Error != nil {
		return nil, 0, tx.Error
	}
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	query := tx.Model(&TopUp{}).Where("user_id = ?", userId)
	if keyword != "" {
		like := "%%" + keyword + "%%"
		query = query.Where("trade_no LIKE ?", like)
	}

	if err = query.Count(&total).Error; err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	if err = query.Order("id desc").Limit(pageInfo.GetPageSize()).Offset(pageInfo.GetStartIdx()).Find(&topups).Error; err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	if err = tx.Commit().Error; err != nil {
		return nil, 0, err
	}
	return topups, total, nil
}

// SearchAllTopUps 按订单号搜索全平台充值记录（管理员使用）
func SearchAllTopUps(keyword string, pageInfo *common.PageInfo) (topups []*TopUp, total int64, err error) {
	tx := DB.Begin()
	if tx.Error != nil {
		return nil, 0, tx.Error
	}
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	query := tx.Model(&TopUp{})
	if keyword != "" {
		like := "%%" + keyword + "%%"
		query = query.Where("trade_no LIKE ?", like)
	}

	if err = query.Count(&total).Error; err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	if err = query.Order("id desc").Limit(pageInfo.GetPageSize()).Offset(pageInfo.GetStartIdx()).Find(&topups).Error; err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	if err = tx.Commit().Error; err != nil {
		return nil, 0, err
	}
	return topups, total, nil
}

// ManualCompleteTopUp 管理员手动完成订单并给用户充值
func ManualCompleteTopUp(tradeNo string) error {
	if tradeNo == "" {
		return errors.New("未提供订单号")
	}

	// 订阅订单以 "SUB" 开头，转调订阅补单逻辑
	if strings.HasPrefix(tradeNo, "SUB") || strings.HasPrefix(tradeNo, "sub_ref_") {
		return CompleteSubscriptionOrder(tradeNo, "")
	}

	refCol := "`trade_no`"
	if common.UsingPostgreSQL {
		refCol = `"trade_no"`
	}

	var userId int
	var quotaToAdd int
	var payMoney float64

	err := DB.Transaction(func(tx *gorm.DB) error {
		topUp := &TopUp{}
		// 行级锁，避免并发补单
		if err := tx.Set("gorm:query_option", "FOR UPDATE").Where(refCol+" = ?", tradeNo).First(topUp).Error; err != nil {
			return errors.New("充值订单不存在")
		}

		// 幂等处理：已成功直接返回
		if topUp.Status == common.TopUpStatusSuccess {
			return nil
		}

		if topUp.Status != common.TopUpStatusPending {
			return errors.New("订单状态不是待支付，无法补单")
		}

		// 计算应充值额度：
		// - Stripe 订单：Money 代表经分组倍率换算后的美元数量，直接 * QuotaPerUnit
		// - 其他订单（如易支付）：Amount 为美元数量，* QuotaPerUnit
		if topUp.PaymentMethod == "stripe" {
			dQuotaPerUnit := decimal.NewFromFloat(common.QuotaPerUnit)
			quotaToAdd = int(decimal.NewFromFloat(topUp.Money).Mul(dQuotaPerUnit).IntPart())
		} else {
			dAmount := decimal.NewFromInt(topUp.Amount)
			dQuotaPerUnit := decimal.NewFromFloat(common.QuotaPerUnit)
			quotaToAdd = int(dAmount.Mul(dQuotaPerUnit).IntPart())
		}
		if quotaToAdd <= 0 {
			return errors.New("无效的充值额度")
		}

		// 标记完成
		topUp.CompleteTime = common.GetTimestamp()
		topUp.Status = common.TopUpStatusSuccess
		if err := tx.Save(topUp).Error; err != nil {
			return err
		}

		// 增加用户额度（立即写库，保持一致性）
		if err := tx.Model(&User{}).Where("id = ?", topUp.UserId).Update("quota", gorm.Expr("quota + ?", quotaToAdd)).Error; err != nil {
			return err
		}

		userId = topUp.UserId
		payMoney = topUp.Money
		return nil
	})

	if err != nil {
		return err
	}

	// 事务外记录日志，避免阻塞
	RecordTopUpLog(userId, quotaToAdd, fmt.Sprintf("管理员补单成功，充值金额: %v，支付金额：%f", logger.FormatQuota(quotaToAdd), payMoney))

	// 处理充值返利
	ProcessTopUpRebate(userId, quotaToAdd)

	return nil
}

// ProcessTopUpRebate 处理充值返利逻辑
// 当被邀请者充值成功时，检查是否满足返利条件，给邀请者发放返利
func ProcessTopUpRebate(userId int, quotaAdded int) {
	// 检查全局配置是否启用（作为默认值的快速检查）
	if common.TopUpRebateCount == 0 || common.TopUpRebatePercent <= 0 {
		// 全局未启用，但可能有个性化设置，继续检查
	}

	// 获取用户信息
	user, err := GetUserById(userId, true)
	if err != nil {
		common.SysLog(fmt.Sprintf("ProcessTopUpRebate: 获取用户信息失败 userId=%d, err=%v", userId, err))
		return
	}

	// 检查是否有邀请者
	if user.InviterId <= 0 {
		return
	}

	// 获取有效的返利设置（个性化 > 全局）
	rebateSetting := GetEffectiveRebateSetting(user.InviterId)

	// 检查返利是否启用
	if rebateSetting.TopUpRebateCount == 0 || rebateSetting.TopUpRebatePercent <= 0 {
		return
	}

	// 检查用户充值次数是否在返利范围内（-1 表示无限次）
	if rebateSetting.TopUpRebateCount > 0 && user.TopUpCount >= rebateSetting.TopUpRebateCount {
		return
	}

	// 计算返利金额
	rebateQuota := quotaAdded * rebateSetting.TopUpRebatePercent / 100
	if rebateQuota <= 0 {
		return
	}

	// 给邀请者增加 AffQuota 和 AffHistoryQuota
	err = DB.Model(&User{}).Where("id = ?", user.InviterId).Updates(map[string]interface{}{
		"aff_quota":   gorm.Expr("aff_quota + ?", rebateQuota),
		"aff_history": gorm.Expr("aff_history + ?", rebateQuota),
	}).Error
	if err != nil {
		common.SysLog(fmt.Sprintf("ProcessTopUpRebate: 更新邀请者额度失败 inviterId=%d, err=%v", user.InviterId, err))
		return
	}

	// 记录返利日志
	CreateAffRebateLog(&AffRebateLog{
		UserId:      user.InviterId,
		InviteeId:   userId,
		InviteeName: user.Username,
		Type:        AffRebateTypeTopUp,
		Quota:       rebateQuota,
		Remark:      fmt.Sprintf("充值返利 %s", logger.LogQuota(rebateQuota)),
	})

	// 用户 TopUpCount +1
	err = DB.Model(&User{}).Where("id = ?", userId).Update("top_up_count", gorm.Expr("top_up_count + ?", 1)).Error
	if err != nil {
		common.SysLog(fmt.Sprintf("ProcessTopUpRebate: 更新用户充值次数失败 userId=%d, err=%v", userId, err))
		return
	}

	// 记录日志
	countDisplay := fmt.Sprintf("%d/%d", user.TopUpCount+1, rebateSetting.TopUpRebateCount)
	if rebateSetting.TopUpRebateCount == -1 {
		countDisplay = fmt.Sprintf("%d/∞", user.TopUpCount+1)
	}
	RecordLogWithTenant(user.TenantId, user.InviterId, LogTypeSystem, fmt.Sprintf("邀请用户充值返利 %s（充值次数: %s）",
		logger.LogQuota(rebateQuota), countDisplay))
	common.SysLog(fmt.Sprintf("ProcessTopUpRebate: 返利成功 inviterId=%d, userId=%d, rebateQuota=%d, topUpCount=%s",
		user.InviterId, userId, rebateQuota, countDisplay))
}

func RechargeCreem(referenceId string, customerEmail string, customerName string) (err error) {
	if referenceId == "" {
		return errors.New("未提供支付单号")
	}

	var quota int64
	topUp := &TopUp{}

	refCol := "`trade_no`"
	if common.UsingPostgreSQL {
		refCol = `"trade_no"`
	}

	err = DB.Transaction(func(tx *gorm.DB) error {
		err := tx.Set("gorm:query_option", "FOR UPDATE").Where(refCol+" = ?", referenceId).First(topUp).Error
		if err != nil {
			return errors.New("充值订单不存在")
		}

		if topUp.Status != common.TopUpStatusPending {
			return errors.New("充值订单状态错误")
		}

		topUp.CompleteTime = common.GetTimestamp()
		topUp.Status = common.TopUpStatusSuccess
		err = tx.Save(topUp).Error
		if err != nil {
			return err
		}

		// Creem 直接使用 Amount 作为充值额度（整数）
		quota = topUp.Amount

		// 构建更新字段，优先使用邮箱，如果邮箱为空则使用用户名
		updateFields := map[string]interface{}{
			"quota": gorm.Expr("quota + ?", quota),
		}

		// 如果有客户邮箱，尝试更新用户邮箱（仅当用户邮箱为空时）
		if customerEmail != "" {
			// 先检查用户当前邮箱是否为空
			var user User
			err = tx.Where("id = ?", topUp.UserId).First(&user).Error
			if err != nil {
				return err
			}

			// 如果用户邮箱为空，则更新为支付时使用的邮箱
			if user.Email == "" {
				updateFields["email"] = customerEmail
			}
		}

		err = tx.Model(&User{}).Where("id = ?", topUp.UserId).Updates(updateFields).Error
		if err != nil {
			return err
		}

		return nil
	})

	if err != nil {
		common.SysError("creem topup failed: " + err.Error())
		return errors.New("充值失败，请稍后重试")
	}

	RecordTopUpLog(topUp.UserId, int(quota), fmt.Sprintf("使用Creem充值成功，充值额度: %v，支付金额：%.2f", quota, topUp.Money))

	// 处理充值返利
	ProcessTopUpRebate(topUp.UserId, int(quota))

	return nil
}

func RechargeWaffo(tradeNo string) (err error) {
	if tradeNo == "" {
		return errors.New("未提供支付单号")
	}

	var quotaToAdd int
	topUp := &TopUp{}

	refCol := "`trade_no`"
	if common.UsingPostgreSQL {
		refCol = `"trade_no"`
	}

	err = DB.Transaction(func(tx *gorm.DB) error {
		err := tx.Set("gorm:query_option", "FOR UPDATE").Where(refCol+" = ?", tradeNo).First(topUp).Error
		if err != nil {
			return errors.New("充值订单不存在")
		}

		if topUp.Status == common.TopUpStatusSuccess {
			return nil // 幂等：已成功直接返回
		}

		if topUp.Status != common.TopUpStatusPending {
			return errors.New("充值订单状态错误")
		}

		dAmount := decimal.NewFromInt(topUp.Amount)
		dQuotaPerUnit := decimal.NewFromFloat(common.QuotaPerUnit)
		quotaToAdd = int(dAmount.Mul(dQuotaPerUnit).IntPart())
		if quotaToAdd <= 0 {
			return errors.New("无效的充值额度")
		}

		topUp.CompleteTime = common.GetTimestamp()
		topUp.Status = common.TopUpStatusSuccess
		if err := tx.Save(topUp).Error; err != nil {
			return err
		}

		if err := tx.Model(&User{}).Where("id = ?", topUp.UserId).Update("quota", gorm.Expr("quota + ?", quotaToAdd)).Error; err != nil {
			return err
		}

		return nil
	})

	if err != nil {
		common.SysError("waffo topup failed: " + err.Error())
		return errors.New("充值失败，请稍后重试")
	}

	if quotaToAdd > 0 {
		RecordLogWithTenant(DefaultTenantId, topUp.UserId, LogTypeTopup, fmt.Sprintf("Waffo充值成功，充值额度: %v，支付金额: %.2f", logger.FormatQuota(quotaToAdd), topUp.Money)) // TODO: Phase 2 — TopUp needs TenantId
	}

	return nil
}

// GetAllTopUpsWithUser returns paginated TopUp records with LEFT JOIN to get username.
func GetAllTopUpsWithUser(pageInfo *common.PageInfo, keyword string, status string) ([]TopUpWithUser, int64, error) {
	var results []TopUpWithUser
	var total int64

	topUpTable := "top_ups"
	userTable := "users"
	usernameCol := "users.username"
	tradeNoCol := "top_ups.trade_no"
	statusCol := "top_ups.status"

	query := DB.Table(topUpTable).
		Select(topUpTable + ".*, " + usernameCol + " AS username").
		Joins("LEFT JOIN " + userTable + " ON " + topUpTable + ".user_id = " + userTable + ".id")

	// Exclude subscription orders (trade_no starts with "SUB" or "sub_ref_")
	query = query.Where(tradeNoCol+" NOT LIKE 'SUB%' AND "+tradeNoCol+" NOT LIKE 'sub_ref_%'")

	if keyword != "" {
		like := "%" + keyword + "%"
		query = query.Where(tradeNoCol+" LIKE ? OR "+usernameCol+" LIKE ?", like, like)
	}
	if status != "" {
		query = query.Where(statusCol+" = ?", status)
	}

	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	if err := query.Order(topUpTable + ".id desc").
		Limit(pageInfo.GetPageSize()).
		Offset(pageInfo.GetStartIdx()).
		Find(&results).Error; err != nil {
		return nil, 0, err
	}

	return results, total, nil
}

// ExpireTopUpOrder marks a pending TopUp order as expired.
func ExpireTopUpOrder(tradeNo string) error {
	if tradeNo == "" {
		return errors.New("trade_no is required")
	}
	refCol := "`trade_no`"
	if common.UsingPostgreSQL {
		refCol = `"trade_no"`
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		topUp := &TopUp{}
		if err := tx.Set("gorm:query_option", "FOR UPDATE").Where(refCol+" = ?", tradeNo).First(topUp).Error; err != nil {
			return errors.New("topup order not found")
		}
		if topUp.Status != common.TopUpStatusPending {
			return errors.New("order is not pending, cannot mark as expired")
		}
		topUp.Status = common.TopUpStatusExpired
		topUp.CompleteTime = common.GetTimestamp()
		return tx.Save(topUp).Error
	})
}

// DeleteTopUpOrder hard-deletes a TopUp order by trade_no.
func DeleteTopUpOrder(tradeNo string) error {
	if tradeNo == "" {
		return errors.New("trade_no is required")
	}
	result := DB.Where("trade_no = ?", tradeNo).Delete(&TopUp{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return errors.New("order not found")
	}
	return nil
}
