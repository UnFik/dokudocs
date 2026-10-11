package aiprovider

import (
	"context"
	"errors"
	"sync"
	"time"

	app "backend/internal/application/aisettings"
	appchat "backend/internal/application/rag/usecase"
	"backend/internal/infrastructure/openai"
)

const cacheTTL = 30 * time.Second

// Reader is the part of the settings store the resolver needs.
type Reader interface {
	Get(ctx context.Context, purpose string) (app.Record, bool, error)
	RecordError(ctx context.Context, purpose, message string) error
	ClearError(ctx context.Context, purpose string) error
}

type entry struct {
	at        time.Time
	found     bool
	hasError  bool
	answer    *openai.AnswerModel
	embedding *openai.EmbeddingModel
}

// Resolver hands out clients built from the stored settings. It reads the store at most
// every 30 seconds, so a change takes effect without a restart.
type Resolver struct {
	reader       Reader
	cipher       app.Cipher
	allowPrivate bool
	now          func() time.Time
	mu           sync.Mutex
	entries      map[string]entry
}

func NewResolver(reader Reader, cipher app.Cipher, allowPrivate bool) *Resolver {
	return &Resolver{reader: reader, cipher: cipher, allowPrivate: allowPrivate, now: time.Now, entries: map[string]entry{}}
}

// Invalidate forgets what was read, so the next call reads the store again.
func (r *Resolver) Invalidate() {
	r.mu.Lock()
	r.entries = map[string]entry{}
	r.mu.Unlock()
}

func (r *Resolver) load(ctx context.Context, purpose string) (entry, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if cached, ok := r.entries[purpose]; ok && r.now().Sub(cached.at) < cacheTTL {
		return cached, nil
	}
	record, found, err := r.reader.Get(ctx, purpose)
	if err != nil {
		return entry{}, err
	}
	loaded := entry{at: r.now(), found: found, hasError: record.LastError != ""}
	if found {
		key, err := r.cipher.Open(record.APIKeyCiphertext)
		if err != nil {
			return entry{}, err
		}
		cfg := openai.Config{BaseURL: record.BaseURL, APIKey: key, Model: record.Model, Protocol: record.Protocol, AllowPrivate: r.allowPrivate}
		if purpose == app.PurposeAnswer {
			loaded.answer = openai.NewAnswer(cfg)
		} else {
			loaded.embedding = openai.NewEmbedding(cfg)
		}
	}
	r.entries[purpose] = loaded
	return loaded, nil
}

// Snapshot returns the embedding client for a purpose, fixed to one model. The worker uses
// it so a batch is never labelled with a model other than the one that made it.
func (r *Resolver) Snapshot(ctx context.Context, purpose string) (appchat.EmbeddingModel, bool, error) {
	loaded, err := r.load(ctx, purpose)
	if err != nil || loaded.embedding == nil {
		return nil, false, err
	}
	return loaded.embedding, true, nil
}

func (r *Resolver) settle(purpose string, err error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	r.mu.Lock()
	cached := r.entries[purpose]
	r.mu.Unlock()
	switch {
	case err != nil:
		_ = r.reader.RecordError(ctx, purpose, trimPrefix(err.Error()))
	case cached.hasError:
		_ = r.reader.ClearError(ctx, purpose)
		r.mu.Lock()
		cached.hasError = false
		r.entries[purpose] = cached
		r.mu.Unlock()
	}
}

// Answer implements appchat.AnswerModel with the current answer setting.
func (r *Resolver) Answer(ctx context.Context, input appchat.ModelInput) (appchat.ModelOutput, error) {
	loaded, err := r.load(ctx, app.PurposeAnswer)
	if err != nil {
		return appchat.ModelOutput{}, err
	}
	if loaded.answer == nil {
		return appchat.ModelOutput{}, appchat.ErrAnswerModelUnavailable
	}
	out, err := loaded.answer.Answer(ctx, input)
	if err != nil && !isProviderError(err) {
		return out, err
	}
	r.settle(app.PurposeAnswer, err)
	return out, err
}

func isProviderError(err error) bool { return errors.Is(err, appchat.ErrRAGProviderUnavailable) }

// Embedder returns a view of one embedding purpose, usable as appchat.EmbeddingModel.
func (r *Resolver) Embedder(purpose string) appchat.EmbeddingModel {
	return &embedderView{r: r, purpose: purpose}
}

type embedderView struct {
	r       *Resolver
	purpose string
}

func (v *embedderView) current() *openai.EmbeddingModel {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	loaded, err := v.r.load(ctx, v.purpose)
	if err != nil {
		return nil
	}
	return loaded.embedding
}

func (v *embedderView) Provider() string {
	if m := v.current(); m != nil {
		return m.Provider()
	}
	return ""
}

func (v *embedderView) Model() string {
	if m := v.current(); m != nil {
		return m.Model()
	}
	return ""
}

func (v *embedderView) Dimensions() int { return 1536 }

func (v *embedderView) Embed(ctx context.Context, inputs []string) ([][]float32, error) {
	loaded, err := v.r.load(ctx, v.purpose)
	if err != nil {
		return nil, err
	}
	if loaded.embedding == nil {
		return nil, appchat.ErrEmbeddingNotConfigured
	}
	vectors, err := loaded.embedding.Embed(ctx, inputs)
	if err == nil || isProviderError(err) {
		v.r.settle(v.purpose, err)
	}
	return vectors, err
}
