package aitrace

import (
	"context"
	"errors"
	"testing"
	"time"

	"backend/internal/application/agent"

	"github.com/google/uuid"
)

type memAdmins map[uuid.UUID]bool

func (m memAdmins) IsSuperadmin(_ context.Context, id uuid.UUID) (bool, error) { return m[id], nil }

type memStore struct {
	settings     Settings
	settingsErr  error
	settingsHits int
	saved        []Settings
	listed       []Filter
	pruned       []time.Time
	detail       RunSummary
	steps        []agent.Step
}

func (m *memStore) List(_ context.Context, f Filter) ([]RunSummary, int, error) {
	m.listed = append(m.listed, f)
	return []RunSummary{{RunID: uuid.New()}}, 1, nil
}
func (m *memStore) Get(context.Context, uuid.UUID) (RunSummary, []agent.Step, error) {
	return m.detail, m.steps, nil
}
func (m *memStore) Settings(context.Context) (Settings, error) {
	m.settingsHits++
	return m.settings, m.settingsErr
}
func (m *memStore) SaveSettings(_ context.Context, s Settings, _ uuid.UUID) error {
	m.saved = append(m.saved, s)
	m.settings = s
	return nil
}
func (m *memStore) Prune(_ context.Context, before time.Time) (int64, error) {
	m.pruned = append(m.pruned, before)
	return 3, nil
}

func newService(t *testing.T) (*Service, *memStore, uuid.UUID, uuid.UUID) {
	t.Helper()
	admin, user := uuid.New(), uuid.New()
	store := &memStore{settings: DefaultSettings}
	return NewService(store, memAdmins{admin: true}), store, admin, user
}

func TestOnlyASuperadminMayReadTracesOrChangeTheSettings(t *testing.T) {
	s, store, admin, user := newService(t)
	ctx := context.Background()
	if _, _, err := s.List(ctx, user, Filter{}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("List by a User: %v", err)
	}
	if _, err := s.Run(ctx, user, uuid.New()); !errors.Is(err, ErrForbidden) {
		t.Fatalf("Run by a User: %v", err)
	}
	if _, err := s.SettingsFor(ctx, user); !errors.Is(err, ErrForbidden) {
		t.Fatalf("SettingsFor by a User: %v", err)
	}
	if _, err := s.SaveSettings(ctx, user, DefaultSettings); !errors.Is(err, ErrForbidden) || len(store.saved) != 0 {
		t.Fatalf("SaveSettings by a User: %v, saved %v", err, store.saved)
	}
	if _, _, err := s.List(ctx, admin, Filter{}); err != nil {
		t.Fatalf("List by a Superadmin: %v", err)
	}
}

func TestAListIsPagedWithinLimits(t *testing.T) {
	s, store, admin, _ := newService(t)
	if _, _, err := s.List(context.Background(), admin, Filter{Limit: 100000, Offset: -5}); err != nil {
		t.Fatal(err)
	}
	if f := store.listed[0]; f.Limit != MaxPage || f.Offset != 0 {
		t.Fatalf("filter = %+v", f)
	}
	if _, _, err := s.List(context.Background(), admin, Filter{}); err != nil || store.listed[1].Limit != DefaultPage {
		t.Fatalf("default limit = %d, %v", store.listed[1].Limit, err)
	}
}

func TestARunComesWithTheGraphItPassedThrough(t *testing.T) {
	s, store, admin, _ := newService(t)
	store.steps = []agent.Step{{Seq: 1, Node: agent.NodeInput}}
	run, err := s.Run(context.Background(), admin, uuid.New())
	if err != nil || len(run.Steps) != 1 || len(run.Graph.Nodes) == 0 {
		t.Fatalf("Run() = %+v, %v", run, err)
	}
}

func TestSettingsAreCheckedBeforeTheyAreSaved(t *testing.T) {
	s, store, admin, _ := newService(t)
	for _, bad := range []Settings{{GateEnabled: true, TraceRetentionDays: 0}, {GateEnabled: true, TraceRetentionDays: 400}} {
		if _, err := s.SaveSettings(context.Background(), admin, bad); !errors.Is(err, ErrInvalid) {
			t.Fatalf("%+v: %v", bad, err)
		}
	}
	if len(store.saved) != 0 {
		t.Fatalf("saved %v", store.saved)
	}
	saved, err := s.SaveSettings(context.Background(), admin, Settings{GateEnabled: false, RouterEnabled: true, TraceRetentionDays: 14})
	if err != nil || saved.TraceRetentionDays != 14 || saved.GateEnabled {
		t.Fatalf("SaveSettings() = %+v, %v", saved, err)
	}
}

func TestTheSwitchesFollowTheSettingsAndAreReadOnceInAWhile(t *testing.T) {
	s, store, admin, _ := newService(t)
	ctx := context.Background()
	if !s.GateEnabled(ctx) || !s.RouterEnabled(ctx) || !s.GateEnabled(ctx) || store.settingsHits != 1 {
		t.Fatalf("defaults: hits %d", store.settingsHits)
	}
	if _, err := s.SaveSettings(ctx, admin, Settings{GateEnabled: false, RouterEnabled: true, TraceRetentionDays: 30}); err != nil {
		t.Fatal(err)
	}
	if s.GateEnabled(ctx) || !s.RouterEnabled(ctx) {
		t.Fatal("a saved switch did not take effect at once")
	}
}

func TestIfTheSettingsCannotBeReadTheGateAndRouterStayOutOfTheWay(t *testing.T) {
	s, store, _, _ := newService(t)
	store.settingsErr = errors.New("database down")
	if s.GateEnabled(context.Background()) || s.RouterEnabled(context.Background()) {
		t.Fatal("a request was gated although the switch could not be read")
	}
}

func TestPruneDropsTracesOlderThanTheRetention(t *testing.T) {
	s, store, _, _ := newService(t)
	now := time.Date(2026, 10, 16, 12, 0, 0, 0, time.UTC)
	s.now = func() time.Time { return now }
	store.settings.TraceRetentionDays = 10
	n, err := s.Prune(context.Background())
	if err != nil || n != 3 || !store.pruned[0].Equal(now.AddDate(0, 0, -10)) {
		t.Fatalf("Prune() = %d, %v, before %v", n, err, store.pruned)
	}
}
