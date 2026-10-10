// Package catalog is the built-in list of Hosts, Systems and protocols an
// Architecture document draws with, and people's requests for missing entries.
package catalog

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
)

// Entry is one kind a node or Connection can be.
type Entry struct {
	Slug       string  `json:"slug"`
	Category   string  `json:"category"`
	Subkind    string  `json:"subkind"`
	Name       string  `json:"name"`
	Family     *string `json:"family"`
	SortOrder  int     `json:"sortOrder"`
	Deprecated bool    `json:"deprecated"`
}

// RequestInput asks for an entry the catalog does not have.
type RequestInput struct {
	UserID      uuid.UUID
	WorkspaceID uuid.UUID
	Name        string
	Category    string
	Website     string
	Note        string
}

// RequestResult is the request the input became or joined.
type RequestResult struct {
	ID               uuid.UUID `json:"id"`
	Name             string    `json:"name"`
	Votes            int       `json:"votes"`
	AlreadyRequested bool      `json:"alreadyRequested"`
}

// MaxOpenRequests is how many open requests one person may have.
const MaxOpenRequests = 20

// OpenRequest is a request waiting for an answer, as platform admins see it.
type OpenRequest struct {
	ID        uuid.UUID `json:"id"`
	Name      string    `json:"name"`
	Category  string    `json:"category"`
	Website   string    `json:"website"`
	Note      string    `json:"note"`
	Votes     int       `json:"votes"`
	CreatedAt time.Time `json:"createdAt"`
}

// MyRequest is a request someone voted for, with its answer.
type MyRequest struct {
	ID            uuid.UUID `json:"id"`
	Name          string    `json:"name"`
	Status        string    `json:"status"`
	ResolvedSlug  *string   `json:"resolvedSlug"`
	DeclineReason string    `json:"declineReason"`
	Votes         int       `json:"votes"`
}

// Answer closes a request: added with the slug it became, or declined with a reason.
type Answer struct {
	Status string `json:"status"`
	Slug   string `json:"slug"`
	Reason string `json:"reason"`
}

// Notification is one in-app message.
type Notification struct {
	ID        uuid.UUID `json:"id"`
	Kind      string    `json:"kind"`
	Title     string    `json:"title"`
	Body      string    `json:"body"`
	Read      bool      `json:"read"`
	CreatedAt time.Time `json:"createdAt"`
	// Path opens what the notification is about, when it is about something.
	Path string `json:"path,omitempty"`
}

var (
	ErrNotAdmin        = errors.New("only a platform admin may review catalog requests")
	ErrInvalidAnswer   = errors.New("an answer is added with a catalog slug, or declined with a reason")
	ErrInvalidRequest  = errors.New("a request needs a name of 1 to 100 characters and a category: host, system or protocol")
	ErrTooManyRequests = errors.New("too many open catalog requests")
	ErrNotMember       = errors.New("not a member of the workspace")
)

// InCatalogError means the name asked for is already an entry.
type InCatalogError struct{ Slug string }

func (e InCatalogError) Error() string { return "already in the catalog as " + e.Slug }

// Store keeps the catalog and the requests.
type Store interface {
	ListEntries(ctx context.Context) ([]Entry, error)
	// FindEntry returns the slug of an entry whose name key or slug matches key, or "".
	FindEntry(ctx context.Context, key string) (string, error)
	// AddRequest records the request or a vote on the open one with the same key.
	AddRequest(ctx context.Context, input RequestInput, key string) (RequestResult, error)
	OpenRequests(ctx context.Context, actorID uuid.UUID) ([]OpenRequest, error)
	MyRequests(ctx context.Context, userID uuid.UUID) ([]MyRequest, error)
	AnswerRequest(ctx context.Context, actorID, requestID uuid.UUID, answer Answer) error
	Notifications(ctx context.Context, userID uuid.UUID) ([]Notification, error)
	// MarkNotificationsRead marks the unread ones of a kind as read, or all of them for kind "".
	MarkNotificationsRead(ctx context.Context, userID uuid.UUID, kind string) error
}

var notAlnum = regexp.MustCompile(`[^a-z0-9]+`)

// NameKey is what two names must share to be the same request: lowercase letters and digits only.
func NameKey(name string) string {
	return notAlnum.ReplaceAllString(strings.ToLower(name), "")
}

type Service struct{ store Store }

func NewService(store Store) *Service { return &Service{store: store} }

func (s *Service) List(ctx context.Context) ([]Entry, error) { return s.store.ListEntries(ctx) }

func (s *Service) Request(ctx context.Context, input RequestInput) (RequestResult, error) {
	input.Name = strings.TrimSpace(input.Name)
	key := NameKey(input.Name)
	if key == "" || len([]rune(input.Name)) > 100 || len([]rune(input.Note)) > 1000 ||
		(input.Category != "host" && input.Category != "system" && input.Category != "protocol") {
		return RequestResult{}, ErrInvalidRequest
	}
	slug, err := s.store.FindEntry(ctx, key)
	if err != nil {
		return RequestResult{}, err
	}
	if slug != "" {
		return RequestResult{}, InCatalogError{Slug: slug}
	}
	return s.store.AddRequest(ctx, input, key)
}

func (s *Service) OpenRequests(ctx context.Context, actorID uuid.UUID) ([]OpenRequest, error) {
	return s.store.OpenRequests(ctx, actorID)
}

func (s *Service) MyRequests(ctx context.Context, userID uuid.UUID) ([]MyRequest, error) {
	return s.store.MyRequests(ctx, userID)
}

func (s *Service) Answer(ctx context.Context, actorID, requestID uuid.UUID, answer Answer) error {
	answer.Reason = strings.TrimSpace(answer.Reason)
	switch {
	case answer.Status == "added" && answer.Slug != "":
	case answer.Status == "declined" && answer.Reason != "" && len([]rune(answer.Reason)) <= 500:
	default:
		return ErrInvalidAnswer
	}
	return s.store.AnswerRequest(ctx, actorID, requestID, answer)
}

func (s *Service) Notifications(ctx context.Context, userID uuid.UUID) ([]Notification, error) {
	return s.store.Notifications(ctx, userID)
}

func (s *Service) MarkNotificationsRead(ctx context.Context, userID uuid.UUID, kind string) error {
	return s.store.MarkNotificationsRead(ctx, userID, kind)
}
