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

	WxQrStatusPending   = "pending"
	WxQrStatusConfirmed = "confirmed"
)

type WxQrTicket struct {
	Ticket    string `json:"ticket"`
	Status    string `json:"status"`
	TenantId  int    `json:"tenant_id"`
	UserId    int    `json:"user_id,omitempty"`
	CreatedAt int64  `json:"created_at"`
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

// CreateWxQrTicket allocates a new pending ticket scoped to the given tenant.
func CreateWxQrTicket(tenantId int) (*WxQrTicket, error) {
	// 16 random chars (lowercase alnum by GetRandomString) → ~95 bits of entropy,
	// well under WeChat's 32-char scene limit.
	ticket := common.GetRandomString(16)
	t := WxQrTicket{
		Ticket:    ticket,
		Status:    WxQrStatusPending,
		TenantId:  tenantId,
		CreatedAt: time.Now().Unix(),
	}
	if err := saveWxQrTicket(&t); err != nil {
		return nil, err
	}
	return &t, nil
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
