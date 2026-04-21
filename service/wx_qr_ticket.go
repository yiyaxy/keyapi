package service

import (
	"errors"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
)

// Ticket lifecycle for WeChat mini-program scan-to-login:
//   1. Web calls /api/oauth/wx_qr/ticket → CreateWxQrTicket(tenantId)
//      Server generates random ticket, status = "pending", stores with 120s TTL.
//   2. Web polls /api/oauth/wx_qr/poll?ticket=...  → GetWxQrTicket
//   3. Mini-program (after wx.login) calls /api/oauth/wx_qr/confirm  → ConfirmWxQrTicket(userId)
//   4. Web then calls /api/oauth/wx_qr/login  → ConsumeWxQrTicket (one-shot)

const (
	WxQrTicketTTLSeconds = 120
	WxQrTicketKeyPrefix  = "wxmini:qr:"

	WxQrStatusPending         = "pending"
	WxQrStatusConfirmed       = "confirmed"        // 登录场景确认；或绑定场景无冲突直接完成
	WxQrStatusMergeRequired   = "merge_required"   // 绑定场景：扫到的微信已绑另一个账户，待 PC 侧二次确认合并

	// WxQrPurposeLogin: 未登录态扫码登录（现有流程）
	WxQrPurposeLogin = "login"
	// WxQrPurposeBind: 已登录态扫码绑定微信到当前账户
	WxQrPurposeBind = "bind"
)

type WxQrTicket struct {
	Ticket    string `json:"ticket"`
	Status    string `json:"status"`
	Purpose   string `json:"purpose"` // "login" | "bind"; 旧 ticket 无此字段时视为 login
	TenantId  int    `json:"tenant_id"`
	// UserId:
	//   - login 场景：小程序确认后写入，PC 登录端消费；
	//   - bind 场景：ticket 创建时就写入（发起绑定的 PC 账户）。
	UserId int `json:"user_id,omitempty"`
	// MergeCandidateUserId: 绑定场景专用。小程序扫完后若发现该微信已被
	// 另一个账户（同租户）占用，把那个账户 id 写在这里，等 PC 弹窗让用户
	// 确认「合并并绑定」。非绑定场景此字段为 0。
	MergeCandidateUserId int   `json:"merge_candidate_user_id,omitempty"`
	// MergeCandidateOpenId: 被冲突的微信 openid（带 wxmini: 前缀）。finalize
	// 合并成功后要把它写到 target.WeChatId——但 source 清空之前它就在 source 上，
	// 所以缓存在 ticket 里避免 finalize 还得再 jscode2session 一次。
	MergeCandidateOpenId string `json:"merge_candidate_open_id,omitempty"`
	CreatedAt            int64  `json:"created_at"`
}

// in-memory store (used when RedisEnabled == false)
var (
	memTicketsMu sync.Mutex
	memTickets   = map[string]memTicket{}
)

type memTicket struct {
	data   WxQrTicket
	expire time.Time
}

func memTicketsPut(key string, t WxQrTicket, ttl time.Duration) {
	memTicketsMu.Lock()
	defer memTicketsMu.Unlock()
	memTickets[key] = memTicket{data: t, expire: time.Now().Add(ttl)}
	// Lazy eviction of expired entries on every write keeps the map bounded
	// without needing a background goroutine. Ticket TTL is 120s and
	// throughput is low, so a linear sweep is fine.
	for k, v := range memTickets {
		if time.Now().After(v.expire) {
			delete(memTickets, k)
		}
	}
}

func memTicketsGet(key string) (WxQrTicket, bool) {
	memTicketsMu.Lock()
	defer memTicketsMu.Unlock()
	v, ok := memTickets[key]
	if !ok {
		return WxQrTicket{}, false
	}
	if time.Now().After(v.expire) {
		delete(memTickets, key)
		return WxQrTicket{}, false
	}
	return v.data, true
}

func memTicketsDel(key string) {
	memTicketsMu.Lock()
	defer memTicketsMu.Unlock()
	delete(memTickets, key)
}

// CreateWxQrTicket allocates a new pending ticket scoped to the given tenant
// for the login (unauthenticated) flow.
func CreateWxQrTicket(tenantId int) (*WxQrTicket, error) {
	return createWxQrTicket(tenantId, WxQrPurposeLogin, 0)
}

// CreateWxQrBindTicket 发起"绑定微信"的扫码会话：ticket 里直接写死
// initiatorUserId（当前 PC 登录账户），扫码确认时校验租户一致性。
func CreateWxQrBindTicket(tenantId int, initiatorUserId int) (*WxQrTicket, error) {
	if initiatorUserId <= 0 {
		return nil, errors.New("需要登录后才能绑定微信")
	}
	return createWxQrTicket(tenantId, WxQrPurposeBind, initiatorUserId)
}

func createWxQrTicket(tenantId int, purpose string, userId int) (*WxQrTicket, error) {
	// 16 random chars (lowercase alnum by GetRandomString) → ~95 bits of entropy,
	// well under WeChat's 32-char scene limit.
	ticket := common.GetRandomString(16)
	t := WxQrTicket{
		Ticket:    ticket,
		Status:    WxQrStatusPending,
		Purpose:   purpose,
		TenantId:  tenantId,
		UserId:    userId,
		CreatedAt: time.Now().Unix(),
	}
	if err := saveWxQrTicket(&t); err != nil {
		return nil, err
	}
	return &t, nil
}

// UpdateWxQrTicket 原子地覆盖现有 ticket（保持 TTL 从创建时起算的剩余部分）。
// 调用方已从 Get 拿到 ticket 并做了状态迁移，这里负责持久化。
func UpdateWxQrTicket(t *WxQrTicket) error {
	if t == nil || t.Ticket == "" {
		return errors.New("ticket 为空")
	}
	return saveWxQrTicket(t)
}

func saveWxQrTicket(t *WxQrTicket) error {
	key := WxQrTicketKeyPrefix + t.Ticket
	ttl := time.Duration(WxQrTicketTTLSeconds) * time.Second
	if common.RedisEnabled {
		payload, err := common.Marshal(t)
		if err != nil {
			return err
		}
		return common.RedisSet(key, string(payload), ttl)
	}
	memTicketsPut(key, *t, ttl)
	return nil
}

// GetWxQrTicket returns nil when the ticket is missing or expired.
func GetWxQrTicket(ticket string) (*WxQrTicket, error) {
	if ticket == "" {
		return nil, errors.New("ticket 为空")
	}
	key := WxQrTicketKeyPrefix + ticket
	if common.RedisEnabled {
		val, err := common.RedisGet(key)
		if err != nil || val == "" {
			return nil, nil
		}
		var t WxQrTicket
		if err := common.UnmarshalJsonStr(val, &t); err != nil {
			return nil, err
		}
		return &t, nil
	}
	if v, ok := memTicketsGet(key); ok {
		return &v, nil
	}
	return nil, nil
}

// ConfirmWxQrTicket marks the ticket as confirmed and attaches the user id.
// Returns ErrWxQrTicketNotFound if ticket expired / missing.
func ConfirmWxQrTicket(ticket string, userId int) error {
	t, err := GetWxQrTicket(ticket)
	if err != nil {
		return err
	}
	if t == nil {
		return ErrWxQrTicketNotFound
	}
	if t.Status == WxQrStatusConfirmed {
		// Idempotent: same user may re-confirm but different user is a conflict.
		if t.UserId == userId {
			return nil
		}
		return ErrWxQrTicketAlreadyUsed
	}
	t.Status = WxQrStatusConfirmed
	t.UserId = userId
	return saveWxQrTicket(t)
}

// ConsumeWxQrTicket returns the confirmed ticket and deletes it in one shot,
// so a ticket can only complete a single web login.
func ConsumeWxQrTicket(ticket string) (*WxQrTicket, error) {
	t, err := GetWxQrTicket(ticket)
	if err != nil {
		return nil, err
	}
	if t == nil {
		return nil, ErrWxQrTicketNotFound
	}
	if t.Status != WxQrStatusConfirmed {
		return nil, ErrWxQrTicketNotConfirmed
	}
	deleteWxQrTicket(ticket)
	return t, nil
}

func deleteWxQrTicket(ticket string) {
	key := WxQrTicketKeyPrefix + ticket
	if common.RedisEnabled {
		_ = common.RedisDel(key)
		return
	}
	memTicketsDel(key)
}

var (
	ErrWxQrTicketNotFound    = errors.New("二维码已失效，请刷新")
	ErrWxQrTicketAlreadyUsed = errors.New("该二维码已被其他用户使用")
	ErrWxQrTicketNotConfirmed = errors.New("尚未扫码确认")
)
