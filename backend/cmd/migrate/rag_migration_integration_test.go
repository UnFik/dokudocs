//go:build integration

package main

import (
	"context"
	"database/sql"
	"os"
	"testing"
)

func TestRAGMigrationProvidesIndexChatAndCitationStorage(t *testing.T) {
	dbURL := os.Getenv("TEST_DATABASE_URL")
	if dbURL == "" {
		t.Fatal("TEST_DATABASE_URL is required for integration tests")
	}
	db, err := sql.Open("pgx", dbURL)
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	defer db.Close()

	for _, table := range []string{"rag_document_indexes", "rag_chunks", "rag_embeddings", "rag_conversations", "rag_messages", "rag_message_citations"} {
		var name string
		if err := db.QueryRowContext(context.Background(), `SELECT to_regclass($1)`, table).Scan(&name); err != nil {
			t.Fatalf("check %s: %v", table, err)
		}
		if name != table {
			t.Fatalf("%s = %q, want table", table, name)
		}
	}
}
