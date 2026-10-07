package document

import (
	"context"
	"errors"
	"strings"
	"unicode"

	"backend/internal/domain/model"

	"github.com/google/uuid"
)

type RAGChunk = model.RAGChunk

func (r *Repository) HasStaleReadableRAGIndex(ctx context.Context, workspaceID, actorID uuid.UUID, publicLinkTokens []string, provider, embeddingModel string) (bool, error) {
	if publicLinkTokens == nil {
		publicLinkTokens = []string{}
	}
	var stale bool
	err := r.db.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM documents d
			LEFT JOIN projects p ON p.id = d.project_id AND p.workspace_id = d.workspace_id AND p.deleted_at IS NULL
			LEFT JOIN rag_document_indexes ri ON ri.document_id = d.id
			WHERE d.workspace_id = $1 AND d.type IN ('markdown', 'architecture') AND d.deleted_at IS NULL AND d.content_json IS NOT NULL
			  AND (
				ri.document_id IS NULL
				OR ri.indexed_body_version <> d.body_version
				OR ri.indexed_title <> d.title
				OR ri.indexed_project_id IS DISTINCT FROM d.project_id
				OR ri.indexed_project_name <> COALESCE(p.name, '')
				OR ri.renderer_version <> 2
				OR ri.coverage_status = 'partial'
				OR ($4 <> '' AND EXISTS (
					SELECT 1 FROM rag_chunks c
					WHERE c.document_id = d.id AND NOT EXISTS (
						SELECT 1 FROM rag_embeddings e WHERE e.chunk_id = c.chunk_id
						  AND e.provider = $4 AND e.model = $5 AND e.dimensions = 1536
					)
				))
			)
			AND (
				(
					(d.visibility <> 'public_link' OR d.is_draft = TRUE)
					AND (TRUE `+documentReadPredicate+`)
				)
				OR (
					d.visibility = 'public_link' AND d.is_draft = FALSE
					AND d.share_token = ANY($3)
					AND EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = d.workspace_id AND wm.user_id = $2)
				)
			)
		)
	`, workspaceID, actorID, publicLinkTokens, provider, embeddingModel).Scan(&stale)
	return stale, err
}

// SearchRAGChunks returns only indexed chunks matching the current canonical body
// and the actor's effective document read policy. It is deliberately lexical until
// an embedding provider and vector index are selected.
func (r *Repository) SearchRAGChunks(ctx context.Context, workspaceID, actorID uuid.UUID, query string, limit int) ([]RAGChunk, error) {
	return r.SearchRAGChunksWithPublicLinkTokens(ctx, workspaceID, actorID, query, limit, nil)
}

func (r *Repository) SearchRAGChunksWithPublicLinkTokens(ctx context.Context, workspaceID, actorID uuid.UUID, query string, limit int, publicLinkTokens []string) ([]RAGChunk, error) {
	return r.searchRAGChunks(ctx, workspaceID, actorID, query, nil, "", "", limit, publicLinkTokens)
}

func (r *Repository) SearchRAGChunksWithEmbedding(ctx context.Context, workspaceID, actorID uuid.UUID, query string, embedding []float32, provider, embeddingModel string, limit int, publicLinkTokens []string) ([]RAGChunk, error) {
	if provider == "" || embeddingModel == "" {
		return nil, errors.New("embedding provider and model are required")
	}
	vector, err := ragVectorLiteral(embedding)
	if err != nil {
		return nil, err
	}
	return r.searchRAGChunks(ctx, workspaceID, actorID, query, vector, provider, embeddingModel, limit, publicLinkTokens)
}

func (r *Repository) searchRAGChunks(ctx context.Context, workspaceID, actorID uuid.UUID, query string, embedding any, provider, embeddingModel string, limit int, publicLinkTokens []string) ([]RAGChunk, error) {
	// ponytail: score only authorized chunks in PostgreSQL; add ANN after workspace-size benchmarks justify it.
	if limit <= 0 || limit > 50 {
		limit = 10
	}
	if publicLinkTokens == nil {
		publicLinkTokens = []string{}
	}
	query = strings.TrimSpace(query)
	tsQuery := buildRAGTSQuery(query)
	metadataPredicate := projectMetadataPredicate("$4", "p")
	rows, err := r.db.QueryContext(ctx, `
		WITH eligible AS (
			SELECT c.chunk_id, c.document_id, c.node_id, c.text, c.title,
			       CASE WHEN `+metadataPredicate+` THEN c.project_name ELSE '' END AS project_name,
			       c.breadcrumb, c.body_version, c.source_fingerprint, ri.coverage_status,
			       c.ordinal,
			       GREATEST(ts_rank_cd(to_tsvector('simple', c.text), to_tsquery('simple', $2)),
			                ts_rank_cd(to_tsvector('simple', c.title), to_tsquery('simple', $2)),
			                ts_rank_cd(to_tsvector('simple', c.breadcrumb), to_tsquery('simple', $2)),
			                CASE WHEN $3 <> '' AND c.text ILIKE '%' || $3 || '%' THEN 0.1 ELSE 0 END) AS lexical_score,
			       e.values <=> $7::vector AS semantic_distance
			FROM rag_chunks c
			JOIN documents d ON d.id = c.document_id
			JOIN rag_document_indexes ri ON ri.document_id = d.id
			LEFT JOIN projects p ON p.id = d.project_id AND p.workspace_id = d.workspace_id AND p.deleted_at IS NULL
			LEFT JOIN rag_embeddings e ON e.chunk_id = c.chunk_id AND e.provider = $8 AND e.model = $9 AND e.dimensions = 1536
			WHERE d.workspace_id = $1 AND d.type IN ('markdown', 'architecture') AND d.deleted_at IS NULL
			  AND ri.indexed_body_version = d.body_version
			  AND ri.source_fingerprint = c.source_fingerprint AND ri.indexed_title = d.title
			  AND ri.indexed_project_id IS NOT DISTINCT FROM d.project_id
			  AND ri.indexed_project_name = COALESCE(p.name, '') AND ri.renderer_version = 2
			  AND (
				(
					(d.visibility <> 'public_link' OR d.is_draft = TRUE)
					AND (TRUE `+strings.ReplaceAll(documentReadPredicate, "$2", "$4")+`)
				)
				OR (d.visibility = 'public_link' AND d.is_draft = FALSE AND d.share_token = ANY($5)
				    AND EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = d.workspace_id AND wm.user_id = $4))
			  )
		), lexical AS (
			SELECT chunk_id, row_number() OVER (ORDER BY lexical_score DESC, ordinal) AS rank
			FROM eligible WHERE $2 <> '' AND lexical_score > 0
		), semantic AS (
			SELECT chunk_id, row_number() OVER (ORDER BY semantic_distance, ordinal) AS rank
			FROM eligible WHERE semantic_distance <= $10
		), ranked AS (
			SELECT chunk_id, SUM(1.0 / (60 + rank)) AS score
			FROM (
				SELECT chunk_id, rank FROM lexical
				UNION ALL
				SELECT chunk_id, rank FROM semantic
			) candidates
			GROUP BY chunk_id
		)
		SELECT e.chunk_id, e.document_id, e.node_id, e.text, e.title, e.project_name,
		       e.breadcrumb, e.body_version, e.source_fingerprint, e.coverage_status
		FROM eligible e JOIN ranked r ON r.chunk_id = e.chunk_id
		ORDER BY r.score DESC, e.ordinal
		LIMIT $6
	`, workspaceID, tsQuery, query, actorID, publicLinkTokens, limit, embedding, provider, embeddingModel, ragSemanticMaxDistance)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]RAGChunk, 0)
	for rows.Next() {
		var chunk RAGChunk
		if err := rows.Scan(&chunk.ChunkID, &chunk.DocumentID, &chunk.NodeID, &chunk.Text, &chunk.Title, &chunk.ProjectName, &chunk.Breadcrumb, &chunk.BodyVersion, &chunk.SourceFingerprint, &chunk.CoverageStatus); err != nil {
			return nil, err
		}
		result = append(result, chunk)
	}
	return result, rows.Err()
}

// ponytail: cosine distance 0.35 is a conservative uncalibrated baseline; tune against bilingual evals, never return arbitrary nearest chunks.
const ragSemanticMaxDistance = 0.35

func buildRAGTSQuery(query string) string {
	stopWords := map[string]struct{}{
		"a": {}, "an": {}, "and": {}, "are": {}, "apa": {}, "bagaimana": {},
		"after": {}, "di": {}, "dari": {}, "for": {}, "how": {}, "is": {}, "ke": {}, "of": {}, "on": {},
		"the": {}, "to": {}, "untuk": {}, "what": {}, "when": {}, "where": {}, "who": {}, "yang": {},
	}
	words := strings.FieldsFunc(strings.ToLower(query), func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsNumber(r) })
	terms := make([]string, 0, 8)
	seen := make(map[string]struct{}, 8)
	for _, word := range words {
		if len([]rune(word)) < 3 {
			continue
		}
		if _, stop := stopWords[word]; stop {
			continue
		}
		if _, exists := seen[word]; exists {
			continue
		}
		seen[word] = struct{}{}
		terms = append(terms, word+":*")
		if len(terms) == 8 {
			break
		}
	}
	return strings.Join(terms, " | ")
}
