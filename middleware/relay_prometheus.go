package middleware

import (
	"github.com/QuantumNous/new-api/relaymetrics"

	"github.com/gin-gonic/gin"
)

type relayMetricsWriter struct {
	gin.ResponseWriter
	s *relaymetrics.Session
}

func (w *relayMetricsWriter) Write(b []byte) (int, error) {
	if len(b) > 0 {
		w.s.MarkFirstClientWrite()
	}
	return w.ResponseWriter.Write(b)
}

func (w *relayMetricsWriter) WriteString(s string) (int, error) {
	if len(s) > 0 {
		w.s.MarkFirstClientWrite()
	}
	return w.ResponseWriter.WriteString(s)
}

func RelayPrometheusMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !relaymetrics.PathMonitored(c.Request.URL.Path) {
			c.Next()
			return
		}
		s := relaymetrics.NewSession(c.Request.URL.Path)
		c.Set(relaymetrics.GinSessionKey, s)
		c.Request = c.Request.WithContext(relaymetrics.ContextWithSession(c.Request.Context(), s))
		rmw := &relayMetricsWriter{ResponseWriter: c.Writer, s: s}
		c.Writer = rmw
		defer s.Finalize(c)
		c.Next()
	}
}
