//go:build integration

package routes

import (
	"net/http"
	"net/url"
	"testing"

	"backend/internal/domain/model"

	"github.com/google/uuid"
)

// localUser registers an email-and-password User and returns its id and token.
func (e *signInEnv) localUser(prefix string) (id, email, token string) {
	e.t.Helper()
	email = e.newEmail(prefix)
	res := e.do(http.MethodPost, "/api/v1/auth/register", map[string]string{"email": email, "password": localPassword, "fullName": "Linking Person"}, nil, "")
	var out signedInBody
	res.json(&out)
	if res.Code != http.StatusCreated {
		e.t.Fatalf("register = %d %s", res.Code, res.Body.String())
	}
	return out.Data.User.ID, email, out.Data.AccessToken
}

func bearer(token string) map[string]string {
	return map[string]string{"Authorization": "Bearer " + token}
}

// link runs start, callback for a signed-in User and returns the callback reply.
func (e *signInEnv) link(token, code string) reply {
	e.t.Helper()
	state, binding, started := e.start("/settings/account", bearer(token))
	if started.Code != http.StatusOK {
		e.t.Fatalf("link start = %d %s", started.Code, started.Body.String())
	}
	return e.callback(url.Values{"code": {code}, "state": {state}}, binding)
}

func locationQuery(t *testing.T, r reply, wantPath string) url.Values {
	t.Helper()
	if r.Code != http.StatusFound {
		t.Fatalf("status = %d %s, want 302", r.Code, r.Body.String())
	}
	location, err := url.Parse(r.Header().Get("Location"))
	if err != nil || location.Scheme+"://"+location.Host != appURL || location.Path != wantPath {
		t.Fatalf("redirect = %s, want %s%s", r.Header().Get("Location"), appURL, wantPath)
	}
	return location.Query()
}

type identitiesBody struct {
	Data struct {
		HasPassword bool `json:"hasPassword"`
		Identities  []struct {
			Provider string `json:"provider"`
			Email    string `json:"email"`
		} `json:"identities"`
	} `json:"data"`
}

func TestSignedInUserLinksGoogleWithAnotherEmail(t *testing.T) {
	env := newSignInEnv(t, nil)
	userID, email, token := env.localUser("link")
	googleEmail := env.newEmail("their-gmail")
	env.google.identities["c"] = model.ProviderIdentity{Subject: "sub-" + uuid.NewString(), Email: googleEmail, EmailVerified: true, Name: "Linking Person"}

	query := locationQuery(t, env.link(token, "c"), "/settings/account")
	if query.Get("linked") != "google" || query.Get("link_error") != "" {
		t.Fatalf("redirect query = %v, want linked=google", query)
	}
	var owner string
	_ = env.db.QueryRow(`SELECT user_id FROM oauth_accounts WHERE provider_email = $1`, googleEmail).Scan(&owner)
	if owner != userID {
		t.Fatalf("identity belongs to %q, want the signed-in User %q", owner, userID)
	}
	var users int
	_ = env.db.QueryRow(`SELECT count(*) FROM users WHERE email = $1`, googleEmail).Scan(&users)
	if users != 0 {
		t.Fatal("linking must not create a User for the Google email")
	}

	var list identitiesBody
	res := env.do(http.MethodGet, "/api/v1/auth/identities", nil, bearer(token), "")
	res.json(&list)
	if res.Code != http.StatusOK || !list.Data.HasPassword || len(list.Data.Identities) != 1 || list.Data.Identities[0].Provider != "google" || list.Data.Identities[0].Email != googleEmail {
		t.Fatalf("identities = %d %s", res.Code, res.Body.String())
	}
	if login := env.do(http.MethodPost, "/api/v1/auth/login", map[string]string{"email": email, "password": localPassword}, nil, ""); login.Code != http.StatusOK {
		t.Fatalf("password login after linking = %d, want 200", login.Code)
	}
	// Signing in with that Google account now reaches the same User.
	var out signedInBody
	exchange := env.signIn("c")
	exchange.json(&out)
	if exchange.Code != http.StatusOK || out.Data.User.ID != userID {
		t.Fatalf("sign-in with the linked account = %d %s, want User %s", exchange.Code, exchange.Body.String(), userID)
	}
}

func TestLinkingFailsWhenTheGoogleAccountBelongsToSomeoneElse(t *testing.T) {
	env := newSignInEnv(t, nil)
	subject := "sub-" + uuid.NewString()
	env.google.identities["owner"] = model.ProviderIdentity{Subject: subject, Email: env.newEmail("owner"), EmailVerified: true, Name: "The Owner"}
	env.signIn("owner")

	_, _, token := env.localUser("other")
	env.google.identities["same"] = model.ProviderIdentity{Subject: subject, Email: env.newEmail("same"), EmailVerified: true, Name: "The Owner"}
	query := locationQuery(t, env.link(token, "same"), "/settings/account")
	if query.Get("link_error") != "identity_in_use" || query.Get("linked") != "" {
		t.Fatalf("redirect query = %v, want link_error=identity_in_use", query)
	}
	var n int
	_ = env.db.QueryRow(`SELECT count(*) FROM oauth_accounts WHERE provider_user_id = $1`, subject).Scan(&n)
	if n != 1 {
		t.Fatalf("identity rows for the subject = %d, want 1", n)
	}
}

func TestLinkingASecondGoogleAccountIsRefused(t *testing.T) {
	env := newSignInEnv(t, nil)
	_, _, token := env.localUser("two")
	env.google.identities["a"] = model.ProviderIdentity{Subject: "sub-" + uuid.NewString(), Email: env.newEmail("a"), EmailVerified: true, Name: "First Account"}
	env.google.identities["b"] = model.ProviderIdentity{Subject: "sub-" + uuid.NewString(), Email: env.newEmail("b"), EmailVerified: true, Name: "Second Account"}
	if q := locationQuery(t, env.link(token, "a"), "/settings/account"); q.Get("linked") != "google" {
		t.Fatalf("first link: %v", q)
	}
	if q := locationQuery(t, env.link(token, "b"), "/settings/account"); q.Get("link_error") != "provider_linked" {
		t.Fatalf("second link: %v, want link_error=provider_linked", q)
	}
}

func TestStartWithAnInvalidBearerTokenIsRefused(t *testing.T) {
	env := newSignInEnv(t, nil)
	if _, _, res := env.start("", bearer("not-a-token")); res.Code != http.StatusUnauthorized {
		t.Fatalf("start with a bad token = %d, want 401: it must not fall back to signing in", res.Code)
	}
}

func TestUnlinkKeepsAtLeastOneWayToSignIn(t *testing.T) {
	env := newSignInEnv(t, nil)
	// A Google-only User has no password: unlinking would lock them out.
	env.google.identities["g"] = model.ProviderIdentity{Subject: "sub-" + uuid.NewString(), Email: env.newEmail("gonly"), EmailVerified: true, Name: "Google Only"}
	var out signedInBody
	res := env.signIn("g")
	res.json(&out)
	token := out.Data.AccessToken
	if res := env.do(http.MethodDelete, "/api/v1/auth/identities/google", nil, bearer(token), ""); res.Code != http.StatusConflict {
		t.Fatalf("unlink the only way to sign in = %d %s, want 409", res.Code, res.Body.String())
	}

	// Set a password through the emailed link, then unlinking is fine.
	if res := env.do(http.MethodPost, "/api/v1/auth/password/link", nil, bearer(token), ""); res.Code != http.StatusNoContent {
		t.Fatalf("send link = %d %s, want 204", res.Code, res.Body.String())
	}
	link := env.passwordLinkToken()
	if res := env.do(http.MethodPost, "/api/v1/auth/password", map[string]string{"token": link, "password": localPassword}, bearer(token), ""); res.Code != http.StatusNoContent {
		t.Fatalf("set password = %d %s, want 204", res.Code, res.Body.String())
	}
	if res := env.do(http.MethodPost, "/api/v1/auth/login", map[string]string{"email": out.Data.User.Email, "password": localPassword}, nil, ""); res.Code != http.StatusOK {
		t.Fatalf("login with the new password = %d, want 200", res.Code)
	}
	if res := env.do(http.MethodDelete, "/api/v1/auth/identities/google", nil, bearer(token), ""); res.Code != http.StatusNoContent {
		t.Fatalf("unlink with a password = %d %s, want 204", res.Code, res.Body.String())
	}
	if res := env.do(http.MethodDelete, "/api/v1/auth/identities/google", nil, bearer(token), ""); res.Code != http.StatusNotFound {
		t.Fatalf("unlink twice = %d, want 404", res.Code)
	}
	var list identitiesBody
	env.do(http.MethodGet, "/api/v1/auth/identities", nil, bearer(token), "").json(&list)
	if !list.Data.HasPassword || len(list.Data.Identities) != 0 {
		t.Fatalf("after unlinking: %+v", list.Data)
	}
}

func TestIdentityEndpointsNeedASignedInUser(t *testing.T) {
	env := newSignInEnv(t, nil)
	for _, c := range []struct{ method, path string }{
		{http.MethodGet, "/api/v1/auth/identities"},
		{http.MethodDelete, "/api/v1/auth/identities/google"},
		{http.MethodPost, "/api/v1/auth/password"},
		{http.MethodPost, "/api/v1/auth/password/link"},
	} {
		if res := env.do(c.method, c.path, nil, nil, ""); res.Code != http.StatusUnauthorized {
			t.Errorf("%s %s without a token = %d, want 401", c.method, c.path, res.Code)
		}
	}
}

func TestAUserWithoutAPasswordCannotSignInWithOne(t *testing.T) {
	env := newSignInEnv(t, nil)
	email := env.newEmail("nopw")
	env.google.identities["g"] = model.ProviderIdentity{Subject: "sub-" + uuid.NewString(), Email: email, EmailVerified: true, Name: "No Password"}
	env.signIn("g")
	for _, password := range []string{"", localPassword, "x"} {
		res := env.do(http.MethodPost, "/api/v1/auth/login", map[string]string{"email": email, "password": password}, nil, "")
		if res.Code != http.StatusUnauthorized && res.Code != http.StatusBadRequest {
			t.Fatalf("login with password %q = %d %s, want 401 (or 400 for empty)", password, res.Code, res.Body.String())
		}
	}
}
