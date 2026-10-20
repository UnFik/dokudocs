package document

import (
	"context"
	"strings"

	"backend/internal/domain/model"

	"github.com/google/uuid"
)

const (
	defaultSearchLimit = 8
	maxSearchLimit     = 20
	minSearchRunes     = 2
	maxSearchRunes     = 100
)

// searchHeadlineOptions marks the matched words with control characters, so the
// client can highlight them without ever treating the snippet as HTML.
const searchHeadlineOptions = "MaxFragments=1, MaxWords=18, MinWords=8, StartSel=\"\x01\", StopSel=\"\x02\""

// likeEscaper makes user text literal inside an ILIKE pattern.
var likeEscaper = strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)

// Search returns documents the actor may read whose title, project name, or body
// contains the query (two letters at least), best match first. An empty query
// lists recent documents instead.
func (r *Repository) Search(ctx context.Context, workspaceID, actorID uuid.UUID, query string, limit int) ([]model.DocumentSearchHit, error) {
	if limit <= 0 {
		limit = defaultSearchLimit
	}
	limit = min(limit, maxSearchLimit)
	query = strings.TrimSpace(query)
	runes := []rune(query)
	if len(runes) == 0 {
		return r.recentDocuments(ctx, workspaceID, actorID, limit)
	}
	if len(runes) < minSearchRunes {
		return []model.DocumentSearchHit{}, nil
	}
	if len(runes) > maxSearchRunes {
		query = string(runes[:maxSearchRunes])
	}
	pattern := "%" + likeEscaper.Replace(query) + "%"
	prefix := likeEscaper.Replace(query) + "%"
	projectName := `CASE WHEN p.id IS NOT NULL AND ` + projectMetadataPredicate("$2", "p") + ` THEN p.name ELSE '' END`

	tsQuery := buildRAGTSQuery(query)

	rows, err := r.db.QueryContext(ctx, `
		WITH visible AS (
			SELECT d.id, d.title, d.type::text AS type, d.project_id, d.is_draft, d.updated_at, d.body_version,
			       `+projectName+` AS project_name, COALESCE(p.name, '') AS raw_project_name
			FROM documents d
			LEFT JOIN projects p ON p.id = d.project_id AND p.workspace_id = d.workspace_id AND p.deleted_at IS NULL
			WHERE d.workspace_id = $1 AND d.deleted_at IS NULL
			`+documentReadPredicate+`
		), title_hits AS (
			SELECT v.id, v.title, v.type, v.project_id, v.project_name, v.is_draft, v.updated_at,
			       'title' AS matched_on, NULL::uuid AS chunk_id, 0::real AS body_rank,
			       CASE WHEN v.title ILIKE $4 THEN 0 WHEN v.title ILIKE $3 THEN 1 ELSE 2 END AS tier
			FROM visible v
			WHERE v.title ILIKE $3 OR v.project_name ILIKE $3
		), matched AS MATERIALIZED (
			-- The full-text index finds the chunks first; scoring and the
			-- workspace check then run only on what it returned.
			SELECT c.chunk_id, c.document_id, c.source_fingerprint,
			       ts_rank_cd(to_tsvector('simple', c.text), to_tsquery('simple', $6)) AS body_rank
			FROM rag_chunks c
			JOIN documents dw ON dw.id = c.document_id AND dw.workspace_id = $1
			WHERE $6 <> '' AND to_tsvector('simple', c.text) @@ to_tsquery('simple', $6)
		), body_hits AS (
			SELECT DISTINCT ON (v.id) v.id, v.title, v.type, v.project_id, v.project_name, v.is_draft, v.updated_at,
			       'body' AS matched_on, m.chunk_id, m.body_rank, 3 AS tier
			FROM matched m
			JOIN visible v ON v.id = m.document_id
			JOIN rag_document_indexes ri ON ri.document_id = v.id
			WHERE v.type IN ('markdown', 'architecture', 'html')
			  AND ri.indexed_body_version = v.body_version
			  AND ri.source_fingerprint = m.source_fingerprint AND ri.indexed_title = v.title
			  AND ri.indexed_project_id IS NOT DISTINCT FROM v.project_id
			  AND ri.indexed_project_name = v.raw_project_name AND ri.renderer_version = $8
			  AND v.id NOT IN (SELECT id FROM title_hits)
			ORDER BY v.id, m.body_rank DESC
		), top_hits AS (
			SELECT * FROM (
				SELECT * FROM title_hits UNION ALL SELECT * FROM body_hits
			) hits
			ORDER BY tier, body_rank DESC, updated_at DESC
			LIMIT $5
		)
		SELECT h.id, h.title, h.type, h.project_id, h.project_name, h.is_draft, h.updated_at, h.matched_on,
		       CASE WHEN h.chunk_id IS NULL THEN ''
		            ELSE ts_headline('simple', c.text, to_tsquery('simple', $6), $7) END
		FROM top_hits h
		LEFT JOIN rag_chunks c ON c.chunk_id = h.chunk_id
		ORDER BY h.tier, h.body_rank DESC, h.updated_at DESC
	`, workspaceID, actorID, pattern, prefix, limit, tsQuery, searchHeadlineOptions, ragRendererVersion)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	hits := make([]model.DocumentSearchHit, 0)
	for rows.Next() {
		var hit model.DocumentSearchHit
		if err := rows.Scan(&hit.ID, &hit.Title, &hit.Type, &hit.ProjectID, &hit.ProjectName, &hit.IsDraft, &hit.UpdatedAt, &hit.MatchedOn, &hit.Snippet); err != nil {
			return nil, err
		}
		hits = append(hits, hit)
	}
	return hits, rows.Err()
}

// recentDocuments lists what the actor may read, the ones they opened last first.
func (r *Repository) recentDocuments(ctx context.Context, workspaceID, actorID uuid.UUID, limit int) ([]model.DocumentSearchHit, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT d.id, d.title, d.type::text, d.project_id,
		       CASE WHEN p.id IS NOT NULL AND `+projectMetadataPredicate("$2", "p")+` THEN p.name ELSE '' END,
		       d.is_draft, d.updated_at
		FROM documents d
		LEFT JOIN projects p ON p.id = d.project_id AND p.workspace_id = d.workspace_id AND p.deleted_at IS NULL
		LEFT JOIN document_views dv ON dv.document_id = d.id AND dv.user_id = $2
		WHERE d.workspace_id = $1 AND d.deleted_at IS NULL
		`+documentReadPredicate+`
		ORDER BY dv.last_viewed_at DESC NULLS LAST, d.updated_at DESC
		LIMIT $3
	`, workspaceID, actorID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	hits := make([]model.DocumentSearchHit, 0)
	for rows.Next() {
		var hit model.DocumentSearchHit
		if err := rows.Scan(&hit.ID, &hit.Title, &hit.Type, &hit.ProjectID, &hit.ProjectName, &hit.IsDraft, &hit.UpdatedAt); err != nil {
			return nil, err
		}
		hits = append(hits, hit)
	}
	return hits, rows.Err()
}
