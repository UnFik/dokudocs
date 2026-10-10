//go:build integration

package routes

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"backend/internal/config"
	"backend/internal/domain/model"
	"backend/internal/infrastructure/database"
	"backend/internal/infrastructure/logger"
	"backend/internal/infrastructure/runtime/container"
	"backend/internal/infrastructure/validator"

	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"
)

const (
	appURL        = "https://app.example.test"
	bindingCookie = "dokudocs_google_binding"
)

// fakeGoogle stands in for Google at the IdentityProvider seam: a code maps to
// the identity Google would vouch for. It remembers what start asked for, so a
// test can check the callback used the same nonce and verifier.
type fakeGoogle struct {
	mu         sync.Mutex
	identities map[string]model.ProviderIdentity
	nonces     map[string]string
	verifiers  []string
}

func (f *fakeGoogle) AuthorizationURL(state, nonce, verifier string) string {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.nonces[state] = nonce
	return "https://accounts.example.test/auth?" + url.Values{"state": {state}, "nonce": {nonce}}.Encode()
}

func (f *fakeGoogle) Verify(_ context.Context, code, verifier, nonce string) (model.ProviderIdentity, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.verifiers = append(f.verifiers, verifier)
	identity, ok := f.identities[code]
	if !ok {
		return model.ProviderIdentity{}, errors.New("invalid google identity token")
	}
	for _, n := range f.nonces {
		if n == nonce {
			return identity, nil
		}
	}
	return model.ProviderIdentity{}, errors.New("invalid google nonce")
}

type signInEnv struct {
	t      *testing.T
	db     *sql.DB
	api    http.Handler
	google *fakeGoogle
	emails []string
}

func newSignInEnv(t *testing.T, mutate func(*config.Config)) *signInEnv {
	t.Helper()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Fatal("TEST_DATABASE_URL is required for integration tests")
	}
	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	ensureMemberRole(t, db)
	google := &fakeGoogle{identities: map[string]model.ProviderIdentity{}, nonces: map[string]string{}}
	app := container.New(database.NewSQLDB(db), logger.New(), validator.New())
	app.IdentityProvider = google
	cfg := config.Config{
		JWTSecret: "google-test-secret-that-is-long-enough", AccessTokenTTL: time.Hour, PublicAppURL: appURL,
		GoogleClientID: "client", GoogleClientSecret: "secret",
	}
	if mutate != nil {
		mutate(&cfg)
	}
	env := &signInEnv{t: t, db: db, api: InitRoutes(app, cfg), google: google}
	t.Cleanup(func() {
		for _, email := range env.emails {
			_, _ = db.Exec(`DELETE FROM users WHERE email = $1`, email)
		}
		_ = db.Close()
	})
	return env
}

func (e *signInEnv) newEmail(prefix string) string {
	email := fmt.Sprintf("%s-%s@example.invalid", prefix, uuid.NewString())
	e.emails = append(e.emails, email)
	return email
}

type reply struct {
	*httptest.ResponseRecorder
}

func (r reply) json(v any) { _ = json.Unmarshal(r.Body.Bytes(), v) }

func (r reply) cookie(name string) *http.Cookie {
	for _, c := range r.Result().Cookies() {
		if c.Name == name {
			return c
		}
	}
	return nil
}

func (e *signInEnv) do(method, path string, body any, headers map[string]string, cookie string) reply {
	e.t.Helper()
	var reader bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&reader).Encode(body)
	}
	req := httptest.NewRequest(method, path, &reader)
	req.RemoteAddr = "203.0.113.7:5000"
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	if cookie != "" {
		req.AddCookie(&http.Cookie{Name: bindingCookie, Value: cookie})
	}
	rec := httptest.NewRecorder()
	e.api.ServeHTTP(rec, req)
	return reply{rec}
}

// start begins a sign-in and returns the state Google would echo and the binding cookie.
func (e *signInEnv) start(redirect string, headers map[string]string) (state, binding string, res reply) {
	e.t.Helper()
	body := map[string]string{}
	if redirect != "" {
		body["redirect"] = redirect
	}
	res = e.do(http.MethodPost, "/api/v1/auth/google/start", body, headers, "")
	if res.Code != http.StatusOK {
		return "", "", res
	}
	var out struct {
		Data struct {
			AuthorizationURL string `json:"authorizationUrl"`
		} `json:"data"`
	}
	res.json(&out)
	parsed, err := url.Parse(out.Data.AuthorizationURL)
	if err != nil {
		e.t.Fatal(err)
	}
	state = parsed.Query().Get("state")
	if c := res.cookie(bindingCookie); c != nil {
		binding = c.Value
	}
	return state, binding, res
}

func (e *signInEnv) callback(query url.Values, binding string) reply {
	e.t.Helper()
	return e.do(http.MethodGet, "/api/v1/auth/google/callback?"+query.Encode(), nil, nil, binding)
}

func (e *signInEnv) exchange(code, binding string) reply {
	e.t.Helper()
	return e.do(http.MethodPost, "/api/v1/auth/google/exchange", map[string]string{"code": code}, nil, binding)
}

// signIn runs start, callback and exchange for the code and returns the exchange reply.
func (e *signInEnv) signIn(code string) reply {
	e.t.Helper()
	state, binding, started := e.start("", nil)
	if started.Code != http.StatusOK {
		e.t.Fatalf("start = %d %s", started.Code, started.Body.String())
	}
	cb := e.callback(url.Values{"code": {code}, "state": {state}}, binding)
	exchangeCode := redirectQuery(e.t, cb).Get("code")
	if exchangeCode == "" {
		e.t.Fatalf("callback = %d %s, want a redirect with a code", cb.Code, cb.Header().Get("Location"))
	}
	return e.exchange(exchangeCode, binding)
}

func redirectQuery(t *testing.T, r reply) url.Values {
	t.Helper()
	if r.Code != http.StatusFound {
		t.Fatalf("status = %d %s, want a 302", r.Code, r.Body.String())
	}
	location, err := url.Parse(r.Header().Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	if location.Scheme+"://"+location.Host != appURL || location.Path != "/auth/callback" {
		t.Fatalf("redirect = %s, want %s/auth/callback", location, appURL)
	}
	return location.Query()
}

type signedInBody struct {
	Data struct {
		AccessToken string `json:"accessToken"`
		Redirect    string `json:"redirect"`
		User        struct {
			ID            string `json:"id"`
			Email         string `json:"email"`
			EmailVerified bool   `json:"emailVerified"`
		} `json:"user"`
	} `json:"data"`
}

func TestStartIsUnavailableWithoutGoogleCredentials(t *testing.T) {
	env := newSignInEnv(t, func(c *config.Config) { c.GoogleClientID = ""; c.GoogleClientSecret = "" })
	res := env.do(http.MethodPost, "/api/v1/auth/google/start", map[string]string{}, nil, "")
	if res.Code != http.StatusServiceUnavailable {
		t.Fatalf("start = %d %s, want 503", res.Code, res.Body.String())
	}
}

func TestStartSetsABindingCookieAndRefusesForeignOrigins(t *testing.T) {
	env := newSignInEnv(t, nil)
	_, binding, res := env.start("", map[string]string{"Origin": appURL})
	if res.Code != http.StatusOK || binding == "" {
		t.Fatalf("start = %d %s", res.Code, res.Body.String())
	}
	c := res.cookie(bindingCookie)
	if !c.HttpOnly || !c.Secure || c.SameSite != http.SameSiteLaxMode || c.Path != "/api/v1/auth/google" || c.MaxAge != 600 {
		t.Fatalf("binding cookie = %+v, want HttpOnly, Secure (https app), SameSite=Lax, Path=/api/v1/auth/google, Max-Age=600", c)
	}
	if res.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("Cache-Control = %q, want no-store", res.Header().Get("Cache-Control"))
	}
	if _, _, res := env.start("", map[string]string{"Origin": "https://evil.example.test"}); res.Code != http.StatusForbidden {
		t.Fatalf("start from another origin = %d, want 403", res.Code)
	}
}

func TestNewGoogleUserIsCreatedOnceAndSignedInAgain(t *testing.T) {
	env := newSignInEnv(t, nil)
	email, sub := env.newEmail("new"), "sub-"+uuid.NewString()
	env.google.identities["c1"] = model.ProviderIdentity{Subject: sub, Email: strings.ToUpper(email), EmailVerified: true, Name: "Gera Google", AvatarURL: "https://lh3.googleusercontent.com/a/p=s96-c"}

	res := env.signIn("c1")
	var first signedInBody
	res.json(&first)
	if res.Code != http.StatusOK || !first.Data.User.EmailVerified || first.Data.AccessToken == "" || first.Data.Redirect != "/dashboard" {
		t.Fatalf("exchange = %d %s, want a verified sign-in", res.Code, res.Body.String())
	}
	if first.Data.User.Email != email {
		t.Fatalf("email = %q, want it lower-cased as %q", first.Data.User.Email, email)
	}
	var hasPassword bool
	var fullName, avatar string
	var verifiedAt sql.NullTime
	if err := env.db.QueryRow(`SELECT password_hash IS NOT NULL, full_name, COALESCE(avatar_url,''), email_verified_at FROM users WHERE id = $1`, first.Data.User.ID).Scan(&hasPassword, &fullName, &avatar, &verifiedAt); err != nil {
		t.Fatal(err)
	}
	if hasPassword || fullName != "Gera Google" || avatar == "" || !verifiedAt.Valid {
		t.Fatalf("user row: password=%v name=%q avatar=%q verified=%v", hasPassword, fullName, avatar, verifiedAt.Valid)
	}
	var identities, roles int
	_ = env.db.QueryRow(`SELECT count(*) FROM oauth_accounts WHERE user_id = $1 AND provider = 'google' AND provider_user_id = $2 AND access_token IS NULL AND refresh_token IS NULL AND raw_profile IS NULL`, first.Data.User.ID, sub).Scan(&identities)
	_ = env.db.QueryRow(`SELECT count(*) FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1 AND r.slug = 'member'`, first.Data.User.ID).Scan(&roles)
	if identities != 1 || roles != 1 {
		t.Fatalf("identities=%d member roles=%d, want 1 each", identities, roles)
	}

	// Signing in again, even with a changed email, is the same User.
	env.google.identities["c2"] = model.ProviderIdentity{Subject: sub, Email: env.newEmail("moved"), EmailVerified: true, Name: "Renamed"}
	var second signedInBody
	res = env.signIn("c2")
	res.json(&second)
	if res.Code != http.StatusOK || second.Data.User.ID != first.Data.User.ID {
		t.Fatalf("second sign-in = %d %s, want the same User %s", res.Code, res.Body.String(), first.Data.User.ID)
	}
	_ = env.db.QueryRow(`SELECT full_name FROM users WHERE id = $1`, first.Data.User.ID).Scan(&fullName)
	if fullName != "Gera Google" {
		t.Fatalf("a later sign-in must not overwrite the profile, name is %q", fullName)
	}
}

func TestExchangeNeedsTheBrowserThatStartedAndWorksOnce(t *testing.T) {
	env := newSignInEnv(t, nil)
	env.google.identities["c"] = model.ProviderIdentity{Subject: "sub-" + uuid.NewString(), Email: env.newEmail("once"), EmailVerified: true, Name: "Once Only"}
	state, binding, _ := env.start("/docs", nil)
	code := redirectQuery(t, env.callback(url.Values{"code": {"c"}, "state": {state}}, binding)).Get("code")

	if res := env.exchange(code, ""); res.Code != http.StatusBadRequest {
		t.Fatalf("exchange with no cookie = %d, want 400", res.Code)
	}
	if res := env.exchange(code, "another-browsers-secret"); res.Code != http.StatusBadRequest {
		t.Fatalf("exchange from another browser = %d, want 400", res.Code)
	}
	var wg sync.WaitGroup
	results := make([]int, 8)
	for i := range results {
		wg.Add(1)
		go func() {
			defer wg.Done()
			results[i] = env.exchange(code, binding).Code
		}()
	}
	wg.Wait()
	ok := 0
	for _, status := range results {
		if status == http.StatusOK {
			ok++
		} else if status != http.StatusBadRequest {
			t.Fatalf("unexpected status %d", status)
		}
	}
	if ok != 1 {
		t.Fatalf("%d parallel exchanges succeeded, want exactly 1 (%v)", ok, results)
	}
	// The wrong attempts did not use the code up: the right browser got it above, so a replay fails.
	if res := env.exchange(code, binding); res.Code != http.StatusBadRequest {
		t.Fatalf("replay = %d, want 400", res.Code)
	}
}

func TestExchangeReturnsTheRedirectTheUserAskedFor(t *testing.T) {
	env := newSignInEnv(t, nil)
	cases := map[string]string{
		"/docs/abc?x=1":       "/docs/abc?x=1",
		"https://evil.test/":  "/dashboard",
		"//evil.test/path":    "/dashboard",
		"/\\evil.test":        "/dashboard",
		"javascript:alert(1)": "/dashboard",
		"/auth/callback":      "/dashboard",
		"/sign-in":            "/dashboard",
	}
	for asked, want := range cases {
		env.google.identities["r"] = model.ProviderIdentity{Subject: "sub-redirect", Email: env.newEmail("redirect"), EmailVerified: true, Name: "Redirect Me"}
		state, binding, _ := env.start(asked, nil)
		code := redirectQuery(t, env.callback(url.Values{"code": {"r"}, "state": {state}}, binding)).Get("code")
		var out signedInBody
		res := env.exchange(code, binding)
		res.json(&out)
		if res.Code != http.StatusOK || out.Data.Redirect != want {
			t.Fatalf("redirect %q: exchange = %d redirect %q, want %q", asked, res.Code, out.Data.Redirect, want)
		}
	}
}

func TestCallbackFailsSafely(t *testing.T) {
	env := newSignInEnv(t, nil)
	env.google.identities["good"] = model.ProviderIdentity{Subject: "sub-" + uuid.NewString(), Email: env.newEmail("safe"), EmailVerified: true, Name: "Safe Person"}

	errorOf := func(r reply) string { return redirectQuery(t, r).Get("error") }

	state, binding, _ := env.start("", nil)
	if got := errorOf(env.callback(url.Values{"code": {"good"}, "state": {"not-the-state"}}, binding)); got != "expired" {
		t.Fatalf("unknown state: error = %q, want expired", got)
	}
	if got := errorOf(env.callback(url.Values{"code": {"good"}, "state": {state}}, "")); got != "expired" {
		t.Fatalf("no cookie: error = %q, want expired", got)
	}
	if got := errorOf(env.callback(url.Values{"code": {"good"}, "state": {state}}, "another-browsers-secret")); got != "expired" {
		t.Fatalf("other browser: error = %q, want expired", got)
	}

	// The failed attempts did not use the transaction up; Google refusing does.
	if got := errorOf(env.callback(url.Values{"error": {"access_denied"}, "state": {state}}, binding)); got != "denied" {
		t.Fatalf("denied: error = %q, want denied", got)
	}
	if got := errorOf(env.callback(url.Values{"code": {"good"}, "state": {state}}, binding)); got != "expired" {
		t.Fatalf("state reused after a denial: error = %q, want expired", got)
	}

	state, binding, _ = env.start("", nil)
	if got := errorOf(env.callback(url.Values{"code": {"forged"}, "state": {state}}, binding)); got != "failed" {
		t.Fatalf("Google rejects the code: error = %q, want failed", got)
	}

	// A code that worked once cannot be walked through a second callback.
	state, binding, _ = env.start("", nil)
	redirectQuery(t, env.callback(url.Values{"code": {"good"}, "state": {state}}, binding))
	if got := errorOf(env.callback(url.Values{"code": {"good"}, "state": {state}}, binding)); got != "expired" {
		t.Fatalf("callback replay: error = %q, want expired", got)
	}

	// Expired transactions are refused.
	state, binding, _ = env.start("", nil)
	if _, err := env.db.Exec(`UPDATE oauth_transactions SET expires_at = now() - interval '1 second' WHERE state_hash = encode(sha256($1::bytea), 'hex')`, state); err != nil {
		t.Fatal(err)
	}
	if got := errorOf(env.callback(url.Values{"code": {"good"}, "state": {state}}, binding)); got != "expired" {
		t.Fatalf("expired transaction: error = %q, want expired", got)
	}
	// Nothing above issued a token or made a user.
	var n int
	_ = env.db.QueryRow(`SELECT count(*) FROM oauth_accounts WHERE provider_user_id = $1`, env.google.identities["good"].Subject).Scan(&n)
	if n != 1 { // only the one callback that succeeded before its replay was refused
		t.Fatalf("identities for the test subject = %d, want 1", n)
	}
}

func TestVerifiedLocalAccountLinksAndKeepsItsPassword(t *testing.T) {
	env := newSignInEnv(t, nil)
	email := env.newEmail("local-verified")
	userID := env.registerLocal(email, true)
	env.google.identities["c"] = model.ProviderIdentity{Subject: "sub-" + uuid.NewString(), Email: email, EmailVerified: true, Name: "Same Person"}

	var out signedInBody
	res := env.signIn("c")
	res.json(&out)
	if res.Code != http.StatusOK || out.Data.User.ID != userID {
		t.Fatalf("exchange = %d %s, want the existing User %s", res.Code, res.Body.String(), userID)
	}
	if login := env.do(http.MethodPost, "/api/v1/auth/login", map[string]string{"email": email, "password": localPassword}, nil, ""); login.Code != http.StatusOK {
		t.Fatalf("password login after linking = %d, want 200: the password stays", login.Code)
	}
}

func TestUnverifiedLocalAccountIsTakenOver(t *testing.T) {
	env := newSignInEnv(t, nil)
	email := env.newEmail("local-unverified")
	userID := env.registerLocal(email, false)
	env.google.identities["c"] = model.ProviderIdentity{Subject: "sub-" + uuid.NewString(), Email: email, EmailVerified: true, Name: "Real Owner"}

	var out signedInBody
	res := env.signIn("c")
	res.json(&out)
	if res.Code != http.StatusOK || out.Data.User.ID != userID || !out.Data.User.EmailVerified {
		t.Fatalf("exchange = %d %s, want the existing User, now verified", res.Code, res.Body.String())
	}
	if login := env.do(http.MethodPost, "/api/v1/auth/login", map[string]string{"email": email, "password": localPassword}, nil, ""); login.Code != http.StatusUnauthorized {
		t.Fatalf("password login after takeover = %d, want 401: the unverified password is gone", login.Code)
	}
}

const localPassword = "a long enough password"

// registerLocal makes an email-and-password User, verified or not, and returns its id.
func (e *signInEnv) registerLocal(email string, verified bool) string {
	e.t.Helper()
	res := e.do(http.MethodPost, "/api/v1/auth/register", map[string]string{"email": email, "password": localPassword, "fullName": "Local Person"}, nil, "")
	var out signedInBody
	res.json(&out)
	if res.Code != http.StatusCreated {
		e.t.Fatalf("register = %d %s", res.Code, res.Body.String())
	}
	if verified {
		if _, err := e.db.Exec(`UPDATE users SET email_verified_at = now() WHERE id = $1`, out.Data.User.ID); err != nil {
			e.t.Fatal(err)
		}
	}
	return out.Data.User.ID
}

func TestTheRateLimitCoversStart(t *testing.T) {
	env := newSignInEnv(t, func(c *config.Config) { c.RateLimitGoogleStartPerMin = 2 })
	env.start("", nil)
	env.start("", nil)
	if _, _, res := env.start("", nil); res.Code != http.StatusTooManyRequests {
		t.Fatalf("third start = %d, want 429", res.Code)
	}
}
