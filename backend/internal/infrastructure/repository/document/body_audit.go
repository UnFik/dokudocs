package document

import (
	"context"

	"backend/internal/domain/documentbody"
	"backend/internal/infrastructure/collaboration/yjs"

	"github.com/google/uuid"
)

// BodyAuditFinding names one Markdown document whose AST body is not
// recoverable from canonical storage.
type BodyAuditFinding struct {
	DocumentID uuid.UUID
	Code       string
	Detail     string
}

// BodyAuditReport counts active Markdown documents by migration state.
// Ready means root, nodes, Yjs state, and an AST revision all exist and the
// Yjs projection equals the stored nodes.
type BodyAuditReport struct {
	ActiveMarkdown int
	PendingLegacy  int
	Initialized    int
	Ready          int
	Findings       []BodyAuditFinding
}

// AuditMarkdownBodies is read-only: it verifies that every initialized
// Markdown body in a workspace can be restored from AST + CRDT state.
func (r *Repository) AuditMarkdownBodies(ctx context.Context, workspaceID uuid.UUID) (BodyAuditReport, error) {
	var report BodyAuditReport
	rows, err := r.db.QueryContext(ctx, `
		SELECT d.id, d.root_node_id, d.body_schema_version, s.encoded_state,
		       EXISTS (SELECT 1 FROM document_revisions rv WHERE rv.document_id = d.id AND rv.ast_snapshot IS NOT NULL)
		FROM documents d
		LEFT JOIN document_collab_states s ON s.document_id = d.id
		WHERE d.workspace_id = $1 AND d.type = 'markdown' AND d.deleted_at IS NULL
		ORDER BY d.id
	`, workspaceID)
	if err != nil {
		return report, err
	}
	type row struct {
		id       uuid.UUID
		root     uuid.NullUUID
		schema   int
		state    []byte
		revision bool
	}
	var docs []row
	for rows.Next() {
		var d row
		if err := rows.Scan(&d.id, &d.root, &d.schema, &d.state, &d.revision); err != nil {
			_ = rows.Close()
			return report, err
		}
		docs = append(docs, d)
	}
	if err := rows.Close(); err != nil {
		return report, err
	}
	if err := rows.Err(); err != nil {
		return report, err
	}

	for _, d := range docs {
		report.ActiveMarkdown++
		if !d.root.Valid {
			report.PendingLegacy++
			continue
		}
		report.Initialized++
		finding := func(code, detail string) {
			report.Findings = append(report.Findings, BodyAuditFinding{DocumentID: d.id, Code: code, Detail: detail})
		}
		if d.schema != yjs.BodySchemaVersionV1 {
			finding("schema_mismatch", "body schema version is not supported")
			continue
		}
		if d.state == nil {
			finding("missing_state", "no Yjs state stored")
			continue
		}
		body, err := loadDocumentBody(ctx, r.db, d.id, d.root.UUID)
		if err != nil {
			finding("missing_nodes", err.Error())
			continue
		}
		projected, err := yjs.ProjectV1(d.state, d.id)
		if err != nil {
			finding("projection_error", err.Error())
			continue
		}
		if !documentbody.SameContent(body, projected) {
			finding("projection_mismatch", "stored nodes differ from the Yjs projection")
			continue
		}
		if !d.revision {
			finding("missing_revision", "no AST revision snapshot")
			continue
		}
		report.Ready++
	}
	return report, nil
}
