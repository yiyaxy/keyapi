package model

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/logger"

	"github.com/bytedance/gopkg/util/gopool"
	"gorm.io/gorm"
)

const UserNameMaxLength = 20

// User if you add sensitive fields, don't forget to clean them in setupLogin function.
// Otherwise, the sensitive information will be saved on local storage in plain text!
type User struct {
	Id                        int            `json:"id"`
	TenantId                  int            `json:"tenant_id" gorm:"index;not null;default:1"`
	Username                  string         `json:"username" gorm:"unique;index" validate:"max=20"`
	Password                  string         `json:"password" gorm:"not null;" validate:"min=8,max=20"`
	OriginalPassword          string         `json:"original_password" gorm:"-:all"` // this field is only for Password change verification, don't save it to database!
	DisplayName               string         `json:"display_name" gorm:"index" validate:"max=20"`
	Role                      int            `json:"role" gorm:"type:int;default:1"`   // admin, common
	Status                    int            `json:"status" gorm:"type:int;default:1"` // enabled, disabled
	Email                     string         `json:"email" gorm:"index" validate:"max=50"`
	GitHubId                  string         `json:"github_id" gorm:"column:github_id;index"`
	DiscordId                 string         `json:"discord_id" gorm:"column:discord_id;index"`
	OidcId                    string         `json:"oidc_id" gorm:"column:oidc_id;index"`
	WeChatId                  string         `json:"wechat_id" gorm:"column:wechat_id;index"`
	TelegramId                string         `json:"telegram_id" gorm:"column:telegram_id;index"`
	VerificationCode          string         `json:"verification_code" gorm:"-:all"`                      // this field is only for Email verification, don't save it to database!
	AccessToken               *string        `json:"access_token" gorm:"column:access_token;uniqueIndex"` // this token is for system management
	Quota                     int            `json:"quota" gorm:"type:int;default:0"`
	UsedQuota                 int            `json:"used_quota" gorm:"type:int;default:0;column:used_quota"` // used quota
	RequestCount              int            `json:"request_count" gorm:"type:int;default:0;"`               // request number
	Group                     string         `json:"group" gorm:"type:varchar(64);default:'default'"`
	AffCode                   string         `json:"aff_code" gorm:"type:varchar(32);column:aff_code;uniqueIndex"`
	AffCount                  int            `json:"aff_count" gorm:"type:int;default:0;column:aff_count"`
	AffQuota                  int            `json:"aff_quota" gorm:"type:int;default:0;column:aff_quota"`           // 邀请剩余额度
	AffHistoryQuota           int            `json:"aff_history_quota" gorm:"type:int;default:0;column:aff_history"` // 邀请历史额度
	InviterId                 int            `json:"inviter_id" gorm:"type:int;column:inviter_id;index"`
	TopUpCount                int            `json:"top_up_count" gorm:"type:int;default:0;column:top_up_count"` // 用户充值成功次数（用于计算返利）
	SubscriptionPurchaseCount int            `json:"subscription_purchase_count" gorm:"type:int;default:0;column:subscription_purchase_count"`
	DeletedAt                 gorm.DeletedAt `gorm:"index"`
	LinuxDOId                 string         `json:"linux_do_id" gorm:"column:linux_do_id;index"`
	Setting                   string         `json:"setting" gorm:"type:text;column:setting"`
	Remark                    string         `json:"remark,omitempty" gorm:"type:varchar(255)" validate:"max=255"`
	StripeCustomer            string         `json:"stripe_customer" gorm:"type:varchar(64);column:stripe_customer;index"`
	IpSet                     string         `json:"ip_set,omitempty" gorm:"type:text;column:ip_set;default:''"`
}

func (user *User) ToBaseUser() *UserBase {
	cache := &UserBase{
		Id:       user.Id,
		Group:    user.Group,
		Quota:    user.Quota,
		Status:   user.Status,
		Username: user.Username,
		Setting:  user.Setting,
		Email:    user.Email,
	}
	return cache
}

func (user *User) GetAccessToken() string {
	if user.AccessToken == nil {
		return ""
	}
	return *user.AccessToken
}

func (user *User) SetAccessToken(token string) {
	user.AccessToken = &token
}

func (user *User) GetSetting() dto.UserSetting {
	setting := dto.UserSetting{}
	if user.Setting != "" {
		err := json.Unmarshal([]byte(user.Setting), &setting)
		if err != nil {
			common.SysLog("failed to unmarshal setting: " + err.Error())
		}
	}
	return setting
}

func (user *User) SetSetting(setting dto.UserSetting) {
	settingBytes, err := json.Marshal(setting)
	if err != nil {
		common.SysLog("failed to marshal setting: " + err.Error())
		return
	}
	user.Setting = string(settingBytes)
}

// 根据用户角色生成默认的边栏配置
func generateDefaultSidebarConfigForRole(userRole int) string {
	defaultConfig := map[string]interface{}{}

	// 聊天区域 - 所有用户都可以访问
	defaultConfig["chat"] = map[string]interface{}{
		"enabled":    true,
		"playground": true,
		"chat":       true,
	}

	// 控制台区域 - 所有用户都可以访问
	defaultConfig["console"] = map[string]interface{}{
		"enabled":    true,
		"detail":     true,
		"token":      true,
		"log":        true,
		"midjourney": true,
		"task":       true,
	}

	// 个人中心区域 - 所有用户都可以访问
	defaultConfig["personal"] = map[string]interface{}{
		"enabled":  true,
		"topup":    true,
		"personal": true,
	}

	// 管理员区域 - 根据角色决定
	if userRole == common.RoleAdminUser {
		// 管理员可以访问管理员区域，但不能访问系统设置
		defaultConfig["admin"] = map[string]interface{}{
			"enabled":    true,
			"channel":    true,
			"models":     true,
			"redemption": true,
			"user":       true,
			"setting":    false, // 管理员不能访问系统设置
		}
	} else if userRole == common.RoleRootUser {
		// 超级管理员可以访问所有功能
		defaultConfig["admin"] = map[string]interface{}{
			"enabled":    true,
			"channel":    true,
			"models":     true,
			"redemption": true,
			"user":       true,
			"setting":    true,
		}
	}
	// 普通用户不包含admin区域

	// 转换为JSON字符串
	configBytes, err := json.Marshal(defaultConfig)
	if err != nil {
		common.SysLog("生成默认边栏配置失败: " + err.Error())
		return ""
	}

	return string(configBytes)
}

// CheckUserExistOrDeleted check if user exist or deleted, if not exist, return false, nil, if deleted or exist, return true, nil
func CheckUserExistOrDeleted(username string, email string, tenantId ...int) (bool, error) {
	var user User

	// err := DB.Unscoped().First(&user, "username = ? or email = ?", username, email).Error
	// check email if empty
	email = strings.ToLower(email)
	var err error
	query := DB.Unscoped()
	if len(tenantId) > 0 && tenantId[0] > 0 {
		query = query.Where("tenant_id = ?", tenantId[0])
	}
	if email == "" {
		err = query.First(&user, "username = ?", username).Error
	} else {
		// 邮箱转小写，确保大小写不敏感
		email = strings.ToLower(email)
		err = query.First(&user, "username = ? or LOWER(email) = ?", username, email).Error
	}
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			// not exist, return false, nil
			return false, nil
		}
		// other error, return false, err
		return false, err
	}
	// exist, return true, nil
	return true, nil
}

func fillUserByField(user *User, field string, value string, tenantId ...int) error {
	if value == "" {
		return errors.New(field + " is empty")
	}
	query := DB
	if len(tenantId) > 0 && tenantId[0] > 0 {
		query = query.Where("tenant_id = ?", tenantId[0])
	}
	if field == "email" {
		return query.Where("LOWER(email) = ?", strings.ToLower(value)).First(user).Error
	}
	return query.Where(field+" = ?", value).First(user).Error
}

func GetMaxUserId() int {
	var user User
	DB.Unscoped().Last(&user)
	return user.Id
}

func GetAllUsersByTenant(tenantId int, pageInfo *common.PageInfo) (users []*User, total int64, err error) {
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

	query := tx.Unscoped().Model(&User{})
	if tenantId > 0 {
		// Query via tenant_memberships to include users who are members but have a different home tenant_id
		query = query.Where("users.id IN (?)",
			tx.Model(&TenantMembership{}).Select("user_id").
				Where("tenant_id = ? AND status <> ?", tenantId, TenantMembershipStatusRemoved))
	}

	// Get total count within transaction
	err = query.Count(&total).Error
	if err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	// Get paginated users within same transaction
	err = query.Order("id desc").Limit(pageInfo.GetPageSize()).Offset(pageInfo.GetStartIdx()).Omit("password").Find(&users).Error
	if err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	// Commit transaction
	if err = tx.Commit().Error; err != nil {
		return nil, 0, err
	}

	return users, total, nil
}

func GetAllUsers(pageInfo *common.PageInfo) (users []*User, total int64, err error) {
	return GetAllUsersByTenant(0, pageInfo)
}

func SearchUsersByTenant(tenantId int, keyword string, group string, ip string, startIdx int, num int) ([]*User, int64, error) {
	var users []*User
	var total int64
	var err error

	// 开始事务
	tx := DB.Begin()
	if tx.Error != nil {
		return nil, 0, tx.Error
	}
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	// 构建基础查询
	query := tx.Unscoped().Model(&User{})
	if tenantId > 0 {
		// Query via tenant_memberships to include users who are members but have a different home tenant_id
		query = query.Where("users.id IN (?)",
			tx.Model(&TenantMembership{}).Select("user_id").
				Where("tenant_id = ? AND status <> ?", tenantId, TenantMembershipStatusRemoved))
	}

	// 构建搜索条件
	likeCondition := "username LIKE ? OR email LIKE ? OR display_name LIKE ?"

	// 尝试将关键字转换为整数ID
	keywordInt, err := strconv.Atoi(keyword)
	if err == nil {
		// 如果是数字，同时搜索ID和其他字段
		likeCondition = "id = ? OR " + likeCondition
		if group != "" {
			query = query.Where("("+likeCondition+") AND "+commonGroupCol+" = ?",
				keywordInt, "%"+keyword+"%", "%"+keyword+"%", "%"+keyword+"%", group)
		} else {
			query = query.Where(likeCondition,
				keywordInt, "%"+keyword+"%", "%"+keyword+"%", "%"+keyword+"%")
		}
	} else {
		// 非数字关键字，只搜索字符串字段
		if group != "" {
			query = query.Where("("+likeCondition+") AND "+commonGroupCol+" = ?",
				"%"+keyword+"%", "%"+keyword+"%", "%"+keyword+"%", group)
		} else {
			query = query.Where(likeCondition,
				"%"+keyword+"%", "%"+keyword+"%", "%"+keyword+"%")
		}
	}

	// IP 搜索条件
	if ip != "" {
		query = query.Where("ip_set LIKE ?", "%"+ip+"%")
	}

	// 获取总数
	err = query.Count(&total).Error
	if err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	// 获取分页数据
	err = query.Omit("password").Order("id desc").Limit(num).Offset(startIdx).Find(&users).Error
	if err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	// 提交事务
	if err = tx.Commit().Error; err != nil {
		return nil, 0, err
	}

	return users, total, nil
}

func SearchUsers(keyword string, group string, ip string, startIdx int, num int) ([]*User, int64, error) {
	return SearchUsersByTenant(0, keyword, group, ip, startIdx, num)
}

func GetUserById(id int, selectAll bool) (*User, error) {
	return GetUserByIdWithContext(context.Background(), id, selectAll)
}

func GetUserByIdWithContext(ctx context.Context, id int, selectAll bool) (*User, error) {
	if id == 0 {
		return nil, errors.New("id 为空！")
	}
	user := User{Id: id}
	q := DB
	if ctx != nil {
		q = DB.WithContext(ctx)
	}
	// Multi-tenant: scope by tenant when context carries tenant_id
	if tenantId := TenantIDFromContext(ctx); tenantId > 0 {
		q = q.Where("tenant_id = ?", tenantId)
	}
	var err error
	if selectAll {
		err = q.First(&user, "id = ?", id).Error
	} else {
		err = q.Omit("password").First(&user, "id = ?", id).Error
	}
	return &user, err
}

func GetUserIdByAffCode(affCode string) (int, error) {
	if affCode == "" {
		return 0, errors.New("affCode 为空！")
	}
	var user User
	err := DB.Select("id").First(&user, "aff_code = ?", affCode).Error
	return user.Id, err
}

func DeleteUserById(id int) (err error) {
	return DeleteUserByIdWithTenant(id, 0)
}

func DeleteUserByIdWithTenant(id int, tenantId int) (err error) {
	if id == 0 {
		return errors.New("id 为空！")
	}
	user := User{Id: id}
	if tenantId > 0 {
		user.TenantId = tenantId
	}
	return user.Delete()
}

func HardDeleteUserById(id int) error {
	return HardDeleteUserByIdWithTenant(id, 0)
}

func HardDeleteUserByIdWithTenant(id int, tenantId int) error {
	if id == 0 {
		return errors.New("id 为空！")
	}
	query := DB.Unscoped().Where("id = ?", id)
	if tenantId > 0 {
		query = query.Where("tenant_id = ?", tenantId)
	}
	err := query.Delete(&User{}).Error
	return err
}

func inviteUser(inviterId int, registerReward int) (err error) {
	user, err := GetUserById(inviterId, true)
	if err != nil {
		return err
	}
	user.AffCount++
	user.AffQuota += registerReward
	user.AffHistoryQuota += registerReward
	return DB.Save(user).Error
}

func (user *User) TransferAffQuotaToQuota(quota int) error {
	// 检查quota是否小于最小额度
	if float64(quota) < common.QuotaPerUnit {
		return fmt.Errorf("转移额度最小为%s！", logger.LogQuota(int(common.QuotaPerUnit)))
	}

	// 开始数据库事务
	tx := DB.Begin()
	if tx.Error != nil {
		return tx.Error
	}
	defer tx.Rollback() // 确保在函数退出时事务能回滚

	// 加锁查询用户以确保数据一致性
	err := tx.Set("gorm:query_option", "FOR UPDATE").First(&user, user.Id).Error
	if err != nil {
		return err
	}

	// 再次检查用户的AffQuota是否足够
	if user.AffQuota < quota {
		return errors.New("邀请额度不足！")
	}

	// 更新用户额度
	user.AffQuota -= quota
	user.Quota += quota

	// 保存用户状态
	if err := tx.Save(user).Error; err != nil {
		return err
	}

	// 提交事务
	return tx.Commit().Error
}

func (user *User) Insert(inviterId int) error {
	var err error
	if user.Password != "" {
		user.Password, err = common.Password2Hash(user.Password)
		if err != nil {
			return err
		}
	}
	user.Quota = common.QuotaForNewUser
	//user.SetAccessToken(common.GetUUID())
	user.AffCode = common.GetRandomString(4)

	// 初始化用户设置，包括默认的边栏配置
	if user.Setting == "" {
		defaultSetting := dto.UserSetting{}
		// 这里暂时不设置SidebarModules，因为需要在用户创建后根据角色设置
		user.SetSetting(defaultSetting)
	}

	result := DB.Create(user)
	if result.Error != nil {
		return result.Error
	}

	// 用户创建成功后，根据角色初始化边栏配置
	// 需要重新获取用户以确保有正确的ID和Role
	var createdUser User
	if err := WithTenantBypass(DB).Where("username = ?", user.Username).First(&createdUser).Error; err == nil {
		// 生成基于角色的默认边栏配置
		defaultSidebarConfig := generateDefaultSidebarConfigForRole(createdUser.Role)
		if defaultSidebarConfig != "" {
			currentSetting := createdUser.GetSetting()
			currentSetting.SidebarModules = defaultSidebarConfig
			createdUser.SetSetting(currentSetting)
			createdUser.Update(false)
			common.SysLog(fmt.Sprintf("为新用户 %s (角色: %d) 初始化边栏配置", createdUser.Username, createdUser.Role))
		}
	}

	if common.QuotaForNewUser > 0 {
		RecordLogWithTenant(user.TenantId, user.Id, LogTypeSystem, fmt.Sprintf("新用户注册赠送 %s", logger.LogQuota(common.QuotaForNewUser)))
	}
	if inviterId != 0 {
		rebateSetting := GetEffectiveRebateSetting(inviterId)
		if rebateSetting.InviteeReward > 0 {
			_ = IncreaseUserQuota(user.Id, rebateSetting.InviteeReward, true, user.TenantId)
			RecordLogWithTenant(user.TenantId, user.Id, LogTypeSystem, fmt.Sprintf("使用邀请码赠送 %s", logger.LogQuota(rebateSetting.InviteeReward)))
		}
		if rebateSetting.RegisterReward > 0 {
			RecordLogWithTenant(user.TenantId, inviterId, LogTypeSystem, fmt.Sprintf("邀请用户赠送 %s", logger.LogQuota(rebateSetting.RegisterReward)))
			_ = inviteUser(inviterId, rebateSetting.RegisterReward)
			CreateAffRebateLog(&AffRebateLog{
				UserId:      inviterId,
				InviteeId:   user.Id,
				InviteeName: user.Username,
				Type:        AffRebateTypeRegister,
				Quota:       rebateSetting.RegisterReward,
				Remark:      fmt.Sprintf("邀请注册奖励 %s", logger.LogQuota(rebateSetting.RegisterReward)),
			})
		}
	}
	return nil
}

// InsertWithTx inserts a new user within an existing transaction.
// This is used for OAuth registration where user creation and binding need to be atomic.
// Post-creation tasks (sidebar config, logs, inviter rewards) are handled after the transaction commits.
func (user *User) InsertWithTx(tx *gorm.DB, inviterId int) error {
	var err error
	if user.Password != "" {
		user.Password, err = common.Password2Hash(user.Password)
		if err != nil {
			return err
		}
	}
	user.Quota = common.QuotaForNewUser
	user.AffCode = common.GetRandomString(4)

	// 初始化用户设置
	if user.Setting == "" {
		defaultSetting := dto.UserSetting{}
		user.SetSetting(defaultSetting)
	}

	result := tx.Create(user)
	if result.Error != nil {
		return result.Error
	}

	return nil
}

// FinalizeOAuthUserCreation performs post-transaction tasks for OAuth user creation.
// This should be called after the transaction commits successfully.
func (user *User) FinalizeOAuthUserCreation(inviterId int) {
	// 用户创建成功后，根据角色初始化边栏配置
	var createdUser User
	if err := WithTenantBypass(DB).Where("id = ?", user.Id).First(&createdUser).Error; err == nil {
		defaultSidebarConfig := generateDefaultSidebarConfigForRole(createdUser.Role)
		if defaultSidebarConfig != "" {
			currentSetting := createdUser.GetSetting()
			currentSetting.SidebarModules = defaultSidebarConfig
			createdUser.SetSetting(currentSetting)
			createdUser.Update(false)
			common.SysLog(fmt.Sprintf("为新用户 %s (角色: %d) 初始化边栏配置", createdUser.Username, createdUser.Role))
		}
	}

	if common.QuotaForNewUser > 0 {
		RecordLogWithTenant(user.TenantId, user.Id, LogTypeSystem, fmt.Sprintf("新用户注册赠送 %s", logger.LogQuota(common.QuotaForNewUser)))
	}
	if inviterId != 0 {
		if common.QuotaForInvitee > 0 {
			_ = IncreaseUserQuota(user.Id, common.QuotaForInvitee, true, user.TenantId)
			RecordLogWithTenant(user.TenantId, user.Id, LogTypeSystem, fmt.Sprintf("使用邀请码赠送 %s", logger.LogQuota(common.QuotaForInvitee)))
		}
		if common.QuotaForInviter > 0 {
			RecordLogWithTenant(user.TenantId, inviterId, LogTypeSystem, fmt.Sprintf("邀请用户赠送 %s", logger.LogQuota(common.QuotaForInviter)))
			_ = inviteUser(inviterId, common.QuotaForInviter)
		}
	}
}

func (user *User) Update(updatePassword bool) error {
	var err error
	if updatePassword {
		user.Password, err = common.Password2Hash(user.Password)
		if err != nil {
			return err
		}
	}
	newUser := *user
	query := DB.Where("id = ?", user.Id)
	if user.TenantId > 0 {
		query = query.Where("tenant_id = ?", user.TenantId)
	}
	if err = query.First(user).Error; err != nil {
		return err
	}
	if err = DB.Model(user).Updates(newUser).Error; err != nil {
		return err
	}

	// Update cache
	return updateUserCache(*user)
}

func (user *User) Edit(updatePassword bool) error {
	var err error
	if updatePassword {
		user.Password, err = common.Password2Hash(user.Password)
		if err != nil {
			return err
		}
	}

	newUser := *user
	updates := map[string]interface{}{
		"username":     newUser.Username,
		"display_name": newUser.DisplayName,
		"group":        newUser.Group,
		"quota":        newUser.Quota,
		"remark":       newUser.Remark,
	}
	if updatePassword {
		updates["password"] = newUser.Password
	}

	query := DB.Where("id = ?", user.Id)
	if user.TenantId > 0 {
		query = query.Where("tenant_id = ?", user.TenantId)
	}
	if err = query.First(user).Error; err != nil {
		return err
	}
	if err = DB.Model(user).Updates(updates).Error; err != nil {
		return err
	}

	// Update cache
	return updateUserCache(*user)
}

func (user *User) ClearBinding(bindingType string) error {
	if user.Id == 0 {
		return errors.New("user id is empty")
	}

	bindingColumnMap := map[string]string{
		"email":    "email",
		"github":   "github_id",
		"discord":  "discord_id",
		"oidc":     "oidc_id",
		"wechat":   "wechat_id",
		"telegram": "telegram_id",
		"linuxdo":  "linux_do_id",
	}

	column, ok := bindingColumnMap[bindingType]
	if !ok {
		return errors.New("invalid binding type")
	}

	query := DB.Model(&User{}).Where("id = ?", user.Id)
	if user.TenantId > 0 {
		query = query.Where("tenant_id = ?", user.TenantId)
	}
	if err := query.Update(column, "").Error; err != nil {
		return err
	}

	refetch := DB.Where("id = ?", user.Id)
	if user.TenantId > 0 {
		refetch = refetch.Where("tenant_id = ?", user.TenantId)
	}
	if err := refetch.First(user).Error; err != nil {
		return err
	}

	return updateUserCache(*user)
}

func (user *User) Delete() error {
	if user.Id == 0 {
		return errors.New("id 为空！")
	}
	query := DB.Where("id = ?", user.Id)
	if user.TenantId > 0 {
		query = query.Where("tenant_id = ?", user.TenantId)
	}
	if err := query.Delete(user).Error; err != nil {
		return err
	}

	// 清除缓存
	return invalidateUserCache(user.Id)
}

func (user *User) HardDelete() error {
	if user.Id == 0 {
		return errors.New("id 为空！")
	}
	query := DB.Unscoped().Where("id = ?", user.Id)
	if user.TenantId > 0 {
		query = query.Where("tenant_id = ?", user.TenantId)
	}
	err := query.Delete(user).Error
	return err
}

// ValidateAndFill check password & user status
func (user *User) ValidateAndFill() (err error) {
	// When querying with struct, GORM will only query with non-zero fields,
	// that means if your field's value is 0, '', false or other zero values,
	// it won't be used to build query conditions
	password := user.Password
	username := strings.TrimSpace(user.Username)
	if username == "" || password == "" {
		return errors.New("用户名或密码为空")
	}
	// find by username or email (邮箱大小写不敏感)
	DB.Where("username = ? OR LOWER(email) = ?", username, strings.ToLower(username)).First(user)
	okay := common.ValidatePasswordAndHash(password, user.Password)
	if !okay || user.Status != common.UserStatusEnabled {
		return errors.New("用户名或密码错误，或用户已被封禁")
	}
	return nil
}

func (user *User) ValidateAndFillWithTenant(tenantId int) (err error) {
	err = user.ValidateAndFill()
	if err != nil {
		return err
	}
	if tenantId <= 0 {
		return nil
	}
	if !TenantMembershipAllowsAccess(user, tenantId) {
		return errors.New("用户不属于当前租户或成员已被禁用")
	}
	return nil
}

func (user *User) FillUserById() error {
	if user.Id == 0 {
		return errors.New("id 为空！")
	}
	DB.Where(User{Id: user.Id}).First(user)
	return nil
}

func (user *User) FillUserByEmail() error {
	return user.FillUserByEmailWithTenant(0)
}

func (user *User) FillUserByEmailWithTenant(tenantId int) error {
	if user.Email == "" {
		return errors.New("email 为空！")
	}
	return fillUserByField(user, "email", user.Email, tenantId)
}

func (user *User) FillUserByGitHubId() error {
	return user.FillUserByGitHubIdWithTenant(0)
}

func (user *User) FillUserByGitHubIdWithTenant(tenantId int) error {
	if user.GitHubId == "" {
		return errors.New("GitHub id 为空！")
	}
	return fillUserByField(user, "github_id", user.GitHubId, tenantId)
}

// UpdateGitHubId updates the user's GitHub ID (used for migration from login to numeric ID)
func (user *User) UpdateGitHubId(newGitHubId string) error {
	if user.Id == 0 {
		return errors.New("user id is empty")
	}
	return DB.Model(user).Update("github_id", newGitHubId).Error
}

func (user *User) FillUserByDiscordId() error {
	return user.FillUserByDiscordIdWithTenant(0)
}

func (user *User) FillUserByDiscordIdWithTenant(tenantId int) error {
	if user.DiscordId == "" {
		return errors.New("discord id 为空！")
	}
	return fillUserByField(user, "discord_id", user.DiscordId, tenantId)
}

func (user *User) FillUserByOidcId() error {
	return user.FillUserByOidcIdWithTenant(0)
}

func (user *User) FillUserByOidcIdWithTenant(tenantId int) error {
	if user.OidcId == "" {
		return errors.New("oidc id 为空！")
	}
	return fillUserByField(user, "oidc_id", user.OidcId, tenantId)
}

func (user *User) FillUserByWeChatId() error {
	return user.FillUserByWeChatIdWithTenant(0)
}

func (user *User) FillUserByWeChatIdWithTenant(tenantId int) error {
	if user.WeChatId == "" {
		return errors.New("WeChat id 为空！")
	}
	return fillUserByField(user, "wechat_id", user.WeChatId, tenantId)
}

func (user *User) FillUserByTelegramId() error {
	return user.FillUserByTelegramIdWithTenant(0)
}

func (user *User) FillUserByTelegramIdWithTenant(tenantId int) error {
	if user.TelegramId == "" {
		return errors.New("Telegram id 为空！")
	}
	err := fillUserByField(user, "telegram_id", user.TelegramId, tenantId)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return errors.New("该 Telegram 账户未绑定")
	}
	return nil
}

func IsEmailAlreadyTaken(email string, tenantId ...int) bool {
	// 邮箱大小写不敏感，使用 > 0 以处理可能存在的重复数据
	query := DB.Unscoped().Where("LOWER(email) = ?", strings.ToLower(email))
	if len(tenantId) > 0 && tenantId[0] > 0 {
		query = query.Where("tenant_id = ?", tenantId[0])
	}
	return query.Find(&User{}).RowsAffected > 0
}

func ResetUserPasswordByEmail(email string, password string, tenantId int) error {
	if email == "" || password == "" {
		return errors.New("邮箱地址或密码为空！")
	}
	normalizedEmail := strings.ToLower(email)
	q := DB.Model(&User{}).Where("LOWER(email) = ?", normalizedEmail)
	if tenantId > 0 {
		q = q.Where("tenant_id = ?", tenantId)
	}
	var count int64
	if err := q.Count(&count).Error; err != nil {
		return fmt.Errorf("查询邮箱失败: %w", err)
	}
	if count == 0 {
		return errors.New("该邮箱地址未注册")
	}
	if count > 1 {
		return errors.New("存在多个相同邮箱的账户，请联系管理员处理")
	}
	hashedPassword, err := common.Password2Hash(password)
	if err != nil {
		return err
	}
	uq := DB.Model(&User{}).Where("LOWER(email) = ?", normalizedEmail)
	if tenantId > 0 {
		uq = uq.Where("tenant_id = ?", tenantId)
	}
	return uq.Update("password", hashedPassword).Error
}

func IsAdmin(userId int) bool {
	if userId == 0 {
		return false
	}
	var user User
	err := DB.Where("id = ?", userId).Select("role").Find(&user).Error
	if err != nil {
		common.SysLog("no such user " + err.Error())
		return false
	}
	return user.Role >= common.RoleAdminUser
}

//// IsUserEnabled checks user status from Redis first, falls back to DB if needed
//func IsUserEnabled(id int, fromDB bool) (status bool, err error) {
//	defer func() {
//		// Update Redis cache asynchronously on successful DB read
//		if shouldUpdateRedis(fromDB, err) {
//			gopool.Go(func() {
//				if err := updateUserStatusCache(id, status); err != nil {
//					common.SysError("failed to update user status cache: " + err.Error())
//				}
//			})
//		}
//	}()
//	if !fromDB && common.RedisEnabled {
//		// Try Redis first
//		status, err := getUserStatusCache(id)
//		if err == nil {
//			return status == common.UserStatusEnabled, nil
//		}
//		// Don't return error - fall through to DB
//	}
//	fromDB = true
//	var user User
//	err = DB.Where("id = ?", id).Select("status").Find(&user).Error
//	if err != nil {
//		return false, err
//	}
//
//	return user.Status == common.UserStatusEnabled, nil
//}

func ValidateAccessToken(token string) (user *User) {
	return ValidateAccessTokenWithTenant(token, 0)
}

// ValidateAccessTokenWithTenant validates an access token, optionally scoped to a tenant.
// tenantId=0 means no tenant filtering (backward compatible).
func ValidateAccessTokenWithTenant(token string, tenantId int) (user *User) {
	if token == "" {
		return nil
	}
	token = strings.Replace(token, "Bearer ", "", 1)
	user = &User{}
	q := DB.Where("access_token = ?", token)
	if tenantId > 0 {
		q = q.Where("tenant_id = ?", tenantId)
	}
	if q.First(user).RowsAffected == 1 {
		return user
	}
	return nil
}

// GetUserQuota gets quota from Redis first, falls back to DB if needed
func GetUserQuota(id int, fromDB bool, tenantId ...int) (quota int, err error) {
	defer func() {
		// Update Redis cache asynchronously on successful DB read
		if shouldUpdateRedis(fromDB, err) {
			gopool.Go(func() {
				if err := updateUserQuotaCache(id, quota); err != nil {
					common.SysLog("failed to update user quota cache: " + err.Error())
				}
			})
		}
	}()
	if !fromDB && common.RedisEnabled {
		quota, err := getUserQuotaCache(id)
		if err == nil {
			return quota, nil
		}
		// Don't return error - fall through to DB
	}
	fromDB = true
	query := DB.Model(&User{}).Where("id = ?", id)
	if len(tenantId) > 0 && tenantId[0] > 0 {
		query = query.Where("tenant_id = ?", tenantId[0])
	}
	err = query.Select("quota").Find(&quota).Error
	if err != nil {
		return 0, err
	}

	return quota, nil
}

func GetUserUsedQuota(id int) (quota int, err error) {
	err = DB.Model(&User{}).Where("id = ?", id).Select("used_quota").Find(&quota).Error
	return quota, err
}

func GetUserEmail(id int) (email string, err error) {
	err = DB.Model(&User{}).Where("id = ?", id).Select("email").Find(&email).Error
	return email, err
}

// GetUserGroup gets group from Redis first, falls back to DB if needed
func GetUserGroup(id int, fromDB bool) (group string, err error) {
	defer func() {
		// Update Redis cache asynchronously on successful DB read
		if shouldUpdateRedis(fromDB, err) {
			gopool.Go(func() {
				if err := updateUserGroupCache(id, group); err != nil {
					common.SysLog("failed to update user group cache: " + err.Error())
				}
			})
		}
	}()
	if !fromDB && common.RedisEnabled {
		group, err := getUserGroupCache(id)
		if err == nil {
			return group, nil
		}
		// Don't return error - fall through to DB
	}
	fromDB = true
	err = DB.Model(&User{}).Where("id = ?", id).Select(commonGroupCol).Find(&group).Error
	if err != nil {
		return "", err
	}

	return group, nil
}

// GetUserSetting gets setting from Redis first, falls back to DB if needed
func GetUserSetting(id int, fromDB bool) (settingMap dto.UserSetting, err error) {
	var setting string
	defer func() {
		// Update Redis cache asynchronously on successful DB read
		if shouldUpdateRedis(fromDB, err) {
			gopool.Go(func() {
				if err := updateUserSettingCache(id, setting); err != nil {
					common.SysLog("failed to update user setting cache: " + err.Error())
				}
			})
		}
	}()
	if !fromDB && common.RedisEnabled {
		setting, err := getUserSettingCache(id)
		if err == nil {
			return setting, nil
		}
		// Don't return error - fall through to DB
	}
	fromDB = true
	// can be nil setting
	var safeSetting sql.NullString
	err = DB.Model(&User{}).Where("id = ?", id).Select("setting").Find(&safeSetting).Error
	if err != nil {
		return settingMap, err
	}
	if safeSetting.Valid {
		setting = safeSetting.String
	} else {
		setting = ""
	}
	userBase := &UserBase{
		Setting: setting,
	}
	return userBase.GetSetting(), nil
}

func IncreaseUserQuota(id int, quota int, db bool, tenantId ...int) (err error) {
	if quota < 0 {
		return errors.New("quota 不能为负数！")
	}
	gopool.Go(func() {
		err := cacheIncrUserQuota(id, int64(quota))
		if err != nil {
			common.SysLog("failed to increase user quota: " + err.Error())
		}
	})
	if !db && common.BatchUpdateEnabled {
		resolvedTenantId := 0
		if len(tenantId) > 0 {
			resolvedTenantId = tenantId[0]
		}
		addNewRecord(BatchUpdateTypeUserQuota, resolvedTenantId, id, quota)
		return nil
	}
	return increaseUserQuota(id, quota, tenantId...)
}

func increaseUserQuota(id int, quota int, tenantId ...int) (err error) {
	query := DB.Model(&User{}).Where("id = ?", id)
	if len(tenantId) > 0 && tenantId[0] > 0 {
		query = query.Where("tenant_id = ?", tenantId[0])
	}
	err = query.Update("quota", gorm.Expr("quota + ?", quota)).Error
	if err != nil {
		return err
	}
	return err
}

func DecreaseUserQuota(id int, quota int, tenantId ...int) (err error) {
	if quota < 0 {
		return errors.New("quota 不能为负数！")
	}
	gopool.Go(func() {
		err := cacheDecrUserQuota(id, int64(quota))
		if err != nil {
			common.SysLog("failed to decrease user quota: " + err.Error())
		}
	})
	if common.BatchUpdateEnabled {
		resolvedTenantId := 0
		if len(tenantId) > 0 {
			resolvedTenantId = tenantId[0]
		}
		addNewRecord(BatchUpdateTypeUserQuota, resolvedTenantId, id, -quota)
		return nil
	}
	return decreaseUserQuota(id, quota, tenantId...)
}

func decreaseUserQuota(id int, quota int, tenantId ...int) (err error) {
	query := DB.Model(&User{}).Where("id = ?", id)
	if len(tenantId) > 0 && tenantId[0] > 0 {
		query = query.Where("tenant_id = ?", tenantId[0])
	}
	err = query.Update("quota", gorm.Expr("quota - ?", quota)).Error
	if err != nil {
		return err
	}
	return err
}

func DeltaUpdateUserQuota(id int, delta int, tenantId ...int) (err error) {
	if delta == 0 {
		return nil
	}
	if delta > 0 {
		return IncreaseUserQuota(id, delta, false, tenantId...)
	} else {
		return DecreaseUserQuota(id, -delta, tenantId...)
	}
}

//func GetRootUserEmail() (email string) {
//	DB.Model(&User{}).Where("role = ?", common.RoleRootUser).Select("email").Find(&email)
//	return email
//}

func GetRootUser() (user *User) {
	WithTenantBypass(DB).Where("role = ?", common.RoleRootUser).First(&user)
	return user
}

func UpdateUserUsedQuotaAndRequestCount(id int, quota int, tenantId ...int) {
	if common.BatchUpdateEnabled {
		resolvedTenantId := 0
		if len(tenantId) > 0 {
			resolvedTenantId = tenantId[0]
		}
		addNewRecord(BatchUpdateTypeUsedQuota, resolvedTenantId, id, quota)
		addNewRecord(BatchUpdateTypeRequestCount, resolvedTenantId, id, 1)
		return
	}
	updateUserUsedQuotaAndRequestCount(id, quota, 1, tenantId...)
}

func updateUserUsedQuotaAndRequestCount(id int, quota int, count int, tenantId ...int) {
	query := DB.Model(&User{}).Where("id = ?", id)
	if len(tenantId) > 0 && tenantId[0] > 0 {
		query = query.Where("tenant_id = ?", tenantId[0])
	}
	err := query.Updates(
		map[string]interface{}{
			"used_quota":    gorm.Expr("used_quota + ?", quota),
			"request_count": gorm.Expr("request_count + ?", count),
		},
	).Error
	if err != nil {
		common.SysLog("failed to update user used quota and request count: " + err.Error())
		return
	}

	//// 更新缓存
	//if err := invalidateUserCache(id); err != nil {
	//	common.SysError("failed to invalidate user cache: " + err.Error())
	//}
}

func updateUserUsedQuota(id int, quota int, tenantId ...int) {
	query := DB.Model(&User{}).Where("id = ?", id)
	if len(tenantId) > 0 && tenantId[0] > 0 {
		query = query.Where("tenant_id = ?", tenantId[0])
	}
	err := query.Updates(
		map[string]interface{}{
			"used_quota": gorm.Expr("used_quota + ?", quota),
		},
	).Error
	if err != nil {
		common.SysLog("failed to update user used quota: " + err.Error())
	}
}

func updateUserRequestCount(id int, count int, tenantId ...int) {
	query := DB.Model(&User{}).Where("id = ?", id)
	if len(tenantId) > 0 && tenantId[0] > 0 {
		query = query.Where("tenant_id = ?", tenantId[0])
	}
	err := query.Update("request_count", gorm.Expr("request_count + ?", count)).Error
	if err != nil {
		common.SysLog("failed to update user request count: " + err.Error())
	}
}

// GetUsernameById gets username from Redis first, falls back to DB if needed
func GetUsernameById(id int, fromDB bool) (username string, err error) {
	defer func() {
		// Update Redis cache asynchronously on successful DB read
		if shouldUpdateRedis(fromDB, err) {
			gopool.Go(func() {
				if err := updateUserNameCache(id, username); err != nil {
					common.SysLog("failed to update user name cache: " + err.Error())
				}
			})
		}
	}()
	if !fromDB && common.RedisEnabled {
		username, err := getUserNameCache(id)
		if err == nil {
			return username, nil
		}
		// Don't return error - fall through to DB
	}
	fromDB = true
	err = DB.Model(&User{}).Where("id = ?", id).Select("username").Find(&username).Error
	if err != nil {
		return "", err
	}

	return username, nil
}

func IsLinuxDOIdAlreadyTaken(linuxDOId string, tenantId ...int) bool {
	var user User
	query := DB.Unscoped().Where("linux_do_id = ?", linuxDOId)
	if len(tenantId) > 0 && tenantId[0] > 0 {
		query = query.Where("tenant_id = ?", tenantId[0])
	}
	err := query.First(&user).Error
	return !errors.Is(err, gorm.ErrRecordNotFound)
}

func IsGitHubIdAlreadyTaken(githubId string, tenantId ...int) bool {
	var user User
	query := DB.Unscoped().Where("github_id = ?", githubId)
	if len(tenantId) > 0 && tenantId[0] > 0 {
		query = query.Where("tenant_id = ?", tenantId[0])
	}
	err := query.First(&user).Error
	return !errors.Is(err, gorm.ErrRecordNotFound)
}

func IsDiscordIdAlreadyTaken(discordId string, tenantId ...int) bool {
	var user User
	query := DB.Unscoped().Where("discord_id = ?", discordId)
	if len(tenantId) > 0 && tenantId[0] > 0 {
		query = query.Where("tenant_id = ?", tenantId[0])
	}
	err := query.First(&user).Error
	return !errors.Is(err, gorm.ErrRecordNotFound)
}

func IsOidcIdAlreadyTaken(oidcId string, tenantId ...int) bool {
	var user User
	query := DB.Unscoped().Where("oidc_id = ?", oidcId)
	if len(tenantId) > 0 && tenantId[0] > 0 {
		query = query.Where("tenant_id = ?", tenantId[0])
	}
	err := query.First(&user).Error
	return !errors.Is(err, gorm.ErrRecordNotFound)
}

func IsTelegramIdAlreadyTaken(telegramId string, tenantId ...int) bool {
	var user User
	query := DB.Unscoped().Where("telegram_id = ?", telegramId)
	if len(tenantId) > 0 && tenantId[0] > 0 {
		query = query.Where("tenant_id = ?", tenantId[0])
	}
	err := query.First(&user).Error
	return !errors.Is(err, gorm.ErrRecordNotFound)
}

func IsWeChatIdAlreadyTaken(wechatId string, tenantId ...int) bool {
	var user User
	query := DB.Unscoped().Where("wechat_id = ?", wechatId)
	if len(tenantId) > 0 && tenantId[0] > 0 {
		query = query.Where("tenant_id = ?", tenantId[0])
	}
	err := query.First(&user).Error
	return !errors.Is(err, gorm.ErrRecordNotFound)
}

func (user *User) FillUserByLinuxDOId() error {
	return user.FillUserByLinuxDOIdWithTenant(0)
}

func (user *User) FillUserByLinuxDOIdWithTenant(tenantId int) error {
	if user.LinuxDOId == "" {
		return errors.New("linux do id is empty")
	}
	err := fillUserByField(user, "linux_do_id", user.LinuxDOId, tenantId)
	return err
}

var ipSetLocks sync.Map // key: int(userId), value: *sync.Mutex

// AddIpToUserSet appends an IP to the user's ip_set if not already present.
func AddIpToUserSet(userId int, ip string) {
	if userId == 0 || ip == "" {
		return
	}
	// Per-user lock to prevent concurrent read-modify-write race
	lockI, _ := ipSetLocks.LoadOrStore(userId, &sync.Mutex{})
	mu := lockI.(*sync.Mutex)
	mu.Lock()
	defer mu.Unlock()
	var currentSet string
	err := DB.Model(&User{}).Where("id = ?", userId).Select("ip_set").Scan(&currentSet).Error
	if err != nil {
		common.SysError(fmt.Sprintf("failed to read ip_set for user %d: %v", userId, err))
		return
	}
	// Check if IP already exists
	if currentSet != "" {
		for _, existing := range strings.Split(currentSet, ",") {
			if existing == ip {
				return
			}
		}
		currentSet = currentSet + "," + ip
	} else {
		currentSet = ip
	}
	err = DB.Model(&User{}).Where("id = ?", userId).Update("ip_set", currentSet).Error
	if err != nil {
		common.SysError(fmt.Sprintf("failed to update ip_set for user %d: %v", userId, err))
	}
}

func RootUserExists() bool {
	var user User
	err := WithTenantBypass(DB).Where("role = ?", common.RoleRootUser).First(&user).Error
	if err != nil {
		return false
	}
	return true
}
