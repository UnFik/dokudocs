package document

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"unicode"

	"backend/internal/domain/documentbody"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

const ragRendererVersion = 2

// ponytail: rune cap bounds chunks without a provider tokenizer; use model tokenization if evaluation shows the character ceiling is inadequate.
const maxRAGChunkRunes = 3000

type RAGIndexResult struct {
	DocumentID       uuid.UUID
	BodyVersion      int64
	BodyEpoch        int64
	ChunkCount       int
	SkippedNodeCount int
	CoverageStatus   string
}

// RebuildRAGIndex replaces the searchable projection for one canonical Markdown body.
// Callers should enqueue this after a committed body or metadata change; stale rows are
// never used by retrieval because the indexed version is compared with documents.
func (r *Repository) RebuildRAGIndex(ctx context.Context, documentID uuid.UUID) (RAGIndexResult, error) {
	if documentID == uuid.Nil || r.tx == nil {
		return RAGIndexResult{}, errors.New("RAG index requires a document and transaction-capable database")
	}
	var result RAGIndexResult
	err := r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		var locked bool
		if err := tx.QueryRowContext(ctx, `
			SELECT pg_try_advisory_xact_lock(hashtextextended('rag-index:' || $1::text, 0))
		`, documentID).Scan(&locked); err != nil {
			return err
		}
		if !locked {
			return nil
		}
		var rootID uuid.UUID
		var title, projectName string
		var projectIDText sql.NullString
		var bodyVersion, bodyEpoch int64
		if err := tx.QueryRowContext(ctx, `
			SELECT d.root_node_id, d.title, COALESCE(p.name, ''), d.body_version, d.body_epoch, d.project_id::text
			FROM documents d
			LEFT JOIN projects p ON p.id = d.project_id AND p.workspace_id = d.workspace_id AND p.deleted_at IS NULL
			WHERE d.id = $1 AND d.type = 'markdown' AND d.deleted_at IS NULL
		`, documentID).Scan(&rootID, &title, &projectName, &bodyVersion, &bodyEpoch, &projectIDText); err != nil {
			return err
		}
		body, err := loadDocumentBody(ctx, tx, documentID, rootID)
		if err != nil {
			return err
		}
		var projectID *uuid.UUID
		if projectIDText.Valid {
			parsed, err := uuid.Parse(projectIDText.String)
			if err != nil {
				return err
			}
			projectID = &parsed
		}
		fingerprint := ragSourceFingerprint(documentID, bodyVersion, title, projectID, projectName, ragRendererVersion)
		if _, err := tx.ExecContext(ctx, `DELETE FROM rag_chunks WHERE document_id = $1`, documentID); err != nil {
			return err
		}
		chunks, skipped := renderRAGBody(body)
		for chunkCount, chunk := range chunks {
			if _, err := tx.ExecContext(ctx, `
			INSERT INTO rag_chunks (document_id, node_id, ordinal, body_version, source_fingerprint, text, title, project_name, breadcrumb)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		`, documentID, chunk.nodeID, chunkCount, bodyVersion, fingerprint, chunk.text, title, projectName, chunk.breadcrumb); err != nil {
				return err
			}
		}
		chunkCount := len(chunks)
		coverage := "complete"
		if skipped > 0 {
			coverage = "partial"
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO rag_document_indexes (document_id, indexed_body_version, indexed_body_epoch, source_fingerprint, indexed_title, indexed_project_id, indexed_project_name, renderer_version, coverage_status, skipped_node_count)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
			ON CONFLICT (document_id) DO UPDATE SET indexed_body_version = EXCLUDED.indexed_body_version,
			 indexed_body_epoch = EXCLUDED.indexed_body_epoch, source_fingerprint = EXCLUDED.source_fingerprint,
			 indexed_title = EXCLUDED.indexed_title, indexed_project_id = EXCLUDED.indexed_project_id,
			 indexed_project_name = EXCLUDED.indexed_project_name,
			 renderer_version = EXCLUDED.renderer_version, coverage_status = EXCLUDED.coverage_status,
			 skipped_node_count = EXCLUDED.skipped_node_count, indexed_at = NOW()
		`, documentID, bodyVersion, bodyEpoch, fingerprint, title, projectID, projectName, ragRendererVersion, coverage, skipped); err != nil {
			return err
		}
		result = RAGIndexResult{DocumentID: documentID, BodyVersion: bodyVersion, BodyEpoch: bodyEpoch, ChunkCount: chunkCount, SkippedNodeCount: skipped, CoverageStatus: coverage}
		return nil
	})
	return result, err
}

// RebuildStaleRAGIndexes reindexes a bounded batch. PostgreSQL advisory locks
// keep multiple service instances from rebuilding the same document concurrently.
func (r *Repository) RebuildStaleRAGIndexes(ctx context.Context, limit int) (int, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := r.db.QueryContext(ctx, `
		SELECT d.id
		FROM documents d
		LEFT JOIN projects p ON p.id = d.project_id AND p.workspace_id = d.workspace_id AND p.deleted_at IS NULL
		LEFT JOIN rag_document_indexes ri ON ri.document_id = d.id
		WHERE d.type = 'markdown' AND d.deleted_at IS NULL AND d.root_node_id IS NOT NULL
		  AND (
			ri.document_id IS NULL
			OR ri.indexed_body_version <> d.body_version
			OR ri.indexed_body_epoch <> d.body_epoch
			OR ri.indexed_title <> d.title
			OR ri.indexed_project_id IS DISTINCT FROM d.project_id
			OR ri.indexed_project_name <> COALESCE(p.name, '')
			OR ri.renderer_version <> 2
		  )
		ORDER BY d.updated_at, d.id
		LIMIT $1
	`, limit)
	if err != nil {
		return 0, err
	}
	var documentIDs []uuid.UUID
	for rows.Next() {
		var documentID uuid.UUID
		if err := rows.Scan(&documentID); err != nil {
			_ = rows.Close()
			return 0, err
		}
		documentIDs = append(documentIDs, documentID)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return 0, err
	}
	if err := rows.Close(); err != nil {
		return 0, err
	}

	rebuilt := 0
	var rebuildErrors []error
	for _, documentID := range documentIDs {
		result, err := r.RebuildRAGIndex(ctx, documentID)
		if err != nil {
			rebuildErrors = append(rebuildErrors, fmt.Errorf("rebuild RAG index for %s: %w", documentID, err))
			continue
		}
		if result.DocumentID != uuid.Nil {
			rebuilt++
		}
	}
	return rebuilt, errors.Join(rebuildErrors...)
}

type renderedRAGChunk struct {
	nodeID     uuid.UUID
	text       string
	breadcrumb string
}

func renderRAGBody(body documentbody.Body) ([]renderedRAGChunk, int) {
	children := make(map[uuid.UUID][]documentbody.Node, len(body.Nodes))
	for _, node := range body.Nodes {
		if node.ParentID != nil {
			children[*node.ParentID] = append(children[*node.ParentID], node)
		}
	}
	for parentID := range children {
		sort.Slice(children[parentID], func(i, j int) bool {
			return children[parentID][i].SiblingOrder < children[parentID][j].SiblingOrder
		})
	}
	ordered := make([]documentbody.Node, 0, len(body.Nodes))
	var order func(uuid.UUID)
	order = func(parentID uuid.UUID) {
		for _, child := range children[parentID] {
			ordered = append(ordered, child)
			order(child.NodeID)
		}
	}
	order(body.RootNodeID)

	chunks := make([]renderedRAGChunk, 0)
	skipped := 0
	type heading struct {
		level int
		text  string
	}
	var headings []heading
	for _, node := range ordered {
		if node.Type == "opaque" {
			skipped++
			continue
		}
		var text string
		switch node.Type {
		case "paragraph", "atx-heading", "setext-heading", "table.cell":
			var builder strings.Builder
			builder.WriteString(node.Content)
			var renderInline func(uuid.UUID)
			renderInline = func(parentID uuid.UUID) {
				for _, child := range children[parentID] {
					switch child.Type {
					case "run", "math":
						builder.WriteString(child.Content)
					case "image":
						var attributes struct {
							Alt string `json:"alt"`
						}
						if json.Unmarshal(child.Attributes, &attributes) == nil {
							builder.WriteString(attributes.Alt)
						}
					case "line-break":
						builder.WriteByte('\n')
					case "opaque-inline":
						skipped++
					default:
						renderInline(child.NodeID)
					}
				}
			}
			renderInline(node.NodeID)
			text = builder.String()
		case "code-block", "html-block", "link-reference-definition", "math-block", "frontmatter", "diagram":
			text = node.Content
		}
		if text = strings.TrimSpace(text); text != "" {
			if node.Type == "atx-heading" || node.Type == "setext-heading" {
				var attributes struct {
					Level int `json:"level"`
				}
				_ = json.Unmarshal(node.Attributes, &attributes)
				if attributes.Level < 1 || attributes.Level > 6 {
					attributes.Level = 1
				}
				for len(headings) > 0 && headings[len(headings)-1].level >= attributes.Level {
					headings = headings[:len(headings)-1]
				}
				headings = append(headings, heading{level: attributes.Level, text: text})
			}
			breadcrumbParts := make([]string, len(headings))
			for i, current := range headings {
				breadcrumbParts[i] = current.text
			}
			breadcrumb := strings.Join(breadcrumbParts, " > ")
			for _, part := range splitRAGText(text, maxRAGChunkRunes) {
				chunks = append(chunks, renderedRAGChunk{nodeID: node.NodeID, text: part, breadcrumb: breadcrumb})
			}
		}
	}
	return chunks, skipped
}

func splitRAGText(text string, maxRunes int) []string {
	if maxRunes <= 0 {
		return nil
	}
	runes := []rune(strings.TrimSpace(text))
	chunks := make([]string, 0, (len(runes)+maxRunes-1)/maxRunes)
	for start := 0; start < len(runes); {
		end := min(start+maxRunes, len(runes))
		if end < len(runes) {
			split := end
			for split > start+maxRunes/2 && !unicode.IsSpace(runes[split-1]) {
				split--
			}
			if split > start+maxRunes/2 {
				end = split
			}
		}
		if part := strings.TrimSpace(string(runes[start:end])); part != "" {
			chunks = append(chunks, part)
		}
		start = end
		for start < len(runes) && unicode.IsSpace(runes[start]) {
			start++
		}
	}
	return chunks
}

func ragSourceFingerprint(documentID uuid.UUID, bodyVersion int64, title string, projectID *uuid.UUID, projectName string, rendererVersion int) string {
	project := ""
	if projectID != nil {
		project = projectID.String()
	}
	sum := sha256.Sum256([]byte(fmt.Sprintf("%s:%d:%d:%s:%s:%s", documentID, bodyVersion, rendererVersion, title, project, projectName)))
	return hex.EncodeToString(sum[:])
}
