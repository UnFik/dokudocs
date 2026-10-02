//go:build integration

package document

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"testing"

	"backend/constant"
	"backend/internal/domain/contract/repository"
	"backend/internal/domain/model"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestListOnlyReturnsDocumentsTheWorkspaceMemberCanRead(t *testing.T) {
	dbURL := integrationDatabaseURL(t)
	db, err := sql.Open("pgx", dbURL)
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	defer db.Close()

	tx, err := db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatalf("begin fixture transaction: %v", err)
	}
	defer tx.Rollback()

	ctx := context.Background()
	authorID := insertAccessTestUser(t, ctx, tx)
	memberID := insertAccessTestUser(t, ctx, tx)
	adminID := insertAccessTestUser(t, ctx, tx)
	workspaceID := uuid.New()
	_, err = tx.ExecContext(ctx, `
		INSERT INTO workspaces (id, name, slug, created_by) VALUES ($1, 'Access Test', $2, $3)
	`, workspaceID, fmt.Sprintf("access-test-%s", workspaceID), authorID)
	if err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO workspace_members (workspace_id, user_id, role) VALUES
		($1, $2, 'owner'), ($1, $3, 'member'), ($1, $4, 'admin')
	`, workspaceID, authorID, memberID, adminID)
	if err != nil {
		t.Fatalf("create workspace members: %v", err)
	}

	documents := map[string]uuid.UUID{
		"private-denied":       uuid.New(),
		"private-view-grant":   uuid.New(),
		"private-admin":        uuid.New(),
		"public-link-denied":   uuid.New(),
		"public-link-grant":    uuid.New(),
		"workspace-draft-view": uuid.New(),
		"workspace-draft-edit": uuid.New(),
		"workspace-visible":    uuid.New(),
	}
	for title, id := range documents {
		visibility := "workspace"
		isDraft := false
		if title == "private-denied" || title == "private-view-grant" || title == "private-admin" {
			visibility = "private"
		} else if title == "public-link-denied" || title == "public-link-grant" {
			visibility = "public_link"
		}
		if title == "workspace-draft-view" || title == "workspace-draft-edit" {
			isDraft = true
		}
		_, err := tx.ExecContext(ctx, `
			INSERT INTO documents (id, workspace_id, title, type, content, author_id, visibility, is_draft)
			VALUES ($1, $2, $3, 'markdown', $4, $5, $6::document_visibility, $7)
		`, id, workspaceID, title, title, authorID, visibility, isDraft)
		if err != nil {
			t.Fatalf("create %s document: %v", title, err)
		}
	}
	for title, level := range map[string]string{
		"private-view-grant":   "view",
		"public-link-grant":    "view",
		"workspace-draft-view": "view",
		"workspace-draft-edit": "edit",
	} {
		_, err := tx.ExecContext(ctx, `
			INSERT INTO document_accesses (document_id, user_id, access_level) VALUES ($1, $2, $3::document_access_level)
		`, documents[title], memberID, level)
		if err != nil {
			t.Fatalf("grant %s document: %v", title, err)
		}
	}

	got, err := (&Repository{db: tx}).List(ctx, workspaceID, memberID, repository.DocumentFilter{})
	if err != nil {
		t.Fatalf("list documents: %v", err)
	}
	gotIDs := make(map[uuid.UUID]bool, len(got))
	for _, doc := range got {
		gotIDs[doc.ID] = true
	}
	for _, title := range []string{"private-view-grant", "public-link-grant", "workspace-draft-edit", "workspace-visible"} {
		if !gotIDs[documents[title]] {
			t.Errorf("List() omitted readable document %q", title)
		}
	}
	for _, title := range []string{"private-denied", "public-link-denied", "workspace-draft-view"} {
		if gotIDs[documents[title]] {
			t.Errorf("List() exposed unreadable document %q", title)
		}
	}
	adminDocs, err := (&Repository{db: tx}).List(ctx, workspaceID, adminID, repository.DocumentFilter{})
	if err != nil {
		t.Fatalf("list documents as workspace admin: %v", err)
	}
	for _, doc := range adminDocs {
		if doc.ID == documents["private-admin"] {
			return
		}
	}
	t.Fatalf("List() omitted private document %s from workspace admin", documents["private-admin"])
}

func TestListAppliesProjectVisibilityOnlyWhenDocumentInheritsIt(t *testing.T) {
	dbURL := integrationDatabaseURL(t)
	db, err := sql.Open("pgx", dbURL)
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	defer db.Close()

	tx, err := db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatalf("begin fixture transaction: %v", err)
	}
	defer tx.Rollback()

	ctx := context.Background()
	authorID := insertAccessTestUser(t, ctx, tx)
	memberID := insertAccessTestUser(t, ctx, tx)
	workspaceID := uuid.New()
	_, err = tx.ExecContext(ctx, `INSERT INTO workspaces (id, name, slug, created_by) VALUES ($1, 'Project Access Test', $2, $3)`, workspaceID, fmt.Sprintf("project-access-%s", workspaceID), authorID)
	if err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO workspace_members (workspace_id, user_id, role) VALUES
		($1, $2, 'owner'), ($1, $3, 'member')
	`, workspaceID, authorID, memberID)
	if err != nil {
		t.Fatalf("create workspace members: %v", err)
	}
	memberProjectID, privateProjectID := uuid.New(), uuid.New()
	for _, project := range []struct {
		id   uuid.UUID
		name string
	}{{memberProjectID, "Member Project"}, {privateProjectID, "Hidden Project"}} {
		_, err = tx.ExecContext(ctx, `
			INSERT INTO projects (id, workspace_id, name, visibility, created_by)
			VALUES ($1, $2, $3, 'private', $4)
		`, project.id, workspaceID, project.name, authorID)
		if err != nil {
			t.Fatalf("create private project: %v", err)
		}
	}
	memberCategoryID, hiddenCategoryID := uuid.New(), uuid.New()
	for _, category := range []struct {
		id        uuid.UUID
		projectID uuid.UUID
		name      string
	}{{memberCategoryID, memberProjectID, "Member Category"}, {hiddenCategoryID, privateProjectID, "Hidden Category"}} {
		_, err = tx.ExecContext(ctx, `
			INSERT INTO project_categories (id, project_id, name) VALUES ($1, $2, $3)
		`, category.id, category.projectID, category.name)
		if err != nil {
			t.Fatalf("create project category: %v", err)
		}
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'viewer')
	`, memberProjectID, memberID)
	if err != nil {
		t.Fatalf("add project viewer: %v", err)
	}

	memberDocID, hiddenDocID, overrideDocID, grantDocID := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	for _, fixture := range []struct {
		id         uuid.UUID
		title      string
		projectID  uuid.UUID
		visibility string
	}{
		{id: memberDocID, title: "inherited-member", projectID: memberProjectID, visibility: "inherit"},
		{id: hiddenDocID, title: "inherited-nonmember", projectID: privateProjectID, visibility: "inherit"},
		{id: overrideDocID, title: "workspace-override", projectID: privateProjectID, visibility: "workspace"},
		{id: grantDocID, title: "direct-grant", projectID: privateProjectID, visibility: "private"},
	} {
		_, err = tx.ExecContext(ctx, `
			INSERT INTO documents (id, workspace_id, project_id, title, type, content, author_id, visibility)
			VALUES ($1, $2, $3, $4, 'markdown', $5, $6, $7::document_visibility)
		`, fixture.id, workspaceID, fixture.projectID, fixture.title, fixture.title, authorID, fixture.visibility)
		if err != nil {
			t.Fatalf("create %s document: %v", fixture.title, err)
		}
	}
	for _, mapping := range []struct {
		documentID uuid.UUID
		categoryID uuid.UUID
	}{{memberDocID, memberCategoryID}, {overrideDocID, hiddenCategoryID}, {grantDocID, hiddenCategoryID}} {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO document_category_mappings (document_id, category_id) VALUES ($1, $2)
		`, mapping.documentID, mapping.categoryID); err != nil {
			t.Fatalf("map document category: %v", err)
		}
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO document_accesses (document_id, user_id, access_level) VALUES ($1, $2, 'view')
	`, grantDocID, memberID); err != nil {
		t.Fatalf("grant direct document read: %v", err)
	}

	got, err := (&Repository{db: tx}).List(ctx, workspaceID, memberID, repository.DocumentFilter{})
	if err != nil {
		t.Fatalf("list documents: %v", err)
	}
	gotByID := make(map[uuid.UUID]model.Document, len(got))
	for _, doc := range got {
		gotByID[doc.ID] = doc
	}
	for _, id := range []uuid.UUID{memberDocID, overrideDocID, grantDocID} {
		if _, ok := gotByID[id]; !ok {
			t.Errorf("List() omitted readable document %s", id)
		}
	}
	if _, ok := gotByID[hiddenDocID]; ok {
		t.Errorf("List() exposed inherited private-project document %s to nonmember", hiddenDocID)
	}
	if gotByID[memberDocID].ProjectName != "Member Project" || len(gotByID[memberDocID].Categories) != 1 || gotByID[memberDocID].Categories[0] != "Member Category" {
		t.Errorf("project member metadata = (%q, %v), want member project/category", gotByID[memberDocID].ProjectName, gotByID[memberDocID].Categories)
	}
	for _, id := range []uuid.UUID{overrideDocID, grantDocID} {
		doc := gotByID[id]
		if doc.ProjectName != "" || len(doc.Categories) != 0 {
			t.Errorf("nonmember document %s exposed private project metadata (%q, %v)", id, doc.ProjectName, doc.Categories)
		}
		detail, err := (&Repository{db: tx}).GetByID(ctx, id, memberID)
		if err != nil {
			t.Fatalf("GetByID(%s): %v", id, err)
		}
		if detail.ProjectName != "" || len(detail.Categories) != 0 {
			t.Errorf("GetByID(%s) exposed private project metadata (%q, %v)", id, detail.ProjectName, detail.Categories)
		}
	}
	filtered, err := (&Repository{db: tx}).List(ctx, workspaceID, memberID, repository.DocumentFilter{Category: "Hidden Category"})
	if err != nil {
		t.Fatalf("list by private project category: %v", err)
	}
	for _, doc := range filtered {
		if doc.ID == overrideDocID || doc.ID == grantDocID {
			t.Errorf("category filter exposed hidden project category for document %s", doc.ID)
		}
	}
}

func TestAuthorWithoutPrivateProjectMembershipCannotReadInheritedDocument(t *testing.T) {
	dbURL := integrationDatabaseURL(t)
	db, err := sql.Open("pgx", dbURL)
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	defer db.Close()

	tx, err := db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatalf("begin fixture transaction: %v", err)
	}
	defer tx.Rollback()

	ctx := context.Background()
	adminID := insertAccessTestUser(t, ctx, tx)
	authorID := insertAccessTestUser(t, ctx, tx)
	workspaceID, projectID, documentID := uuid.New(), uuid.New(), uuid.New()
	_, err = tx.ExecContext(ctx, `
		INSERT INTO workspaces (id, name, slug, created_by) VALUES ($1, 'Inherited Access Test', $2, $3)
	`, workspaceID, fmt.Sprintf("inherited-access-%s", workspaceID), adminID)
	if err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO workspace_members (workspace_id, user_id, role) VALUES
		($1, $2, 'owner'), ($1, $3, 'member')
	`, workspaceID, adminID, authorID)
	if err != nil {
		t.Fatalf("create workspace members: %v", err)
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO projects (id, workspace_id, name, visibility, created_by)
		VALUES ($1, $2, 'Private Project', 'private', $3)
	`, projectID, workspaceID, adminID)
	if err != nil {
		t.Fatalf("create private project: %v", err)
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO documents (id, workspace_id, project_id, title, type, content, author_id, visibility)
		VALUES ($1, $2, $3, 'Inherited Private Project Document', 'markdown', '', $4, 'inherit')
	`, documentID, workspaceID, projectID, authorID)
	if err != nil {
		t.Fatalf("create inherited document: %v", err)
	}

	repo := &Repository{db: tx}
	listed, err := repo.List(ctx, workspaceID, authorID, repository.DocumentFilter{})
	if err != nil {
		t.Fatalf("list documents: %v", err)
	}
	for _, doc := range listed {
		if doc.ID == documentID {
			t.Fatal("List() exposed inherited private-project document to its nonmember author")
		}
	}
	if _, err := repo.GetByID(ctx, documentID, authorID); !errors.Is(err, constant.ErrDocumentNotFound) {
		t.Fatalf("GetByID() error = %v, want document not found", err)
	}
}

func TestListDoesNotUseProjectRoleToExposePrivateDraft(t *testing.T) {
	dbURL := integrationDatabaseURL(t)
	db, err := sql.Open("pgx", dbURL)
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	defer db.Close()

	ctx := context.Background()
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin fixture transaction: %v", err)
	}
	defer tx.Rollback()

	authorID := insertAccessTestUser(t, ctx, tx)
	memberID := insertAccessTestUser(t, ctx, tx)
	workspaceID := uuid.New()
	_, err = tx.ExecContext(ctx, `
		INSERT INTO workspaces (id, name, slug, created_by) VALUES ($1, 'Private Draft Test', $2, $3)
	`, workspaceID, fmt.Sprintf("private-draft-%s", workspaceID), authorID)
	if err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner'), ($1, $3, 'member')
	`, workspaceID, authorID, memberID)
	if err != nil {
		t.Fatalf("create workspace members: %v", err)
	}
	projectID := uuid.New()
	_, err = tx.ExecContext(ctx, `
		INSERT INTO projects (id, workspace_id, name, visibility, created_by)
		VALUES ($1, $2, 'Private Project', 'private', $3)
	`, projectID, workspaceID, authorID)
	if err != nil {
		t.Fatalf("create project: %v", err)
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'editor')
	`, projectID, memberID)
	if err != nil {
		t.Fatalf("add project editor: %v", err)
	}
	docID := uuid.New()
	_, err = tx.ExecContext(ctx, `
		INSERT INTO documents (id, workspace_id, project_id, title, type, content, author_id, visibility, is_draft)
		VALUES ($1, $2, $3, 'Private draft', 'markdown', '', $4, 'private', true)
	`, docID, workspaceID, projectID, authorID)
	if err != nil {
		t.Fatalf("create private draft: %v", err)
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO document_accesses (document_id, user_id, access_level) VALUES ($1, $2, 'view')
	`, docID, memberID)
	if err != nil {
		t.Fatalf("grant document view: %v", err)
	}

	docs, err := (&Repository{db: tx}).List(ctx, workspaceID, memberID, repository.DocumentFilter{})
	if err != nil {
		t.Fatalf("list documents: %v", err)
	}
	for _, doc := range docs {
		if doc.ID == docID {
			t.Fatal("List() exposed private draft using project role despite only direct view grant")
		}
	}
}

func TestGetByShareTokenRejectsDraftAndNonPublicDocumentsAndOmitsProjectName(t *testing.T) {
	dbURL := integrationDatabaseURL(t)
	db, err := sql.Open("pgx", dbURL)
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	defer db.Close()

	tx, err := db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatalf("begin fixture transaction: %v", err)
	}
	defer tx.Rollback()

	ctx := context.Background()
	authorID := insertAccessTestUser(t, ctx, tx)
	workspaceID := uuid.New()
	_, err = tx.ExecContext(ctx, `INSERT INTO workspaces (id, name, slug, created_by) VALUES ($1, 'Share Test', $2, $3)`, workspaceID, fmt.Sprintf("share-test-%s", workspaceID), authorID)
	if err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`, workspaceID, authorID)
	if err != nil {
		t.Fatalf("create workspace member: %v", err)
	}
	privateProjectID := uuid.New()
	_, err = tx.ExecContext(ctx, `
		INSERT INTO projects (id, workspace_id, name, visibility, created_by)
		VALUES ($1, $2, 'Private Project Name', 'private', $3)
	`, privateProjectID, workspaceID, authorID)
	if err != nil {
		t.Fatalf("create private project: %v", err)
	}

	publicID, draftID, hiddenID := uuid.New(), uuid.New(), uuid.New()
	for _, fixture := range []struct {
		id         uuid.UUID
		title      string
		token      string
		visibility string
		draft      bool
	}{
		{id: publicID, title: "public", token: "valid-public-token", visibility: "public_link"},
		{id: draftID, title: "draft", token: "draft-token", visibility: "public_link", draft: true},
		{id: hiddenID, title: "hidden", token: "hidden-token", visibility: "workspace"},
	} {
		_, err := tx.ExecContext(ctx, `
			INSERT INTO documents (id, workspace_id, title, type, content, author_id, visibility, is_draft, share_token)
			VALUES ($1, $2, $3, 'markdown', $4, $5, $6::document_visibility, $7, $8)
		`, fixture.id, workspaceID, fixture.title, fixture.title, authorID, fixture.visibility, fixture.draft, fixture.token)
		if err != nil {
			t.Fatalf("create %s document: %v", fixture.title, err)
		}
	}
	if _, err := tx.ExecContext(ctx, `UPDATE documents SET project_id = $2 WHERE id = $1`, publicID, privateProjectID); err != nil {
		t.Fatalf("attach public document to private project: %v", err)
	}

	repo := &Repository{db: tx}
	if got, err := repo.GetByShareToken(ctx, "valid-public-token"); err != nil || got.ID != publicID || got.ProjectName != "" {
		t.Fatalf("valid public token got (id=%s, projectName=%q, err=%v), want id %s without project name", got.ID, got.ProjectName, err, publicID)
	}
	for _, token := range []string{"draft-token", "hidden-token"} {
		if _, err := repo.GetByShareToken(ctx, token); err != constant.ErrDocumentNotFound {
			t.Errorf("GetByShareToken(%q) error = %v, want document not found", token, err)
		}
	}
}

func TestCreateRollsBackDocumentWhenOwnerGrantCannotBeStored(t *testing.T) {
	dbURL := integrationDatabaseURL(t)
	db, err := sql.Open("pgx", dbURL)
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	defer db.Close()

	ctx := context.Background()
	authorID := insertAccessTestUser(t, ctx, db)
	workspaceID := uuid.New()
	_, err = db.ExecContext(ctx, `INSERT INTO workspaces (id, name, slug, created_by) VALUES ($1, 'Create Test', $2, $3)`, workspaceID, fmt.Sprintf("create-test-%s", workspaceID), authorID)
	if err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`, workspaceID, authorID); err != nil {
		t.Fatalf("add workspace owner: %v", err)
	}
	t.Cleanup(func() {
		_, _ = db.ExecContext(ctx, "DELETE FROM workspace_members WHERE workspace_id = $1", workspaceID)
		_, _ = db.ExecContext(ctx, "DELETE FROM workspaces WHERE id = $1", workspaceID)
		_, _ = db.ExecContext(ctx, "DELETE FROM users WHERE id = $1", authorID)
	})

	docID := uuid.New()
	_, err = db.ExecContext(ctx, fmt.Sprintf(`
		ALTER TABLE document_accesses ADD CONSTRAINT integration_reject_owner
		CHECK (access_level <> 'owner' OR document_id <> '%s'::uuid) NOT VALID
	`, docID))
	if err != nil {
		t.Fatalf("add owner grant failure constraint: %v", err)
	}
	t.Cleanup(func() {
		_, _ = db.ExecContext(ctx, `ALTER TABLE document_accesses DROP CONSTRAINT IF EXISTS integration_reject_owner`)
	})

	_, err = NewRepository(database.NewSQLDB(db)).Create(ctx, model.Document{
		ID:          docID,
		WorkspaceID: workspaceID,
		Title:       "Atomic create",
		Type:        "markdown",
		Content:     "content",
		AuthorID:    authorID,
		Tags:        []string{},
		Visibility:  "inherit",
	}, nil)
	if err == nil {
		t.Fatal("Create() error = nil, want owner grant failure")
	}

	var count int
	if err := db.QueryRowContext(ctx, "SELECT count(*) FROM documents WHERE id = $1", docID).Scan(&count); err != nil {
		t.Fatalf("check failed document create: %v", err)
	}
	if count != 0 {
		t.Fatalf("failed Create() left %d document rows, want 0", count)
	}
	if _, err := db.ExecContext(ctx, `ALTER TABLE document_accesses DROP CONSTRAINT integration_reject_owner`); err != nil {
		t.Fatalf("remove owner grant failure constraint: %v", err)
	}

	successID := uuid.New()
	if _, err := NewRepository(database.NewSQLDB(db)).Create(ctx, model.Document{
		ID:          successID,
		WorkspaceID: workspaceID,
		Title:       "Create with owner grant",
		Type:        "markdown",
		AuthorID:    authorID,
		Tags:        []string{},
		Visibility:  "inherit",
	}, nil); err != nil {
		t.Fatalf("Create() with owner grant available: %v", err)
	}
	var accessLevel string
	if err := db.QueryRowContext(ctx, `
		SELECT access_level::text FROM document_accesses WHERE document_id = $1 AND user_id = $2
	`, successID, authorID).Scan(&accessLevel); err != nil {
		t.Fatalf("read create owner grant: %v", err)
	}
	if accessLevel != "owner" {
		t.Fatalf("Create() owner grant = %q, want owner", accessLevel)
	}
}

func TestGetTrashedByID(t *testing.T) {
	dbURL := integrationDatabaseURL(t)
	db, err := sql.Open("pgx", dbURL)
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	defer db.Close()

	ctx := context.Background()
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin fixture transaction: %v", err)
	}
	defer tx.Rollback()

	authorID := insertAccessTestUser(t, ctx, tx)
	workspaceID := uuid.New()
	_, err = tx.ExecContext(ctx, `
		INSERT INTO workspaces (id, name, slug, created_by) VALUES ($1, 'Lifecycle Test', $2, $3)
	`, workspaceID, fmt.Sprintf("lifecycle-%s", workspaceID), authorID)
	if err != nil {
		t.Fatalf("create workspace: %v", err)
	}

	trashedID := uuid.New()
	{
		_, err := tx.ExecContext(ctx, `
			INSERT INTO documents (id, workspace_id, title, type, content, author_id, deleted_at)
			VALUES ($1, $2, 'Trashed', 'markdown', '', $3, now())
		`, trashedID, workspaceID, authorID)
		if err != nil {
			t.Fatalf("create trashed document: %v", err)
		}
	}

	repo := &Repository{db: tx}
	trashed, err := repo.GetTrashedByID(ctx, trashedID)
	if err != nil || trashed.WorkspaceID != workspaceID || trashed.DeletedAt == nil {
		t.Fatalf("GetTrashedByID() = (%+v, %v), want trashed document in workspace %s", trashed, err, workspaceID)
	}
}

func TestMoveCannotAssignProjectFromAnotherWorkspace(t *testing.T) {
	dbURL := integrationDatabaseURL(t)
	db, err := sql.Open("pgx", dbURL)
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	defer db.Close()

	ctx := context.Background()
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin fixture transaction: %v", err)
	}
	defer tx.Rollback()
	var constraintValidated bool
	if err := tx.QueryRowContext(ctx, `
		SELECT convalidated FROM pg_constraint WHERE conname = 'documents_project_workspace_fkey'
	`).Scan(&constraintValidated); err != nil {
		t.Fatalf("read project/workspace constraint: %v", err)
	}
	if !constraintValidated {
		t.Fatal("documents_project_workspace_fkey is not validated")
	}

	authorID := insertAccessTestUser(t, ctx, tx)
	workspaceID, otherWorkspaceID := uuid.New(), uuid.New()
	for i, id := range []uuid.UUID{workspaceID, otherWorkspaceID} {
		_, err := tx.ExecContext(ctx, `
			INSERT INTO workspaces (id, name, slug, created_by) VALUES ($1, $2, $3, $4)
		`, id, "Project Constraint Test", fmt.Sprintf("project-constraint-%d-%s", i, id), authorID)
		if err != nil {
			t.Fatalf("create workspace: %v", err)
		}
	}
	projectID := uuid.New()
	_, err = tx.ExecContext(ctx, `
		INSERT INTO projects (id, workspace_id, name, created_by) VALUES ($1, $2, 'Project A', $3)
	`, projectID, workspaceID, authorID)
	if err != nil {
		t.Fatalf("create project: %v", err)
	}
	docID := uuid.New()
	_, err = tx.ExecContext(ctx, `
		INSERT INTO documents (id, workspace_id, title, type, content, author_id)
		VALUES ($1, $2, 'Workspace B document', 'markdown', '', $3)
	`, docID, otherWorkspaceID, authorID)
	if err != nil {
		t.Fatalf("create document: %v", err)
	}

	if _, err := tx.ExecContext(ctx, "SAVEPOINT invalid_move"); err != nil {
		t.Fatalf("savepoint before invalid move: %v", err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE documents SET project_id = $1 WHERE id = $2`, projectID, docID); err == nil {
		t.Fatal("database accepted a project from another workspace")
	}
	if _, err := tx.ExecContext(ctx, "ROLLBACK TO SAVEPOINT invalid_move"); err != nil {
		t.Fatalf("rollback invalid move: %v", err)
	}
	var gotProjectID sql.NullString
	if err := tx.QueryRowContext(ctx, "SELECT project_id FROM documents WHERE id = $1", docID).Scan(&gotProjectID); err != nil {
		t.Fatalf("read document after rejected move: %v", err)
	}
	if gotProjectID.Valid {
		t.Fatalf("Move() changed project to %s after rejection", gotProjectID.String)
	}
}

func integrationDatabaseURL(t *testing.T) string {
	t.Helper()
	dbURL := os.Getenv("TEST_DATABASE_URL")
	if dbURL == "" {
		t.Fatal("TEST_DATABASE_URL is required for integration tests")
	}
	return dbURL
}

func insertAccessTestUser(t *testing.T, ctx context.Context, tx database.Queryer) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	email := fmt.Sprintf("access-test-%s@example.invalid", uuid.NewString())
	err := tx.QueryRowContext(ctx, `
		INSERT INTO users (account_no, email, full_name) VALUES ($1, $2, 'Access Integration Test') RETURNING id
	`, uuid.NewString(), email).Scan(&id)
	if err != nil {
		t.Fatalf("create test user: %v", err)
	}
	return id
}
