// Package mcp is how an outside AI client reaches Dokudocs: the User's MCP API
// keys, the Superadmin's switch and limits, and the audit trail (ADR 0045).
package mcp

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"math/big"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

const (
	keyPrefix = "dkd_"
	// settingsTTL is how long the Superadmin's settings are trusted before reading them again.
	settingsTTL = 30 * time.Second

	OutcomeOK      = "ok"
	OutcomeRefused = "refused"
	OutcomeLimited = "limited"
	OutcomeError   = "error"
)

var (
	ErrUnauthorized = errors.New("the MCP API key is not valid")
	ErrDisabled     = errors.New("MCP is switched off on this Dokudocs")
	ErrForbidden    = errors.New("only a superadmin can do this")
	ErrInvalid      = errors.New("the request is not valid")
)

// Key is an MCP API key as the User sees it; the secret is never stored.
type Key struct {
	ID         uuid.UUID  `json:"id"`
	UserID     uuid.UUID  `json:"-"`
	Name       string     `json:"name"`
	Prefix     string     `json:"prefix"`
	ExpiresAt  *time.Time `json:"expiresAt"`
	LastUsedAt *time.Time `json:"lastUsedAt"`
	RevokedAt  *time.Time `json:"revokedAt"`
	CreatedAt  time.Time  `json:"createdAt"`
}

type Settings struct {
	Enabled            bool      `json:"enabled"`
	ReadPerMinute      int       `json:"readPerMinute"`
	WritePerMinute     int       `json:"writePerMinute"`
	MaxResultBytes     int       `json:"maxResultBytes"`
	AuditRetentionDays int       `json:"auditRetentionDays"`
	UpdatedAt          time.Time `json:"updatedAt"`
}

// DefaultSettings match the database defaults.
var DefaultSettings = Settings{Enabled: true, ReadPerMinute: 60, WritePerMinute: 10, MaxResultBytes: 204800, AuditRetentionDays: 90}

type AuditEntry struct {
	At       time.Time `json:"at"`
	KeyID    uuid.UUID `json:"keyId"`
	KeyName  string    `json:"keyName"`
	UserID   uuid.UUID `json:"userId"`
	UserName string    `json:"userName,omitempty"`
	Tool     string    `json:"tool"`
	Resource string    `json:"resource"`
	Outcome  string    `json:"outcome"`
	Detail   string    `json:"detail"`
}

type KeyStore interface {
	CreateKey(ctx context.Context, k Key, hash string) (Key, error)
	ListKeys(ctx context.Context, userID uuid.UUID) ([]Key, error)
	RevokeKey(ctx context.Context, userID, id uuid.UUID) (bool, error)
	KeyByHash(ctx context.Context, hash string) (Key, bool, error)
	TouchKey(ctx context.Context, id uuid.UUID) error
}

type SettingsStore interface {
	MCPSettings(ctx context.Context) (Settings, error)
	SaveMCPSettings(ctx context.Context, s Settings, by uuid.UUID) error
}

type AuditStore interface {
	AddAudit(ctx context.Context, e AuditEntry) error
	// ListAudit lists one User's entries, or everyone's when userID is nil, newest first.
	ListAudit(ctx context.Context, userID *uuid.UUID, limit int) ([]AuditEntry, error)
	PruneAudit(ctx context.Context, before time.Time) (int64, error)
}

type Superadmins interface {
	IsSuperadmin(ctx context.Context, userID uuid.UUID) (bool, error)
}

type window struct {
	start time.Time
	count int
}

type Service struct {
	keys     KeyStore
	settings SettingsStore
	audit    AuditStore
	admins   Superadmins
	now      func() time.Time

	mu       sync.Mutex
	cached   Settings
	cachedAt time.Time
	windows  map[string]window
	touched  map[uuid.UUID]time.Time
}

func NewService(keys KeyStore, settings SettingsStore, audit AuditStore, admins Superadmins) *Service {
	return &Service{keys: keys, settings: settings, audit: audit, admins: admins, now: time.Now, windows: map[string]window{}, touched: map[uuid.UUID]time.Time{}}
}

func hashKey(secret string) string {
	sum := sha256.Sum256([]byte(secret))
	return hex.EncodeToString(sum[:])
}

const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"

func randomSecret() (string, error) {
	var b strings.Builder
	b.WriteString(keyPrefix)
	for range 40 {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(alphabet))))
		if err != nil {
			return "", err
		}
		b.WriteByte(alphabet[n.Int64()])
	}
	return b.String(), nil
}

// CreateKey makes a key that expires after 7, 30 or 90 days, or never with 0.
// The secret is returned once.
func (s *Service) CreateKey(ctx context.Context, userID uuid.UUID, name string, expiresInDays int) (Key, string, error) {
	name = strings.TrimSpace(name)
	if name == "" || len([]rune(name)) > 80 {
		return Key{}, "", ErrInvalid
	}
	key := Key{UserID: userID, Name: name}
	switch expiresInDays {
	case 0:
	case 7, 30, 90:
		at := s.now().Add(time.Duration(expiresInDays) * 24 * time.Hour)
		key.ExpiresAt = &at
	default:
		return Key{}, "", ErrInvalid
	}
	secret, err := randomSecret()
	if err != nil {
		return Key{}, "", err
	}
	key.Prefix = secret[:12]
	created, err := s.keys.CreateKey(ctx, key, hashKey(secret))
	return created, secret, err
}

func (s *Service) ListKeys(ctx context.Context, userID uuid.UUID) ([]Key, error) {
	return s.keys.ListKeys(ctx, userID)
}

func (s *Service) RevokeKey(ctx context.Context, userID, id uuid.UUID) (bool, error) {
	return s.keys.RevokeKey(ctx, userID, id)
}

// Authenticate turns a bearer secret into its key, or refuses it.
func (s *Service) Authenticate(ctx context.Context, secret string) (Key, error) {
	secret = strings.TrimSpace(secret)
	if !strings.HasPrefix(secret, keyPrefix) || len(secret) < 20 {
		return Key{}, ErrUnauthorized
	}
	settings, err := s.Settings(ctx)
	if err != nil {
		return Key{}, err
	}
	if !settings.Enabled {
		return Key{}, ErrDisabled
	}
	key, found, err := s.keys.KeyByHash(ctx, hashKey(secret))
	if err != nil {
		return Key{}, err
	}
	if !found || key.RevokedAt != nil || (key.ExpiresAt != nil && !key.ExpiresAt.After(s.now())) {
		return Key{}, ErrUnauthorized
	}
	s.touch(ctx, key.ID)
	return key, nil
}

// touch records the last use at most once a minute per key.
func (s *Service) touch(ctx context.Context, id uuid.UUID) {
	s.mu.Lock()
	last, seen := s.touched[id]
	if seen && s.now().Sub(last) < time.Minute {
		s.mu.Unlock()
		return
	}
	s.touched[id] = s.now()
	s.mu.Unlock()
	_ = s.keys.TouchKey(ctx, id)
}

func (s *Service) invalidate() {
	s.mu.Lock()
	s.cachedAt = time.Time{}
	s.mu.Unlock()
}

// Settings are read at most every 30 seconds.
func (s *Service) Settings(ctx context.Context) (Settings, error) {
	s.mu.Lock()
	if !s.cachedAt.IsZero() && s.now().Sub(s.cachedAt) < settingsTTL {
		defer s.mu.Unlock()
		return s.cached, nil
	}
	s.mu.Unlock()
	settings, err := s.settings.MCPSettings(ctx)
	if err != nil {
		return Settings{}, err
	}
	s.mu.Lock()
	s.cached, s.cachedAt = settings, s.now()
	s.mu.Unlock()
	return settings, nil
}

func (s *Service) requireSuperadmin(ctx context.Context, actor uuid.UUID) error {
	ok, err := s.admins.IsSuperadmin(ctx, actor)
	if err != nil {
		return err
	}
	if !ok {
		return ErrForbidden
	}
	return nil
}

// SettingsFor returns the settings to a Superadmin.
func (s *Service) SettingsFor(ctx context.Context, actor uuid.UUID) (Settings, error) {
	if err := s.requireSuperadmin(ctx, actor); err != nil {
		return Settings{}, err
	}
	return s.settings.MCPSettings(ctx)
}

func (s *Service) SaveSettings(ctx context.Context, actor uuid.UUID, next Settings) (Settings, error) {
	if err := s.requireSuperadmin(ctx, actor); err != nil {
		return Settings{}, err
	}
	if next.ReadPerMinute < 1 || next.ReadPerMinute > 10000 || next.WritePerMinute < 1 || next.WritePerMinute > 10000 ||
		next.MaxResultBytes < 1024 || next.MaxResultBytes > 4<<20 || next.AuditRetentionDays < 1 || next.AuditRetentionDays > 3650 {
		return Settings{}, ErrInvalid
	}
	if err := s.settings.SaveMCPSettings(ctx, next, actor); err != nil {
		return Settings{}, err
	}
	s.invalidate()
	return s.settings.MCPSettings(ctx)
}

// Allow counts one call against the key's read or write limit for the current minute.
func (s *Service) Allow(ctx context.Context, keyID uuid.UUID, write bool) bool {
	settings, err := s.Settings(ctx)
	if err != nil {
		return false
	}
	limit, kind := settings.ReadPerMinute, "r:"
	if write {
		limit, kind = settings.WritePerMinute, "w:"
	}
	slot := kind + keyID.String()
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	w := s.windows[slot]
	if now.Sub(w.start) >= time.Minute {
		w = window{start: now}
	}
	if w.count >= limit {
		s.windows[slot] = w
		return false
	}
	w.count++
	s.windows[slot] = w
	return true
}

// MaxResultBytes is the cap on one tool result.
func (s *Service) MaxResultBytes(ctx context.Context) int {
	settings, err := s.Settings(ctx)
	if err != nil || settings.MaxResultBytes <= 0 {
		return DefaultSettings.MaxResultBytes
	}
	return settings.MaxResultBytes
}

// Audit records one call; it never holds content.
func (s *Service) Audit(ctx context.Context, e AuditEntry) error {
	if len(e.Detail) > 300 {
		e.Detail = e.Detail[:300]
	}
	write, cancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
	defer cancel()
	return s.audit.AddAudit(write, e)
}

func (s *Service) MyAudit(ctx context.Context, userID uuid.UUID, limit int) ([]AuditEntry, error) {
	return s.audit.ListAudit(ctx, &userID, limit)
}

func (s *Service) AllAudit(ctx context.Context, actor uuid.UUID, limit int) ([]AuditEntry, error) {
	if err := s.requireSuperadmin(ctx, actor); err != nil {
		return nil, err
	}
	return s.audit.ListAudit(ctx, nil, limit)
}

// Prune drops audit entries older than the retention the Superadmin set.
func (s *Service) Prune(ctx context.Context) (int64, error) {
	settings, err := s.settings.MCPSettings(ctx)
	if err != nil {
		return 0, err
	}
	return s.audit.PruneAudit(ctx, s.now().AddDate(0, 0, -settings.AuditRetentionDays))
}
