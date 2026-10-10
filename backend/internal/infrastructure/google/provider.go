package google

import (
	"bytes"
	"context"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"backend/internal/domain/model"

	"github.com/golang-jwt/jwt/v5"
)

const (
	defaultTimeout = 10 * time.Second
	// maxBody bounds what is read from Google, so a bad reply cannot fill memory.
	maxBody = 1 << 20
	// A key set is trusted for its max-age, kept between these bounds, and an
	// unknown key id may trigger a reload no more than once a minute.
	defaultKeyTTL = time.Hour
	minKeyTTL     = 5 * time.Minute
	maxKeyTTL     = 24 * time.Hour
	reloadGap     = time.Minute
	maxPictureLen = 2048
)

// Endpoints are the Google URLs the provider calls; tests point them at a local server.
type Endpoints struct {
	Authorization string
	Token         string
	JWKS          string
}

var defaultEndpoints = Endpoints{
	Authorization: "https://accounts.google.com/o/oauth2/v2/auth",
	Token:         "https://oauth2.googleapis.com/token",
	JWKS:          "https://www.googleapis.com/oauth2/v3/certs",
}

type Option func(*Provider)

// WithEndpoints replaces the endpoints that are not empty.
func WithEndpoints(e Endpoints) Option {
	return func(p *Provider) {
		if e.Authorization != "" {
			p.endpoints.Authorization = e.Authorization
		}
		if e.Token != "" {
			p.endpoints.Token = e.Token
		}
		if e.JWKS != "" {
			p.endpoints.JWKS = e.JWKS
		}
	}
}

func WithTimeout(d time.Duration) Option { return func(p *Provider) { p.httpClient.Timeout = d } }

func WithClock(now func() time.Time) Option { return func(p *Provider) { p.now = now } }

type Provider struct {
	clientID, clientSecret, redirectURL string
	endpoints                           Endpoints
	httpClient                          *http.Client
	now                                 func() time.Time

	mu         sync.Mutex
	keys       map[string]*rsa.PublicKey
	keysExpire time.Time
	lastFetch  time.Time
}

func NewProvider(clientID, clientSecret, redirectURL string, options ...Option) *Provider {
	p := &Provider{
		clientID: clientID, clientSecret: clientSecret, redirectURL: redirectURL,
		endpoints:  defaultEndpoints,
		httpClient: &http.Client{Timeout: defaultTimeout},
		now:        time.Now,
	}
	for _, option := range options {
		option(p)
	}
	return p
}

func (p *Provider) AuthorizationURL(state, nonce, verifier string) string {
	h := sha256Base64(verifier)
	q := url.Values{"client_id": {p.clientID}, "redirect_uri": {p.redirectURL}, "response_type": {"code"}, "scope": {"openid email profile"}, "state": {state}, "nonce": {nonce}, "code_challenge": {h}, "code_challenge_method": {"S256"}}
	return p.endpoints.Authorization + "?" + q.Encode()
}

func (p *Provider) Verify(ctx context.Context, code, verifier, nonce string) (model.ProviderIdentity, error) {
	form := url.Values{"code": {code}, "client_id": {p.clientID}, "client_secret": {p.clientSecret}, "redirect_uri": {p.redirectURL}, "grant_type": {"authorization_code"}, "code_verifier": {verifier}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.endpoints.Token, bytes.NewBufferString(form.Encode()))
	if err != nil {
		return model.ProviderIdentity{}, errors.New("google token exchange failed")
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	res, err := p.httpClient.Do(req)
	if err != nil {
		return model.ProviderIdentity{}, errors.New("google token exchange failed")
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return model.ProviderIdentity{}, errors.New("google token exchange failed")
	}
	var tokenResponse struct {
		IDToken string `json:"id_token"`
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, maxBody)).Decode(&tokenResponse); err != nil || tokenResponse.IDToken == "" {
		return model.ProviderIdentity{}, errors.New("google token exchange failed")
	}

	parser := jwt.NewParser(
		jwt.WithValidMethods([]string{jwt.SigningMethodRS256.Alg()}),
		jwt.WithExpirationRequired(),
		jwt.WithAudience(p.clientID),
		jwt.WithTimeFunc(p.now),
	)
	token, err := parser.Parse(tokenResponse.IDToken, func(t *jwt.Token) (any, error) {
		kid, ok := t.Header["kid"].(string)
		if !ok {
			return nil, errors.New("missing google key")
		}
		return p.key(ctx, kid)
	})
	if err != nil || !token.Valid {
		return model.ProviderIdentity{}, errors.New("invalid google identity token")
	}
	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return model.ProviderIdentity{}, errors.New("invalid google claims")
	}
	iss, _ := claims["iss"].(string)
	sub, sok := claims["sub"].(string)
	email, eok := claims["email"].(string)
	verified, vok := claims["email_verified"].(bool)
	if (iss != "https://accounts.google.com" && iss != "accounts.google.com") || !sok || sub == "" || !eok || email == "" || !vok || !verified {
		return model.ProviderIdentity{}, errors.New("invalid google claims")
	}
	if got, _ := claims["nonce"].(string); got != nonce {
		return model.ProviderIdentity{}, errors.New("invalid google nonce")
	}
	name, ok := displayName(claims, email)
	if !ok {
		return model.ProviderIdentity{}, errors.New("invalid google claims")
	}
	return model.ProviderIdentity{Subject: sub, Email: email, EmailVerified: true, Name: name, AvatarURL: pictureURL(claims)}, nil
}

// displayName is the name claim, or the part of the email before @ when Google
// sent none. A name of the wrong type is refused.
func displayName(claims jwt.MapClaims, email string) (string, bool) {
	raw, present := claims["name"]
	if !present {
		return localPart(email), true
	}
	name, ok := raw.(string)
	if !ok {
		return "", false
	}
	if strings.TrimSpace(name) == "" {
		return localPart(email), true
	}
	return name, true
}

func localPart(email string) string {
	if i := strings.LastIndex(email, "@"); i > 0 {
		return email[:i]
	}
	return email
}

// pictureURL keeps an https address of a sensible size and drops anything else:
// a bad picture must not stop the sign-in.
func pictureURL(claims jwt.MapClaims) string {
	raw, _ := claims["picture"].(string)
	if raw == "" || len(raw) > maxPictureLen {
		return ""
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Host == "" {
		return ""
	}
	return raw
}

// key returns the public key for kid. Keys are reused until their max-age ends;
// a kid that is not in a fresh set reloads it, but no more than once a minute.
func (p *Provider) key(ctx context.Context, kid string) (*rsa.PublicKey, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	now := p.now()
	fresh := p.keys != nil && now.Before(p.keysExpire)
	if fresh {
		if key := p.keys[kid]; key != nil {
			return key, nil
		}
		if now.Sub(p.lastFetch) < reloadGap {
			return nil, errors.New("google key not found")
		}
	}
	if err := p.fetchKeys(ctx, now); err != nil {
		return nil, err
	}
	key := p.keys[kid]
	if key == nil {
		return nil, errors.New("google key not found")
	}
	return key, nil
}

func (p *Provider) fetchKeys(ctx context.Context, now time.Time) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, p.endpoints.JWKS, nil)
	if err != nil {
		return err
	}
	res, err := p.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return errors.New("google keys unavailable")
	}
	var body struct {
		Keys []struct {
			Kid string `json:"kid"`
			N   string `json:"n"`
			E   string `json:"e"`
		} `json:"keys"`
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, maxBody)).Decode(&body); err != nil {
		return err
	}
	keys := make(map[string]*rsa.PublicKey, len(body.Keys))
	for _, k := range body.Keys {
		n, err := base64.RawURLEncoding.DecodeString(k.N)
		if err != nil {
			continue
		}
		e, err := base64.RawURLEncoding.DecodeString(k.E)
		if err != nil {
			continue
		}
		keys[k.Kid] = &rsa.PublicKey{N: new(big.Int).SetBytes(n), E: int(new(big.Int).SetBytes(e).Int64())}
	}
	p.keys = keys
	p.lastFetch = now
	p.keysExpire = now.Add(keyLifetime(res.Header.Get("Cache-Control")))
	return nil
}

// keyLifetime reads max-age from a Cache-Control header, kept between the bounds.
func keyLifetime(header string) time.Duration {
	for _, part := range strings.Split(header, ",") {
		if value, ok := strings.CutPrefix(strings.TrimSpace(part), "max-age="); ok {
			seconds, err := strconv.Atoi(value)
			if err != nil {
				break
			}
			return min(max(time.Duration(seconds)*time.Second, minKeyTTL), maxKeyTTL)
		}
	}
	return defaultKeyTTL
}

func sha256Base64(value string) string {
	h := sha256.Sum256([]byte(value))
	return base64.RawURLEncoding.EncodeToString(h[:])
}
