//go:build integration

package routes

import (
	"context"
	"encoding/base64"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"backend/internal/application/aisettings"
	"backend/internal/config"
	"backend/internal/infrastructure/database"
	settingsrepo "backend/internal/infrastructure/repository/aisettings"
	documentrepo "backend/internal/infrastructure/repository/document"
	"backend/internal/infrastructure/secretbox"
)

type scriptedTester struct {
	err error
	// during runs inside the test, like something else happening while it waits on the provider.
	during func()
}

func (s *scriptedTester) Test(context.Context, string, aisettings.Config) (aisettings.TestReport, error) {
	if s.during != nil {
		s.during()
	}
	return aisettings.TestReport{Streaming: "supported"}, s.err
}

type aiEnv struct {
	*signInEnv
	tester *scriptedTester
}

func newAIEnv(t *testing.T) *aiEnv {
	t.Helper()
	tester := &scriptedTester{}
	env := newSignInEnv(t, func(c *config.Config) { c.AllowPrivateAIHosts = false })
	_, _ = env.db.Exec(`DELETE FROM ai_provider_settings`)
	_, _ = env.db.Exec(`DELETE FROM ai_provider_setting_changes`)
	t.Cleanup(func() {
		_, _ = env.db.Exec(`DELETE FROM ai_provider_settings`)
		_, _ = env.db.Exec(`DELETE FROM ai_provider_setting_changes`)
	})
	env.useAISettings(t, tester)
	return &aiEnv{signInEnv: env, tester: tester}
}

// useAISettings rebuilds the API with the settings service wired to a scripted provider tester.
func (e *signInEnv) useAISettings(t *testing.T, tester aisettings.Tester) {
	t.Helper()
	box, err := secretbox.New(base64.StdEncoding.EncodeToString([]byte(strings.Repeat("k", 32))))
	if err != nil {
		t.Fatal(err)
	}
	db := database.NewSQLDB(e.db)
	service := aisettings.NewService(aisettings.Deps{
		Store: settingsrepo.NewStore(db), Index: documentrepo.NewRepository(db), Cipher: box, Tester: tester,
		ProviderName: func(url string) string { return url },
	})
	e.app.AISettings = service
	e.api = InitRoutes(e.app, e.cfg)
}

type tokenUser struct{ id, token string }

func (e *signInEnv) registerWithToken(role string) tokenUser {
	e.t.Helper()
	email := e.newEmail("ai")
	res := e.do(http.MethodPost, "/api/v1/auth/register", map[string]string{"email": email, "password": localPassword, "fullName": "AI Person"}, nil, "")
	var out authBody
	res.json(&out)
	if res.Code != http.StatusCreated {
		e.t.Fatalf("register = %d %s", res.Code, res.Body.String())
	}
	if _, err := e.db.Exec(`UPDATE users SET email_verified_at = now() WHERE id = $1`, out.Data.User.ID); err != nil {
		e.t.Fatal(err)
	}
	if role != "" {
		e.grant(out.Data.User.ID, role)
	}
	return tokenUser{id: out.Data.User.ID, token: out.Data.AccessToken}
}

func (e *signInEnv) grant(userID, role string) {
	e.t.Helper()
	if _, err := e.db.Exec(`INSERT INTO roles (name, slug, is_system) VALUES ($1, $1, true) ON CONFLICT (slug) DO NOTHING`, role); err != nil {
		e.t.Fatal(err)
	}
	if _, err := e.db.Exec(`INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE slug = $2 ON CONFLICT DO NOTHING`, userID, role); err != nil {
		e.t.Fatal(err)
	}
}

func (e *signInEnv) as(u tokenUser, method, path string, body any) reply {
	e.t.Helper()
	return e.do(method, path, body, map[string]string{"Authorization": "Bearer " + u.token}, "")
}

var goodAnswer = map[string]string{"baseURL": "https://api.example.com/v1", "protocol": "openai_chat_completions", "model": "m-1", "apiKey": "sk-secret-abcd"}

func TestOnlyASuperadminReachesTheAISettings(t *testing.T) {
	env := newAIEnv(t)
	anonymous := env.do(http.MethodGet, "/api/v1/platform/ai", nil, nil, "")
	if anonymous.Code != http.StatusUnauthorized {
		t.Errorf("anonymous GET = %d", anonymous.Code)
	}
	for _, role := range []string{"", "admin", "member"} {
		user := env.registerWithToken(role)
		for _, call := range []struct {
			method, path string
			body         any
		}{
			{http.MethodGet, "/api/v1/platform/ai", nil},
			{http.MethodGet, "/api/v1/platform/ai/changes", nil},
			{http.MethodPut, "/api/v1/platform/ai/answer", goodAnswer},
			{http.MethodPost, "/api/v1/platform/ai/answer/test", goodAnswer},
		} {
			if res := env.as(user, call.method, call.path, call.body); res.Code != http.StatusForbidden {
				t.Errorf("role %q: %s %s = %d, want 403", role, call.method, call.path, res.Code)
			}
		}
	}
	var stored int
	_ = env.db.QueryRow(`SELECT COUNT(*) FROM ai_provider_settings`).Scan(&stored)
	if stored != 0 {
		t.Fatal("a refused request stored a setting")
	}
}

func TestASuperadminSavesASettingAndNeverGetsTheKeyBack(t *testing.T) {
	env := newAIEnv(t)
	super := env.registerWithToken("superadmin")
	res := env.as(super, http.MethodPut, "/api/v1/platform/ai/answer", goodAnswer)
	if res.Code != http.StatusOK {
		t.Fatalf("PUT = %d %s", res.Code, res.Body.String())
	}
	for _, path := range []string{"/api/v1/platform/ai", "/api/v1/platform/ai/changes"} {
		got := env.as(super, http.MethodGet, path, nil)
		if got.Code != http.StatusOK || strings.Contains(got.Body.String(), "sk-secret") {
			t.Fatalf("GET %s = %d, body holds the key: %s", path, got.Code, got.Body.String())
		}
	}
	overview := env.as(super, http.MethodGet, "/api/v1/platform/ai", nil)
	if !strings.Contains(overview.Body.String(), "••••abcd") || !strings.Contains(overview.Body.String(), "m-1") {
		t.Fatalf("overview = %s", overview.Body.String())
	}
	var raw string
	if err := env.db.QueryRow(`SELECT encode(api_key_ciphertext, 'escape') FROM ai_provider_settings WHERE purpose = 'answer'`).Scan(&raw); err != nil || strings.Contains(raw, "sk-secret") {
		t.Fatalf("the key is stored in clear text: %v", err)
	}
	changes := env.as(super, http.MethodGet, "/api/v1/platform/ai/changes", nil).Body.String()
	if !strings.Contains(changes, "replaced") || !strings.Contains(changes, "m-1") {
		t.Fatalf("changes = %s", changes)
	}
}

func TestAFailedConnectionTestSavesNothingAndExplainsWhy(t *testing.T) {
	env := newAIEnv(t)
	super := env.registerWithToken("superadmin")
	env.tester.err = errors.New("answer provider returned HTTP 401")
	res := env.as(super, http.MethodPut, "/api/v1/platform/ai/answer", goodAnswer)
	if res.Code != http.StatusUnprocessableEntity || !strings.Contains(res.Body.String(), "HTTP 401") || strings.Contains(res.Body.String(), "sk-secret") {
		t.Fatalf("PUT = %d %s", res.Code, res.Body.String())
	}
	var stored int
	_ = env.db.QueryRow(`SELECT COUNT(*) FROM ai_provider_settings`).Scan(&stored)
	if stored != 0 {
		t.Fatal("a failed test left a setting behind")
	}
	if test := env.as(super, http.MethodPost, "/api/v1/platform/ai/answer/test", goodAnswer); test.Code != http.StatusUnprocessableEntity {
		t.Fatalf("test endpoint = %d", test.Code)
	}
	env.tester.err = nil
	if test := env.as(super, http.MethodPost, "/api/v1/platform/ai/answer/test", goodAnswer); test.Code != http.StatusOK {
		t.Fatalf("test endpoint = %d %s", test.Code, test.Body.String())
	}
}

func TestBadSettingsAreRefusedWithAReason(t *testing.T) {
	env := newAIEnv(t)
	super := env.registerWithToken("superadmin")
	for name, body := range map[string]map[string]string{
		"http":     {"baseURL": "http://api.example.com/v1", "protocol": "openai_responses", "model": "m", "apiKey": "k"},
		"private":  {"baseURL": "https://169.254.169.254/v1", "protocol": "openai_responses", "model": "m", "apiKey": "k"},
		"no model": {"baseURL": "https://api.example.com/v1", "protocol": "openai_responses", "model": "", "apiKey": "k"},
	} {
		if res := env.as(super, http.MethodPut, "/api/v1/platform/ai/answer", body); res.Code != http.StatusBadRequest {
			t.Errorf("%s: PUT = %d %s", name, res.Code, res.Body.String())
		}
	}
	if res := env.as(super, http.MethodPut, "/api/v1/platform/ai/nonsense", goodAnswer); res.Code != http.StatusNotFound && res.Code != http.StatusBadRequest {
		t.Errorf("unknown purpose = %d", res.Code)
	}
	if res := env.as(super, http.MethodPut, "/api/v1/platform/ai/embedding_pending", goodAnswer); res.Code != http.StatusNotFound && res.Code != http.StatusBadRequest {
		t.Errorf("the pending purpose is not writable directly: %d", res.Code)
	}
}

func TestRevokingTheRoleTakesEffectWithoutANewToken(t *testing.T) {
	env := newAIEnv(t)
	super := env.registerWithToken("superadmin")
	if res := env.as(super, http.MethodGet, "/api/v1/platform/ai", nil); res.Code != http.StatusOK {
		t.Fatalf("GET = %d", res.Code)
	}
	if _, err := env.db.Exec(`DELETE FROM user_roles WHERE user_id = $1`, super.id); err != nil {
		t.Fatal(err)
	}
	if res := env.as(super, http.MethodGet, "/api/v1/platform/ai", nil); res.Code != http.StatusForbidden {
		t.Fatalf("GET after revoking = %d, want 403", res.Code)
	}
	_ = time.Now
}
