//go:build integration

package main

import (
	"context"
	"database/sql"
	"os"
	"testing"
)

func TestSuggestionMigrationProvidesAtomicProposalStorage(t *testing.T) {
	dbURL := os.Getenv("TEST_DATABASE_URL")
	if dbURL == "" {
		t.Fatal("TEST_DATABASE_URL is required for integration tests")
	}
	db, err := sql.Open("pgx", dbURL)
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	defer db.Close()

	var tableName string
	if err := db.QueryRowContext(context.Background(), `SELECT to_regclass('document_suggestions')`).Scan(&tableName); err != nil {
		t.Fatalf("check suggestion table: %v", err)
	}
	if tableName != "document_suggestions" {
		t.Fatalf("document_suggestions = %q, want table", tableName)
	}

	var checkCount int
	if err := db.QueryRowContext(context.Background(), `
		SELECT count(*)
		FROM pg_constraint
		WHERE conrelid = 'document_suggestions'::regclass
		  AND conname IN ('document_suggestions_status_valid', 'document_suggestions_decision_complete')
	`).Scan(&checkCount); err != nil {
		t.Fatalf("check suggestion constraints: %v", err)
	}
	if checkCount != 2 {
		t.Fatalf("suggestion check constraints = %d, want 2", checkCount)
	}
}
