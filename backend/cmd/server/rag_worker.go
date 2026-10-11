package main

import (
	"context"
	"errors"

	"backend/internal/application/aisettings"
	appchat "backend/internal/application/rag/usecase"
	"backend/internal/domain/model"
	documentrepo "backend/internal/infrastructure/repository/document"
)

const (
	// ragEmbedBatchSize matches the provider adapter's per-request input limit.
	ragEmbedBatchSize = 32
	// maxRAGEmbedBatchesPerTick bounds one tick so a huge backlog cannot starve
	// index rebuilds or shutdown; the next tick continues where this one stopped.
	maxRAGEmbedBatchesPerTick = 20
)

type ragEmbeddingStore interface {
	ListRAGChunksMissingEmbeddings(ctx context.Context, provider, embeddingModel string, limit int) ([]model.RAGChunk, error)
	StoreRAGChunkEmbeddings(ctx context.Context, provider, embeddingModel string, embeddings []documentrepo.RAGChunkEmbedding) error
}

// embedRAGBacklog embeds pending chunks batch by batch until none remain or the
// per-tick ceiling is reached.
func embedRAGBacklog(ctx context.Context, store ragEmbeddingStore, embedder appchat.EmbeddingModel) error {
	for range maxRAGEmbedBatchesPerTick {
		chunks, err := store.ListRAGChunksMissingEmbeddings(ctx, embedder.Provider(), embedder.Model(), ragEmbedBatchSize)
		if err != nil || len(chunks) == 0 {
			return err
		}
		inputs := make([]string, len(chunks))
		for i, chunk := range chunks {
			inputs[i] = chunk.Text
		}
		vectors, err := embedder.Embed(ctx, inputs)
		if err != nil {
			return err
		}
		if len(vectors) != len(chunks) {
			return errors.New("embedding provider returned an unexpected vector count")
		}
		embeddings := make([]documentrepo.RAGChunkEmbedding, len(chunks))
		for i, chunk := range chunks {
			embeddings[i] = documentrepo.RAGChunkEmbedding{
				ChunkID: chunk.ChunkID, DocumentID: chunk.DocumentID, BodyVersion: chunk.BodyVersion,
				SourceFingerprint: chunk.SourceFingerprint, Vector: vectors[i],
			}
		}
		if err := store.StoreRAGChunkEmbeddings(ctx, embedder.Provider(), embedder.Model(), embeddings); err != nil {
			return err
		}
		if len(chunks) < ragEmbedBatchSize {
			return nil
		}
	}
	return nil
}

// embedderSource hands out the embedding client for the active and the pending model.
type embedderSource interface {
	Snapshot(ctx context.Context, purpose string) (appchat.EmbeddingModel, bool, error)
}

type transitionAdvancer interface {
	Advance(ctx context.Context) (bool, error)
}

// embedConfiguredModels embeds the backlog for the active model and, while a switch is in
// progress, for the pending one as well; then lets the switch complete if it is done. A
// failing pending model never holds back the active one.
func embedConfiguredModels(ctx context.Context, store ragEmbeddingStore, source embedderSource, advance transitionAdvancer) error {
	var failures []error
	for _, purpose := range []string{aisettings.PurposeEmbedding, aisettings.PurposeEmbeddingPending} {
		embedder, ok, err := source.Snapshot(ctx, purpose)
		if err != nil {
			failures = append(failures, err)
			continue
		}
		if !ok {
			continue
		}
		if err := embedRAGBacklog(ctx, store, embedder); err != nil {
			failures = append(failures, err)
		}
	}
	if len(failures) > 0 {
		return errors.Join(failures...)
	}
	_, err := advance.Advance(ctx)
	return err
}
