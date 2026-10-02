package main

import (
	"context"
	"testing"

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
