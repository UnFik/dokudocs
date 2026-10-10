//go:build integration

package routes

import (
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"testing"

	"backend/internal/config"
	"backend/internal/domain/model"

	"github.com/google/uuid"
)

const newPassword = "a brand new long password"

var passwordLinkPattern = regexp.MustCompile(regexp.QuoteMeta(appURL) + `/settings/account/set-password\?token=([A-Za-z0-9_-]+)`)

// passwordLinkToken returns the token in the newest set-password email.
func (e *signInEnv) passwordLinkToken() string {
	e.t.Helper()
	e.mailer.mu.Lock()
	defer e.mailer.mu.Unlock()
	for i := len(e.mailer.sent) - 1; i >= 0; i-- {
		if match := passwordLinkPattern.FindStringSubmatch(e.mailer.sent[i].Text); match != nil {
			return match[1]
		}
	}
	e.t.Fatal("no set-password email was sent")
	return ""
}

func (e *signInEnv) sentTo(email, subject string) int {
	e.mailer.mu.Lock()
	defer e.mailer.mu.Unlock()
	n := 0
	for _, m := range e.mailer.sent {
		if m.To == email && strings.Contains(m.Subject, subject) {
			n++
		}
	}
	return n
}

func (e *signInEnv) skipPasswordCooldown(userID string) {
	e.t.Helper()
	if _, err := e.db.Exec(`UPDATE password_tokens SET created_at = created_at - interval '2 minutes' WHERE user_id = $1`, userID); err != nil {
		e.t.Fatal(err)
	}
}

func (e *signInEnv) googleOnlyUser(prefix string) (id, email, token string) {
	e.t.Helper()
	email = e.newEmail(prefix)
	code := "code-" + uuid.NewString()
	e.google.identities[code] = model.ProviderIdentity{Subject: "sub-" + uuid.NewString(), Email: email, EmailVerified: true, Name: "Google Only"}
	var out signedInBody
	res := e.signIn(code)
	res.json(&out)
	if res.Code != http.StatusOK {
		e.t.Fatalf("google sign-in = %d %s", res.Code, res.Body.String())
	}
	return out.Data.User.ID, email, out.Data.AccessToken
}

func TestAGoogleOnlyUserSetsAPasswordThroughAnEmailedLink(t *testing.T) {
	env := newSignInEnv(t, nil)
	_, email, token := env.googleOnlyUser("setpw")

	if res := env.do(http.MethodPost, "/api/v1/auth/password/link", nil, bearer(token), ""); res.Code != http.StatusNoContent {
		t.Fatalf("send link = %d %s, want 204", res.Code, res.Body.String())
	}
	if env.sentTo(email, "password") != 1 {
		t.Fatalf("the link must go to the account email %s", email)
	}
	link := env.passwordLinkToken()

	if res := env.do(http.MethodPost, "/api/v1/auth/password/check", map[string]string{"token": link}, bearer(token), ""); res.Code != http.StatusNoContent {
		t.Fatalf("check = %d %s, want 204", res.Code, res.Body.String())
	}
	if res := env.do(http.MethodPost, "/api/v1/auth/password/check", map[string]string{"token": link}, bearer(token), ""); res.Code != http.StatusNoContent {
		t.Fatalf("a check must not use the link up, second check = %d", res.Code)
	}
	for name, password := range map[string]string{"short": "short", "over 72 bytes": strings.Repeat("é", 40)} {
		if res := env.do(http.MethodPost, "/api/v1/auth/password", map[string]string{"token": link, "password": password}, bearer(token), ""); res.Code != http.StatusBadRequest {
			t.Fatalf("%s password = %d, want 400", name, res.Code)
		}
	}
	if res := env.do(http.MethodPost, "/api/v1/auth/password", map[string]string{"token": link, "password": newPassword}, bearer(token), ""); res.Code != http.StatusNoContent {
		t.Fatalf("set password = %d %s, want 204 (a bad password must not use the link up)", res.Code, res.Body.String())
	}
	if res := env.do(http.MethodPost, "/api/v1/auth/login", map[string]string{"email": email, "password": newPassword}, nil, ""); res.Code != http.StatusOK {
		t.Fatalf("login with the new password = %d, want 200", res.Code)
	}
	if env.sentTo(email, "password was changed") != 1 {
		t.Fatal("the User must be told by email that the password changed")
	}
	if res := env.do(http.MethodPost, "/api/v1/auth/password", map[string]string{"token": link, "password": newPassword + "x"}, bearer(token), ""); res.Code != http.StatusBadRequest {
		t.Fatalf("a link works once, second use = %d, want 400", res.Code)
	}
	if res := env.do(http.MethodPost, "/api/v1/auth/password/check", map[string]string{"token": link}, bearer(token), ""); res.Code != http.StatusBadRequest {
		t.Fatalf("check of a used link = %d, want 400", res.Code)
	}
}

func TestAUserWithAPasswordChangesItThroughTheSameFlow(t *testing.T) {
	env := newSignInEnv(t, nil)
	id, email, token := env.localUser("changepw")
	if res := env.do(http.MethodPost, "/api/v1/auth/password/link", nil, bearer(token), ""); res.Code != http.StatusNoContent {
		t.Fatalf("send link = %d %s", res.Code, res.Body.String())
	}
	link := env.passwordLinkToken()
	if res := env.do(http.MethodPost, "/api/v1/auth/password", map[string]string{"token": link, "password": newPassword}, bearer(token), ""); res.Code != http.StatusNoContent {
		t.Fatalf("change password = %d %s, want 204", res.Code, res.Body.String())
	}
	if res := env.do(http.MethodPost, "/api/v1/auth/login", map[string]string{"email": email, "password": localPassword}, nil, ""); res.Code != http.StatusUnauthorized {
		t.Fatalf("login with the old password = %d, want 401", res.Code)
	}
	if res := env.do(http.MethodPost, "/api/v1/auth/login", map[string]string{"email": email, "password": newPassword}, nil, ""); res.Code != http.StatusOK {
		t.Fatalf("login with the new password = %d, want 200", res.Code)
	}
	_ = id
}

func TestAPasswordLinkBelongsToItsUser(t *testing.T) {
	env := newSignInEnv(t, nil)
	_, _, owner := env.localUser("owner")
	_, _, other := env.localUser("other")
	env.do(http.MethodPost, "/api/v1/auth/password/link", nil, bearer(owner), "")
	link := env.passwordLinkToken()

	if res := env.do(http.MethodPost, "/api/v1/auth/password/check", map[string]string{"token": link}, bearer(other), ""); res.Code != http.StatusBadRequest {
		t.Fatalf("someone else's link, check = %d, want 400", res.Code)
	}
	if res := env.do(http.MethodPost, "/api/v1/auth/password", map[string]string{"token": link, "password": newPassword}, bearer(other), ""); res.Code != http.StatusBadRequest {
		t.Fatalf("someone else's link, set = %d, want 400", res.Code)
	}
	if res := env.do(http.MethodPost, "/api/v1/auth/password/check", map[string]string{"token": "not-a-real-token"}, bearer(owner), ""); res.Code != http.StatusBadRequest {
		t.Fatalf("unknown link = %d, want 400", res.Code)
	}
	// The failed attempt by the other User did not use the link up.
	if res := env.do(http.MethodPost, "/api/v1/auth/password", map[string]string{"token": link, "password": newPassword}, bearer(owner), ""); res.Code != http.StatusNoContent {
		t.Fatalf("the owner's link after a stranger tried it = %d, want 204", res.Code)
	}
}

func TestAnExpiredPasswordLinkIsRefused(t *testing.T) {
	env := newSignInEnv(t, nil)
	id, _, token := env.localUser("expired")
	env.do(http.MethodPost, "/api/v1/auth/password/link", nil, bearer(token), "")
	link := env.passwordLinkToken()
	if _, err := env.db.Exec(`UPDATE password_tokens SET expires_at = now() - interval '1 minute' WHERE user_id = $1`, id); err != nil {
		t.Fatal(err)
	}
	if res := env.do(http.MethodPost, "/api/v1/auth/password", map[string]string{"token": link, "password": newPassword}, bearer(token), ""); res.Code != http.StatusBadRequest {
		t.Fatalf("expired link = %d, want 400", res.Code)
	}
}

func TestOnlyTheNewestPasswordLinkWorksAndAskingTooSoonIsRefused(t *testing.T) {
	env := newSignInEnv(t, nil)
	id, email, token := env.localUser("newest")
	env.do(http.MethodPost, "/api/v1/auth/password/link", nil, bearer(token), "")
	first := env.passwordLinkToken()
	if res := env.do(http.MethodPost, "/api/v1/auth/password/link", nil, bearer(token), ""); res.Code != http.StatusTooManyRequests {
		t.Fatalf("immediate second link = %d, want 429", res.Code)
	}
	if env.sentTo(email, "password") != 1 {
		t.Fatal("a refused request must not send an email")
	}
	env.skipPasswordCooldown(id)
	if res := env.do(http.MethodPost, "/api/v1/auth/password/link", nil, bearer(token), ""); res.Code != http.StatusNoContent {
		t.Fatalf("link after the cooldown = %d, want 204", res.Code)
	}
	second := env.passwordLinkToken()
	if first == second {
		t.Fatal("a new request must send a new link")
	}
	if res := env.do(http.MethodPost, "/api/v1/auth/password", map[string]string{"token": first, "password": newPassword}, bearer(token), ""); res.Code != http.StatusBadRequest {
		t.Fatalf("the replaced link = %d, want 400", res.Code)
	}
	if res := env.do(http.MethodPost, "/api/v1/auth/password", map[string]string{"token": second, "password": newPassword}, bearer(token), ""); res.Code != http.StatusNoContent {
		t.Fatalf("the newest link = %d, want 204", res.Code)
	}
}

func TestAPasswordLinkThatCannotBeSentIsDiscarded(t *testing.T) {
	env := newSignInEnv(t, nil)
	_, _, token := env.localUser("down")
	env.mailer.fail = fmt.Errorf("smtp down")
	if res := env.do(http.MethodPost, "/api/v1/auth/password/link", nil, bearer(token), ""); res.Code != http.StatusBadGateway {
		t.Fatalf("send with the mail server down = %d, want 502", res.Code)
	}
	env.mailer.fail = nil
	if res := env.do(http.MethodPost, "/api/v1/auth/password/link", nil, bearer(token), ""); res.Code != http.StatusNoContent {
		t.Fatalf("retry right after a failed send = %d, want 204 without waiting out the cooldown", res.Code)
	}
}

func TestChangingThePasswordSucceedsWhenTheNoticeCannotBeSent(t *testing.T) {
	env := newSignInEnv(t, nil)
	_, _, token := env.localUser("notice")
	env.do(http.MethodPost, "/api/v1/auth/password/link", nil, bearer(token), "")
	link := env.passwordLinkToken()
	env.mailer.fail = fmt.Errorf("smtp down")
	if res := env.do(http.MethodPost, "/api/v1/auth/password", map[string]string{"token": link, "password": newPassword}, bearer(token), ""); res.Code != http.StatusNoContent {
		t.Fatalf("change with the notice failing = %d, want 204", res.Code)
	}
}

func TestPasswordLinksAreClosedToUnverifiedUsers(t *testing.T) {
	env := newSignInEnv(t, func(c *config.Config) { c.RequireEmailVerification = true })
	_, _, token := env.localUser("unverified")
	res := env.do(http.MethodPost, "/api/v1/auth/password/link", nil, bearer(token), "")
	var body authBody
	res.json(&body)
	if res.Code != http.StatusForbidden || body.Code != "email_not_verified" {
		t.Fatalf("link for an unverified User = %d %s, want 403 email_not_verified", res.Code, res.Body.String())
	}
}

func TestPasswordEndpointsNeedASignedInUser(t *testing.T) {
	env := newSignInEnv(t, nil)
	for _, path := range []string{"/api/v1/auth/password/link", "/api/v1/auth/password/check", "/api/v1/auth/password"} {
		if res := env.do(http.MethodPost, path, map[string]string{"token": "x", "password": newPassword}, nil, ""); res.Code != http.StatusUnauthorized {
			t.Errorf("POST %s without a token = %d, want 401", path, res.Code)
		}
	}
}

func TestSettingAPasswordWithoutALinkIsRefused(t *testing.T) {
	env := newSignInEnv(t, nil)
	_, _, token := env.googleOnlyUser("nolink")
	if res := env.do(http.MethodPost, "/api/v1/auth/password", map[string]string{"password": newPassword}, bearer(token), ""); res.Code != http.StatusBadRequest {
		t.Fatalf("set password with no token = %d, want 400", res.Code)
	}
}
