//go:build integration

package routes

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"sync"
	"testing"
	"time"

	"backend/internal/config"
	"backend/internal/domain/contract/mail"
	"backend/internal/infrastructure/database"
	"backend/internal/infrastructure/logger"
	"backend/internal/infrastructure/runtime/container"
	"backend/internal/infrastructure/validator"

	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"
)

type recordingMailer struct {
	mu   sync.Mutex
	sent []mail.Message
	fail error
}

func (m *recordingMailer) Send(_ context.Context, msg mail.Message) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.fail != nil {
		return m.fail
	}
	m.sent = append(m.sent, msg)
	return nil
}

func (m *recordingMailer) count() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.sent)
}

func (m *recordingMailer) lastToken(t *testing.T) string {
	t.Helper()
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.sent) == 0 {
		t.Fatal("no email was sent")
	}
	match := regexp.MustCompile(`https://app\.example\.test/verify-email\?token=([A-Za-z0-9_-]+)`).FindStringSubmatch(m.sent[len(m.sent)-1].Text)
	if match == nil {
		t.Fatalf("no verification link in %q", m.sent[len(m.sent)-1].Text)
	}
	return match[1]
}

func ensureMemberRole(t *testing.T, db *sql.DB) {
	t.Helper()
	if _, err := db.Exec(`INSERT INTO roles (name, slug, is_system) VALUES ('Member', 'member', true) ON CONFLICT (slug) DO NOTHING`); err != nil {
		t.Fatalf("seed member role: %v", err)
	}
}

type authBody struct {
	Data struct {
		AccessToken string `json:"accessToken"`
		User        struct {
			ID            string `json:"id"`
			EmailVerified bool   `json:"emailVerified"`
		} `json:"user"`
	} `json:"data"`
	Title string `json:"title"`
	Code  string `json:"code"`
}

func TestEmailVerificationOverHTTP(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Fatal("TEST_DATABASE_URL is required for integration tests")
	}
	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	ensureMemberRole(t, db)
	mailer := &recordingMailer{}
	app := container.New(database.NewSQLDB(db), logger.New(), validator.New())
	app.Mailer = mailer
	api := InitRoutes(app, config.Config{
		JWTSecret: "verify-test-secret-that-is-long-enough", AccessTokenTTL: time.Hour,
		PublicAppURL: "https://app.example.test", RequireEmailVerification: true,
	})

	call := func(method, path string, body any, token string) (*httptest.ResponseRecorder, authBody) {
		t.Helper()
		var reader bytes.Buffer
		if body != nil {
			_ = json.NewEncoder(&reader).Encode(body)
		}
		req := httptest.NewRequest(method, path, &reader)
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		rec := httptest.NewRecorder()
		api.ServeHTTP(rec, req)
		var out authBody
		_ = json.Unmarshal(rec.Body.Bytes(), &out)
		return rec, out
	}

	email := fmt.Sprintf("verify-%s@example.invalid", uuid.NewString())
	var userID string
	t.Cleanup(func() { _, _ = db.Exec(`DELETE FROM users WHERE email = $1`, email) })

	// Registering signs the User in unverified and sends the link.
	rec, registered := call(http.MethodPost, "/api/v1/auth/register", map[string]string{"email": email, "password": "a long enough password", "fullName": "Verify Me"}, "")
	if rec.Code != http.StatusCreated || registered.Data.User.EmailVerified {
		t.Fatalf("register = %d %s, want 201 unverified", rec.Code, rec.Body.String())
	}
	userID = registered.Data.User.ID
	unverified := registered.Data.AccessToken
	if mailer.count() != 1 {
		t.Fatalf("register should send one email, sent %d", mailer.count())
	}
	if to := mailer.sent[0].To; to != email {
		t.Fatalf("email sent to %q, want %q", to, email)
	}

	// The gate is on: the app is closed, the verification endpoints are not.
	if rec, body := call(http.MethodGet, "/api/v1/projects", nil, unverified); rec.Code != http.StatusForbidden || body.Code != "email_not_verified" {
		t.Fatalf("projects while unverified = %d %s, want 403 email_not_verified", rec.Code, rec.Body.String())
	}
	if rec, _ := call(http.MethodGet, "/api/v1/auth/me", nil, unverified); rec.Code != http.StatusOK {
		t.Fatalf("auth/me while unverified = %d, want 200", rec.Code)
	}

	// A second link right away is refused; the first one still works.
	if rec, _ := call(http.MethodPost, "/api/v1/auth/email/resend", nil, unverified); rec.Code != http.StatusTooManyRequests {
		t.Fatalf("immediate resend = %d, want 429", rec.Code)
	}
	if mailer.count() != 1 {
		t.Fatalf("a refused resend must not send, sent %d", mailer.count())
	}
	if rec, _ := call(http.MethodPost, "/api/v1/auth/email/resend", nil, ""); rec.Code != http.StatusUnauthorized {
		t.Fatalf("resend with no token = %d, want 401", rec.Code)
	}

	// After the cooldown a resend replaces the link: the old one stops working.
	first := mailer.lastToken(t)
	if _, err := db.Exec(`UPDATE email_verifications SET created_at = created_at - interval '2 minutes' WHERE user_id = $1`, userID); err != nil {
		t.Fatal(err)
	}
	if rec, _ := call(http.MethodPost, "/api/v1/auth/email/resend", nil, unverified); rec.Code != http.StatusNoContent {
		t.Fatalf("resend after cooldown = %d, want 204", rec.Code)
	}
	second := mailer.lastToken(t)
	if first == second || mailer.count() != 2 {
		t.Fatalf("resend should send a new link, sent %d", mailer.count())
	}
	if rec, _ := call(http.MethodPost, "/api/v1/auth/email/verify", map[string]string{"token": first}, ""); rec.Code != http.StatusBadRequest {
		t.Fatalf("replaced link = %d, want 400", rec.Code)
	}

	// Wrong and expired links fail the same way.
	if rec, _ := call(http.MethodPost, "/api/v1/auth/email/verify", map[string]string{"token": "not-a-real-token"}, ""); rec.Code != http.StatusBadRequest {
		t.Fatalf("unknown token = %d, want 400", rec.Code)
	}
	if _, err := db.Exec(`UPDATE email_verifications SET expires_at = now() - interval '1 minute' WHERE user_id = $1`, userID); err != nil {
		t.Fatal(err)
	}
	if rec, _ := call(http.MethodPost, "/api/v1/auth/email/verify", map[string]string{"token": second}, ""); rec.Code != http.StatusBadRequest {
		t.Fatalf("expired token = %d, want 400", rec.Code)
	}
	if _, err := db.Exec(`UPDATE email_verifications SET expires_at = now() + interval '1 hour' WHERE user_id = $1`, userID); err != nil {
		t.Fatal(err)
	}

	// The right link verifies and returns a token the gate accepts.
	rec, verified := call(http.MethodPost, "/api/v1/auth/email/verify", map[string]string{"token": second}, "")
	if rec.Code != http.StatusOK || !verified.Data.User.EmailVerified || verified.Data.AccessToken == "" {
		t.Fatalf("verify = %d %s, want 200 with a verified token", rec.Code, rec.Body.String())
	}
	var at sql.NullTime
	if err := db.QueryRow(`SELECT email_verified_at FROM users WHERE id = $1`, userID).Scan(&at); err != nil || !at.Valid {
		t.Fatalf("email_verified_at not set: %v", err)
	}
	if rec, _ := call(http.MethodGet, "/api/v1/auth/me", nil, verified.Data.AccessToken); rec.Code != http.StatusOK {
		t.Fatalf("auth/me with the new token = %d", rec.Code)
	}
	if rec, _ := call(http.MethodPost, "/api/v1/auth/email/verify", map[string]string{"token": second}, ""); rec.Code != http.StatusBadRequest {
		t.Fatalf("a link works once, second use = %d, want 400", rec.Code)
	}

	// A verified User gets no more emails.
	sent := mailer.count()
	if rec, _ := call(http.MethodPost, "/api/v1/auth/email/resend", nil, verified.Data.AccessToken); rec.Code != http.StatusNoContent || mailer.count() != sent {
		t.Fatalf("resend for a verified User = %d, sent %d more", rec.Code, mailer.count()-sent)
	}

	// Login brings the flag back from the database.
	rec, login := call(http.MethodPost, "/api/v1/auth/login", map[string]string{"email": email, "password": "a long enough password"}, "")
	if rec.Code != http.StatusOK || !login.Data.User.EmailVerified {
		t.Fatalf("login after verifying = %d %s, want verified", rec.Code, rec.Body.String())
	}
}

func TestRegisterSucceedsWhenTheEmailCannotBeSent(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Fatal("TEST_DATABASE_URL is required for integration tests")
	}
	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	ensureMemberRole(t, db)
	app := container.New(database.NewSQLDB(db), logger.New(), validator.New())
	app.Mailer = &recordingMailer{fail: fmt.Errorf("smtp down")}
	api := InitRoutes(app, config.Config{JWTSecret: "verify-test-secret-that-is-long-enough", AccessTokenTTL: time.Hour, PublicAppURL: "https://app.example.test"})

	email := fmt.Sprintf("verify-down-%s@example.invalid", uuid.NewString())
	t.Cleanup(func() { _, _ = db.Exec(`DELETE FROM users WHERE email = $1`, email) })
	body, _ := json.Marshal(map[string]string{"email": email, "password": "a long enough password", "fullName": "Mail Down"})
	rec := httptest.NewRecorder()
	api.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", bytes.NewReader(body)))
	if rec.Code != http.StatusCreated {
		t.Fatalf("register with the mail server down = %d %s, want 201", rec.Code, rec.Body.String())
	}
}
