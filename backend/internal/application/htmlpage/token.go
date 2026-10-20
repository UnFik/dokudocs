// Package htmlpage serves HTML documents to a sandboxed frame from a separate
// content origin (ADR 0052): a short-lived token for one viewer and one page,
// the capabilities the page declares, and the headers that confine it.
package htmlpage

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
)

// ErrInvalidToken means the token is not one this server issued, or it has expired.
var ErrInvalidToken = errors.New("htmlpage: invalid or expired token")

// Claims say who may fetch which page, and until when.
type Claims struct {
	WorkspaceID uuid.UUID `json:"w"`
	DocumentID  uuid.UUID `json:"d"`
	UserID      uuid.UUID `json:"u"`
	ExpiresAt   int64     `json:"e"`
}

// Signer issues and checks page tokens. They are signed with a key derived for
// this purpose, so a login token can never be taken for a page token or back.
type Signer struct {
	key []byte
	ttl time.Duration
	now func() time.Time
}

func NewSigner(secret string, ttl time.Duration) *Signer {
	sum := sha256.Sum256([]byte("dokudocs.html-page.v1\x00" + secret))
	return &Signer{key: sum[:], ttl: ttl, now: time.Now}
}

// SetNow replaces the clock, for tests.
func (s *Signer) SetNow(now func() time.Time) { s.now = now }

func (s *Signer) mac(payload string) string {
	m := hmac.New(sha256.New, s.key)
	m.Write([]byte(payload))
	return base64.RawURLEncoding.EncodeToString(m.Sum(nil))
}

// Issue signs a token for one viewer and one page.
func (s *Signer) Issue(workspaceID, documentID, userID uuid.UUID) (string, time.Time) {
	expires := s.now().Add(s.ttl)
	raw, _ := json.Marshal(Claims{WorkspaceID: workspaceID, DocumentID: documentID, UserID: userID, ExpiresAt: expires.Unix()})
	payload := base64.RawURLEncoding.EncodeToString(raw)
	return payload + "." + s.mac(payload), expires
}

// Verify returns the claims of an unexpired token this signer issued.
func (s *Signer) Verify(token string) (Claims, error) {
	payload, signature, ok := strings.Cut(token, ".")
	if !ok || !hmac.Equal([]byte(signature), []byte(s.mac(payload))) {
		return Claims{}, ErrInvalidToken
	}
	raw, err := base64.RawURLEncoding.DecodeString(payload)
	if err != nil {
		return Claims{}, ErrInvalidToken
	}
	var claims Claims
	if json.Unmarshal(raw, &claims) != nil || claims.ExpiresAt <= s.now().Unix() ||
		claims.WorkspaceID == uuid.Nil || claims.DocumentID == uuid.Nil || claims.UserID == uuid.Nil {
		return Claims{}, ErrInvalidToken
	}
	return claims, nil
}
