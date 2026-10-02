//go:build integration

package seeders

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"testing"

	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestSeedBackupDataGivesEveryDocumentAnOwner(t *testing.T) {
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
	if err := Run(ctx, db); err != nil {
		t.Fatalf("Run() seeders error = %v", err)
	}

	var wrapper backupStateWrapper
	if err := json.Unmarshal(backupStateJSON, &wrapper); err != nil {
		t.Fatalf("decode backup fixture: %v", err)
	}
	for _, doc := range wrapper.State.Documents {
		docID := toDeterministicUUID("document", doc.ID)
		var owners int
		if err := db.QueryRowContext(ctx, `
			SELECT count(*) FROM document_accesses
			WHERE document_id = $1 AND access_level = 'owner'
		`, docID).Scan(&owners); err != nil {
			t.Fatalf("count owner grants for %s: %v", doc.ID, err)
		}
		if owners == 0 {
			t.Errorf("backup document %s has no owner grant", doc.ID)
		}
	}

	for _, docID := range []string{DemoDoc1ID, DemoDoc2ID, DemoDoc3ID} {
		var owners int
		if err := db.QueryRowContext(ctx, `
			SELECT count(*) FROM document_accesses
			WHERE document_id = $1 AND access_level = 'owner'
		`, docID).Scan(&owners); err != nil {
			t.Fatalf("count demo owner grants for %s: %v", docID, err)
		}
		if owners == 0 {
			t.Errorf("demo document %s has no owner grant", docID)
		}
	}
}
