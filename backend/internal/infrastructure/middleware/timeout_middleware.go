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
			if isWebSocketUpgrade(r) || isRunEventStream(r) {
				next.ServeHTTP(w, r)
				return
			}
			requestDuration := duration
			modelRequest := strings.HasPrefix(r.URL.Path, "/api/v1/rag/") ||
				(strings.HasPrefix(r.URL.Path, "/api/v1/platform/ai/") && (r.Method == http.MethodPost || r.Method == http.MethodPut))
			if modelRequest && ragDuration > 0 {
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

// isRunEventStream is the SSE route that follows an AI run. The run has its own
// deadline, and TimeoutHandler would hold every event until the response ended.
func isRunEventStream(r *http.Request) bool {
	return r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/events") &&
		(strings.HasPrefix(r.URL.Path, "/api/v1/ai/runs/") || r.URL.Path == "/api/v1/platform/ai/embedding/events")
}
