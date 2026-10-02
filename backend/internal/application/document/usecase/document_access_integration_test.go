//go:build integration

package usecase

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"backend/constant"
	"backend/internal/domain/model"
	"backend/internal/infrastructure/database"
	documentrepo "backend/internal/infrastructure/repository/document"

	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestGetDocumentEnforcesVisibilityWithoutDirectGrant(t *testing.T) {
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
	authorID := insertDocumentAccessUser(t, ctx, db)
	readerID := insertDocumentAccessUser(t, ctx, db)
	workspaceID := uuid.New()
	_, err = db.ExecContext(ctx, `
		INSERT INTO workspaces (id, name, slug, created_by)
		VALUES ($1, 'Document Policy Test', $2, $3)
	`, workspaceID, fmt.Sprintf("document-policy-%s", workspaceID), authorID)
	if err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	_, err = db.ExecContext(ctx, `
		INSERT INTO workspace_members (workspace_id, user_id, role) VALUES
		($1, $2, 'owner'), ($1, $3, 'member')
	`, workspaceID, authorID, readerID)
	if err != nil {
		t.Fatalf("create workspace members: %v", err)
	}
	visibleID, privateID := uuid.New(), uuid.New()
	t.Cleanup(func() {
		_, _ = db.ExecContext(ctx, `DELETE FROM document_accesses WHERE document_id IN ($1, $2)`, visibleID, privateID)
		_, _ = db.ExecContext(ctx, `DELETE FROM documents WHERE workspace_id = $1`, workspaceID)
		_, _ = db.ExecContext(ctx, `DELETE FROM workspace_members WHERE workspace_id = $1`, workspaceID)
		_, _ = db.ExecContext(ctx, `DELETE FROM workspaces WHERE id = $1`, workspaceID)
		_, _ = db.ExecContext(ctx, `DELETE FROM users WHERE id IN ($1, $2)`, authorID, readerID)
	})

	docRepo := documentrepo.NewRepository(database.NewSQLDB(db))
	visible, err := docRepo.Create(ctx, model.Document{
		ID:          visibleID,
		WorkspaceID: workspaceID,
		Title:       "Workspace visible",
		Type:        "markdown",
		AuthorID:    authorID,
		Visibility:  "workspace",
	}, nil)
	if err != nil {
		t.Fatalf("create workspace-visible document: %v", err)
	}
	private, err := docRepo.Create(ctx, model.Document{
		ID:          privateID,
		WorkspaceID: workspaceID,
		Title:       "Private document",
		Type:        "markdown",
		AuthorID:    authorID,
		Visibility:  "private",
	}, nil)
	if err != nil {
		t.Fatalf("create private document: %v", err)
	}

	uc := NewUseCase(database.NewSQLDB(db))
	if got, err := uc.GetDocument(ctx, visible.ID, workspaceID, readerID); err != nil || got.ID != visible.ID {
		t.Fatalf("GetDocument(workspace) = (%s, %v), want %s and nil", got.ID, err, visible.ID)
	}
	if got, err := uc.GetDocument(ctx, private.ID, workspaceID, readerID); !errors.Is(err, constant.ErrDocumentNotFound) || got.ID != uuid.Nil {
		t.Fatalf("GetDocument(private) = (%s, %v), want empty and not found", got.ID, err)
	}
}

func TestAuthorizedUpdateRejectsRevokedGrantFromStaleRead(t *testing.T) {
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
	authorID := insertDocumentAccessUser(t, ctx, db)
	editorID := insertDocumentAccessUser(t, ctx, db)
	workspaceID := uuid.New()
	docID := uuid.New()
	_, err = db.ExecContext(ctx, `
		INSERT INTO workspaces (id, name, slug, created_by)
		VALUES ($1, 'Revocation Test', $2, $3)
	`, workspaceID, fmt.Sprintf("revocation-%s", workspaceID), authorID)
	if err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	_, err = db.ExecContext(ctx, `
		INSERT INTO workspace_members (workspace_id, user_id, role) VALUES
		($1, $2, 'owner'), ($1, $3, 'member')
	`, workspaceID, authorID, editorID)
	if err != nil {
		t.Fatalf("create workspace members: %v", err)
	}
	t.Cleanup(func() {
		_, _ = db.ExecContext(ctx, `DELETE FROM document_accesses WHERE document_id = $1`, docID)
		_, _ = db.ExecContext(ctx, `DELETE FROM documents WHERE id = $1`, docID)
		_, _ = db.ExecContext(ctx, `DELETE FROM workspace_members WHERE workspace_id = $1`, workspaceID)
		_, _ = db.ExecContext(ctx, `DELETE FROM workspaces WHERE id = $1`, workspaceID)
		_, _ = db.ExecContext(ctx, `DELETE FROM users WHERE id IN ($1, $2)`, authorID, editorID)
	})

	dbAccess := database.NewSQLDB(db)
	docRepo := documentrepo.NewRepository(dbAccess)
	doc, err := docRepo.Create(ctx, model.Document{
		ID:          docID,
		WorkspaceID: workspaceID,
		Title:       "Before revoke",
		Type:        "markdown",
		AuthorID:    authorID,
		Visibility:  "private",
	}, nil)
	if err != nil {
		t.Fatalf("create private document: %v", err)
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO document_accesses (document_id, user_id, access_level) VALUES ($1, $2, 'edit')
	`, docID, editorID); err != nil {
		t.Fatalf("grant editor access: %v", err)
	}
	uc := NewUseCase(dbAccess)
	staleDoc, err := uc.GetDocument(ctx, doc.ID, workspaceID, editorID)
	if err != nil {
		t.Fatalf("read as editor before revoke: %v", err)
	}
	if err := uc.RemoveAccess(ctx, docID, workspaceID, editorID, authorID); err != nil {
		t.Fatalf("revoke edit grant: %v", err)
	}

	staleDoc.Title = "Must not commit"
	if err := docRepo.UpdateAuthorized(ctx, staleDoc, nil, editorID); !errors.Is(err, constant.ErrForbidden) {
		t.Fatalf("UpdateAuthorized() after revoke error = %v, want %v", err, constant.ErrForbidden)
	}
	current, err := uc.GetDocument(ctx, docID, workspaceID, authorID)
	if err != nil {
		t.Fatalf("read as owner after rejected update: %v", err)
	}
	if current.Title != "Before revoke" {
		t.Fatalf("title after revoked update = %q, want %q", current.Title, "Before revoke")
	}
	if err := docRepo.SoftDelete(ctx, docID, workspaceID, editorID); !errors.Is(err, constant.ErrForbidden) {
		t.Fatalf("SoftDelete() after revoke error = %v, want %v", err, constant.ErrForbidden)
	}
	var deletedAt sql.NullTime
	if err := db.QueryRowContext(ctx, `SELECT deleted_at FROM documents WHERE id = $1`, docID).Scan(&deletedAt); err != nil {
		t.Fatalf("read lifecycle after rejected trash: %v", err)
	}
	if deletedAt.Valid {
		t.Fatal("revoked editor moved the document to trash")
	}
}

func insertDocumentAccessUser(t *testing.T, ctx context.Context, db *sql.DB) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	err := db.QueryRowContext(ctx, `
		INSERT INTO users (account_no, email, full_name) VALUES ($1, $2, 'Document Policy Test') RETURNING id
	`, uuid.NewString(), fmt.Sprintf("document-policy-%s@example.invalid", uuid.NewString())).Scan(&id)
	if err != nil {
		t.Fatalf("create test user: %v", err)
	}
	return id
}

func TestDocumentAccessRemovalPreservesAnOwner(t *testing.T) {
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
	authorID := insertDocumentAccessUser(t, ctx, db)
	newOwnerID := insertDocumentAccessUser(t, ctx, db)
	workspaceID, docID := uuid.New(), uuid.New()
	_, err = db.ExecContext(ctx, `
		INSERT INTO workspaces (id, name, slug, created_by)
		VALUES ($1, 'Owner Transfer Test', $2, $3)
	`, workspaceID, fmt.Sprintf("owner-transfer-%s", workspaceID), authorID)
	if err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	_, err = db.ExecContext(ctx, `
		INSERT INTO workspace_members (workspace_id, user_id, role) VALUES
		($1, $2, 'owner'), ($1, $3, 'member')
	`, workspaceID, authorID, newOwnerID)
	if err != nil {
		t.Fatalf("create workspace members: %v", err)
	}
	t.Cleanup(func() {
		_, _ = db.ExecContext(ctx, `DELETE FROM document_accesses WHERE document_id = $1`, docID)
		_, _ = db.ExecContext(ctx, `DELETE FROM documents WHERE id = $1`, docID)
		_, _ = db.ExecContext(ctx, `DELETE FROM workspace_members WHERE workspace_id = $1`, workspaceID)
		_, _ = db.ExecContext(ctx, `DELETE FROM workspaces WHERE id = $1`, workspaceID)
		_, _ = db.ExecContext(ctx, `DELETE FROM users WHERE id IN ($1, $2)`, authorID, newOwnerID)
	})

	dbAccess := database.NewSQLDB(db)
	docRepo := documentrepo.NewRepository(dbAccess)
	if _, err := docRepo.Create(ctx, model.Document{
		ID:          docID,
		WorkspaceID: workspaceID,
		Title:       "Transfer owner safely",
		Type:        "markdown",
		AuthorID:    authorID,
		Visibility:  "private",
	}, nil); err != nil {
		t.Fatalf("create private document: %v", err)
	}
	uc := NewUseCase(dbAccess)
	if err := docRepo.AddOrUpdateAccess(ctx, docID, workspaceID, authorID, authorID, "edit"); !errors.Is(err, constant.ErrForbidden) {
		t.Fatalf("demote sole owner error = %v, want %v", err, constant.ErrForbidden)
	}
	if err := uc.RemoveAccess(ctx, docID, workspaceID, authorID, authorID); !errors.Is(err, constant.ErrForbidden) {
		t.Fatalf("remove sole owner error = %v, want %v", err, constant.ErrForbidden)
	}
	var ownerCount int
	if err := db.QueryRowContext(ctx, `
		SELECT count(*) FROM document_accesses WHERE document_id = $1 AND access_level = 'owner'
	`, docID).Scan(&ownerCount); err != nil {
		t.Fatalf("count document owners: %v", err)
	}
	if ownerCount != 1 {
		t.Fatalf("owner grant count after rejected removal = %d, want 1", ownerCount)
	}
	if err := docRepo.AddOrUpdateAccess(ctx, docID, workspaceID, authorID, newOwnerID, "owner"); err != nil {
		t.Fatalf("grant replacement owner: %v", err)
	}
	if err := docRepo.AddOrUpdateAccess(ctx, docID, workspaceID, authorID, authorID, "edit"); err != nil {
		t.Fatalf("demote previous owner after transfer: %v", err)
	}
	if err := uc.RemoveAccess(ctx, docID, workspaceID, authorID, authorID); err != nil {
		t.Fatalf("remove previous owner after transfer: %v", err)
	}
	var remainingOwner uuid.UUID
	if err := db.QueryRowContext(ctx, `
		SELECT user_id FROM document_accesses WHERE document_id = $1 AND access_level = 'owner'
	`, docID).Scan(&remainingOwner); err != nil {
		t.Fatalf("read replacement owner: %v", err)
	}
	if remainingOwner != newOwnerID {
		t.Fatalf("remaining owner = %s, want %s", remainingOwner, newOwnerID)
	}
}

func TestTrashedMutationsRecheckRevokedAccess(t *testing.T) {
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
	authorID := insertDocumentAccessUser(t, ctx, db)
	editorID := insertDocumentAccessUser(t, ctx, db)
	workspaceID, docID := uuid.New(), uuid.New()
	_, err = db.ExecContext(ctx, `
		INSERT INTO workspaces (id, name, slug, created_by)
		VALUES ($1, 'Trash Mutation Test', $2, $3)
	`, workspaceID, fmt.Sprintf("trash-mutation-%s", workspaceID), authorID)
	if err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	_, err = db.ExecContext(ctx, `
		INSERT INTO workspace_members (workspace_id, user_id, role) VALUES
		($1, $2, 'owner'), ($1, $3, 'member')
	`, workspaceID, authorID, editorID)
	if err != nil {
		t.Fatalf("create workspace members: %v", err)
	}
	t.Cleanup(func() {
		_, _ = db.ExecContext(ctx, `DELETE FROM document_accesses WHERE document_id = $1`, docID)
		_, _ = db.ExecContext(ctx, `DELETE FROM documents WHERE id = $1`, docID)
		_, _ = db.ExecContext(ctx, `DELETE FROM workspace_members WHERE workspace_id = $1`, workspaceID)
		_, _ = db.ExecContext(ctx, `DELETE FROM workspaces WHERE id = $1`, workspaceID)
		_, _ = db.ExecContext(ctx, `DELETE FROM users WHERE id IN ($1, $2)`, authorID, editorID)
	})

	dbAccess := database.NewSQLDB(db)
	docRepo := documentrepo.NewRepository(dbAccess)
	if _, err := docRepo.Create(ctx, model.Document{
		ID:          docID,
		WorkspaceID: workspaceID,
		Title:       "Trashed document",
		Type:        "markdown",
		AuthorID:    authorID,
		Visibility:  "private",
	}, nil); err != nil {
		t.Fatalf("create private document: %v", err)
	}
	if err := docRepo.AddOrUpdateAccess(ctx, docID, workspaceID, authorID, editorID, "edit"); err != nil {
		t.Fatalf("grant editor access: %v", err)
	}
	uc := NewUseCase(dbAccess)
	if _, err := uc.GetDocument(ctx, docID, workspaceID, editorID); err != nil {
		t.Fatalf("read document before revoke: %v", err)
	}
	if err := uc.RemoveAccess(ctx, docID, workspaceID, editorID, authorID); err != nil {
		t.Fatalf("revoke editor access: %v", err)
	}
	if err := docRepo.SoftDelete(ctx, docID, workspaceID, authorID); err != nil {
		t.Fatalf("move document to trash: %v", err)
	}
	otherWorkspaceID := uuid.New()
	if err := docRepo.Restore(ctx, docID, otherWorkspaceID, authorID); !errors.Is(err, constant.ErrDocumentNotFound) {
		t.Fatalf("Restore() with wrong workspace error = %v, want %v", err, constant.ErrDocumentNotFound)
	}
	if err := docRepo.Restore(ctx, docID, workspaceID, editorID); !errors.Is(err, constant.ErrForbidden) {
		t.Fatalf("Restore() after revoke error = %v, want %v", err, constant.ErrForbidden)
	}
	if err := docRepo.Restore(ctx, docID, workspaceID, authorID); err != nil {
		t.Fatalf("Restore() for owner: %v", err)
	}
	if err := docRepo.SoftDelete(ctx, docID, workspaceID, authorID); err != nil {
		t.Fatalf("move restored document back to trash: %v", err)
	}
	if err := docRepo.PermanentDelete(ctx, docID, otherWorkspaceID, authorID); !errors.Is(err, constant.ErrDocumentNotFound) {
		t.Fatalf("PermanentDelete() with wrong workspace error = %v, want %v", err, constant.ErrDocumentNotFound)
	}
	if err := docRepo.PermanentDelete(ctx, docID, workspaceID, editorID); !errors.Is(err, constant.ErrForbidden) {
		t.Fatalf("PermanentDelete() after revoke error = %v, want %v", err, constant.ErrForbidden)
	}
	var deletedAt sql.NullTime
	if err := db.QueryRowContext(ctx, `SELECT deleted_at FROM documents WHERE id = $1`, docID).Scan(&deletedAt); err != nil {
		t.Fatalf("read document after rejected mutations: %v", err)
	}
	if !deletedAt.Valid {
		t.Fatal("revoked editor changed the document's trash state")
	}
	if err := docRepo.PermanentDelete(ctx, docID, workspaceID, authorID); err != nil {
		t.Fatalf("PermanentDelete() for owner: %v", err)
	}
	if err := db.QueryRowContext(ctx, `SELECT id FROM documents WHERE id = $1`, docID).Scan(new(uuid.UUID)); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("document after owner permanent delete error = %v, want no rows", err)
	}
}

func TestShareTokenAndEmptyTrashRecheckAccess(t *testing.T) {
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
	authorID := insertDocumentAccessUser(t, ctx, db)
	editorID := insertDocumentAccessUser(t, ctx, db)
	workspaceID, docID := uuid.New(), uuid.New()
	_, err = db.ExecContext(ctx, `
		INSERT INTO workspaces (id, name, slug, created_by)
		VALUES ($1, 'Share Token Test', $2, $3)
	`, workspaceID, fmt.Sprintf("share-token-%s", workspaceID), authorID)
	if err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	_, err = db.ExecContext(ctx, `
		INSERT INTO workspace_members (workspace_id, user_id, role) VALUES
		($1, $2, 'owner'), ($1, $3, 'member')
	`, workspaceID, authorID, editorID)
	if err != nil {
		t.Fatalf("create workspace members: %v", err)
	}
	t.Cleanup(func() {
		_, _ = db.ExecContext(ctx, `DELETE FROM document_accesses WHERE document_id = $1`, docID)
		_, _ = db.ExecContext(ctx, `DELETE FROM documents WHERE id = $1`, docID)
		_, _ = db.ExecContext(ctx, `DELETE FROM workspace_members WHERE workspace_id = $1`, workspaceID)
		_, _ = db.ExecContext(ctx, `DELETE FROM workspaces WHERE id = $1`, workspaceID)
		_, _ = db.ExecContext(ctx, `DELETE FROM users WHERE id IN ($1, $2)`, authorID, editorID)
	})

	dbAccess := database.NewSQLDB(db)
	docRepo := documentrepo.NewRepository(dbAccess)
	if _, err := docRepo.Create(ctx, model.Document{
		ID:          docID,
		WorkspaceID: workspaceID,
		Title:       "Share token access",
		Type:        "markdown",
		AuthorID:    authorID,
		Visibility:  "private",
	}, nil); err != nil {
		t.Fatalf("create private document: %v", err)
	}
	if err := docRepo.AddOrUpdateAccess(ctx, docID, workspaceID, authorID, editorID, "edit"); err != nil {
		t.Fatalf("grant editor access: %v", err)
	}
	if got, err := docRepo.SetShareToken(ctx, docID, workspaceID, editorID, "valid-before-revoke", "public_link"); err != nil || got != "valid-before-revoke" {
		t.Fatalf("set token for editor: %v", err)
	}
	if got, err := docRepo.SetShareToken(ctx, docID, workspaceID, editorID, "replacement-token", "public_link"); err != nil || got != "valid-before-revoke" {
		t.Fatalf("repeat token request = (%q, %v), want existing token", got, err)
	}
	uc := NewUseCase(dbAccess)
	if err := uc.RemoveAccess(ctx, docID, workspaceID, editorID, authorID); err != nil {
		t.Fatalf("revoke editor access: %v", err)
	}
	if _, err := docRepo.SetShareToken(ctx, docID, workspaceID, editorID, "after-revoke", "private"); !errors.Is(err, constant.ErrForbidden) {
		t.Fatalf("SetShareToken() after revoke error = %v, want %v", err, constant.ErrForbidden)
	}
	var token, visibility string
	if err := db.QueryRowContext(ctx, `SELECT share_token, visibility::text FROM documents WHERE id = $1`, docID).Scan(&token, &visibility); err != nil {
		t.Fatalf("read share settings: %v", err)
	}
	if token != "valid-before-revoke" || visibility != "public_link" {
		t.Fatalf("share settings after rejected write = (%q, %q), want original values", token, visibility)
	}
	if err := docRepo.UpdateThumbnails(ctx, docID, workspaceID, editorID, "stale-thumbnail", "", "", ""); !errors.Is(err, constant.ErrForbidden) {
		t.Fatalf("UpdateThumbnails() after revoke error = %v, want %v", err, constant.ErrForbidden)
	}
	var thumbnail string
	if err := db.QueryRowContext(ctx, `SELECT COALESCE(thumbnail, '') FROM documents WHERE id = $1`, docID).Scan(&thumbnail); err != nil {
		t.Fatalf("read thumbnail after rejected update: %v", err)
	}
	if thumbnail != "" {
		t.Fatalf("thumbnail after rejected update = %q, want empty", thumbnail)
	}
	if err := docRepo.SoftDelete(ctx, docID, workspaceID, authorID); err != nil {
		t.Fatalf("move document to trash: %v", err)
	}
	if err := docRepo.EmptyTrash(ctx, workspaceID, editorID); !errors.Is(err, constant.ErrForbidden) {
		t.Fatalf("EmptyTrash() as workspace member error = %v, want %v", err, constant.ErrForbidden)
	}
	var trashedCount int
	if err := db.QueryRowContext(ctx, `SELECT count(*) FROM documents WHERE id = $1 AND deleted_at IS NOT NULL`, docID).Scan(&trashedCount); err != nil {
		t.Fatalf("read trashed document: %v", err)
	}
	if trashedCount != 1 {
		t.Fatalf("trashed document count after rejected empty = %d, want 1", trashedCount)
	}
	if err := uc.EmptyTrash(ctx, workspaceID, authorID); err != nil {
		t.Fatalf("EmptyTrash() as workspace owner: %v", err)
	}
	if err := db.QueryRowContext(ctx, `SELECT id FROM documents WHERE id = $1`, docID).Scan(new(uuid.UUID)); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("document after owner empty trash error = %v, want no rows", err)
	}
}

func TestMoveRechecksAccessAndProjectWorkspace(t *testing.T) {
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
	authorID := insertDocumentAccessUser(t, ctx, db)
	editorID := insertDocumentAccessUser(t, ctx, db)
	workspaceID, otherWorkspaceID, docID := uuid.New(), uuid.New(), uuid.New()
	projectID, otherProjectID := uuid.New(), uuid.New()
	_, err = db.ExecContext(ctx, `
		INSERT INTO workspaces (id, name, slug, created_by) VALUES
		($1, 'Move Test', $3, $4), ($2, 'Other Move Test', $5, $4)
	`, workspaceID, otherWorkspaceID, fmt.Sprintf("move-%s", workspaceID), authorID, fmt.Sprintf("other-move-%s", otherWorkspaceID))
	if err != nil {
		t.Fatalf("create workspaces: %v", err)
	}
	_, err = db.ExecContext(ctx, `
		INSERT INTO workspace_members (workspace_id, user_id, role) VALUES
		($1, $2, 'owner'), ($1, $3, 'member'), ($4, $2, 'owner')
	`, workspaceID, authorID, editorID, otherWorkspaceID)
	if err != nil {
		t.Fatalf("create workspace members: %v", err)
	}
	_, err = db.ExecContext(ctx, `
		INSERT INTO projects (id, workspace_id, name, created_by) VALUES
		($1, $2, 'Target Project', $3), ($4, $5, 'Other Workspace Project', $3)
	`, projectID, workspaceID, authorID, otherProjectID, otherWorkspaceID)
	if err != nil {
		t.Fatalf("create projects: %v", err)
	}
	t.Cleanup(func() {
		_, _ = db.ExecContext(ctx, `DELETE FROM document_accesses WHERE document_id = $1`, docID)
		_, _ = db.ExecContext(ctx, `DELETE FROM documents WHERE id = $1`, docID)
		_, _ = db.ExecContext(ctx, `DELETE FROM projects WHERE id IN ($1, $2)`, projectID, otherProjectID)
		_, _ = db.ExecContext(ctx, `DELETE FROM workspace_members WHERE workspace_id IN ($1, $2)`, workspaceID, otherWorkspaceID)
		_, _ = db.ExecContext(ctx, `DELETE FROM workspaces WHERE id IN ($1, $2)`, workspaceID, otherWorkspaceID)
		_, _ = db.ExecContext(ctx, `DELETE FROM users WHERE id IN ($1, $2)`, authorID, editorID)
	})

	dbAccess := database.NewSQLDB(db)
	docRepo := documentrepo.NewRepository(dbAccess)
	if _, err := docRepo.Create(ctx, model.Document{
		ID:          docID,
		WorkspaceID: workspaceID,
		Title:       "Move access",
		Type:        "markdown",
		AuthorID:    authorID,
		Visibility:  "private",
	}, nil); err != nil {
		t.Fatalf("create private document: %v", err)
	}
	if err := docRepo.AddOrUpdateAccess(ctx, docID, workspaceID, authorID, editorID, "edit"); err != nil {
		t.Fatalf("grant editor access: %v", err)
	}
	uc := NewUseCase(dbAccess)
	if err := uc.RemoveAccess(ctx, docID, workspaceID, editorID, authorID); err != nil {
		t.Fatalf("revoke editor access: %v", err)
	}
	if err := docRepo.Move(ctx, docID, workspaceID, editorID, &projectID); !errors.Is(err, constant.ErrForbidden) {
		t.Fatalf("Move() after revoke error = %v, want %v", err, constant.ErrForbidden)
	}
	if err := docRepo.Move(ctx, docID, workspaceID, authorID, &projectID); err != nil {
		t.Fatalf("Move() to same-workspace project: %v", err)
	}
	if err := docRepo.Move(ctx, docID, workspaceID, authorID, &otherProjectID); !errors.Is(err, constant.ErrProjectNotFound) {
		t.Fatalf("Move() to another workspace project error = %v, want %v", err, constant.ErrProjectNotFound)
	}
	movedDoc, err := uc.GetDocument(ctx, docID, workspaceID, authorID)
	if err != nil {
		t.Fatalf("read document for update project check: %v", err)
	}
	movedDoc.ProjectID = &otherProjectID
	if err := docRepo.UpdateAuthorized(ctx, movedDoc, nil, authorID); !errors.Is(err, constant.ErrProjectNotFound) {
		t.Fatalf("UpdateAuthorized() to another workspace project error = %v, want %v", err, constant.ErrProjectNotFound)
	}
	var actualProjectID uuid.UUID
	if err := db.QueryRowContext(ctx, `SELECT project_id FROM documents WHERE id = $1`, docID).Scan(&actualProjectID); err != nil {
		t.Fatalf("read project after move attempts: %v", err)
	}
	if actualProjectID != projectID {
		t.Fatalf("project after move attempts = %s, want %s", actualProjectID, projectID)
	}
}

func TestCreateRechecksMembershipAndActiveProject(t *testing.T) {
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
	ownerID := insertDocumentAccessUser(t, ctx, db)
	memberID := insertDocumentAccessUser(t, ctx, db)
	outsiderID := insertDocumentAccessUser(t, ctx, db)
	workspaceID, otherWorkspaceID := uuid.New(), uuid.New()
	projectID, deletedProjectID := uuid.New(), uuid.New()
	_, err = db.ExecContext(ctx, `
		INSERT INTO workspaces (id, name, slug, created_by) VALUES
		($1, 'Create Access Test', $3, $4), ($2, 'Other Create Test', $5, $4)
	`, workspaceID, otherWorkspaceID, fmt.Sprintf("create-access-%s", workspaceID), ownerID, fmt.Sprintf("other-create-access-%s", otherWorkspaceID))
	if err != nil {
		t.Fatalf("create workspaces: %v", err)
	}
	_, err = db.ExecContext(ctx, `
		INSERT INTO workspace_members (workspace_id, user_id, role) VALUES
		($1, $2, 'owner'), ($1, $3, 'member'), ($4, $2, 'owner')
	`, workspaceID, ownerID, memberID, otherWorkspaceID)
	if err != nil {
		t.Fatalf("create workspace members: %v", err)
	}
	_, err = db.ExecContext(ctx, `
		INSERT INTO projects (id, workspace_id, name, created_by) VALUES
		($1, $2, 'Other Workspace Project', $3), ($4, $5, 'Deleted Project', $3)
	`, projectID, otherWorkspaceID, ownerID, deletedProjectID, workspaceID)
	if err != nil {
		t.Fatalf("create projects: %v", err)
	}
	if _, err := db.ExecContext(ctx, `UPDATE projects SET deleted_at = NOW() WHERE id = $1`, deletedProjectID); err != nil {
		t.Fatalf("delete project: %v", err)
	}
	t.Cleanup(func() {
		_, _ = db.ExecContext(ctx, `DELETE FROM documents WHERE workspace_id IN ($1, $2)`, workspaceID, otherWorkspaceID)
		_, _ = db.ExecContext(ctx, `DELETE FROM projects WHERE id IN ($1, $2)`, projectID, deletedProjectID)
		_, _ = db.ExecContext(ctx, `DELETE FROM workspace_members WHERE workspace_id IN ($1, $2)`, workspaceID, otherWorkspaceID)
		_, _ = db.ExecContext(ctx, `DELETE FROM workspaces WHERE id IN ($1, $2)`, workspaceID, otherWorkspaceID)
		_, _ = db.ExecContext(ctx, `DELETE FROM users WHERE id IN ($1, $2, $3)`, ownerID, memberID, outsiderID)
	})

	docRepo := documentrepo.NewRepository(database.NewSQLDB(db))
	if _, err := docRepo.Create(ctx, model.Document{
		ID:          uuid.New(),
		WorkspaceID: workspaceID,
		Title:       "Non-member create",
		Type:        "markdown",
		AuthorID:    outsiderID,
	}, nil); !errors.Is(err, constant.ErrForbidden) {
		t.Fatalf("Create() as non-member error = %v, want %v", err, constant.ErrForbidden)
	}
	for name, project := range map[string]uuid.UUID{"other workspace": projectID, "deleted": deletedProjectID} {
		if _, err := docRepo.Create(ctx, model.Document{
			ID:          uuid.New(),
			WorkspaceID: workspaceID,
			ProjectID:   &project,
			Title:       name,
			Type:        "markdown",
			AuthorID:    memberID,
		}, nil); !errors.Is(err, constant.ErrProjectNotFound) {
			t.Errorf("Create() with %s project error = %v, want %v", name, err, constant.ErrProjectNotFound)
		}
	}
}

func TestAuthorizedUpdateFinishesBeforeConcurrentRevoke(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Fatal("TEST_DATABASE_URL is required for integration tests")
	}
	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	defer db.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	authorID := insertDocumentAccessUser(t, ctx, db)
	editorID := insertDocumentAccessUser(t, ctx, db)
	workspaceID, docID := uuid.New(), uuid.New()
	_, err = db.ExecContext(ctx, `
		INSERT INTO workspaces (id, name, slug, created_by)
		VALUES ($1, 'Write First Test', $2, $3)
	`, workspaceID, fmt.Sprintf("write-first-%s", workspaceID), authorID)
	if err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	_, err = db.ExecContext(ctx, `
		INSERT INTO workspace_members (workspace_id, user_id, role) VALUES
		($1, $2, 'owner'), ($1, $3, 'member')
	`, workspaceID, authorID, editorID)
	if err != nil {
		t.Fatalf("create workspace members: %v", err)
	}
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(), `DELETE FROM document_accesses WHERE document_id = $1`, docID)
		_, _ = db.ExecContext(context.Background(), `DELETE FROM documents WHERE id = $1`, docID)
		_, _ = db.ExecContext(context.Background(), `DELETE FROM workspace_members WHERE workspace_id = $1`, workspaceID)
		_, _ = db.ExecContext(context.Background(), `DELETE FROM workspaces WHERE id = $1`, workspaceID)
		_, _ = db.ExecContext(context.Background(), `DELETE FROM users WHERE id IN ($1, $2)`, authorID, editorID)
	})

	suffix := strings.ReplaceAll(uuid.NewString(), "-", "")
	triggerName, functionName := "hold_document_update_"+suffix, "hold_document_update_fn_"+suffix
	lockName := "write-first-" + suffix
	functionSQL := fmt.Sprintf(`
		CREATE FUNCTION public.%s() RETURNS trigger LANGUAGE plpgsql AS $$
		BEGIN
			IF NEW.id = '%s'::uuid THEN
				PERFORM pg_advisory_xact_lock(hashtext('%s'));
			END IF;
			RETURN NEW;
		END;
		$$
	`, functionName, docID, lockName)
	if _, err := db.ExecContext(ctx, functionSQL); err != nil {
		t.Fatalf("create blocking trigger function: %v", err)
	}
	if _, err := db.ExecContext(ctx, fmt.Sprintf(`CREATE TRIGGER %s BEFORE UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION public.%s()`, triggerName, functionName)); err != nil {
		t.Fatalf("create blocking trigger: %v", err)
	}
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(), fmt.Sprintf(`DROP TRIGGER IF EXISTS %s ON documents`, triggerName))
		_, _ = db.ExecContext(context.Background(), fmt.Sprintf(`DROP FUNCTION IF EXISTS public.%s()`, functionName))
	})

	operationURL, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatalf("parse test database URL: %v", err)
	}
	operationName := "g0-write-first-" + suffix
	query := operationURL.Query()
	query.Set("application_name", operationName)
	operationURL.RawQuery = query.Encode()
	operationDB, err := sql.Open("pgx", operationURL.String())
	if err != nil {
		t.Fatalf("open operation database: %v", err)
	}
	defer operationDB.Close()

	docRepo := documentrepo.NewRepository(database.NewSQLDB(operationDB))
	doc, err := docRepo.Create(ctx, model.Document{
		ID:          docID,
		WorkspaceID: workspaceID,
		Title:       "Before concurrent revoke",
		Type:        "markdown",
		AuthorID:    authorID,
		Visibility:  "private",
	}, nil)
	if err != nil {
		t.Fatalf("create private document: %v", err)
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO document_accesses (document_id, user_id, access_level) VALUES ($1, $2, 'edit')
	`, docID, editorID); err != nil {
		t.Fatalf("grant editor access: %v", err)
	}

	blocker, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin advisory lock holder: %v", err)
	}
	defer blocker.Rollback()
	if _, err := blocker.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, lockName); err != nil {
		t.Fatalf("hold update trigger lock: %v", err)
	}

	writeResult := make(chan error, 1)
	doc.Title = "Editor committed before revoke"
	go func() { writeResult <- docRepo.UpdateAuthorized(ctx, doc, nil, editorID) }()
	waitForBlockedQuery(t, ctx, db, operationName, "%UPDATE documents%")

	revokeResult := make(chan error, 1)
	uc := NewUseCase(database.NewSQLDB(operationDB))
	go func() { revokeResult <- uc.RemoveAccess(ctx, docID, workspaceID, editorID, authorID) }()
	waitForBlockedQuery(t, ctx, db, operationName, "%FOR UPDATE%")

	if err := blocker.Commit(); err != nil {
		t.Fatalf("release update trigger lock: %v", err)
	}
	for name, result := range map[string]<-chan error{"authorized update": writeResult, "grant revoke": revokeResult} {
		select {
		case err := <-result:
			if err != nil {
				t.Fatalf("%s failed: %v", name, err)
			}
		case <-ctx.Done():
			t.Fatalf("timed out waiting for %s: %v", name, ctx.Err())
		}
	}

	var title string
	if err := db.QueryRowContext(ctx, `SELECT title FROM documents WHERE id = $1`, docID).Scan(&title); err != nil {
		t.Fatalf("read committed title: %v", err)
	}
	if title != "Editor committed before revoke" {
		t.Fatalf("committed title = %q, want editor's update", title)
	}
	var grantCount int
	if err := db.QueryRowContext(ctx, `SELECT count(*) FROM document_accesses WHERE document_id = $1 AND user_id = $2`, docID, editorID).Scan(&grantCount); err != nil {
		t.Fatalf("read revoked grant: %v", err)
	}
	if grantCount != 0 {
		t.Fatalf("editor grant count after revoke = %d, want 0", grantCount)
	}
}

func TestConcurrentRevokeWinsBeforeAuthorizedUpdate(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Fatal("TEST_DATABASE_URL is required for integration tests")
	}
	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	defer db.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	authorID := insertDocumentAccessUser(t, ctx, db)
	editorID := insertDocumentAccessUser(t, ctx, db)
	workspaceID, docID := uuid.New(), uuid.New()
	_, err = db.ExecContext(ctx, `
		INSERT INTO workspaces (id, name, slug, created_by)
		VALUES ($1, 'Revoke First Test', $2, $3)
	`, workspaceID, fmt.Sprintf("revoke-first-%s", workspaceID), authorID)
	if err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	_, err = db.ExecContext(ctx, `
		INSERT INTO workspace_members (workspace_id, user_id, role) VALUES
		($1, $2, 'owner'), ($1, $3, 'member')
	`, workspaceID, authorID, editorID)
	if err != nil {
		t.Fatalf("create workspace members: %v", err)
	}
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(), `DELETE FROM document_accesses WHERE document_id = $1`, docID)
		_, _ = db.ExecContext(context.Background(), `DELETE FROM documents WHERE id = $1`, docID)
		_, _ = db.ExecContext(context.Background(), `DELETE FROM workspace_members WHERE workspace_id = $1`, workspaceID)
		_, _ = db.ExecContext(context.Background(), `DELETE FROM workspaces WHERE id = $1`, workspaceID)
		_, _ = db.ExecContext(context.Background(), `DELETE FROM users WHERE id IN ($1, $2)`, authorID, editorID)
	})

	suffix := strings.ReplaceAll(uuid.NewString(), "-", "")
	triggerName, functionName := "hold_access_revoke_"+suffix, "hold_access_revoke_fn_"+suffix
	lockName := "revoke-first-" + suffix
	functionSQL := fmt.Sprintf(`
		CREATE FUNCTION public.%s() RETURNS trigger LANGUAGE plpgsql AS $$
		BEGIN
			IF OLD.document_id = '%s'::uuid THEN
				PERFORM pg_advisory_xact_lock(hashtext('%s'));
			END IF;
			RETURN OLD;
		END;
		$$
	`, functionName, docID, lockName)
	if _, err := db.ExecContext(ctx, functionSQL); err != nil {
		t.Fatalf("create blocking revoke trigger function: %v", err)
	}
	if _, err := db.ExecContext(ctx, fmt.Sprintf(`CREATE TRIGGER %s BEFORE DELETE ON document_accesses FOR EACH ROW EXECUTE FUNCTION public.%s()`, triggerName, functionName)); err != nil {
		t.Fatalf("create blocking revoke trigger: %v", err)
	}
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(), fmt.Sprintf(`DROP TRIGGER IF EXISTS %s ON document_accesses`, triggerName))
		_, _ = db.ExecContext(context.Background(), fmt.Sprintf(`DROP FUNCTION IF EXISTS public.%s()`, functionName))
	})

	openOperationDB := func(applicationName string) (*sql.DB, error) {
		operationURL, err := url.Parse(databaseURL)
		if err != nil {
			return nil, err
		}
		query := operationURL.Query()
		query.Set("application_name", applicationName)
		operationURL.RawQuery = query.Encode()
		return sql.Open("pgx", operationURL.String())
	}
	revokeApplication := "g0-revoke-first-remove-" + suffix
	writeApplication := "g0-revoke-first-write-" + suffix
	revokeDB, err := openOperationDB(revokeApplication)
	if err != nil {
		t.Fatalf("open revoke database: %v", err)
	}
	defer revokeDB.Close()
	writeDB, err := openOperationDB(writeApplication)
	if err != nil {
		t.Fatalf("open write database: %v", err)
	}
	defer writeDB.Close()

	docRepo := documentrepo.NewRepository(database.NewSQLDB(writeDB))
	_, err = docRepo.Create(ctx, model.Document{
		ID:          docID,
		WorkspaceID: workspaceID,
		Title:       "Before concurrent revoke",
		Type:        "markdown",
		AuthorID:    authorID,
		Visibility:  "private",
	}, nil)
	if err != nil {
		t.Fatalf("create private document: %v", err)
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO document_accesses (document_id, user_id, access_level) VALUES ($1, $2, 'edit')
	`, docID, editorID); err != nil {
		t.Fatalf("grant editor access: %v", err)
	}
	writeUseCase := NewUseCase(database.NewSQLDB(writeDB))
	staleDoc, err := writeUseCase.GetDocument(ctx, docID, workspaceID, editorID)
	if err != nil {
		t.Fatalf("read as editor before concurrent revoke: %v", err)
	}
	staleDoc.Title = "Must not commit"

	blocker, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin advisory lock holder: %v", err)
	}
	defer blocker.Rollback()
	if _, err := blocker.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, lockName); err != nil {
		t.Fatalf("hold revoke trigger lock: %v", err)
	}

	revokeResult := make(chan error, 1)
	ownerUseCase := NewUseCase(database.NewSQLDB(revokeDB))
	go func() { revokeResult <- ownerUseCase.RemoveAccess(ctx, docID, workspaceID, editorID, authorID) }()
	waitForBlockedQuery(t, ctx, db, revokeApplication, "%DELETE FROM document_accesses%")

	writeResult := make(chan error, 1)
	go func() { writeResult <- docRepo.UpdateAuthorized(ctx, staleDoc, nil, editorID) }()
	waitForBlockedQuery(t, ctx, db, writeApplication, "%FOR UPDATE%")

	if err := blocker.Commit(); err != nil {
		t.Fatalf("release revoke trigger lock: %v", err)
	}
	select {
	case err := <-revokeResult:
		if err != nil {
			t.Fatalf("grant revoke failed: %v", err)
		}
	case <-ctx.Done():
		t.Fatalf("timed out waiting for grant revoke: %v", ctx.Err())
	}
	select {
	case err := <-writeResult:
		if !errors.Is(err, constant.ErrForbidden) {
			t.Fatalf("authorized update after concurrent revoke = %v, want forbidden", err)
		}
	case <-ctx.Done():
		t.Fatalf("timed out waiting for authorized update: %v", ctx.Err())
	}

	current, err := NewUseCase(database.NewSQLDB(db)).GetDocument(ctx, docID, workspaceID, authorID)
	if err != nil {
		t.Fatalf("read as owner after race: %v", err)
	}
	if current.Title != "Before concurrent revoke" {
		t.Fatalf("title after revoke-first race = %q, want unchanged", current.Title)
	}
	var grantCount int
	if err := db.QueryRowContext(ctx, `SELECT count(*) FROM document_accesses WHERE document_id = $1 AND user_id = $2`, docID, editorID).Scan(&grantCount); err != nil {
		t.Fatalf("read revoked grant: %v", err)
	}
	if grantCount != 0 {
		t.Fatalf("editor grant count after revoke = %d, want 0", grantCount)
	}
}

func waitForBlockedQuery(t *testing.T, ctx context.Context, db *sql.DB, applicationName, queryPattern string) {
	t.Helper()
	for {
		var waiting bool
		err := db.QueryRowContext(ctx, `
			SELECT EXISTS (
				SELECT 1 FROM pg_stat_activity
				WHERE application_name = $1 AND wait_event_type = 'Lock' AND query LIKE $2
			)
		`, applicationName, queryPattern).Scan(&waiting)
		if err != nil {
			t.Fatalf("inspect blocked query: %v", err)
		}
		if waiting {
			return
		}
		select {
		case <-ctx.Done():
			t.Fatalf("timed out waiting for %q to block: %v", queryPattern, ctx.Err())
		case <-time.After(10 * time.Millisecond):
		}
	}
}
