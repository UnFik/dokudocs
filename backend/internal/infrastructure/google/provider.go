package google

import (
	"backend/internal/domain/model"
	"bytes"
	"context"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"github.com/golang-jwt/jwt/v5"
	"math/big"
	"net/http"
	"net/url"
	"sync"
)

type Provider struct {
	clientID, clientSecret, redirectURL string
	httpClient                          *http.Client
	mu                                  sync.Mutex
	keys                                map[string]*rsa.PublicKey
}

func NewProvider(clientID, clientSecret, redirectURL string) *Provider {
	return &Provider{clientID: clientID, clientSecret: clientSecret, redirectURL: redirectURL, httpClient: http.DefaultClient}
}

func (p *Provider) AuthorizationURL(state, nonce, verifier string) string {
	h := sha256Base64(verifier)
	q := url.Values{"client_id": {p.clientID}, "redirect_uri": {p.redirectURL}, "response_type": {"code"}, "scope": {"openid email profile"}, "state": {state}, "nonce": {nonce}, "code_challenge": {h}, "code_challenge_method": {"S256"}}
	return "https://accounts.google.com/o/oauth2/v2/auth?" + q.Encode()
}

func (p *Provider) Verify(ctx context.Context, code, verifier, nonce string) (model.GoogleIdentity, error) {
	form := url.Values{"code": {code}, "client_id": {p.clientID}, "client_secret": {p.clientSecret}, "redirect_uri": {p.redirectURL}, "grant_type": {"authorization_code"}, "code_verifier": {verifier}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://oauth2.googleapis.com/token", bytes.NewBufferString(form.Encode()))
	if err != nil {
		return model.GoogleIdentity{}, errors.New("google token exchange failed")
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	res, err := p.httpClient.Do(req)
	if err != nil {
		return model.GoogleIdentity{}, errors.New("google token exchange failed")
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return model.GoogleIdentity{}, errors.New("google token exchange failed")
	}
	var tokenResponse struct {
		IDToken string `json:"id_token"`
	}
	if err := json.NewDecoder(res.Body).Decode(&tokenResponse); err != nil || tokenResponse.IDToken == "" {
		return model.GoogleIdentity{}, errors.New("google token exchange failed")
	}

	token, err := jwt.Parse(tokenResponse.IDToken, func(t *jwt.Token) (any, error) {
		if t.Method != jwt.SigningMethodRS256 {
			return nil, errors.New("invalid google signing method")
		}
		kid, ok := t.Header["kid"].(string)
		if !ok {
			return nil, errors.New("missing google key")
		}
		return p.key(ctx, kid)
	})
	if err != nil || !token.Valid {
		return model.GoogleIdentity{}, errors.New("invalid google identity token")
	}
	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return model.GoogleIdentity{}, errors.New("invalid google claims")
	}
	iss, _ := claims["iss"].(string)
	aud, _ := claims["aud"].(string)
	sub, sok := claims["sub"].(string)
	email, eok := claims["email"].(string)
	name, nok := claims["name"].(string)
	verified, vok := claims["email_verified"].(bool)
	if (iss != "https://accounts.google.com" && iss != "accounts.google.com") || aud != p.clientID || !sok || sub == "" || !eok || email == "" || !nok || name == "" || !vok || !verified {
		return model.GoogleIdentity{}, errors.New("invalid google claims")
	}
	if got, _ := claims["nonce"].(string); got != nonce {
		return model.GoogleIdentity{}, errors.New("invalid google nonce")
	}
	return model.GoogleIdentity{Subject: sub, Email: email, FullName: name}, nil
}

func (p *Provider) key(ctx context.Context, kid string) (*rsa.PublicKey, error) {
	p.mu.Lock()
	if key := p.keys[kid]; key != nil {
		p.mu.Unlock()
		return key, nil
	}
	p.mu.Unlock()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://www.googleapis.com/oauth2/v3/certs", nil)
	if err != nil {
		return nil, err
	}
	res, err := p.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, errors.New("google keys unavailable")
	}
	var body struct {
		Keys []struct {
			Kid string `json:"kid"`
			N   string `json:"n"`
			E   string `json:"e"`
		} `json:"keys"`
	}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		return nil, err
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
	p.mu.Lock()
	p.keys = keys
	key := keys[kid]
	p.mu.Unlock()
	if key == nil {
		return nil, errors.New("google key not found")
	}
	return key, nil
}

func sha256Base64(value string) string {
	h := sha256.Sum256([]byte(value))
	return base64.RawURLEncoding.EncodeToString(h[:])
}
