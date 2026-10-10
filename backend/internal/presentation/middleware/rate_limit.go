package middleware

import (
	"math"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"backend/internal/presentation/response"
)

const (
	idleAfter     = 10 * time.Minute
	sweepInterval = time.Minute
)

type bucket struct {
	tokens float64
	last   time.Time
}

// RateLimiter lets each client address make perMinute requests a minute, with a
// burst of the same size. State lives in this process, so it holds for one API
// instance only.
type RateLimiter struct {
	perMinute  float64
	trustProxy bool
	now        func() time.Time

	mu        sync.Mutex
	buckets   map[string]*bucket
	lastSweep time.Time
}

// NewRateLimiter builds a limiter. With trustProxy, the client is the address in
// X-Real-IP, which the proxy in front of the API sets; without it the header is
// ignored, since any caller could send one.
func NewRateLimiter(perMinute int, trustProxy bool, now func() time.Time) *RateLimiter {
	return &RateLimiter{
		perMinute:  float64(perMinute),
		trustProxy: trustProxy,
		now:        now,
		buckets:    map[string]*bucket{},
		lastSweep:  now(),
	}
}

func (l *RateLimiter) Middleware() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if retry, ok := l.allow(l.client(r)); !ok {
				w.Header().Set("Retry-After", strconv.Itoa(retry))
				response.Error(w, http.StatusTooManyRequests, "too many requests, try again later")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func (l *RateLimiter) client(r *http.Request) string {
	if l.trustProxy {
		if ip := net.ParseIP(strings.TrimSpace(r.Header.Get("X-Real-IP"))); ip != nil {
			return ip.String()
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// allow spends one token and reports, when there is none, the seconds until one
// is back.
func (l *RateLimiter) allow(key string) (retryAfter int, ok bool) {
	now := l.now()
	l.mu.Lock()
	defer l.mu.Unlock()
	l.sweep(now)

	b := l.buckets[key]
	if b == nil {
		b = &bucket{tokens: l.perMinute, last: now}
		l.buckets[key] = b
	}
	b.tokens = math.Min(l.perMinute, b.tokens+now.Sub(b.last).Seconds()*l.perMinute/60)
	b.last = now
	if b.tokens < 1 {
		return int(math.Ceil((1 - b.tokens) * 60 / l.perMinute)), false
	}
	b.tokens--
	return 0, true
}

func (l *RateLimiter) sweep(now time.Time) {
	if now.Sub(l.lastSweep) < sweepInterval {
		return
	}
	l.lastSweep = now
	for key, b := range l.buckets {
		if now.Sub(b.last) > idleAfter {
			delete(l.buckets, key)
		}
	}
}

func (l *RateLimiter) tracked() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.buckets)
}
