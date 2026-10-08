//go:build integration

package document

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"testing"

	"backend/constant"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

// versionFixture: an Architecture document whose System links to a spec the owner
// can read and to a private document of someone else.
func versionFixture(t *testing.T) (ctx context.Context, db *sql.DB, repo *Repository, workspaceID, archID, ownerID, spec, private uuid.UUID) {
	t.Helper()
	ctx = context.Background()
	db = openIntegrationDB(t)
	workspaceID, archID, ownerID, repo = seedArchitectureDocument(t, ctx, db, canvasOne, "")
	if _, err := db.ExecContext(ctx, `UPDATE documents SET title = 'Prod' WHERE id = $1`, archID); err != nil {
		t.Fatalf("title: %v", err)
	}
	spec = uuid.New()
	if err := seedJSONDocument(ctx, db, workspaceID, spec, ownerID, "Order API"); err != nil {
		t.Fatalf("seed spec: %v", err)
	}
	stranger := insertAccessTestUser(t, ctx, db)
	t.Cleanup(func() { _, _ = db.ExecContext(context.Background(), `DELETE FROM users WHERE id = $1`, stranger) })
	if _, err := db.ExecContext(ctx, `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'member')`, workspaceID, stranger); err != nil {
		t.Fatalf("member: %v", err)
	}
	private = uuid.New()
	if err := seedJSONDocument(ctx, db, workspaceID, private, stranger, "secret"); err != nil {
		t.Fatalf("seed private: %v", err)
	}
	if _, err := db.ExecContext(ctx, `UPDATE documents SET visibility = 'private' WHERE id = $1`, private); err != nil {
		t.Fatalf("private: %v", err)
	}
	canvas := fmt.Sprintf(`{"version":1,"nodes":[{"id":"api","kind":"system","name":"API","links":["%s","%s"]}],"connections":[]}`, spec, private)
	if err := NewCollabStateStore(database.NewSQLDB(db)).StoreState(ctx, workspaceID, archID, []byte{1}, json.RawMessage(canvas), `System "API".`, nil); err != nil {
		t.Fatalf("StoreState(): %v", err)
	}
	return
}

func TestTaggingAVersionPinsTheCanvasAndTheDocumentsTheTaggerCanRead(t *testing.T) {
	ctx, db, repo, workspaceID, archID, _, spec, private := versionFixture(t)
	// A plain member who may edit the canvas; a workspace owner could read the private document.
	tagger := insertAccessTestUser(t, ctx, db)
	t.Cleanup(func() { _, _ = db.ExecContext(context.Background(), `DELETE FROM users WHERE id = $1`, tagger) })
	if _, err := db.ExecContext(ctx, `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'member')`, workspaceID, tagger); err != nil {
		t.Fatalf("member: %v", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO document_accesses (document_id, user_id, access_level) VALUES ($1, $2, 'edit')`, archID, tagger); err != nil {
		t.Fatalf("grant: %v", err)
	}

	version, err := repo.CreateArchitectureVersion(ctx, workspaceID, archID, tagger, "v1.0", "MVP")
	if err != nil {
		t.Fatalf("CreateArchitectureVersion(): %v", err)
	}
	var canvasTitle string
	var named bool
	if err := db.QueryRowContext(ctx, `SELECT title, is_named FROM document_revisions WHERE id = $1 AND document_id = $2`, version.RevisionID, archID).Scan(&canvasTitle, &named); err != nil || canvasTitle != "v1.0" || !named {
		t.Fatalf("canvas revision = (%q, %v, %v), want a named revision titled v1.0", canvasTitle, named, err)
	}
	pins := map[uuid.UUID]*uuid.UUID{}
	for _, pin := range version.Pins {
		pins[pin.DocumentID] = pin.RevisionID
	}
	if len(pins) != 2 || pins[spec] == nil || pins[private] != nil {
		t.Fatalf("pins = %+v, want the spec pinned and the private document not pinned", version.Pins)
	}
	var specTitle string
	if err := db.QueryRowContext(ctx, `SELECT title FROM document_revisions WHERE id = $1 AND document_id = $2 AND is_named`, *pins[spec], spec).Scan(&specTitle); err != nil || specTitle != "Prod v1.0" {
		t.Fatalf("spec revision title = %q (%v), want \"Prod v1.0\"", specTitle, err)
	}

	if _, err := repo.CreateArchitectureVersion(ctx, workspaceID, archID, tagger, "v1.0", ""); !errors.Is(err, constant.ErrDocumentConflict) {
		t.Fatalf("same label again: %v, want ErrDocumentConflict", err)
	}
	listed, err := repo.ListArchitectureVersions(ctx, workspaceID, archID, tagger)
	if err != nil || len(listed) != 1 || listed[0].Label != "v1.0" || len(listed[0].Pins) != 2 || listed[0].RevisionNumber == 0 {
		t.Fatalf("ListArchitectureVersions() = (%+v, %v)", listed, err)
	}
}

func TestOnlyAnEditorTagsAndOnlyAnOwnerDeletesAVersion(t *testing.T) {
	ctx, db, repo, workspaceID, archID, ownerID, _, _ := versionFixture(t)
	viewer, editor := insertAccessTestUser(t, ctx, db), insertAccessTestUser(t, ctx, db)
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(), `DELETE FROM users WHERE id = ANY($1)`, fmt.Sprintf("{%s,%s}", viewer, editor))
	})
	for user, level := range map[uuid.UUID]string{viewer: "view", editor: "edit"} {
		if _, err := db.ExecContext(ctx, `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'member')`, workspaceID, user); err != nil {
			t.Fatalf("member: %v", err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO document_accesses (document_id, user_id, access_level) VALUES ($1, $2, $3::document_access_level)`, archID, user, level); err != nil {
			t.Fatalf("grant: %v", err)
		}
	}
	if _, err := db.ExecContext(ctx, `UPDATE documents SET visibility = 'private' WHERE id = $1`, archID); err != nil {
		t.Fatalf("private: %v", err)
	}
	if _, err := repo.CreateArchitectureVersion(ctx, workspaceID, archID, viewer, "v2", ""); !errors.Is(err, constant.ErrForbidden) {
		t.Fatalf("viewer tags: %v, want ErrForbidden", err)
	}
	version, err := repo.CreateArchitectureVersion(ctx, workspaceID, archID, editor, "v2", "")
	if err != nil {
		t.Fatalf("editor tags: %v", err)
	}
	if err := repo.UpdateArchitectureVersion(ctx, workspaceID, archID, version.ID, editor, "v2.0", "split the monolith"); err != nil {
		t.Fatalf("editor renames: %v", err)
	}
	if err := repo.DeleteArchitectureVersion(ctx, workspaceID, archID, version.ID, editor); !errors.Is(err, constant.ErrForbidden) {
		t.Fatalf("editor deletes: %v, want ErrForbidden", err)
	}
	if err := repo.DeleteArchitectureVersion(ctx, workspaceID, archID, version.ID, ownerID); err != nil {
		t.Fatalf("owner deletes: %v", err)
	}
	var revisions int
	_ = db.QueryRowContext(ctx, `SELECT COUNT(*) FROM document_revisions WHERE id = $1`, version.RevisionID).Scan(&revisions)
	if revisions != 1 {
		t.Fatalf("the canvas revision of a deleted version is gone; it is ordinary history and stays")
	}
	if listed, _ := repo.ListArchitectureVersions(ctx, workspaceID, archID, ownerID); len(listed) != 0 {
		t.Fatalf("versions after delete = %+v", listed)
	}
}
