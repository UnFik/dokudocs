// Package aiusage counts what every call to a Dokudocs model used, for the
// Superadmin. It keeps counts only, never content, and sets no quota.
package aiusage

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
)

// Features a model call can come from.
const (
	FeatureChatWorkspace  = "chat_workspace"
	FeatureChatDocument   = "chat_document"
	FeatureChatTitle      = "chat_title"
	FeatureIndexing       = "indexing"
	FeatureConnectionTest = "connection_test"
)

var ErrForbidden = errors.New("only a superadmin can see model usage")

// Attribution is who and what a model call is for; it rides on the context.
type Attribution struct {
	Feature     string
	UserID      uuid.UUID
	WorkspaceID uuid.UUID
}

type ctxKey struct{}

func With(ctx context.Context, a Attribution) context.Context {
	return context.WithValue(ctx, ctxKey{}, a)
}

func From(ctx context.Context) Attribution {
	a, _ := ctx.Value(ctxKey{}).(Attribution)
	if a.Feature == "" {
		a.Feature = FeatureIndexing
	}
	return a
}

type Record struct {
	Provider     string
	Model        string
	Purpose      string
	Feature      string
	InputTokens  int
	OutputTokens int
	DurationMS   int
	UserID       uuid.UUID
	WorkspaceID  uuid.UUID
	OK           bool
}

type Total struct {
	Calls        int `json:"calls"`
	Failed       int `json:"failed"`
	InputTokens  int `json:"inputTokens"`
	OutputTokens int `json:"outputTokens"`
}

type DayTotal struct {
	Day string `json:"day"`
	Total
}

type ModelTotal struct {
	Provider string `json:"provider"`
	Model    string `json:"model"`
	Total
}

type PurposeTotal struct {
	Purpose string `json:"purpose"`
	Feature string `json:"feature"`
	Total
}

type UserTotal struct {
	UserID uuid.UUID `json:"userId"`
	Name   string    `json:"name"`
	Email  string    `json:"email"`
	Total
}

type Summary struct {
	Since    time.Time      `json:"since"`
	Overall  Total          `json:"overall"`
	Days     []DayTotal     `json:"days"`
	Models   []ModelTotal   `json:"models"`
	Purposes []PurposeTotal `json:"purposes"`
	TopUsers []UserTotal    `json:"topUsers"`
}

type Store interface {
	RecordUsage(ctx context.Context, r Record) error
	UsageSummary(ctx context.Context, since time.Time, topUsers int) (Summary, error)
}

type Superadmins interface {
	IsSuperadmin(ctx context.Context, userID uuid.UUID) (bool, error)
}

type Service struct {
	store  Store
	admins Superadmins
	now    func() time.Time
}

func NewService(store Store, admins Superadmins) *Service {
	return &Service{store: store, admins: admins, now: time.Now}
}

// Summary covers the last days days, 1 to 90.
func (s *Service) Summary(ctx context.Context, actor uuid.UUID, days int) (Summary, error) {
	ok, err := s.admins.IsSuperadmin(ctx, actor)
	if err != nil {
		return Summary{}, err
	}
	if !ok {
		return Summary{}, ErrForbidden
	}
	if days < 1 || days > 90 {
		days = 30
	}
	since := s.now().UTC().Truncate(24*time.Hour).AddDate(0, 0, -(days - 1))
	return s.store.UsageSummary(ctx, since, 10)
}

// Recorder returns the hook a model client calls after each request. It writes
// with its own short context so a canceled request is still counted.
func Recorder(store Store, provider, model, purpose string) func(ctx context.Context, in, out int, took time.Duration, ok bool) {
	return func(ctx context.Context, in, out int, took time.Duration, ok bool) {
		a := From(ctx)
		write, cancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
		defer cancel()
		_ = store.RecordUsage(write, Record{
			Provider: provider, Model: model, Purpose: purpose, Feature: a.Feature,
			InputTokens: in, OutputTokens: out, DurationMS: int(took.Milliseconds()), UserID: a.UserID, WorkspaceID: a.WorkspaceID, OK: ok,
		})
	}
}
