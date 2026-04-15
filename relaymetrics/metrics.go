package relaymetrics

import (
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

var (
	phaseHist = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "camel_relay_phase_duration_seconds",
		Help:    "Relay request phase latencies for monitored paths.",
		Buckets: prometheus.ExponentialBuckets(0.005, 2, 20),
	}, []string{"phase", "route", "status_class", "stream", "site_label"})

	dbHist = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "camel_relay_db_duration_seconds",
		Help:    "Time in GORM queries attributed to relay-monitored requests (request-scoped context).",
		Buckets: prometheus.ExponentialBuckets(0.001, 2, 18),
	}, []string{"route", "status_class", "stream", "site_label"})

	requestsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "camel_relay_requests_total",
		Help: "Relay monitored path requests completed.",
	}, []string{"route", "status_class", "stream", "site_label"})
)

var gormCallbacksOnce sync.Once

func RegisterGormCallbacks(db *gorm.DB) {
	if db == nil {
		return
	}
	gormCallbacksOnce.Do(func() {
		q := db.Callback().Query()
		q.Before("gorm:query").Register("relaymetrics:before_query", func(tx *gorm.DB) {
			tx.InstanceSet("relaymetrics_t0", time.Now())
		})
		q.After("gorm:query").Register("relaymetrics:after_query", func(tx *gorm.DB) {
			v, ok := tx.InstanceGet("relaymetrics_t0")
			if !ok {
				return
			}
			t0, ok := v.(time.Time)
			if !ok {
				return
			}
			AddDBFromContext(tx.Statement.Context, time.Since(t0))
		})
	})
}

func scrapeLogHandler(inner http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		common.SysLog(fmt.Sprintf("[metrics] prometheus scrape %s %s remote=%s", r.Method, r.URL.Path, r.RemoteAddr))
		inner.ServeHTTP(w, r)
	})
}

func promMetricsHandler() http.Handler {
	return scrapeLogHandler(promhttp.Handler())
}

func RegisterGinMetrics(e gin.IRoutes) {
	h := gin.WrapH(promMetricsHandler())
	e.GET("/metrics", h)
	e.HEAD("/metrics", h)
}
