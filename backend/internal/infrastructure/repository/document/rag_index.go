package document

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"unicode"

	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

const ragRendererVersion = 2

// ponytail: rune cap bounds chunks without a provider tokenizer; use model tokenization if evaluation shows the character ceiling is inadequate.
const maxRAGChunkRunes = 3000

type RAGIndexResult struct {
	DocumentID       uuid.UUID
	BodyVersion      int64
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
		var contentJSON []byte
		var title, projectName string
		var projectIDText sql.NullString
		var bodyVersion int64
		if err := tx.QueryRowContext(ctx, `
			SELECT d.content_json, d.title, COALESCE(p.name, ''), d.body_version, d.project_id::text
			FROM documents d
			LEFT JOIN projects p ON p.id = d.project_id AND p.workspace_id = d.workspace_id AND p.deleted_at IS NULL
			WHERE d.id = $1 AND d.type = 'markdown' AND d.deleted_at IS NULL AND d.content_json IS NOT NULL
		`, documentID).Scan(&contentJSON, &title, &projectName, &bodyVersion, &projectIDText); err != nil {
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
		chunks, skipped := renderRAGJSON(contentJSON)
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
			INSERT INTO rag_document_indexes (document_id, indexed_body_version, source_fingerprint, indexed_title, indexed_project_id, indexed_project_name, renderer_version, coverage_status, skipped_node_count)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
			ON CONFLICT (document_id) DO UPDATE SET indexed_body_version = EXCLUDED.indexed_body_version,
			 source_fingerprint = EXCLUDED.source_fingerprint,
			 indexed_title = EXCLUDED.indexed_title, indexed_project_id = EXCLUDED.indexed_project_id,
			 indexed_project_name = EXCLUDED.indexed_project_name,
			 renderer_version = EXCLUDED.renderer_version, coverage_status = EXCLUDED.coverage_status,
			 skipped_node_count = EXCLUDED.skipped_node_count, indexed_at = NOW()
		`, documentID, bodyVersion, fingerprint, title, projectID, projectName, ragRendererVersion, coverage, skipped); err != nil {
			return err
		}
		result = RAGIndexResult{DocumentID: documentID, BodyVersion: bodyVersion, ChunkCount: chunkCount, SkippedNodeCount: skipped, CoverageStatus: coverage}
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
		WHERE d.type = 'markdown' AND d.deleted_at IS NULL AND d.content_json IS NOT NULL
		  AND (
			ri.document_id IS NULL
			OR ri.indexed_body_version <> d.body_version
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

type ragNode struct {
	Type    string         `json:"type"`
	Attrs   map[string]any `json:"attrs"`
	Content []ragNode      `json:"content"`
	Text    string         `json:"text"`
	Marks   []struct {
		Type string `json:"type"`
	} `json:"marks"`
}

var ragNodeNamespace = uuid.MustParse("6f6f0f0e-6f0e-4f0e-8f0e-6f0e6f0e6f0e")

// ragNodeID is the block's node ID as a UUID; editors that wrote a different ID shape still get a stable one.
func ragNodeID(node ragNode) uuid.UUID {
	raw, _ := node.Attrs["nodeID"].(string)
	if id, err := uuid.Parse(raw); err == nil {
		return id
	}
	return uuid.NewSHA1(ragNodeNamespace, []byte(raw))
}

func (n ragNode) bodyAttributes() struct{ Level int } {
	var attributes struct {
		Level int `json:"level"`
	}
	raw, _ := n.Attrs["bodyAttributes"].(string)
	_ = json.Unmarshal([]byte(raw), &attributes)
	return struct{ Level int }{attributes.Level}
}

// inlineText is the text of a block's inline content; suggested-only text is left out.
func (n ragNode) inlineText(skipped *int) string {
	var builder strings.Builder
	var walk func(ragNode)
	walk = func(node ragNode) {
		switch node.Type {
		case "text":
			for _, mark := range node.Marks {
				if mark.Type == "suggestion_insert" {
					return
				}
			}
			builder.WriteString(node.Text)
		case "image":
			var attributes struct {
				Alt string `json:"alt"`
			}
			raw, _ := node.Attrs["bodyAttributes"].(string)
			if json.Unmarshal([]byte(raw), &attributes) == nil {
				builder.WriteString(attributes.Alt)
			}
		case "line_break":
			builder.WriteByte('\n')
		case "opaque_inline":
			*skipped++
		default:
			for _, child := range node.Content {
				walk(child)
			}
		}
	}
	for _, child := range n.Content {
		walk(child)
	}
	return builder.String()
}

// renderRAGJSON turns the document JSON into bounded text chunks, each under the headings above it.
func renderRAGJSON(contentJSON []byte) ([]renderedRAGChunk, int) {
	var root ragNode
	if json.Unmarshal(contentJSON, &root) != nil {
		return nil, 0
	}
	chunks := make([]renderedRAGChunk, 0)
	skipped := 0
	type heading struct {
		level int
		text  string
	}
	var headings []heading
	var visit func(ragNode)
	visit = func(node ragNode) {
		var text string
		switch node.Type {
		case "opaque":
			skipped++
			return
		case "paragraph", "atx_heading", "setext_heading", "table_cell":
			text = node.inlineText(&skipped)
		case "code_block", "html_block", "link_reference_definition", "math_block", "frontmatter", "diagram":
			text = node.inlineText(&skipped)
		default:
			for _, child := range node.Content {
				visit(child)
			}
			return
		}
		if text = strings.TrimSpace(text); text == "" {
			return
		}
		if node.Type == "atx_heading" || node.Type == "setext_heading" {
			level := node.bodyAttributes().Level
			if level < 1 || level > 6 {
				level = 1
			}
			for len(headings) > 0 && headings[len(headings)-1].level >= level {
				headings = headings[:len(headings)-1]
			}
			headings = append(headings, heading{level: level, text: text})
		}
		parts := make([]string, len(headings))
		for i, current := range headings {
			parts[i] = current.text
		}
		breadcrumb := strings.Join(parts, " > ")
		for _, part := range splitRAGText(text, maxRAGChunkRunes) {
			chunks = append(chunks, renderedRAGChunk{nodeID: ragNodeID(node), text: part, breadcrumb: breadcrumb})
		}
	}
	visit(root)
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
