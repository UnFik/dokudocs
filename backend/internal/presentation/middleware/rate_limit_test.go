package middleware

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"
)

type fakeClock struct{ now time.Time }

func (c *fakeClock) Now() time.Time { return c.now }

func okHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
}

func call(h http.Handler, remote, realIP string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", nil)
	req.RemoteAddr = remote
	if realIP != "" {
		req.Header.Set("X-Real-IP", realIP)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestRateLimitRejectsAfterTheBurstWithRetryAfter(t *testing.T) {
	clock := &fakeClock{now: time.Unix(1_700_000_000, 0)}
	h := NewRateLimiter(3, false, clock.Now).Middleware()(okHandler())

	for i := 0; i < 3; i++ {
		if got := call(h, "203.0.113.5:4000", "").Code; got != http.StatusNoContent {
			t.Fatalf("request %d: want 204, got %d", i+1, got)
		}
	}
	rec := call(h, "203.0.113.5:4001", "")
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("want 429, got %d", rec.Code)
	}
	retry, err := strconv.Atoi(rec.Header().Get("Retry-After"))
	if err != nil || retry < 1 || retry > 60 {
		t.Fatalf("Retry-After should be 1..60 seconds, got %q", rec.Header().Get("Retry-After"))
	}
}

func TestRateLimitRefillsOverTime(t *testing.T) {
	clock := &fakeClock{now: time.Unix(1_700_000_000, 0)}
	h := NewRateLimiter(6, false, clock.Now).Middleware()(okHandler())
	for i := 0; i < 6; i++ {
		call(h, "203.0.113.5:4000", "")
	}
	if got := call(h, "203.0.113.5:4000", "").Code; got != http.StatusTooManyRequests {
		t.Fatalf("burst spent: want 429, got %d", got)
	}
	clock.now = clock.now.Add(10 * time.Second) // 6 per minute refills one token every 10s
	if got := call(h, "203.0.113.5:4000", "").Code; got != http.StatusNoContent {
		t.Fatalf("after refill: want 204, got %d", got)
	}
	if got := call(h, "203.0.113.5:4000", "").Code; got != http.StatusTooManyRequests {
		t.Fatalf("only one token refilled: want 429, got %d", got)
	}
}

func TestRateLimitCountsEachClientSeparately(t *testing.T) {
	clock := &fakeClock{now: time.Unix(1_700_000_000, 0)}
	h := NewRateLimiter(1, false, clock.Now).Middleware()(okHandler())
	call(h, "203.0.113.5:4000", "")
	if got := call(h, "203.0.113.5:4000", "").Code; got != http.StatusTooManyRequests {
		t.Fatalf("same client: want 429, got %d", got)
	}
	if got := call(h, "198.51.100.9:4000", "").Code; got != http.StatusNoContent {
		t.Fatalf("other client: want 204, got %d", got)
	}
}

func TestRateLimitIgnoresRealIPHeaderUnlessProxyIsTrusted(t *testing.T) {
	clock := &fakeClock{now: time.Unix(1_700_000_000, 0)}
	untrusted := NewRateLimiter(1, false, clock.Now).Middleware()(okHandler())
	call(untrusted, "203.0.113.5:4000", "10.0.0.1")
	if got := call(untrusted, "203.0.113.5:4000", "10.0.0.2").Code; got != http.StatusTooManyRequests {
		t.Fatalf("a spoofed header must not give a fresh bucket: want 429, got %d", got)
	}

	trusted := NewRateLimiter(1, true, clock.Now).Middleware()(okHandler())
	call(trusted, "172.18.0.2:4000", "10.0.0.1")
	if got := call(trusted, "172.18.0.2:4001", "10.0.0.2").Code; got != http.StatusNoContent {
		t.Fatalf("trusted proxy: clients behind it are separate, want 204, got %d", got)
	}
	if got := call(trusted, "172.18.0.2:4002", "10.0.0.1").Code; got != http.StatusTooManyRequests {
		t.Fatalf("trusted proxy: same real IP, want 429, got %d", got)
	}
}

func TestRateLimitFallsBackToTheConnectionWhenTheHeaderIsNotAnIP(t *testing.T) {
	clock := &fakeClock{now: time.Unix(1_700_000_000, 0)}
	h := NewRateLimiter(1, true, clock.Now).Middleware()(okHandler())
	call(h, "203.0.113.5:4000", "not-an-ip")
	if got := call(h, "203.0.113.5:4001", "also-not-an-ip").Code; got != http.StatusTooManyRequests {
		t.Fatalf("want 429 keyed by the connection address, got %d", got)
	}
}

func TestRateLimitForgetsIdleClients(t *testing.T) {
	clock := &fakeClock{now: time.Unix(1_700_000_000, 0)}
	l := NewRateLimiter(5, false, clock.Now)
	h := l.Middleware()(okHandler())
	call(h, "203.0.113.5:4000", "")
	clock.now = clock.now.Add(30 * time.Minute)
	call(h, "198.51.100.9:4000", "")
	if got := l.tracked(); got != 1 {
		t.Fatalf("idle client should have been dropped, tracking %d", got)
	}
}
