package aiusage

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
)

// ErrLimitReached means the User has used this month's tokens in the Workspace (ADR-0048).
var ErrLimitReached = errors.New("monthly AI usage limit reached")

// Status is how much of the Usage limit a User has spent in a Workspace this month.
type Status struct {
	Used     int64     `json:"used"`
	Limit    int64     `json:"limit"`
	ResetsAt time.Time `json:"resetsAt"`
}

// Spent reports whether nothing is left.
func (s Status) Spent() bool { return s.Used >= s.Limit }

type LimitStore interface {
	// MonthlyTokens sums the tokens a User's answers, Agent runs and titles used in a Workspace since a moment.
	MonthlyTokens(ctx context.Context, userID, workspaceID uuid.UUID, since time.Time) (int64, error)
	// PlanLimit is the monthly tokens the Workspace's Plan allows each User.
	PlanLimit(ctx context.Context, workspaceID uuid.UUID) (int64, error)
}

// Limits applies the Usage limit.
type Limits struct {
	store LimitStore
	now   func() time.Time
}

func NewLimits(store LimitStore) *Limits { return &Limits{store: store, now: time.Now} }

// Status reads this month's use, counted from the first day of the month at 00:00 UTC.
func (l *Limits) Status(ctx context.Context, userID, workspaceID uuid.UUID) (Status, error) {
	now := l.now().UTC()
	start := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	used, err := l.store.MonthlyTokens(ctx, userID, workspaceID, start)
	if err != nil {
		return Status{}, err
	}
	limit, err := l.store.PlanLimit(ctx, workspaceID)
	if err != nil {
		return Status{}, err
	}
	return Status{Used: used, Limit: limit, ResetsAt: start.AddDate(0, 1, 0)}, nil
}

// Check refuses a new run once the Usage limit is spent. A run already going is
// not stopped, so use can pass the limit by one run.
func (l *Limits) Check(ctx context.Context, userID, workspaceID uuid.UUID) error {
	status, err := l.Status(ctx, userID, workspaceID)
	if err != nil {
		return err
	}
	if status.Spent() {
		return ErrLimitReached
	}
	return nil
}

// ErrInvalidLimit means the Plan name or the token count cannot be stored.
var ErrInvalidLimit = errors.New("invalid usage limit")

const (
	maxPlanNameLength = 50
	maxMonthlyTokens  = 1_000_000_000_000
)

// PlanLimit is what one Plan allows each User per workspace per month.
type PlanLimit struct {
	Plan          string `json:"plan"`
	MonthlyTokens int64  `json:"monthlyTokens"`
}

// PlanLimitStore reads and writes the limits a Superadmin sets.
type PlanLimitStore interface {
	ListPlanLimits(ctx context.Context) ([]PlanLimit, error)
	SetPlanLimit(ctx context.Context, plan string, monthlyTokens int64) error
}

// PlanLimits lists the limits of every Plan; only a Superadmin may.
func (s *Service) PlanLimits(ctx context.Context, actor uuid.UUID, store PlanLimitStore) ([]PlanLimit, error) {
	if err := s.requireSuperadmin(ctx, actor); err != nil {
		return nil, err
	}
	return store.ListPlanLimits(ctx)
}

// SetPlanLimit sets what a Plan allows. A Plan with no limit of its own gets the Free limit.
func (s *Service) SetPlanLimit(ctx context.Context, actor uuid.UUID, store PlanLimitStore, plan string, monthlyTokens int64) error {
	if err := s.requireSuperadmin(ctx, actor); err != nil {
		return err
	}
	plan = strings.TrimSpace(plan)
	if plan == "" || utf8.RuneCountInString(plan) > maxPlanNameLength || monthlyTokens < 1 || monthlyTokens > maxMonthlyTokens {
		return ErrInvalidLimit
	}
	return store.SetPlanLimit(ctx, plan, monthlyTokens)
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

// Quota is one User's spend in one Workspace this month, for the Superadmin.
type Quota struct {
	UserID      uuid.UUID `json:"userId"`
	Name        string    `json:"name"`
	Email       string    `json:"email"`
	WorkspaceID uuid.UUID `json:"workspaceId"`
	Workspace   string    `json:"workspace"`
	Plan        string    `json:"plan"`
	Used        int64     `json:"used"`
	Limit       int64     `json:"limit"`
}

// QuotaStore lists and resets the month's spend per User and Workspace.
type QuotaStore interface {
	ListQuotas(ctx context.Context, since time.Time) ([]Quota, error)
	ResetQuota(ctx context.Context, userID, workspaceID uuid.UUID) error
}

// Quotas lists this month's use per User and Workspace; only a Superadmin may.
func (s *Service) Quotas(ctx context.Context, actor uuid.UUID, store QuotaStore) ([]Quota, error) {
	if err := s.requireSuperadmin(ctx, actor); err != nil {
		return nil, err
	}
	now := s.now().UTC()
	return store.ListQuotas(ctx, time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC))
}

// ResetQuota gives a User their full allowance back in a Workspace for the rest
// of the month. Their recorded usage stays in the model usage table.
func (s *Service) ResetQuota(ctx context.Context, actor uuid.UUID, store QuotaStore, userID, workspaceID uuid.UUID) error {
	if err := s.requireSuperadmin(ctx, actor); err != nil {
		return err
	}
	return store.ResetQuota(ctx, userID, workspaceID)
}
