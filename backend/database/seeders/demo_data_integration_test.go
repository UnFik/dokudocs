//go:build integration

package seeders

import (
	"context"
	"database/sql"
	"os"
	"testing"

	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestDemoSeedMakesMarkdownDocumentsWithJSONAndAnOwner(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Fatal("TEST_DATABASE_URL is required for integration tests")
	}
	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	defer db.Close()
	ctx := context.Background()
	for i := 0; i < 2; i++ { // seeding twice changes nothing
		if err := Run(ctx, db); err != nil {
			t.Fatalf("Run() = %v", err)
		}
	}
	for index, doc := range mockMarkdownDocuments() {
		var markdown string
		var hasJSON bool
		var owners int
		id := mockDocumentID(index)
		if err := db.QueryRowContext(ctx, `
			SELECT content, content_json IS NOT NULL, (SELECT count(*) FROM document_accesses WHERE document_id = d.id AND access_level = 'owner')
			FROM documents d WHERE id = $1
		`, id).Scan(&markdown, &hasJSON, &owners); err != nil {
			t.Fatalf("%s: %v", doc.title, err)
		}
		if markdown != doc.markdown || !hasJSON || owners != 1 {
			t.Errorf("%s: (markdown match %v, json %v, owners %d), want a match, JSON and one owner", doc.title, markdown == doc.markdown, hasJSON, owners)
		}
	}
	for _, docID := range []string{DemoDoc2ID, DemoDoc3ID} {
		var owners int
		if err := db.QueryRowContext(ctx, `SELECT count(*) FROM document_accesses WHERE document_id = $1 AND access_level = 'owner'`, docID).Scan(&owners); err != nil || owners == 0 {
			t.Errorf("demo document %s has no owner grant (%v)", docID, err)
		}
	}
}
