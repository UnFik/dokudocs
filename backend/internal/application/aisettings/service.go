// Package aisettings holds which AI provider the chatbot answers and embeds with.
// A Superadmin changes it at run time; a setting is kept only after a connection test.
package aisettings

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"backend/internal/infrastructure/netguard"

	"github.com/google/uuid"
)

const (
	PurposeAnswer           = "answer"
	PurposeEmbedding        = "embedding"
	PurposeEmbeddingPending = "embedding_pending"
	// PurposeAgent is the model the Agent thinks and calls tools with; without it chat answers from documents only.
	PurposeAgent = "agent"

	ProtocolResponses       = "openai_responses"
	ProtocolChatCompletions = "openai_chat_completions"

	maxModelLength = 200
)

var (
	ErrForbidden = errors.New("only a superadmin can change the AI provider")
	ErrInvalid   = errors.New("the AI provider setting is not valid")
)

// ConnectionError is a failed connection test; Message is safe to show.
type ConnectionError struct{ Message string }

func (e *ConnectionError) Error() string { return "connection test failed: " + e.Message }

// Config is what a provider client needs.
type Config struct{ BaseURL, Protocol, Model, APIKey string }

// Record is a stored setting; the key is sealed.
type Record struct {
	Purpose, BaseURL, Protocol, Model string
	APIKeyCiphertext                  []byte
	UpdatedBy                         *uuid.UUID
	UpdatedAt                         time.Time
	LastError                         string
	LastErrorAt                       *time.Time
}

type FieldChange struct {
	From string `json:"from"`
	To   string `json:"to"`
}

// Change is one audit entry.
type Change struct {
	Purpose   string
	ChangedBy uuid.UUID
	ChangedAt time.Time
	Changes   map[string]FieldChange
}

type Store interface {
	IsSuperadmin(context.Context, uuid.UUID) (bool, error)
	Get(ctx context.Context, purpose string) (Record, bool, error)
	// Put replaces the row for the record's purpose and clears its last error.
	Put(context.Context, Record) error
	Delete(ctx context.Context, purpose string) error
	RecordError(ctx context.Context, purpose, message string) error
	AddChange(context.Context, Change) error
	ListChanges(ctx context.Context, limit int) ([]Change, error)
}

// Index reports and prunes the stored vectors.
type Index interface {
	RAGEmbeddingProgress(ctx context.Context, provider, model string) (done, total int, err error)
	DeleteRAGEmbeddingsExcept(ctx context.Context, provider, model string) (int64, error)
}

type Cipher interface {
	Seal(plain string) ([]byte, error)
	Open(sealed []byte) (string, error)
}

type Tester interface {
	Test(ctx context.Context, purpose string, cfg Config) error
}

type Deps struct {
	Store        Store
	Index        Index
	Cipher       Cipher
	Tester       Tester
	ProviderName func(baseURL string) string
	AllowPrivate bool
	// OnChange runs after a setting changed, so cached readers can look again.
	OnChange func()
}

type Service struct{ d Deps }

func NewService(d Deps) *Service { return &Service{d: d} }

// Input is what a Superadmin submits; an empty APIKey keeps the stored one.
type Input struct{ BaseURL, Protocol, Model, APIKey string }

type View struct {
	Purpose     string     `json:"purpose"`
	BaseURL     string     `json:"baseURL"`
	Protocol    string     `json:"protocol"`
	Model       string     `json:"model"`
	KeyHint     string     `json:"keyHint"`
	UpdatedBy   *uuid.UUID `json:"updatedBy"`
	UpdatedAt   time.Time  `json:"updatedAt"`
	LastError   string     `json:"lastError"`
	LastErrorAt *time.Time `json:"lastErrorAt"`
}

type Progress struct {
	Done  int `json:"done"`
	Total int `json:"total"`
}

type Overview struct {
	Answer           *View     `json:"answer"`
	Embedding        *View     `json:"embedding"`
	EmbeddingPending *View     `json:"embeddingPending"`
	Agent            *View     `json:"agent"`
	Progress         *Progress `json:"progress"`
}

func (s *Service) authorize(ctx context.Context, actor uuid.UUID) error {
	ok, err := s.d.Store.IsSuperadmin(ctx, actor)
	if err != nil {
		return err
	}
	if !ok {
		return ErrForbidden
	}
	return nil
}

func (s *Service) Overview(ctx context.Context, actor uuid.UUID) (Overview, error) {
	if err := s.authorize(ctx, actor); err != nil {
		return Overview{}, err
	}
	return s.overview(ctx)
}

func (s *Service) overview(ctx context.Context) (Overview, error) {
	var out Overview
	for purpose, target := range map[string]**View{
		PurposeAnswer: &out.Answer, PurposeEmbedding: &out.Embedding, PurposeEmbeddingPending: &out.EmbeddingPending,
		PurposeAgent: &out.Agent,
	} {
		record, found, err := s.d.Store.Get(ctx, purpose)
		if err != nil {
			return Overview{}, err
		}
		if !found {
			continue
		}
		view, err := s.view(record)
		if err != nil {
			return Overview{}, err
		}
		*target = &view
	}
	if out.EmbeddingPending != nil {
		done, total, err := s.d.Index.RAGEmbeddingProgress(ctx, s.d.ProviderName(out.EmbeddingPending.BaseURL), out.EmbeddingPending.Model)
		if err != nil {
			return Overview{}, err
		}
		out.Progress = &Progress{Done: done, Total: total}
	}
	return out, nil
}

func (s *Service) view(r Record) (View, error) {
	key, err := s.d.Cipher.Open(r.APIKeyCiphertext)
	if err != nil {
		return View{}, err
	}
	hint := "••••"
	if len(key) >= 4 {
		hint += key[len(key)-4:]
	}
	return View{
		Purpose: r.Purpose, BaseURL: r.BaseURL, Protocol: r.Protocol, Model: r.Model, KeyHint: hint,
		UpdatedBy: r.UpdatedBy, UpdatedAt: r.UpdatedAt, LastError: r.LastError, LastErrorAt: r.LastErrorAt,
	}, nil
}

// Changes lists the newest audit entries.
func (s *Service) Changes(ctx context.Context, actor uuid.UUID, limit int) ([]Change, error) {
	if err := s.authorize(ctx, actor); err != nil {
		return nil, err
	}
	return s.d.Store.ListChanges(ctx, limit)
}

// prepared is an Input that passed validation, with its key resolved.
type prepared struct {
	cfg         Config
	keyReplaced bool
}

func (s *Service) prepare(ctx context.Context, purpose string, in Input) (prepared, error) {
	if purpose != PurposeAnswer && purpose != PurposeEmbedding && purpose != PurposeAgent {
		return prepared{}, fmt.Errorf("%w: unknown purpose", ErrInvalid)
	}
	baseURL, err := netguard.ValidateBaseURL(in.BaseURL, s.d.AllowPrivate)
	if err != nil {
		return prepared{}, fmt.Errorf("%w: %v", ErrInvalid, err)
	}
	model := strings.TrimSpace(in.Model)
	if model == "" || len(model) > maxModelLength {
		return prepared{}, fmt.Errorf("%w: the model name is required and at most %d characters", ErrInvalid, maxModelLength)
	}
	if in.Protocol != ProtocolResponses && in.Protocol != ProtocolChatCompletions {
		return prepared{}, fmt.Errorf("%w: unknown protocol", ErrInvalid)
	}
	cfg := Config{BaseURL: baseURL, Protocol: in.Protocol, Model: model, APIKey: strings.TrimSpace(in.APIKey)}
	if cfg.APIKey != "" {
		return prepared{cfg: cfg, keyReplaced: true}, nil
	}
	// No new key: keep the one already stored for this purpose (or its pending twin).
	for _, name := range []string{purpose, PurposeEmbeddingPending} {
		if name == PurposeEmbeddingPending && purpose != PurposeEmbedding {
			continue
		}
		record, found, err := s.d.Store.Get(ctx, name)
		if err != nil {
			return prepared{}, err
		}
		if !found {
			continue
		}
		if cfg.APIKey, err = s.d.Cipher.Open(record.APIKeyCiphertext); err != nil {
			return prepared{}, err
		}
		return prepared{cfg: cfg}, nil
	}
	return prepared{}, fmt.Errorf("%w: an API key is required", ErrInvalid)
}

func (s *Service) test(ctx context.Context, purpose string, cfg Config) error {
	if err := s.d.Tester.Test(ctx, purpose, cfg); err != nil {
		return &ConnectionError{Message: err.Error()}
	}
	return nil
}

// Test checks a setting against the provider without saving it.
func (s *Service) Test(ctx context.Context, actor uuid.UUID, purpose string, in Input) error {
	if err := s.authorize(ctx, actor); err != nil {
		return err
	}
	p, err := s.prepare(ctx, purpose, in)
	if err != nil {
		return err
	}
	return s.test(ctx, purpose, p.cfg)
}

// Save keeps a setting once its connection test passes. A different embedding model
// than the active one is stored as pending until every document has been re-embedded.
func (s *Service) Save(ctx context.Context, actor uuid.UUID, purpose string, in Input) (Overview, error) {
	if err := s.authorize(ctx, actor); err != nil {
		return Overview{}, err
	}
	p, err := s.prepare(ctx, purpose, in)
	if err != nil {
		return Overview{}, err
	}
	if err := s.test(ctx, purpose, p.cfg); err != nil {
		return Overview{}, err
	}
	sealed, err := s.d.Cipher.Seal(p.cfg.APIKey)
	if err != nil {
		return Overview{}, err
	}
	target := purpose
	previous, hadPrevious, err := s.d.Store.Get(ctx, purpose)
	if err != nil {
		return Overview{}, err
	}
	if purpose == PurposeEmbedding && hadPrevious {
		if s.d.ProviderName(previous.BaseURL) != s.d.ProviderName(p.cfg.BaseURL) || previous.Model != p.cfg.Model {
			target = PurposeEmbeddingPending
			if previous, hadPrevious, err = s.d.Store.Get(ctx, target); err != nil {
				return Overview{}, err
			}
		} else if err := s.d.Store.Delete(ctx, PurposeEmbeddingPending); err != nil {
			return Overview{}, err
		}
	}
	actorID := actor
	if err := s.d.Store.Put(ctx, Record{
		Purpose: target, BaseURL: p.cfg.BaseURL, Protocol: p.cfg.Protocol, Model: p.cfg.Model,
		APIKeyCiphertext: sealed, UpdatedBy: &actorID, UpdatedAt: time.Now(),
	}); err != nil {
		return Overview{}, err
	}
	if err := s.d.Store.AddChange(ctx, Change{
		Purpose: target, ChangedBy: actor, Changes: diff(previous, hadPrevious, p),
	}); err != nil {
		return Overview{}, err
	}
	s.changed()
	return s.overview(ctx)
}

func (s *Service) changed() {
	if s.d.OnChange != nil {
		s.d.OnChange()
	}
}

func diff(previous Record, had bool, p prepared) map[string]FieldChange {
	changes := map[string]FieldChange{}
	for field, pair := range map[string][2]string{
		"baseURL":  {previous.BaseURL, p.cfg.BaseURL},
		"protocol": {previous.Protocol, p.cfg.Protocol},
		"model":    {previous.Model, p.cfg.Model},
	} {
		if !had || pair[0] != pair[1] {
			changes[field] = FieldChange{From: pair[0], To: pair[1]}
		}
	}
	if p.keyReplaced {
		changes["apiKey"] = FieldChange{To: "replaced"}
	}
	return changes
}

// Advance makes the pending embedding model active once every current chunk has its
// vector, then drops the old model's vectors. The worker calls it on each tick.
func (s *Service) Advance(ctx context.Context) (bool, error) {
	pending, found, err := s.d.Store.Get(ctx, PurposeEmbeddingPending)
	if err != nil || !found {
		return false, err
	}
	provider := s.d.ProviderName(pending.BaseURL)
	done, total, err := s.d.Index.RAGEmbeddingProgress(ctx, provider, pending.Model)
	if err != nil || done < total {
		return false, err
	}
	previous, _, err := s.d.Store.Get(ctx, PurposeEmbedding)
	if err != nil {
		return false, err
	}
	promoted := pending
	promoted.Purpose = PurposeEmbedding
	if err := s.d.Store.Put(ctx, promoted); err != nil {
		return false, err
	}
	if err := s.d.Store.Delete(ctx, PurposeEmbeddingPending); err != nil {
		return false, err
	}
	s.changed()
	if _, err := s.d.Index.DeleteRAGEmbeddingsExcept(ctx, provider, pending.Model); err != nil {
		return true, err
	}
	changed := map[string]FieldChange{"model": {From: previous.Model, To: pending.Model}, "baseURL": {From: previous.BaseURL, To: pending.BaseURL}}
	by := uuid.Nil
	if pending.UpdatedBy != nil {
		by = *pending.UpdatedBy
	}
	return true, s.d.Store.AddChange(ctx, Change{Purpose: PurposeEmbedding, ChangedBy: by, Changes: changed})
}

// Seed is the environment's one-time contribution.
type Seed struct{ APIKey, BaseURL, AnswerModel, EmbeddingModel string }

// Seed fills a purpose that has no row yet from the environment. Later boots leave
// the database alone, so it is the single source of truth after the first run.
func (s *Service) Seed(ctx context.Context, seed Seed) error {
	if strings.TrimSpace(seed.APIKey) == "" {
		return nil
	}
	baseURL := strings.TrimSpace(seed.BaseURL)
	if baseURL == "" {
		baseURL = "https://api.openai.com/v1"
	}
	sealed, err := s.d.Cipher.Seal(strings.TrimSpace(seed.APIKey))
	if err != nil {
		return err
	}
	for purpose, model := range map[string]string{PurposeAnswer: seed.AnswerModel, PurposeEmbedding: seed.EmbeddingModel} {
		if strings.TrimSpace(model) == "" {
			continue
		}
		if _, found, err := s.d.Store.Get(ctx, purpose); err != nil || found {
			if err != nil {
				return err
			}
			continue
		}
		if err := s.d.Store.Put(ctx, Record{
			Purpose: purpose, BaseURL: baseURL, Protocol: ProtocolResponses, Model: strings.TrimSpace(model),
			APIKeyCiphertext: sealed, UpdatedAt: time.Now(),
		}); err != nil {
			return err
		}
	}
	return nil
}
