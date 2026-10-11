package mcp

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
)

type memStore struct {
	mu       sync.Mutex
	keys     map[uuid.UUID]Key
	hashes   map[string]uuid.UUID
	settings Settings
	audit    []AuditEntry
	admins   map[uuid.UUID]bool
	members  map[uuid.UUID]bool
}

func newMemStore() *memStore {
	return &memStore{keys: map[uuid.UUID]Key{}, hashes: map[string]uuid.UUID{}, admins: map[uuid.UUID]bool{}, settings: DefaultSettings}
}

func (m *memStore) CreateKey(_ context.Context, k Key, hash string) (Key, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	k.ID, k.CreatedAt = uuid.New(), time.Now()
	m.keys[k.ID] = k
	m.hashes[hash] = k.ID
	return k, nil
}
func (m *memStore) ListKeys(_ context.Context, user uuid.UUID) ([]Key, error) {
	out := []Key{}
	for _, k := range m.keys {
		if k.UserID == user {
			out = append(out, k)
		}
	}
	return out, nil
}
func (m *memStore) RevokeKey(_ context.Context, user, id uuid.UUID) (bool, error) {
	k, ok := m.keys[id]
	if !ok || k.UserID != user || k.RevokedAt != nil {
		return false, nil
	}
	now := time.Now()
	k.RevokedAt = &now
	m.keys[id] = k
	return true, nil
}
func (m *memStore) KeyByHash(_ context.Context, hash string) (Key, bool, error) {
	id, ok := m.hashes[hash]
	if !ok {
		return Key{}, false, nil
	}
	return m.keys[id], true, nil
}
func (m *memStore) TouchKey(_ context.Context, id uuid.UUID) error {
	k := m.keys[id]
	now := time.Now()
	k.LastUsedAt = &now
	m.keys[id] = k
	return nil
}
func (m *memStore) MCPSettings(context.Context) (Settings, error) { return m.settings, nil }
func (m *memStore) SaveMCPSettings(_ context.Context, s Settings, _ uuid.UUID) error {
	m.settings = s
	return nil
}
func (m *memStore) AddAudit(_ context.Context, e AuditEntry) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.audit = append(m.audit, e)
	return nil
}
func (m *memStore) ListAudit(_ context.Context, user *uuid.UUID, limit int) ([]AuditEntry, error) {
	out := []AuditEntry{}
	for _, e := range m.audit {
		if user == nil || e.UserID == *user {
			out = append(out, e)
		}
	}
	return out, nil
}
func (m *memStore) PruneAudit(context.Context, time.Time) (int64, error) { return 0, nil }
func (m *memStore) IsSuperadmin(_ context.Context, id uuid.UUID) (bool, error) {
	return m.admins[id], nil
}

func newService() (*Service, *memStore) {
	store := newMemStore()
	return NewService(store, store, store, store), store
}

func TestAKeyIsShownOnceAndOnlyItsHashIsKept(t *testing.T) {
	svc, store := newService()
	user := uuid.New()
	key, secret, err := svc.CreateKey(context.Background(), user, "Laptop", 30)
	if err != nil || !strings.HasPrefix(secret, "dkd_") || len(secret) < 40 || key.Prefix != secret[:12] {
		t.Fatalf("CreateKey() = %+v, %q, %v", key, secret, err)
	}
	for hash := range store.hashes {
		if strings.Contains(hash, secret) || hash == secret {
			t.Fatal("the key itself is stored")
		}
	}
	if key.ExpiresAt == nil || key.ExpiresAt.Sub(time.Now()) < 29*24*time.Hour {
		t.Fatalf("expiry = %v", key.ExpiresAt)
	}
	got, err := svc.Authenticate(context.Background(), secret)
	if err != nil || got.ID != key.ID || got.UserID != user {
		t.Fatalf("Authenticate() = %+v, %v", got, err)
	}
}

func TestKeysMayNeverExpireButOnlyTheOfferedLifetimesAreAccepted(t *testing.T) {
	svc, _ := newService()
	key, _, err := svc.CreateKey(context.Background(), uuid.New(), "CI", 0)
	if err != nil || key.ExpiresAt != nil {
		t.Fatalf("a key without expiry = %+v, %v", key, err)
	}
	for _, days := range []int{-1, 1, 365} {
		if _, _, err := svc.CreateKey(context.Background(), uuid.New(), "x", days); !errors.Is(err, ErrInvalid) {
			t.Errorf("%d days accepted: %v", days, err)
		}
	}
	if _, _, err := svc.CreateKey(context.Background(), uuid.New(), "  ", 7); !errors.Is(err, ErrInvalid) {
		t.Errorf("an empty name was accepted: %v", err)
	}
}

func TestRevokedExpiredWrongOrSwitchedOffKeysAreRefused(t *testing.T) {
	svc, store := newService()
	user := uuid.New()
	key, secret, _ := svc.CreateKey(context.Background(), user, "Laptop", 7)
	for _, bad := range []string{"", "Bearer x", "dkd_wrong", strings.Replace(secret, "dkd_", "xyz_", 1)} {
		if _, err := svc.Authenticate(context.Background(), bad); !errors.Is(err, ErrUnauthorized) {
			t.Errorf("Authenticate(%q) error = %v", bad, err)
		}
	}
	store.settings.Enabled = false
	svc.invalidate()
	if _, err := svc.Authenticate(context.Background(), secret); !errors.Is(err, ErrDisabled) {
		t.Fatalf("switched-off MCP error = %v", err)
	}
	store.settings.Enabled = true
	svc.invalidate()
	past := time.Now().Add(-time.Minute)
	k := store.keys[key.ID]
	k.ExpiresAt = &past
	store.keys[key.ID] = k
	if _, err := svc.Authenticate(context.Background(), secret); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("expired key error = %v", err)
	}
	k.ExpiresAt = nil
	store.keys[key.ID] = k
	if ok, _ := svc.RevokeKey(context.Background(), uuid.New(), key.ID); ok {
		t.Fatal("someone else revoked the key")
	}
	if ok, err := svc.RevokeKey(context.Background(), user, key.ID); !ok || err != nil {
		t.Fatalf("RevokeKey() = %v, %v", ok, err)
	}
	if _, err := svc.Authenticate(context.Background(), secret); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("revoked key error = %v", err)
	}
}

func TestEachKeyHasItsOwnReadAndWriteLimit(t *testing.T) {
	svc, store := newService()
	store.settings.ReadPerMinute, store.settings.WritePerMinute = 3, 1
	svc.invalidate()
	now := time.Now()
	svc.now = func() time.Time { return now }
	a, b := uuid.New(), uuid.New()
	for i := range 3 {
		if !svc.Allow(context.Background(), a, false) {
			t.Fatalf("read %d refused", i+1)
		}
	}
	if svc.Allow(context.Background(), a, false) {
		t.Fatal("a fourth read in a minute was allowed")
	}
	if !svc.Allow(context.Background(), b, false) {
		t.Fatal("another key shared the limit")
	}
	if !svc.Allow(context.Background(), a, true) || svc.Allow(context.Background(), a, true) {
		t.Fatal("the write limit of 1 was not kept")
	}
	now = now.Add(61 * time.Second)
	if !svc.Allow(context.Background(), a, false) {
		t.Fatal("the limit did not reset after a minute")
	}
}

func TestOnlyASuperadminChangesTheSettingsAndTheyAreChecked(t *testing.T) {
	svc, store := newService()
	admin := uuid.New()
	store.admins[admin] = true
	next := Settings{Enabled: false, ReadPerMinute: 30, WritePerMinute: 5, MaxResultBytes: 65536, AuditRetentionDays: 30}
	if _, err := svc.SaveSettings(context.Background(), uuid.New(), next); !errors.Is(err, ErrForbidden) {
		t.Fatalf("a non-superadmin saved: %v", err)
	}
	saved, err := svc.SaveSettings(context.Background(), admin, next)
	if err != nil || saved.Enabled || store.settings.ReadPerMinute != 30 {
		t.Fatalf("SaveSettings() = %+v, %v", saved, err)
	}
	for _, bad := range []Settings{
		{ReadPerMinute: 0, WritePerMinute: 1, MaxResultBytes: 4096, AuditRetentionDays: 1},
		{ReadPerMinute: 1, WritePerMinute: 1, MaxResultBytes: 10, AuditRetentionDays: 1},
		{ReadPerMinute: 1, WritePerMinute: 1, MaxResultBytes: 4096, AuditRetentionDays: 0},
		{ReadPerMinute: 100000, WritePerMinute: 1, MaxResultBytes: 4096, AuditRetentionDays: 1},
	} {
		if _, err := svc.SaveSettings(context.Background(), admin, bad); !errors.Is(err, ErrInvalid) {
			t.Errorf("SaveSettings(%+v) error = %v", bad, err)
		}
	}
}

func TestTheAuditTrailIsTheOwnersOrEveryoneForASuperadmin(t *testing.T) {
	svc, store := newService()
	admin, alice, bob := uuid.New(), uuid.New(), uuid.New()
	store.admins[admin] = true
	_ = svc.Audit(context.Background(), AuditEntry{UserID: alice, Tool: "read_document", Outcome: OutcomeOK})
	_ = svc.Audit(context.Background(), AuditEntry{UserID: bob, Tool: "trash_document", Outcome: OutcomeRefused})
	mine, err := svc.MyAudit(context.Background(), alice, 50)
	if err != nil || len(mine) != 1 || mine[0].Tool != "read_document" {
		t.Fatalf("MyAudit() = %+v, %v", mine, err)
	}
	if _, err := svc.AllAudit(context.Background(), alice, 50); !errors.Is(err, ErrForbidden) {
		t.Fatalf("AllAudit() by a member = %v", err)
	}
	all, err := svc.AllAudit(context.Background(), admin, 50)
	if err != nil || len(all) != 2 {
		t.Fatalf("AllAudit() = %+v, %v", all, err)
	}
}
