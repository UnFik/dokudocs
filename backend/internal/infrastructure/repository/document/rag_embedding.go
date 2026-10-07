package document

import (
	"context"
	"errors"
	"math"
	"strconv"
	"strings"

	"backend/internal/domain/model"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

const ragEmbeddingDimensions = 1536

type RAGChunkEmbedding struct {
	ChunkID           uuid.UUID
	DocumentID        uuid.UUID
	BodyVersion       int64
	SourceFingerprint string
	Vector            []float32
}

// ListRAGChunksMissingEmbeddings returns only chunks from the current AST projection.
func (r *Repository) ListRAGChunksMissingEmbeddings(ctx context.Context, provider, embeddingModel string, limit int) ([]model.RAGChunk, error) {
	if strings.TrimSpace(provider) == "" || strings.TrimSpace(embeddingModel) == "" {
		return nil, errors.New("embedding provider and model are required")
	}
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := r.db.QueryContext(ctx, `
		SELECT c.chunk_id, c.document_id, c.node_id, c.text, c.title,
		       c.breadcrumb, c.body_version, c.source_fingerprint, ri.coverage_status
		FROM rag_chunks c
		JOIN documents d ON d.id = c.document_id
		JOIN rag_document_indexes ri ON ri.document_id = d.id
		LEFT JOIN projects p ON p.id = d.project_id AND p.workspace_id = d.workspace_id AND p.deleted_at IS NULL
		LEFT JOIN rag_embeddings e ON e.chunk_id = c.chunk_id AND e.provider = $1 AND e.model = $2
		WHERE d.type = 'markdown' AND d.deleted_at IS NULL
		  AND ri.indexed_body_version = d.body_version
		  AND ri.source_fingerprint = c.source_fingerprint AND ri.indexed_title = d.title
		  AND ri.indexed_project_id IS NOT DISTINCT FROM d.project_id
		  AND ri.indexed_project_name = COALESCE(p.name, '') AND ri.renderer_version = 2
		  AND e.chunk_id IS NULL
		ORDER BY ri.indexed_at, c.document_id, c.ordinal
		LIMIT $3
	`, provider, embeddingModel, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	chunks := make([]model.RAGChunk, 0)
	for rows.Next() {
		var chunk model.RAGChunk
		if err := rows.Scan(&chunk.ChunkID, &chunk.DocumentID, &chunk.NodeID, &chunk.Text, &chunk.Title,
			&chunk.Breadcrumb, &chunk.BodyVersion, &chunk.SourceFingerprint, &chunk.CoverageStatus); err != nil {
			return nil, err
		}
		chunks = append(chunks, chunk)
	}
	return chunks, rows.Err()
}

// StoreRAGChunkEmbeddings discards results if the canonical source changed during provider work.
func (r *Repository) StoreRAGChunkEmbeddings(ctx context.Context, provider, embeddingModel string, embeddings []RAGChunkEmbedding) error {
	if r.tx == nil || strings.TrimSpace(provider) == "" || strings.TrimSpace(embeddingModel) == "" {
		return errors.New("embedding storage requires a provider, model, and transaction-capable database")
	}
	literals := make([]string, len(embeddings))
	for i, embedding := range embeddings {
		if embedding.ChunkID == uuid.Nil || embedding.DocumentID == uuid.Nil || embedding.BodyVersion <= 0 || embedding.SourceFingerprint == "" {
			return errors.New("embedding source identity is invalid")
		}
		literal, err := ragVectorLiteral(embedding.Vector)
		if err != nil {
			return err
		}
		literals[i] = literal
	}
	return r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		for i, embedding := range embeddings {
			if _, err := tx.ExecContext(ctx, `
				INSERT INTO rag_embeddings (chunk_id, provider, model, dimensions, values)
				SELECT c.chunk_id, $5, $6, $7, $8::vector
				FROM rag_chunks c
				JOIN documents d ON d.id = c.document_id
				JOIN rag_document_indexes ri ON ri.document_id = d.id
				LEFT JOIN projects p ON p.id = d.project_id AND p.workspace_id = d.workspace_id AND p.deleted_at IS NULL
				WHERE c.chunk_id = $1 AND c.document_id = $2 AND c.body_version = $3
				  AND c.source_fingerprint = $4 AND d.type = 'markdown' AND d.deleted_at IS NULL
				  AND ri.indexed_body_version = d.body_version
				  AND ri.source_fingerprint = c.source_fingerprint AND ri.indexed_title = d.title
				  AND ri.indexed_project_id IS NOT DISTINCT FROM d.project_id
				  AND ri.indexed_project_name = COALESCE(p.name, '') AND ri.renderer_version = 2
				ON CONFLICT (chunk_id) DO UPDATE SET provider = EXCLUDED.provider, model = EXCLUDED.model,
				  dimensions = EXCLUDED.dimensions, values = EXCLUDED.values, created_at = NOW()
			`, embedding.ChunkID, embedding.DocumentID, embedding.BodyVersion, embedding.SourceFingerprint,
				provider, embeddingModel, ragEmbeddingDimensions, literals[i]); err != nil {
				return err
			}
		}
		return nil
	})
}

func ragVectorLiteral(vector []float32) (string, error) {
	if len(vector) != ragEmbeddingDimensions {
		return "", errors.New("embedding vector has an unsupported dimension")
	}
	parts := make([]string, len(vector))
	norm := float64(0)
	for i, value := range vector {
		if math.IsNaN(float64(value)) || math.IsInf(float64(value), 0) {
			return "", errors.New("embedding vector contains a non-finite value")
		}
		norm += float64(value) * float64(value)
		parts[i] = strconv.FormatFloat(float64(value), 'g', -1, 32)
	}
	if norm == 0 {
		return "", errors.New("embedding vector cannot be zero")
	}
	return "[" + strings.Join(parts, ",") + "]", nil
}
