package main

import (
	"context"
	"errors"
	"testing"

	"backend/internal/application/aisettings"
	appchat "backend/internal/application/rag/usecase"
	"backend/internal/domain/model"
	documentrepo "backend/internal/infrastructure/repository/document"

	"github.com/google/uuid"
)

type fakeEmbeddingStore struct {
	pending []model.RAGChunk
	stored  int
	listed  int
}

func (s *fakeEmbeddingStore) ListRAGChunksMissingEmbeddings(_ context.Context, _, _ string, limit int) ([]model.RAGChunk, error) {
	s.listed++
	n := min(limit, len(s.pending))
	batch := s.pending[:n]
	s.pending = s.pending[n:]
	return batch, nil
}

func (s *fakeEmbeddingStore) StoreRAGChunkEmbeddings(_ context.Context, _, _ string, e []documentrepo.RAGChunkEmbedding) error {
	s.stored += len(e)
	return nil
}

type unitEmbedder struct{}

func (unitEmbedder) Provider() string { return "fake" }
func (unitEmbedder) Model() string    { return "unit" }
func (unitEmbedder) Dimensions() int  { return 1536 }
func (unitEmbedder) Embed(_ context.Context, in []string) ([][]float32, error) {
	out := make([][]float32, len(in))
	for i := range in {
		out[i] = make([]float32, 1536)
		out[i][0] = 1
	}
	return out, nil
}

func chunks(n int) []model.RAGChunk {
	out := make([]model.RAGChunk, n)
	for i := range out {
		out[i] = model.RAGChunk{ChunkID: uuid.New(), Text: "text"}
	}
	return out
}

// One worker tick must clear a backlog larger than a single provider batch,
// otherwise recovery time grows with backlog size times the polling interval.
func TestEmbeddingTickDrainsBacklogBeyondOneBatch(t *testing.T) {
	store := &fakeEmbeddingStore{pending: chunks(100)}
	if err := embedRAGBacklog(context.Background(), store, unitEmbedder{}); err != nil {
		t.Fatal(err)
	}
	if store.stored != 100 {
		t.Fatalf("embedded %d chunks in one tick, want the whole backlog of 100", store.stored)
	}
}

func TestEmbeddingTickStopsAtBatchCeilingSoOneTickCannotRunForever(t *testing.T) {
	store := &fakeEmbeddingStore{pending: chunks(ragEmbedBatchSize * (maxRAGEmbedBatchesPerTick + 5))}
	if err := embedRAGBacklog(context.Background(), store, unitEmbedder{}); err != nil {
		t.Fatal(err)
	}
	if want := ragEmbedBatchSize * maxRAGEmbedBatchesPerTick; store.stored != want {
		t.Fatalf("embedded %d chunks, want the per-tick ceiling %d", store.stored, want)
	}
}

type namedEmbedder struct {
	unitEmbedder
	provider, name string
	err            error
}

func (e namedEmbedder) Provider() string { return e.provider }
func (e namedEmbedder) Model() string    { return e.name }
func (e namedEmbedder) Embed(ctx context.Context, in []string) ([][]float32, error) {
	if e.err != nil {
		return nil, e.err
	}
	return e.unitEmbedder.Embed(ctx, in)
}

type modelStore struct {
	byModel map[string][]model.RAGChunk
	stored  map[string]int
}

func (s *modelStore) ListRAGChunksMissingEmbeddings(_ context.Context, provider, name string, limit int) ([]model.RAGChunk, error) {
	key := provider + "/" + name
	n := min(limit, len(s.byModel[key]))
	batch := s.byModel[key][:n]
	s.byModel[key] = s.byModel[key][n:]
	return batch, nil
}

func (s *modelStore) StoreRAGChunkEmbeddings(_ context.Context, provider, name string, e []documentrepo.RAGChunkEmbedding) error {
	s.stored[provider+"/"+name] += len(e)
	return nil
}

type fixedSource map[string]appchat.EmbeddingModel

func (s fixedSource) Snapshot(_ context.Context, purpose string) (appchat.EmbeddingModel, bool, error) {
	m, ok := s[purpose]
	return m, ok, nil
}

type countingAdvancer struct{ calls int }

func (a *countingAdvancer) Advance(context.Context) (bool, error) { a.calls++; return false, nil }

func TestWhileSwitchingModelsEveryChunkGetsAVectorFromBoth(t *testing.T) {
	store := &modelStore{
		byModel: map[string][]model.RAGChunk{"openai/old": chunks(3), "other/new": chunks(5)},
		stored:  map[string]int{},
	}
	source := fixedSource{
		aisettings.PurposeEmbedding:        namedEmbedder{provider: "openai", name: "old"},
		aisettings.PurposeEmbeddingPending: namedEmbedder{provider: "other", name: "new"},
	}
	advancer := &countingAdvancer{}
	if err := embedConfiguredModels(context.Background(), store, source, advancer); err != nil {
		t.Fatal(err)
	}
	if store.stored["openai/old"] != 3 || store.stored["other/new"] != 5 {
		t.Fatalf("stored = %v, want 3 for the active model and 5 for the pending one", store.stored)
	}
	if advancer.calls != 1 {
		t.Fatalf("Advance ran %d times, want once after embedding", advancer.calls)
	}
}

func TestAFailingPendingModelDoesNotStopTheActiveOne(t *testing.T) {
	store := &modelStore{byModel: map[string][]model.RAGChunk{"openai/old": chunks(3), "other/new": chunks(5)}, stored: map[string]int{}}
	source := fixedSource{
		aisettings.PurposeEmbedding:        namedEmbedder{provider: "openai", name: "old"},
		aisettings.PurposeEmbeddingPending: namedEmbedder{provider: "other", name: "new", err: errors.New("provider down")},
	}
	advancer := &countingAdvancer{}
	if err := embedConfiguredModels(context.Background(), store, source, advancer); err == nil {
		t.Fatal("the pending model's failure was swallowed")
	}
	if store.stored["openai/old"] != 3 {
		t.Fatalf("the active model embedded %d chunks, want 3", store.stored["openai/old"])
	}
	if advancer.calls != 0 {
		t.Fatal("Advance ran after a failed embedding")
	}
}

func TestWithoutAnyEmbeddingModelTheWorkerEmbedsNothing(t *testing.T) {
	store := &modelStore{byModel: map[string][]model.RAGChunk{}, stored: map[string]int{}}
	advancer := &countingAdvancer{}
	if err := embedConfiguredModels(context.Background(), store, fixedSource{}, advancer); err != nil || len(store.stored) != 0 {
		t.Fatalf("err %v, stored %v", err, store.stored)
	}
}
