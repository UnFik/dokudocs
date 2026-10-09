//go:build integration

package document

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"testing"

	"backend/constant"
	"backend/internal/application/collaboration"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

// seedSourceDocument turns the seeded Markdown document into a DBML or Mermaid document holding source.
func seedSourceDocument(t *testing.T, ctx context.Context, db *sql.DB, documentType, source string) (workspaceID, documentID, ownerID uuid.UUID, repo *Repository) {
	t.Helper()
	workspaceID, documentID, ownerID, _, _, repo = seedRunDocument(t, ctx, db)
	body, _ := json.Marshal(map[string]string{"source": source})
	if _, err := db.ExecContext(ctx, `UPDATE documents SET type = $2::document_type, content = $3, content_json = $4::jsonb WHERE id = $1`,
		documentID, documentType, source, string(body)); err != nil {
		t.Fatalf("make %s document: %v", documentType, err)
	}
	return workspaceID, documentID, ownerID, repo
}

func sourceJSON(source string) json.RawMessage {
	body, _ := json.Marshal(map[string]string{"source": source})
	return body
}

func TestStoringASourceKeepsItExactlyAsWritten(t *testing.T) {
	ctx := context.Background()
	db := openIntegrationDB(t)
	store := NewCollabStateStore(database.NewSQLDB(db))
	for _, documentType := range []string{"dbdiagram", "mermaid"} {
		for _, source := range []string{"", "   \n\t", "Table café 😀 {\n  id int [pk\n", "graph TD\n  A -->"} {
			workspaceID, documentID, _, _ := seedSourceDocument(t, ctx, db, documentType, "old")
			// The text the service sends alongside is ignored: the source is the record.
			if err := store.StoreState(ctx, workspaceID, documentID, []byte{1}, sourceJSON(source), "not the source", nil); err != nil {
				t.Fatalf("%s StoreState(%q): %v", documentType, source, err)
			}
			var content string
			var contentJSON []byte
			if err := db.QueryRowContext(ctx, `SELECT content, content_json FROM documents WHERE id = $1`, documentID).Scan(&content, &contentJSON); err != nil {
				t.Fatalf("read: %v", err)
			}
			if content != source || !sameJSON(t, contentJSON, string(sourceJSON(source))) {
				t.Fatalf("%s after store = (%q, %s), want the source %q in both", documentType, content, contentJSON, source)
			}
			state, loaded, err := store.LoadDocument(ctx, workspaceID, documentID)
			if err != nil || len(state) != 1 || !sameJSON(t, loaded, string(sourceJSON(source))) {
				t.Fatalf("%s LoadDocument() = (%v, %s, %v), want the stored state and source", documentType, state, loaded, err)
			}
		}
	}
}

func TestStoringASourceRefusesJSONThatIsNotOne(t *testing.T) {
	ctx := context.Background()
	db := openIntegrationDB(t)
	store := NewCollabStateStore(database.NewSQLDB(db))
	workspaceID, documentID, _, _ := seedSourceDocument(t, ctx, db, "dbdiagram", "Table a {}")
	for _, content := range []string{`{"type":"doc","content":[]}`, `{"source":42}`, `{"source":"x","extra":1}`} {
		err := store.StoreState(ctx, workspaceID, documentID, []byte{1}, json.RawMessage(content), "", nil)
		if !errors.Is(err, ErrInvalidCollabContent) {
			t.Fatalf("StoreState(%s) = %v, want ErrInvalidCollabContent", content, err)
		}
	}
	var source string
	if err := db.QueryRowContext(ctx, `SELECT content FROM documents WHERE id = $1`, documentID).Scan(&source); err != nil || source != "Table a {}" {
		t.Fatalf("content after refused stores = %q (%v), want it unchanged", source, err)
	}
}

func TestASourceDocumentFromBeforeCollaborationOpensWithItsText(t *testing.T) {
	ctx := context.Background()
	db := openIntegrationDB(t)
	workspaceID, documentID, _, _ := seedSourceDocument(t, ctx, db, "mermaid", "graph TD\n  Old --> Doc")
	// Made by the REST editor: the text only, no JSON.
	if _, err := db.ExecContext(ctx, `UPDATE documents SET content_json = NULL WHERE id = $1`, documentID); err != nil {
		t.Fatalf("drop content_json: %v", err)
	}
	state, content, err := NewCollabStateStore(database.NewSQLDB(db)).LoadDocument(ctx, workspaceID, documentID)
	if err != nil || state != nil || !sameJSON(t, content, string(sourceJSON("graph TD\n  Old --> Doc"))) {
		t.Fatalf("LoadDocument() = (%v, %s, %v), want the text as source, so the room does not open empty", state, content, err)
	}
}

func TestReadingASourceDocumentGivesItsSourceJSON(t *testing.T) {
	ctx := context.Background()
	db := openIntegrationDB(t)
	_, documentID, ownerID, repo := seedSourceDocument(t, ctx, db, "mermaid", "graph TD\n  A -->")
	got, err := repo.GetByID(ctx, documentID, ownerID)
	if err != nil {
		t.Fatalf("GetByID(): %v", err)
	}
	if got.Content != "graph TD\n  A -->" || !sameJSON(t, got.ContentJSON, string(sourceJSON("graph TD\n  A -->"))) {
		t.Fatalf("GetByID() = (%q, %s), want the source in both", got.Content, got.ContentJSON)
	}
}

func TestMetadataUpdatesNeverWriteTheSource(t *testing.T) {
	ctx := context.Background()
	db := openIntegrationDB(t)
	_, documentID, ownerID, repo := seedSourceDocument(t, ctx, db, "dbdiagram", "Table a {}")
	doc, err := repo.GetByID(ctx, documentID, ownerID)
	if err != nil {
		t.Fatalf("GetByID(): %v", err)
	}
	doc.Title = "Schema"
	doc.Content = ""
	if err := repo.UpdateAuthorized(ctx, doc, nil, ownerID); err != nil {
		t.Fatalf("rename: UpdateAuthorized() = %v", err)
	}
	doc, _ = repo.GetByID(ctx, documentID, ownerID)
	doc.Content = "Table overwritten {}"
	if err := repo.UpdateAuthorized(ctx, doc, nil, ownerID); !errors.Is(err, constant.ErrDocumentConflict) {
		t.Fatalf("a body through the REST update = %v, want ErrDocumentConflict", err)
	}
	var title, content string
	if err := db.QueryRowContext(ctx, `SELECT title, content FROM documents WHERE id = $1`, documentID).Scan(&title, &content); err != nil {
		t.Fatalf("read: %v", err)
	}
	if title != "Schema" || content != "Table a {}" {
		t.Fatalf("after updates = (%q, %q), want the new title and the same source", title, content)
	}
}

func TestDuplicatingASourceDocumentCopiesTheSource(t *testing.T) {
	ctx := context.Background()
	db := openIntegrationDB(t)
	workspaceID, documentID, ownerID, repo := seedSourceDocument(t, ctx, db, "dbdiagram", "Table a {\n  id int\n}")
	copyDoc, err := repo.DuplicateAuthorized(ctx, documentID, workspaceID, ownerID, uuid.New())
	if err != nil {
		t.Fatalf("DuplicateAuthorized(): %v", err)
	}
	state, content, err := NewCollabStateStore(database.NewSQLDB(db)).LoadDocument(ctx, workspaceID, copyDoc.ID)
	if err != nil || state != nil || !sameJSON(t, content, string(sourceJSON("Table a {\n  id int\n}"))) || copyDoc.Content != "Table a {\n  id int\n}" {
		t.Fatalf("copy = (%v, %s, %q, %v), want the source and no state, to be seeded once by the service", state, content, copyDoc.Content, err)
	}
}

func TestOnlyARestoreReplacesTheRecordAStoreWritesTo(t *testing.T) {
	ctx := context.Background()
	db := openIntegrationDB(t)
	workspaceID, documentID, ownerID, repo := seedSourceDocument(t, ctx, db, "dbdiagram", "Table one {}")
	store := NewCollabStateStore(database.NewSQLDB(db))
	before, err := repo.GetByID(ctx, documentID, ownerID)
	if err != nil || before.ReplacementID == nil {
		t.Fatalf("GetByID() = (%v, %v), want a replacement id", before.ReplacementID, err)
	}
	named, err := repo.CreateNamedDocumentRevision(ctx, documentID, workspaceID, ownerID, "One")
	if err != nil {
		t.Fatalf("CreateNamedDocumentRevision(): %v", err)
	}
	if err := store.StoreState(ctx, workspaceID, documentID, []byte{1}, sourceJSON("Table two {}"), "", nil,
		collaboration.WithReplacementID(*before.ReplacementID)); err != nil {
		t.Fatalf("StoreState() for the current record: %v", err)
	}
	if after, _ := repo.GetByID(ctx, documentID, ownerID); *after.ReplacementID != *before.ReplacementID {
		t.Fatalf("a store changed the replacement id from %s to %s", before.ReplacementID, after.ReplacementID)
	}

	restored, err := repo.RestoreDocumentRevision(ctx, documentID, named.ID, workspaceID, ownerID, uuid.New())
	if err != nil {
		t.Fatalf("RestoreDocumentRevision(): %v", err)
	}
	if restored.ReplacementID == uuid.Nil || restored.ReplacementID == *before.ReplacementID {
		t.Fatalf("restore replacement id = %s, want a new one (was %s)", restored.ReplacementID, before.ReplacementID)
	}
	if got, _ := repo.GetByID(ctx, documentID, ownerID); *got.ReplacementID != restored.ReplacementID || got.Content != "Table one {}" {
		t.Fatalf("after restore = (%s, %q), want the new record holding the named source", got.ReplacementID, got.Content)
	}

	// A room still holding the replaced record must not write over the restored one.
	err = store.StoreState(ctx, workspaceID, documentID, []byte{9}, sourceJSON("Table stale {}"), "", nil,
		collaboration.WithReplacementID(*before.ReplacementID))
	if !errors.Is(err, ErrCollabReplaced) {
		t.Fatalf("StoreState() for the replaced record = %v, want ErrCollabReplaced", err)
	}
	state, content, err := store.LoadDocument(ctx, workspaceID, documentID)
	if err != nil || state != nil || !sameJSON(t, content, string(sourceJSON("Table one {}"))) {
		t.Fatalf("after a stale store = (%v, %s, %v), want the restored source and no state", state, content, err)
	}
	head, err := repo.ReadRoomHead(ctx, workspaceID, documentID, []uuid.UUID{ownerID})
	if err != nil || head.ReplacementID != restored.ReplacementID {
		t.Fatalf("ReadRoomHead().ReplacementID = %s (%v), want %s", head.ReplacementID, err, restored.ReplacementID)
	}
}

func TestANamedRevisionOfASourceKeepsItExactly(t *testing.T) {
	ctx := context.Background()
	db := openIntegrationDB(t)
	workspaceID, documentID, ownerID, repo := seedSourceDocument(t, ctx, db, "mermaid", "x")
	store := NewCollabStateStore(database.NewSQLDB(db))
	if err := store.StoreState(ctx, workspaceID, documentID, []byte{1}, sourceJSON("graph LR\n  é --> 😀\n"), "", nil); err != nil {
		t.Fatalf("StoreState(): %v", err)
	}
	named, err := repo.CreateNamedDocumentRevision(ctx, documentID, workspaceID, ownerID, "Release")
	if err != nil {
		t.Fatalf("CreateNamedDocumentRevision(): %v", err)
	}
	if named.Content != "graph LR\n  é --> 😀\n" || !sameJSON(t, named.ContentJSON, string(sourceJSON("graph LR\n  é --> 😀\n"))) {
		t.Fatalf("named revision = (%q, %s), want the stored source", named.Content, named.ContentJSON)
	}
}
