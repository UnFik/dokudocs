package middleware

import (
	"net/http"
	"strings"
	"time"
)

func Timeout(duration time.Duration) func(http.Handler) http.Handler {
	return TimeoutWithRAG(duration, duration)
}

func TimeoutWithRAG(duration, ragDuration time.Duration) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if isWebSocketUpgrade(r) {
				next.ServeHTTP(w, r)
				return
			}
			requestDuration := duration
			if strings.HasPrefix(r.URL.Path, "/api/v1/rag/") && ragDuration > 0 {
				requestDuration = ragDuration
			}
			http.TimeoutHandler(next, requestDuration, "request timeout").ServeHTTP(w, r)
		})
	}
}

func isWebSocketUpgrade(r *http.Request) bool {
	if !strings.EqualFold(strings.TrimSpace(r.Header.Get("Upgrade")), "websocket") {
		return false
	}
	for _, token := range strings.Split(r.Header.Get("Connection"), ",") {
		if strings.EqualFold(strings.TrimSpace(token), "upgrade") {
			return true
		}
	}
	return false
}
