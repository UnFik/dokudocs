package middleware

import (
	"bufio"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"

	"backend/internal/infrastructure/logger"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
)

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hijacker, ok := r.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, http.ErrNotSupported
	}
	conn, rw, err := hijacker.Hijack()
	if err == nil {
		r.status = http.StatusSwitchingProtocols
	}
	return conn, rw, err
}

func (r *statusRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}

func (r *statusRecorder) Write(data []byte) (int, error) {
	if r.status == 0 {
		r.status = http.StatusOK
	}
	return r.ResponseWriter.Write(data)
}

// Logger writes one line per request, with its trace ID, and names the request's
// span after the matched route. It never logs the query string or a body.
func Logger(log *logger.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			ctx, fields := logger.WithRequest(r.Context())
			r = r.WithContext(ctx)
			recorder := &statusRecorder{ResponseWriter: w}
			next.ServeHTTP(recorder, r)
			status := recorder.status
			if status == 0 {
				status = http.StatusOK
			}
			level := slog.LevelInfo
			if status >= http.StatusInternalServerError {
				level = slog.LevelError
			}
			attrs := []slog.Attr{
				slog.String("method", r.Method),
				// The ServeMux fills in the pattern it matched, e.g. "GET /api/v1/documents/{id}".
				slog.String("route", r.Pattern),
				slog.String("path", redactShareTokenPath(r.URL.Path)),
				slog.Int("status", status),
				slog.Float64("duration_ms", float64(time.Since(start).Microseconds())/1000),
				slog.String("client_ip", clientIP(r)),
			}
			if fields.UserID != "" {
				attrs = append(attrs, slog.String("user_id", fields.UserID))
			}
			if span := trace.SpanFromContext(ctx); span.SpanContext().IsValid() {
				attrs = append(attrs, slog.String("trace_id", span.SpanContext().TraceID().String()))
				if r.Pattern != "" {
					name := r.Pattern
					if !strings.Contains(name, " ") {
						name = r.Method + " " + name
					}
					span.SetName(name)
					span.SetAttributes(attribute.String("http.route", r.Pattern))
				}
			}
			log.Log(ctx, level, "request", attrs...)
		})
	}
}

// clientIP prefers the address Cloudflare saw, then the first proxy hop, then the peer.
func clientIP(r *http.Request) string {
	if ip := strings.TrimSpace(r.Header.Get("CF-Connecting-IP")); ip != "" {
		return ip
	}
	if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
		return strings.TrimSpace(strings.Split(forwarded, ",")[0])
	}
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return host
	}
	return r.RemoteAddr
}

// redactShareTokenPath hides the share token in "/public/documents/{token}", for
// both the public page and the API ("/api/v1/public/documents/{token}").
func redactShareTokenPath(path string) string {
	parts := strings.Split(path, "/")
	for i := 0; i+2 < len(parts); i++ {
		if parts[i] == "public" && parts[i+1] == "documents" && parts[i+2] != "" {
			parts[i+2] = "[REDACTED]"
			return strings.Join(parts, "/")
		}
	}
	return path
}
