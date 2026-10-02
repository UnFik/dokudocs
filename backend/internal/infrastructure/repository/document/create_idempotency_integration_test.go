//go:build integration

package document

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sync"
	"testing"

	"backend/constant"
	"backend/internal/domain/model"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestCreateIdempotencyReturnsTheCommittedDocument(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("pgx", integrationDatabaseURL(t))
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	defer db.Close()

	actorID := insertAccessTestUser(t, ctx, db)
	workspaceID := uuid.New()
	if _, err := db.ExecContext(ctx, `
		INSERT INTO workspaces (id, name, slug, created_by) VALUES ($1, 'Create retry test', $2, $3)
	`, workspaceID, fmt.Sprintf("create-retry-%s", workspaceID), actorID); err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')
	`, workspaceID, actorID); err != nil {
		t.Fatalf("add workspace owner: %v", err)
	}
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(), `DELETE FROM documents WHERE workspace_id = $1`, workspaceID)
		_, _ = db.ExecContext(context.Background(), `DELETE FROM workspace_members WHERE workspace_id = $1`, workspaceID)
		_, _ = db.ExecContext(context.Background(), `DELETE FROM workspaces WHERE id = $1`, workspaceID)
		_, _ = db.ExecContext(context.Background(), `DELETE FROM users WHERE id = $1`, actorID)
	})

	repo := NewRepository(database.NewSQLDB(db))
	requestID := uuid.New()
	doc := model.Document{
		WorkspaceID: workspaceID,
		Title:       "Retry safe",
		Type:        "markdown",
		Content:     "# Stable source",
		AuthorID:    actorID,
	}
	type createResult struct {
		doc model.Document
		err error
	}
	results := make(chan createResult, 2)
	var callers sync.WaitGroup
	for range 2 {
		callers.Add(1)
		go func() {
			defer callers.Done()
			created, err := repo.CreateIdempotent(ctx, doc, nil, requestID)
			results <- createResult{doc: created, err: err}
		}()
	}
	callers.Wait()
	close(results)
	var createdID uuid.UUID
	for result := range results {
		if result.err != nil {
			t.Fatalf("concurrent CreateIdempotent(): %v", result.err)
		}
		if createdID != uuid.Nil && result.doc.ID != createdID {
			t.Fatalf("concurrent creates returned IDs %s and %s", createdID, result.doc.ID)
		}
		createdID = result.doc.ID
	}
	retried, err := repo.CreateIdempotent(ctx, doc, nil, requestID)
	if err != nil || retried.ID != createdID {
		t.Fatalf("CreateIdempotent() retry = (%s, %v), want same ID %s", retried.ID, err, createdID)
	}

	doc.Title = "Different payload"
	if _, err := repo.CreateIdempotent(ctx, doc, nil, requestID); !errors.Is(err, constant.ErrDocumentConflict) {
		t.Fatalf("CreateIdempotent() reused key with changed payload = %v, want %v", err, constant.ErrDocumentConflict)
	}
	var copyCount int
	if err := db.QueryRowContext(ctx, `
		SELECT count(*) FROM documents
		WHERE author_id = $1 AND creation_request_kind = 'create' AND creation_request_id = $2
	`, actorID, requestID).Scan(&copyCount); err != nil {
		t.Fatalf("count created documents: %v", err)
	}
	if copyCount != 1 {
		t.Fatalf("documents for idempotency key = %d, want 1", copyCount)
	}
}
