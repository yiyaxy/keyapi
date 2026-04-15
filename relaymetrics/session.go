package relaymetrics

import (
	"context"
	"net/http"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"

	"github.com/gin-gonic/gin"
)

type contextKeyType string

const (
	contextSessionKey contextKeyType = "relaymetrics_session_ctx"
	GinSessionKey     = "relaymetrics_session_gin"
)

type Session struct {
	mu                sync.Mutex
	Route             string
	StartTime         time.Time
	Stream            bool
	DBNanos           int64
	UpstreamIssued    time.Time
	FirstUpstreamByte time.Time
	UpstreamDone      time.Time
	FirstDataParsed   time.Time // first valid SSE data line parsed by scanner
	FirstClientWrite  time.Time
	finalized         bool
}

func NewSession(route string) *Session {
	return &Session{
		Route:     route,
		StartTime: time.Now(),
	}
}

func ContextWithSession(parent context.Context, s *Session) context.Context {
	if parent == nil {
		parent = context.Background()
	}
	if s == nil {
		return parent
	}
	return context.WithValue(parent, contextSessionKey, s)
}

func SessionFromContext(ctx context.Context) *Session {
	if ctx == nil {
		return nil
	}
	v := ctx.Value(contextSessionKey)
	if v == nil {
		return nil
	}
	s, _ := v.(*Session)
	return s
}

func SessionFromGin(c *gin.Context) *Session {
	if c == nil {
		return nil
	}
	v, ok := c.Get(GinSessionKey)
	if !ok {
		return nil
	}
	s, _ := v.(*Session)
	return s
}

func AddDBFromContext(ctx context.Context, d time.Duration) {
	if d <= 0 {
		return
	}
	s := SessionFromContext(ctx)
	if s == nil {
		return
	}
	s.AddDB(d)
}

func (s *Session) AddDB(d time.Duration) {
	if s == nil || d <= 0 {
		return
	}
	s.mu.Lock()
	s.DBNanos += d.Nanoseconds()
	s.mu.Unlock()
}

func (s *Session) MarkUpstreamIssued(isStream bool) {
	if s == nil {
		return
	}
	s.mu.Lock()
	s.Stream = isStream
	if s.UpstreamIssued.IsZero() {
		s.UpstreamIssued = time.Now()
	}
	s.mu.Unlock()
}

func (s *Session) MarkFirstUpstreamByte() {
	if s == nil {
		return
	}
	s.mu.Lock()
	if s.FirstUpstreamByte.IsZero() {
		s.FirstUpstreamByte = time.Now()
	}
	s.mu.Unlock()
}

func (s *Session) MarkUpstreamDone() {
	if s == nil {
		return
	}
	s.mu.Lock()
	if s.UpstreamDone.IsZero() {
		s.UpstreamDone = time.Now()
	}
	s.mu.Unlock()
}

func (s *Session) MarkFirstDataParsed() {
	if s == nil {
		return
	}
	s.mu.Lock()
	if s.FirstDataParsed.IsZero() {
		s.FirstDataParsed = time.Now()
	}
	s.mu.Unlock()
}

func (s *Session) MarkFirstClientWrite() {
	if s == nil {
		return
	}
	s.mu.Lock()
	if s.FirstClientWrite.IsZero() {
		s.FirstClientWrite = time.Now()
	}
	s.mu.Unlock()
}

func (s *Session) Finalize(c *gin.Context) {
	if s == nil || c == nil {
		return
	}
	end := time.Now()
	status := c.Writer.Status()
	if status == 0 {
		status = http.StatusOK
	}
	sc := statusClass(status)
	streamStr := "false"
	s.mu.Lock()
	if s.Stream {
		streamStr = "true"
	}
	if s.finalized {
		s.mu.Unlock()
		return
	}
	s.finalized = true
	route := s.Route
	start := s.StartTime
	upIssued := s.UpstreamIssued
	firstUp := s.FirstUpstreamByte
	upDone := s.UpstreamDone
	firstData := s.FirstDataParsed
	firstCli := s.FirstClientWrite
	dbSecs := float64(s.DBNanos) / 1e9
	s.mu.Unlock()

	loc := common.SiteLabel
	observePhase := func(phase string, secs float64) {
		if secs < 0 {
			secs = 0
		}
		phaseHist.WithLabelValues(phase, route, sc, streamStr, loc).Observe(secs)
	}
	if !upIssued.IsZero() {
		observePhase("local", upIssued.Sub(start).Seconds())
	} else {
		observePhase("local", end.Sub(start).Seconds())
	}
	if dbSecs > 0 {
		dbHist.WithLabelValues(route, sc, streamStr, loc).Observe(dbSecs)
	}
	if !upIssued.IsZero() && !firstUp.IsZero() {
		observePhase("upstream_ttfb", firstUp.Sub(upIssued).Seconds())
	}
	if !firstUp.IsZero() && !upDone.IsZero() {
		observePhase("upstream_body", upDone.Sub(firstUp).Seconds())
	}
	// scan_to_data: time from first upstream byte to first parsed SSE data line
	if !firstUp.IsZero() && !firstData.IsZero() {
		observePhase("scan_to_data", firstData.Sub(firstUp).Seconds())
	}
	// data_to_client: time from first parsed data to first client write (buffer delay + format conversion)
	if !firstData.IsZero() && !firstCli.IsZero() {
		observePhase("data_to_client", firstCli.Sub(firstData).Seconds())
	}
	if !firstCli.IsZero() {
		observePhase("client_ttfb", firstCli.Sub(start).Seconds())
		observePhase("client_stream", end.Sub(firstCli).Seconds())
	}
	observePhase("total", end.Sub(start).Seconds())
	requestsTotal.WithLabelValues(route, sc, streamStr, loc).Inc()
}

// MarkAuthDone records that the auth phase is complete.
// Stub: this project's metrics do not track auth timing.
func (s *Session) MarkAuthDone() {}

// SetModelInfo stores model and provider name for metrics labeling.
// Stub: this project's metrics do not label by model/provider.
func (s *Session) SetModelInfo(model, provider string) {}

func statusClass(code int) string {
	switch {
	case code >= 200 && code < 300:
		return "2xx"
	case code >= 400 && code < 500:
		return "4xx"
	case code >= 500:
		return "5xx"
	default:
		return "other"
	}
}
