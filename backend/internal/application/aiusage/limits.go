package aiusage

import (
	"context"
	"errors"
	"time"

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
