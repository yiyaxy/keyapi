package model

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// MergeResult 返回调用方，主要用于打日志/审计面板。
type MergeResult struct {
	SourceUserId    int
	TargetUserId    int
	MergedQuota     int
	MergedUsedQuota int
	WeChatId        string
}

// MergeUserInto 把 sourceId 账户所有业务数据并入 targetId，在一个事务里完成。
// 约束：同租户、源账户非主账户自身、两个账户都存在且可用。
// 合并成功后：
//   - target 的 Quota / UsedQuota / RequestCount / Aff* / TopUpCount 等叠加；
//   - target 的 WeChatId 继承 source（无论 target 原本是否有）；
//   - source 的 WeChatId 清空、Status = Disabled、MergedInto = target、DeletedAt = now；
//   - source 在该租户的 membership 删除；source 若为 tenant admin，target 升格；
//   - source 所有业务表（tokens/logs/topups/...）的 user_id 迁到 target；
//   - 每次合并落一条 user_merge_logs 审计记录；
//   - Redis 里 source 的用户缓存 & 可能残留的 session 缓存清理。
//
// 不可逆。调用方需自行保证用户已二次确认。
func MergeUserInto(sourceId, targetId, operatorId int, reason string) (*MergeResult, error) {
	if sourceId <= 0 || targetId <= 0 {
		return nil, errors.New("invalid user id")
	}
	if sourceId == targetId {
		return nil, errors.New("不能将账户合并到自身")
	}

	var result MergeResult
	result.SourceUserId = sourceId
	result.TargetUserId = targetId

	err := DB.Transaction(func(tx *gorm.DB) error {
		// 加锁读取源/目标，防止并发合并或并发扣费。
		// SQLite 不支持 SELECT FOR UPDATE，跳过；事务内串行化已足够。
		var source, target User
		srcQuery := WithTenantBypass(tx).Unscoped().Where("id = ?", sourceId)
		tgtQuery := WithTenantBypass(tx).Unscoped().Where("id = ?", targetId)
		if !common.UsingSQLite {
			srcQuery = srcQuery.Clauses(clause.Locking{Strength: "UPDATE"})
			tgtQuery = tgtQuery.Clauses(clause.Locking{Strength: "UPDATE"})
		}
		if err := srcQuery.First(&source).Error; err != nil {
			return fmt.Errorf("源账户读取失败: %w", err)
		}
		if err := tgtQuery.First(&target).Error; err != nil {
			return fmt.Errorf("目标账户读取失败: %w", err)
		}

		if source.DeletedAt.Valid || source.MergedInto != 0 {
			return errors.New("源账户已被删除或合并过")
		}
		if target.DeletedAt.Valid || target.MergedInto != 0 {
			return errors.New("目标账户已被删除或合并过")
		}
		if source.TenantId != target.TenantId {
			return errors.New("跨租户账户不允许合并")
		}
		tenantId := source.TenantId

		// —— 业务表 reassign ——
		// 设计考量：逐表 UPDATE 而不是批量外键 CASCADE，因为部分表有
		// (user_id, ...) 唯一约束，需要先清理 source 侧冲突行再 reassign。

		// 1) 有 (user_id, X) 唯一约束的表：先删 source 的冲突行，保留 target
		//    的（target 是"主"，语义上继承其现有数据）。
		if err := deleteConflictingCheckins(tx, tenantId, sourceId, targetId); err != nil {
			return err
		}

		// 2) 有 user_id 唯一索引、每用户至多一行的表：直接删 source 的。
		//    target 已有的继续用；如果 target 没有而 source 有，就把 source 的
		//    搬过去。
		if err := moveUserUniqueRow(tx, "two_fas", sourceId, targetId); err != nil {
			return err
		}
		if err := moveUserUniqueRow(tx, "passkey_credentials", sourceId, targetId); err != nil {
			return err
		}

		// 3) (user_id, provider_id) unique table: merge provider bindings one by one.
		if err := moveOAuthBindings(tx, sourceId, targetId); err != nil {
			return err
		}

		// 4) 其它普通表：直接 UPDATE user_id。
		//    注意：logs 表如果走 LOG_DB 独立库，主 DB 事务里 UPDATE 不了；
		//    所以 logs 单独在事务外处理。
		reassignTables := []string{
			"tokens",
			"top_ups",
			"redemptions",
			"tickets",
			"ticket_replies",
			"ticket_attachments",
			"ticket_uploads",
			"invoice_applications",
			"invoice_items",
			"invoice_uploads",
			"user_subscriptions",
			"subscription_orders",
			"subscription_pre_consume_records",
			"aff_rebate_logs",
			"aff_transfer_requests",
			"tasks",
			"payment_orders",
			"midjourneys",
			"messages",
			"message_read_statuses",
			"user_ip_records",
			"user_rebate_settings",
			"two_fa_backup_codes",
			"quota_data",
		}
		for _, table := range reassignTables {
			if err := reassignUserId(tx, table, sourceId, targetId); err != nil {
				return fmt.Errorf("表 %s reassign 失败: %w", table, err)
			}
		}

		// 5) users.inviter_id 指向 source 的，改指 target（仅同租户）。
		if err := WithTenantBypass(tx).Exec(
			"UPDATE users SET inviter_id = ? WHERE inviter_id = ? AND tenant_id = ?",
			targetId, sourceId, tenantId,
		).Error; err != nil {
			return fmt.Errorf("inviter_id 迁移失败: %w", err)
		}

		// —— 租户成员身份：选两者里更高的角色给 target，删 source 的 —— //
		sourceMember, _ := GetTenantMembershipUnscoped(tenantId, sourceId)
		targetMember, _ := GetTenantMembershipUnscoped(tenantId, targetId)
		if sourceMember != nil {
			if targetMember == nil {
				// target 居然没有 membership（不该出现，防御性创建）
				if err := tx.Create(&TenantMembership{
					TenantId: tenantId,
					UserId:   targetId,
					Role:     sourceMember.Role,
					Status:   TenantMembershipStatusActive,
				}).Error; err != nil {
					return fmt.Errorf("创建目标 membership 失败: %w", err)
				}
			} else if sourceMember.Role > targetMember.Role {
				// 升格：取更高权限（admin > member）
				if err := WithTenantBypass(tx).Model(&TenantMembership{}).
					Where("id = ?", targetMember.Id).
					Updates(map[string]interface{}{
						"role":       sourceMember.Role,
						"status":     TenantMembershipStatusActive,
						"deleted_at": nil,
					}).Error; err != nil {
					return fmt.Errorf("升级目标 membership 角色失败: %w", err)
				}
			}
			// 删 source 的 membership（硬删，不留软删痕迹）
			if err := WithTenantBypass(tx).Unscoped().
				Where("id = ?", sourceMember.Id).
				Delete(&TenantMembership{}).Error; err != nil {
				return fmt.Errorf("删除源 membership 失败: %w", err)
			}
		}

		// —— 用户表：target 吸收余额 + 继承第三方身份 —— //
		updates := map[string]interface{}{
			"quota":                       target.Quota + source.Quota,
			"used_quota":                  target.UsedQuota + source.UsedQuota,
			"request_count":               target.RequestCount + source.RequestCount,
			"aff_count":                   target.AffCount + source.AffCount,
			"aff_quota":                   target.AffQuota + source.AffQuota,
			"aff_history":                 target.AffHistoryQuota + source.AffHistoryQuota,
			"top_up_count":                target.TopUpCount + source.TopUpCount,
			"subscription_purchase_count": target.SubscriptionPurchaseCount + source.SubscriptionPurchaseCount,
			"wechat_id":                   source.WeChatId, // 无条件继承：用户就是为了绑这个微信来合并的
		}
		// 其它三方 ID 仅在 target 为空时继承，不要覆盖用户已有的绑定。
		if target.GitHubId == "" && source.GitHubId != "" {
			updates["github_id"] = source.GitHubId
		}
		if target.DiscordId == "" && source.DiscordId != "" {
			updates["discord_id"] = source.DiscordId
		}
		if target.OidcId == "" && source.OidcId != "" {
			updates["oidc_id"] = source.OidcId
		}
		if target.TelegramId == "" && source.TelegramId != "" {
			updates["telegram_id"] = source.TelegramId
		}
		if target.LinuxDOId == "" && source.LinuxDOId != "" {
			updates["linux_do_id"] = source.LinuxDOId
		}
		if target.StripeCustomer == "" && source.StripeCustomer != "" {
			updates["stripe_customer"] = source.StripeCustomer
		}

		// PostgreSQL checks the partial unique indexes on github_id/...
		// immediately. Clear source's identities before target inherits them,
		// otherwise the target update collides with the still-live source row.
		if err := clearSourceExternalIdentitiesForMerge(tx, sourceId); err != nil {
			return fmt.Errorf("清空源账户第三方身份失败: %w", err)
		}

		if err := WithTenantBypass(tx).Unscoped().Model(&User{}).
			Where("id = ?", targetId).
			Updates(updates).Error; err != nil {
			return fmt.Errorf("更新目标账户失败: %w", err)
		}

		// —— 源账户：清敏感字段、标记合并、软删 ——
		// wechat_id 必须先清空，否则下次有人登录同 openid 会撞上"已被绑定"
		// （IsWeChatIdAlreadyTaken 是 Unscoped 查询，软删也算）。
		if err := WithTenantBypass(tx).Unscoped().Model(&User{}).
			Where("id = ?", sourceId).
			Updates(map[string]interface{}{
				"wechat_id":       "",
				"github_id":       "",
				"discord_id":      "",
				"oidc_id":         "",
				"telegram_id":     "",
				"linux_do_id":     "",
				"stripe_customer": "",
				"quota":           0,
				"aff_quota":       0,
				"status":          common.UserStatusDisabled,
				"merged_into":     targetId,
				"deleted_at":      gorm.DeletedAt{Time: time.Now(), Valid: true},
			}).Error; err != nil {
			return fmt.Errorf("标记源账户合并失败: %w", err)
		}

		// —— 审计记录 ——
		audit := &UserMergeLog{
			TenantId:          tenantId,
			SourceUserId:      sourceId,
			TargetUserId:      targetId,
			OperatorUserId:    operatorId,
			WeChatId:          source.WeChatId,
			MergedQuota:       source.Quota,
			MergedUsedQuota:   source.UsedQuota,
			SourceUsername:    source.Username,
			SourceDisplayName: source.DisplayName,
			SourceEmail:       source.Email,
			Reason:            reason,
		}
		if err := WithTenantBypass(tx).Create(audit).Error; err != nil {
			return fmt.Errorf("写审计失败: %w", err)
		}

		result.MergedQuota = source.Quota
		result.MergedUsedQuota = source.UsedQuota
		result.WeChatId = source.WeChatId
		return nil
	})
	if err != nil {
		return nil, err
	}

	// —— 事务外收尾 ——
	// 1) LOG_DB 可能独立库，这里不能走上面的主事务；失败不回滚（日志不致命）。
	if LOG_DB != nil {
		if logErr := LOG_DB.Exec(
			"UPDATE logs SET user_id = ? WHERE user_id = ?",
			targetId, sourceId,
		).Error; logErr != nil {
			common.SysLog(fmt.Sprintf("MergeUserInto: logs reassign warn: %v", logErr))
		}
	}

	// 2) Redis 缓存清理：source 的用户缓存失效；target 的也刷掉（强制重读）。
	_ = invalidateUserCache(sourceId)
	_ = invalidateUserCache(targetId)

	return &result, nil
}

// deleteConflictingCheckins 删除 source 在 target 已有签到日期的行，避免
// reassign 时撞 (user_id, checkin_date) 唯一约束。然后把剩下的 source 签到改到 target。
func deleteConflictingCheckins(tx *gorm.DB, tenantId, sourceId, targetId int) error {
	// SQLite / MySQL / Postgres 语法差异：用一个 subquery 的 DELETE 兜底
	// (user_id=source AND checkin_date IN (select checkin_date from checkins where user_id=target))
	// 各家都支持这种写法。
	if err := WithTenantBypass(tx).Exec(`
		DELETE FROM checkins
		WHERE user_id = ?
		  AND checkin_date IN (SELECT checkin_date FROM (
		      SELECT checkin_date FROM checkins WHERE user_id = ?
		  ) AS t)
	`, sourceId, targetId).Error; err != nil {
		return fmt.Errorf("清理冲突签到失败: %w", err)
	}
	if err := WithTenantBypass(tx).Exec(
		"UPDATE checkins SET user_id = ? WHERE user_id = ?",
		targetId, sourceId,
	).Error; err != nil {
		return fmt.Errorf("签到 reassign 失败: %w", err)
	}
	_ = tenantId // 保留参数占位，未来如需按租户过滤时直接用
	return nil
}

// moveUserUniqueRow 处理 user_id 唯一的表：source 有且 target 无 → reassign；
// 两者都有 → 删 source 行，保留 target。
func moveUserUniqueRow(tx *gorm.DB, table string, sourceId, targetId int) error {
	return moveUserUniqueColumnRow(tx, table, "user_id", sourceId, targetId)
}

func moveUserUniqueColumnRow(tx *gorm.DB, table, column string, sourceId, targetId int) error {
	hasColumn, err := tableHasColumn(tx, table, column)
	if err != nil || !hasColumn {
		return err
	}
	var targetCount int64
	if err := WithTenantBypass(tx).Table(table).
		Where(column+" = ?", targetId).Count(&targetCount).Error; err != nil {
		return err
	}
	if targetCount > 0 {
		return WithTenantBypass(tx).Exec(
			fmt.Sprintf("DELETE FROM %s WHERE %s = ?", table, column), sourceId,
		).Error
	}
	return WithTenantBypass(tx).Exec(
		fmt.Sprintf("UPDATE %s SET %s = ? WHERE %s = ?", table, column, column),
		targetId, sourceId,
	).Error
}

// moveOAuthBindings reassigns source OAuth bindings to target. If target
// already has the same provider_id, delete source's row first to avoid the
// (user_id, provider_id) unique key.
func moveOAuthBindings(tx *gorm.DB, sourceId, targetId int) error {
	var targetProviderIds []int
	if err := WithTenantBypass(tx).Table("user_oauth_bindings").
		Where("user_id = ?", targetId).
		Pluck("provider_id", &targetProviderIds).Error; err != nil {
		return err
	}
	if len(targetProviderIds) > 0 {
		if err := WithTenantBypass(tx).Exec(
			"DELETE FROM user_oauth_bindings WHERE user_id = ? AND provider_id IN ?",
			sourceId, targetProviderIds,
		).Error; err != nil {
			return err
		}
	}
	return WithTenantBypass(tx).Exec(
		"UPDATE user_oauth_bindings SET user_id = ? WHERE user_id = ?",
		targetId, sourceId,
	).Error
}

func clearSourceExternalIdentitiesForMerge(tx *gorm.DB, sourceId int) error {
	return WithTenantBypass(tx).Unscoped().Model(&User{}).
		Where("id = ?", sourceId).
		Updates(map[string]interface{}{
			"wechat_id":       "",
			"github_id":       "",
			"discord_id":      "",
			"oidc_id":         "",
			"telegram_id":     "",
			"linux_do_id":     "",
			"stripe_customer": "",
		}).Error
}

// reassignUserId moves user ownership for business tables. Some tables use
// sender_id/uploader_id/etc. instead of user_id, so keep those differences
// centralized here.
func reassignUserId(tx *gorm.DB, table string, sourceId, targetId int) error {
	switch table {
	case "ticket_replies":
		return reassignUserColumn(tx, table, "sender_id", sourceId, targetId)
	case "ticket_attachments", "invoice_uploads":
		return reassignUserColumn(tx, table, "uploader_id", sourceId, targetId)
	case "messages":
		if err := reassignUserColumn(tx, table, "target_user_id", sourceId, targetId); err != nil {
			return err
		}
		return reassignUserColumn(tx, table, "sender_id", sourceId, targetId)
	case "message_read_statuses":
		if err := deleteConflictingPairRows(tx, table, "user_id", "message_id", sourceId, targetId); err != nil {
			return err
		}
		return reassignUserColumn(tx, table, "user_id", sourceId, targetId)
	case "user_rebate_settings":
		return moveUserUniqueColumnRow(tx, table, "inviter_id", sourceId, targetId)
	case "aff_rebate_logs":
		if err := reassignUserColumn(tx, table, "user_id", sourceId, targetId); err != nil {
			return err
		}
		return reassignUserColumn(tx, table, "invitee_id", sourceId, targetId)
	default:
		return reassignUserColumn(tx, table, "user_id", sourceId, targetId)
	}
}

func reassignUserColumn(tx *gorm.DB, table, column string, sourceId, targetId int) error {
	hasColumn, err := tableHasColumn(tx, table, column)
	if err != nil || !hasColumn {
		return err
	}
	return WithTenantBypass(tx).Exec(
		fmt.Sprintf("UPDATE %s SET %s = ? WHERE %s = ?", table, column, column),
		targetId, sourceId,
	).Error
}

func deleteConflictingPairRows(tx *gorm.DB, table, userColumn, pairColumn string, sourceId, targetId int) error {
	hasUserColumn, err := tableHasColumn(tx, table, userColumn)
	if err != nil || !hasUserColumn {
		return err
	}
	hasPairColumn, err := tableHasColumn(tx, table, pairColumn)
	if err != nil || !hasPairColumn {
		return err
	}
	return WithTenantBypass(tx).Exec(
		fmt.Sprintf(`DELETE FROM %s
WHERE %s = ?
  AND %s IN (SELECT %s FROM (
      SELECT %s FROM %s WHERE %s = ?
  ) AS merge_conflicts)`,
			table, userColumn, pairColumn, pairColumn, pairColumn, table, userColumn),
		sourceId, targetId,
	).Error
}

func tableHasColumn(tx *gorm.DB, table, column string) (bool, error) {
	if tx == nil || table == "" || column == "" || !tx.Migrator().HasTable(table) {
		return false, nil
	}
	cols, err := tx.Migrator().ColumnTypes(table)
	if err != nil {
		return false, err
	}
	for _, col := range cols {
		if strings.EqualFold(col.Name(), column) {
			return true, nil
		}
	}
	return false, nil
}
