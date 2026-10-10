package google

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"backend/internal/domain/contract/repository"
	"backend/internal/domain/model"
	"github.com/golang-jwt/jwt/v5"
)

const (
	testClientID     = "client-id"
	testClientSecret = "client-secret"
	testRedirectURL  = "https://client.example.test/callback"
	testState        = "state-value"
	testNonce        = "nonce-value"
	testVerifier     = "verifier-value"
	testKeyID        = "test-key"
	testIssuedAt     = int64(1700000000)
	testExpiry       = int64(4102444800)
)

type googleTestServer struct {
	server     *httptest.Server
	private    *rsa.PrivateKey
	token      string
	tokenCalls int
	jwksCalls  int
	// jwksCacheControl is sent with the key set; keyID is the kid new tokens are
	// signed with, jwksKeyID the kid the key set publishes (both default to testKeyID).
	jwksCacheControl string
	keyID            string
	jwksKeyID        string
}

func newGoogleTestServer(t *testing.T) *googleTestServer {
	t.Helper()
	private, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	fixture := &googleTestServer{private: private}
	fixture.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/token":
			fixture.tokenCalls++
			if r.Method != http.MethodPost {
				t.Errorf("token method = %s, want POST", r.Method)
			}
			if err := r.ParseForm(); err != nil {
				t.Errorf("parse token form: %v", err)
			}
			for key, want := range map[string]string{
				"code":          "auth-code",
				"client_id":     testClientID,
				"client_secret": testClientSecret,
				"redirect_uri":  testRedirectURL,
				"grant_type":    "authorization_code",
				"code_verifier": testVerifier,
			} {
				if got := r.Form.Get(key); got != want {
					t.Errorf("token %s = %q, want %q", key, got, want)
				}
			}
			w.Header().Set("Content-Type", "application/json")
			if fixture.token == "" {
				w.WriteHeader(http.StatusBadRequest)
				_, _ = io.WriteString(w, `{"error":"invalid_grant"}`)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"access_token": "access-token",
				"id_token":     fixture.token,
				"token_type":   "Bearer",
				"expires_in":   3600,
			})
		case "/oauth2/v3/certs":
			fixture.jwksCalls++
			if r.Method != http.MethodGet {
				t.Errorf("JWKS method = %s, want GET", r.Method)
			}
			w.Header().Set("Content-Type", "application/json")
			if fixture.jwksCacheControl != "" {
				w.Header().Set("Cache-Control", fixture.jwksCacheControl)
			}
			kid := testKeyID
			if fixture.jwksKeyID != "" {
				kid = fixture.jwksKeyID
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"keys": []map[string]string{rsaJWK(&fixture.private.PublicKey, kid)},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	return fixture
}

type googleTransport struct {
	server *url.URL
	base   http.RoundTripper
}

func (t googleTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if req.URL.Host != "oauth2.googleapis.com" && req.URL.Host != "www.googleapis.com" {
		return nil, fmt.Errorf("unexpected outbound host %q", req.URL.Host)
	}
	clone := req.Clone(req.Context())
	u := *req.URL
	u.Scheme = t.server.Scheme
	u.Host = t.server.Host
	clone.URL = &u
	return t.base.RoundTrip(clone)
}

func useGoogleTestTransport(t *testing.T, serverURL string) {
	t.Helper()
	parsed, err := url.Parse(serverURL)
	if err != nil {
		t.Fatal(err)
	}
	previous := http.DefaultTransport
	http.DefaultTransport = googleTransport{server: parsed, base: previous}
	t.Cleanup(func() { http.DefaultTransport = previous })
}

func TestProviderAuthorizationURL(t *testing.T) {
	provider := NewProvider(testClientID, testClientSecret, testRedirectURL)
	var googleProvider repository.IdentityProvider = provider

	got, err := url.Parse(googleProvider.AuthorizationURL(testState, testNonce, testVerifier))
	if err != nil {
		t.Fatal(err)
	}
	query := got.Query()
	if got.Host != "accounts.google.com" || got.Path != "/o/oauth2/v2/auth" {
		t.Fatalf("unexpected authorization endpoint: %s", got)
	}
	if gotParam := query.Get("scope"); gotParam != "openid email profile" {
		t.Errorf("scope = %q, want %q", gotParam, "openid email profile")
	}
	if query.Get("state") != testState || query.Get("nonce") != testNonce {
		t.Errorf("authorization parameters = %v", query)
	}
	if query.Get("code_challenge_method") != "S256" {
		t.Errorf("code_challenge_method = %q", query.Get("code_challenge_method"))
	}
	hash := sha256.Sum256([]byte(testVerifier))
	wantChallenge := base64.RawURLEncoding.EncodeToString(hash[:])
	if query.Get("code_challenge") != wantChallenge {
		t.Errorf("code_challenge = %q, want %q", query.Get("code_challenge"), wantChallenge)
	}
}

func TestProviderVerify(t *testing.T) {
	fixture := newGoogleTestServer(t)
	defer fixture.server.Close()
	useGoogleTestTransport(t, fixture.server.URL)

	provider := NewProvider(testClientID, testClientSecret, testRedirectURL)
	var googleProvider repository.IdentityProvider = provider

	tests := []struct {
		name       string
		mutate     func(jwt.MapClaims)
		otherKey   bool
		tokenError bool
		wantID     string
		wantEmail  string
		wantName   string
		wantError  bool
	}{
		{
			name:      "valid claims",
			wantID:    "subject-123",
			wantEmail: "user@example.com",
			wantName:  "Example User",
		},
		{
			name:      "nonce failure",
			mutate:    func(claims jwt.MapClaims) { claims["nonce"] = "wrong-nonce" },
			wantError: true,
		},
		{
			name:      "signature failure",
			otherKey:  true,
			wantError: true,
		},
		{
			name:      "issuer failure",
			mutate:    func(claims jwt.MapClaims) { claims["iss"] = "https://evil.example.com" },
			wantError: true,
		},
		{
			name:      "audience failure",
			mutate:    func(claims jwt.MapClaims) { claims["aud"] = "wrong-client" },
			wantError: true,
		},
		{
			name:      "expiry failure",
			mutate:    func(claims jwt.MapClaims) { claims["exp"] = testIssuedAt - 1 },
			wantError: true,
		},
		{
			name:      "unverified email",
			mutate:    func(claims jwt.MapClaims) { claims["email_verified"] = false },
			wantError: true,
		},
		{
			name:      "invalid name",
			mutate:    func(claims jwt.MapClaims) { claims["name"] = 42 },
			wantError: true,
		},
		{
			name:       "clean generic errors",
			tokenError: true,
			wantError:  true,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			claims := jwt.MapClaims{
				"iss":            "https://accounts.google.com",
				"aud":            testClientID,
				"sub":            "subject-123",
				"email":          "user@example.com",
				"email_verified": true,
				"name":           "Example User",
				"nonce":          testNonce,
				"exp":            testExpiry,
				"iat":            testIssuedAt,
			}
			if test.mutate != nil {
				test.mutate(claims)
			}
			if test.tokenError {
				fixture.token = ""
			} else {
				key := fixture.private
				if test.otherKey {
					var err error
					key, err = rsa.GenerateKey(rand.Reader, 2048)
					if err != nil {
						t.Fatal(err)
					}
				}
				fixture.token = signGoogleClaims(t, key, claims)
			}

			identity, err := googleProvider.Verify(context.Background(), "auth-code", testVerifier, testNonce)
			if test.wantError {
				if err == nil {
					t.Fatal("Verify() error = nil, want error")
				}
				if strings.Contains(err.Error(), "invalid_grant") || strings.Contains(err.Error(), "crypto/rsa") {
					t.Fatalf("Verify() exposed provider detail: %v", err)
				}
				if identity != (model.ProviderIdentity{}) {
					t.Errorf("identity = %+v, want zero identity", identity)
				}
				return
			}
			if err != nil {
				t.Fatalf("Verify() error = %v", err)
			}
			want := fmt.Sprintf("%s %s %s", test.wantID, test.wantEmail, test.wantName)
			got := fmt.Sprintf("%s %s %s", identity.Subject, identity.Email, identity.Name)
			if got != want {
				t.Errorf("identity = %q, want %q", got, want)
			}
			if fixture.tokenCalls != 1 {
				t.Errorf("token calls = %d, want 1", fixture.tokenCalls)
			}
			if fixture.jwksCalls != 1 {
				t.Errorf("JWKS calls = %d, want 1", fixture.jwksCalls)
			}
		})
	}
}

func signGoogleClaims(t *testing.T, key *rsa.PrivateKey, claims jwt.MapClaims) string {
	return signGoogleClaimsWithKeyID(t, key, claims, "")
}

func signGoogleClaimsWithKeyID(t *testing.T, key *rsa.PrivateKey, claims jwt.MapClaims, keyID string) string {
	t.Helper()
	if keyID == "" {
		keyID = testKeyID
	}
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	token.Header["kid"] = keyID
	signed, err := token.SignedString(key)
	if err != nil {
		t.Fatal(err)
	}
	return signed
}

func rsaJWK(key *rsa.PublicKey, keyID string) map[string]string {
	return map[string]string{
		"kty": "RSA",
		"kid": keyID,
		"use": "sig",
		"alg": "RS256",
		"n":   base64.RawURLEncoding.EncodeToString(key.N.Bytes()),
		"e":   base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.E)).Bytes()),
	}
}

func validClaims() jwt.MapClaims {
	return jwt.MapClaims{
		"iss": "https://accounts.google.com", "aud": testClientID, "sub": "subject-123",
		"email": "user@example.com", "email_verified": true, "name": "Example User",
		"nonce": testNonce, "exp": testExpiry, "iat": testIssuedAt,
	}
}

func verifyWith(t *testing.T, fixture *googleTestServer, p *Provider, claims jwt.MapClaims) (model.ProviderIdentity, error) {
	t.Helper()
	fixture.token = signGoogleClaimsWithKeyID(t, fixture.private, claims, fixture.keyID)
	return p.Verify(context.Background(), "auth-code", testVerifier, testNonce)
}

func TestProviderRequiresAnExpiry(t *testing.T) {
	fixture := newGoogleTestServer(t)
	defer fixture.server.Close()
	useGoogleTestTransport(t, fixture.server.URL)
	claims := validClaims()
	delete(claims, "exp")
	if _, err := verifyWith(t, fixture, NewProvider(testClientID, testClientSecret, testRedirectURL), claims); err == nil {
		t.Fatal("a token with no exp must be refused")
	}
}

func TestProviderReturnsTheProfilePictureAndVerifiedFlag(t *testing.T) {
	fixture := newGoogleTestServer(t)
	defer fixture.server.Close()
	useGoogleTestTransport(t, fixture.server.URL)
	claims := validClaims()
	claims["picture"] = "https://lh3.googleusercontent.com/a/photo=s96-c"
	identity, err := verifyWith(t, fixture, NewProvider(testClientID, testClientSecret, testRedirectURL), claims)
	if err != nil {
		t.Fatal(err)
	}
	if identity.AvatarURL != "https://lh3.googleusercontent.com/a/photo=s96-c" || !identity.EmailVerified {
		t.Fatalf("identity = %+v", identity)
	}
}

func TestProviderIgnoresAPictureThatIsNotHTTPS(t *testing.T) {
	fixture := newGoogleTestServer(t)
	defer fixture.server.Close()
	useGoogleTestTransport(t, fixture.server.URL)
	for _, picture := range []any{"javascript:alert(1)", "http://example.com/a.png", 42, strings.Repeat("a", 3000)} {
		claims := validClaims()
		claims["picture"] = picture
		identity, err := verifyWith(t, fixture, NewProvider(testClientID, testClientSecret, testRedirectURL), claims)
		if err != nil {
			t.Fatalf("picture %v: a bad picture must not fail the sign-in: %v", picture, err)
		}
		if identity.AvatarURL != "" {
			t.Fatalf("picture %v accepted as %q", picture, identity.AvatarURL)
		}
	}
}

func TestProviderFallsBackToTheEmailNameWhenThereIsNoName(t *testing.T) {
	fixture := newGoogleTestServer(t)
	defer fixture.server.Close()
	useGoogleTestTransport(t, fixture.server.URL)
	claims := validClaims()
	delete(claims, "name")
	identity, err := verifyWith(t, fixture, NewProvider(testClientID, testClientSecret, testRedirectURL), claims)
	if err != nil {
		t.Fatal(err)
	}
	if identity.Name != "user" {
		t.Fatalf("name = %q, want the part of the email before @", identity.Name)
	}
}

func TestProviderUsesTheEndpointsItIsGiven(t *testing.T) {
	fixture := newGoogleTestServer(t)
	defer fixture.server.Close()
	p := NewProvider(testClientID, testClientSecret, testRedirectURL, WithEndpoints(Endpoints{
		Authorization: fixture.server.URL + "/auth",
		Token:         fixture.server.URL + "/token",
		JWKS:          fixture.server.URL + "/oauth2/v3/certs",
	}))
	if got := p.AuthorizationURL(testState, testNonce, testVerifier); !strings.HasPrefix(got, fixture.server.URL+"/auth?") {
		t.Fatalf("authorization url = %s", got)
	}
	if _, err := verifyWith(t, fixture, p, validClaims()); err != nil {
		t.Fatalf("verify against injected endpoints: %v", err)
	}
}

func TestProviderGivesUpOnASlowServer(t *testing.T) {
	release := make(chan struct{})
	slow := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-release:
		}
	}))
	defer slow.Close()
	defer close(release)
	p := NewProvider(testClientID, testClientSecret, testRedirectURL,
		WithEndpoints(Endpoints{Token: slow.URL, JWKS: slow.URL}), WithTimeout(50*time.Millisecond))
	start := time.Now()
	if _, err := p.Verify(context.Background(), "auth-code", testVerifier, testNonce); err == nil {
		t.Fatal("want an error")
	}
	if time.Since(start) > 2*time.Second {
		t.Fatalf("took %s, the timeout did not apply", time.Since(start))
	}
}

func TestProviderRefusesAnOversizedResponse(t *testing.T) {
	big := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, `{"id_token":"`+strings.Repeat("a", 2<<20)+`"}`)
	}))
	defer big.Close()
	p := NewProvider(testClientID, testClientSecret, testRedirectURL, WithEndpoints(Endpoints{Token: big.URL, JWKS: big.URL}))
	if _, err := p.Verify(context.Background(), "auth-code", testVerifier, testNonce); err == nil {
		t.Fatal("want an error for a response over the size limit")
	}
}

type clock struct{ now time.Time }

func (c *clock) Now() time.Time { return c.now }

func TestProviderKeepsKeysUntilTheirCacheLifetimeEnds(t *testing.T) {
	fixture := newGoogleTestServer(t)
	defer fixture.server.Close()
	fixture.jwksCacheControl = "public, max-age=600"
	c := &clock{now: time.Unix(1_800_000_000, 0)}
	p := NewProvider(testClientID, testClientSecret, testRedirectURL, WithClock(c.Now), WithEndpoints(Endpoints{
		Authorization: fixture.server.URL + "/auth", Token: fixture.server.URL + "/token", JWKS: fixture.server.URL + "/oauth2/v3/certs",
	}))
	for i := 0; i < 3; i++ {
		if _, err := verifyWith(t, fixture, p, validClaims()); err != nil {
			t.Fatal(err)
		}
	}
	if fixture.jwksCalls != 1 {
		t.Fatalf("within max-age the keys must not be fetched again, fetched %d times", fixture.jwksCalls)
	}
	c.now = c.now.Add(11 * time.Minute)
	if _, err := verifyWith(t, fixture, p, validClaims()); err != nil {
		t.Fatal(err)
	}
	if fixture.jwksCalls != 2 {
		t.Fatalf("after max-age the keys are fetched again, fetched %d times", fixture.jwksCalls)
	}
}

func TestProviderReloadsKeysOncePerMinuteForAnUnknownKeyID(t *testing.T) {
	fixture := newGoogleTestServer(t)
	defer fixture.server.Close()
	fixture.jwksCacheControl = "public, max-age=86400"
	c := &clock{now: time.Unix(1_800_000_000, 0)}
	p := NewProvider(testClientID, testClientSecret, testRedirectURL, WithClock(c.Now), WithEndpoints(Endpoints{
		Authorization: fixture.server.URL + "/auth", Token: fixture.server.URL + "/token", JWKS: fixture.server.URL + "/oauth2/v3/certs",
	}))
	if _, err := verifyWith(t, fixture, p, validClaims()); err != nil {
		t.Fatal(err)
	}
	fixture.keyID = "rotated-key" // Google rotated: the next token names a key we have not seen.
	if _, err := verifyWith(t, fixture, p, validClaims()); err == nil {
		t.Fatal("the key set still lacks the new id, so the token is refused")
	}
	if fixture.jwksCalls != 1 {
		t.Fatalf("a reload within a minute of the last fetch must wait, fetched %d times", fixture.jwksCalls)
	}
	c.now = c.now.Add(2 * time.Minute)
	fixture.jwksKeyID = "rotated-key" // the published key set now has it
	if _, err := verifyWith(t, fixture, p, validClaims()); err != nil {
		t.Fatalf("after a minute the unknown id triggers a reload that finds the key: %v", err)
	}
	if fixture.jwksCalls != 2 {
		t.Fatalf("fetched %d times, want 2", fixture.jwksCalls)
	}
}
