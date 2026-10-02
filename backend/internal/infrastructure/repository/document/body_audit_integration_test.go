//go:build integration

package document

import (
	"context"
	"testing"

	"github.com/google/uuid"
)

func TestAuditMarkdownBodiesReportsCountsAndFindings(t *testing.T) {
	ctx := context.Background()
	f := newNodeDiffFixture(t, 2)
	var workspaceID uuid.UUID
	if err := f.db.QueryRowContext(ctx, `SELECT workspace_id FROM documents WHERE id = $1`, f.documentID).Scan(&workspaceID); err != nil {
		t.Fatal(err)
	}
	audit := func() BodyAuditReport {
		t.Helper()
		report, err := f.writer.AuditMarkdownBodies(ctx, workspaceID)
		if err != nil {
			t.Fatalf("AuditMarkdownBodies() = %v", err)
		}
		return report
	}
	codes := func(r BodyAuditReport) map[string]uuid.UUID {
		out := map[string]uuid.UUID{}
		for _, finding := range r.Findings {
			out[finding.Code] = finding.DocumentID
		}
		return out
	}

	report := audit()
	if report.ActiveMarkdown != 1 || report.Initialized != 1 || report.Ready != 0 || codes(report)["missing_revision"] != f.documentID {
		t.Fatalf("seeded document without revision = %+v", report)
	}

	tx, err := f.db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := storeAutoRevision(ctx, tx, f.documentID, f.authorID, f.body, 1, 1, 0); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	if report = audit(); report.Ready != 1 || len(report.Findings) != 0 {
		t.Fatalf("complete document = %+v", report)
	}

	legacyID := uuid.New()
	if _, err := f.db.ExecContext(ctx, `
		INSERT INTO documents (id, workspace_id, title, type, content, author_id, visibility)
		VALUES ($1, $2, 'Legacy', 'markdown', '# legacy', $3, 'private')
	`, legacyID, workspaceID, f.authorID); err != nil {
		t.Fatal(err)
	}
	if report = audit(); report.ActiveMarkdown != 2 || report.PendingLegacy != 1 || report.Ready != 1 || len(report.Findings) != 0 {
		t.Fatalf("with legacy document = %+v", report)
	}

	if _, err := f.db.ExecContext(ctx, `UPDATE document_nodes SET content = 'tampered' WHERE node_id = $1`, f.runs[0]); err != nil {
		t.Fatal(err)
	}
	if report = audit(); codes(report)["projection_mismatch"] != f.documentID || report.Ready != 0 {
		t.Fatalf("tampered AST = %+v", report)
	}

	if _, err := f.db.ExecContext(ctx, `DELETE FROM document_collab_states WHERE document_id = $1`, f.documentID); err != nil {
		t.Fatal(err)
	}
	if report = audit(); codes(report)["missing_state"] != f.documentID {
		t.Fatalf("missing state = %+v", report)
	}
}
