// Package aitrace is how a Superadmin follows one request through the Agent: which
// places of the decision graph it passed, how often it went around, and where it
// stopped. A trace holds codes, counts and names, never what a User wrote (ADR-0050).
package aitrace

import (
	"context"
	"errors"
	"sync"
	"time"

	"backend/internal/application/agent"

	"github.com/google/uuid"
)

var (
	ErrForbidden = errors.New("only a superadmin can do this")
	ErrInvalid   = errors.New("the request is not valid")
	ErrNotFound  = errors.New("there is no such trace")
)

const (
	DefaultPage = 50
	MaxPage     = 200
	// settingsTTL is how long the switches are kept before they are read again. A save
	// takes effect at once on the server that saved it.
	settingsTTL = 5 * time.Second
)

// Settings are the Superadmin's controls over the entry gate, the model router and
// how long traces are kept.
type Settings struct {
	GateEnabled        bool      `json:"gateEnabled"`
	RouterEnabled      bool      `json:"routerEnabled"`
	TraceRetentionDays int       `json:"traceRetentionDays"`
	UpdatedAt          time.Time `json:"updatedAt"`
}

var DefaultSettings = Settings{GateEnabled: true, RouterEnabled: true, TraceRetentionDays: 30}

// Filter picks the runs a Superadmin looks at. Zero values filter nothing.
type Filter struct {
	UserID         *uuid.UUID
	WorkspaceID    *uuid.UUID
	ConversationID *uuid.UUID
	// Outcome is the last place the run reached: respond, reject, clarify or approval.
	Outcome string
	// Node keeps runs that passed through this node.
	Node          string
	Since, Until  *time.Time
	MinDurationMS int64
	FailedOnly    bool
	Limit, Offset int
}

// RunSummary is one request, in a line.
type RunSummary struct {
	RunID          uuid.UUID  `json:"runId"`
	OwnerID        *uuid.UUID `json:"ownerId"`
	OwnerName      string     `json:"ownerName"`
	OwnerEmail     string     `json:"ownerEmail"`
	WorkspaceID    *uuid.UUID `json:"workspaceId"`
	ConversationID *uuid.UUID `json:"conversationId"`
	StartedAt      time.Time  `json:"startedAt"`
	Steps          int        `json:"steps"`
	ModelCalls     int        `json:"modelCalls"`
	ToolCalls      int        `json:"toolCalls"`
	InputTokens    int        `json:"inputTokens"`
	OutputTokens   int        `json:"outputTokens"`
	DurationMS     int64      `json:"durationMs"`
	// Outcome is the last node reached; Failed says some step failed.
	Outcome string `json:"outcome"`
	Failed  bool   `json:"failed"`
}

// Run is one request with its steps and the graph they ran through.
type Run struct {
	RunSummary
	Steps []agent.Step `json:"stepList"`
	Graph agent.Graph  `json:"graph"`
}

type Store interface {
	List(ctx context.Context, f Filter) ([]RunSummary, int, error)
	Get(ctx context.Context, run uuid.UUID) (RunSummary, []agent.Step, error)
	Settings(ctx context.Context) (Settings, error)
	SaveSettings(ctx context.Context, s Settings, by uuid.UUID) error
	Prune(ctx context.Context, before time.Time) (int64, error)
}

type Superadmins interface {
	IsSuperadmin(ctx context.Context, userID uuid.UUID) (bool, error)
}

type Service struct {
	store  Store
	admins Superadmins
	now    func() time.Time

	mu       sync.Mutex
	cached   Settings
	cachedOK bool
	cachedAt time.Time
}

func NewService(store Store, admins Superadmins) *Service {
	return &Service{store: store, admins: admins, now: time.Now}
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

func (s *Service) List(ctx context.Context, actor uuid.UUID, f Filter) ([]RunSummary, int, error) {
	if err := s.requireSuperadmin(ctx, actor); err != nil {
		return nil, 0, err
	}
	switch {
	case f.Limit <= 0:
		f.Limit = DefaultPage
	case f.Limit > MaxPage:
		f.Limit = MaxPage
	}
	if f.Offset < 0 {
		f.Offset = 0
	}
	return s.store.List(ctx, f)
}

func (s *Service) Run(ctx context.Context, actor, run uuid.UUID) (Run, error) {
	if err := s.requireSuperadmin(ctx, actor); err != nil {
		return Run{}, err
	}
	summary, steps, err := s.store.Get(ctx, run)
	if err != nil {
		return Run{}, err
	}
	return Run{RunSummary: summary, Steps: steps, Graph: agent.DecisionGraph()}, nil
}

func (s *Service) SettingsFor(ctx context.Context, actor uuid.UUID) (Settings, error) {
	if err := s.requireSuperadmin(ctx, actor); err != nil {
		return Settings{}, err
	}
	return s.settings(ctx)
}

func (s *Service) SaveSettings(ctx context.Context, actor uuid.UUID, next Settings) (Settings, error) {
	if err := s.requireSuperadmin(ctx, actor); err != nil {
		return Settings{}, err
	}
	if next.TraceRetentionDays < 1 || next.TraceRetentionDays > 365 {
		return Settings{}, ErrInvalid
	}
	if err := s.store.SaveSettings(ctx, next, actor); err != nil {
		return Settings{}, err
	}
	s.mu.Lock()
	s.cachedOK = false
	s.mu.Unlock()
	return s.settings(ctx)
}

func (s *Service) settings(ctx context.Context) (Settings, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cachedOK && s.now().Sub(s.cachedAt) < settingsTTL {
		return s.cached, nil
	}
	got, err := s.store.Settings(ctx)
	if err != nil {
		return Settings{}, err
	}
	s.cached, s.cachedOK, s.cachedAt = got, true, s.now()
	return got, nil
}

// GateEnabled says whether requests go through the entry gate. If the setting cannot be
// read the gate stays off: a request is never held up by a switch nobody can see.
func (s *Service) GateEnabled(ctx context.Context) bool {
	got, err := s.settings(ctx)
	return err == nil && got.GateEnabled
}

func (s *Service) RouterEnabled(ctx context.Context) bool {
	got, err := s.settings(ctx)
	return err == nil && got.RouterEnabled
}

// Prune drops the traces older than the retention the Superadmin set.
func (s *Service) Prune(ctx context.Context) (int64, error) {
	got, err := s.settings(ctx)
	if err != nil {
		return 0, err
	}
	return s.store.Prune(ctx, s.now().AddDate(0, 0, -got.TraceRetentionDays))
}
