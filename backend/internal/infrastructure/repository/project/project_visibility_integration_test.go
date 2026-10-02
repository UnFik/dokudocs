//go:build integration

package project

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"testing"

	"backend/constant"
	"backend/internal/domain/model"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestPrivateProjectsAreVisibleOnlyToMembersAndWorkspaceAdmins(t *testing.T) {
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
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin fixture transaction: %v", err)
	}
	defer tx.Rollback()

	ownerID := insertProjectVisibilityUser(t, ctx, tx)
	memberID := insertProjectVisibilityUser(t, ctx, tx)
	editorID := insertProjectVisibilityUser(t, ctx, tx)
	nonmemberID := insertProjectVisibilityUser(t, ctx, tx)
	workspaceID := uuid.New()
	_, err = tx.ExecContext(ctx, `
		INSERT INTO workspaces (id, name, slug, created_by)
		VALUES ($1, 'Project Visibility Test', $2, $3)
	`, workspaceID, fmt.Sprintf("project-visibility-%s", workspaceID), ownerID)
	if err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO workspace_members (workspace_id, user_id, role) VALUES
		($1, $2, 'owner'), ($1, $3, 'member'), ($1, $4, 'member')
	`, workspaceID, ownerID, memberID, editorID)
	if err != nil {
		t.Fatalf("create workspace members: %v", err)
	}

	privateMemberID, privateHiddenID, workspaceProjectID := uuid.New(), uuid.New(), uuid.New()
	for _, project := range []struct {
		id         uuid.UUID
		name       string
		visibility string
	}{
		{privateMemberID, "Private member", "private"},
		{privateHiddenID, "Private hidden", "private"},
		{workspaceProjectID, "Workspace visible", "workspace"},
	} {
		_, err = tx.ExecContext(ctx, `
			INSERT INTO projects (id, workspace_id, name, visibility, created_by)
			VALUES ($1, $2, $3, $4::project_visibility, $5)
		`, project.id, workspaceID, project.name, project.visibility, ownerID)
		if err != nil {
			t.Fatalf("create project %q: %v", project.name, err)
		}
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'viewer')
	`, privateMemberID, memberID)
	if err != nil {
		t.Fatalf("add project viewer: %v", err)
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'editor')
	`, privateMemberID, editorID)
	if err != nil {
		t.Fatalf("add project editor: %v", err)
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO project_categories (project_id, name) VALUES ($1, 'Private category')
	`, privateMemberID); err != nil {
		t.Fatalf("add private project category: %v", err)
	}
	if err := lockManagedProject(ctx, tx, privateMemberID, workspaceID, memberID); !errors.Is(err, constant.ErrForbidden) {
		t.Fatalf("lockManagedProject() for viewer = %v, want forbidden", err)
	}
	if err := lockEditableProject(ctx, tx, privateMemberID, workspaceID, editorID); err != nil {
		t.Fatalf("lockEditableProject() for editor: %v", err)
	}
	if err := lockManagedProject(ctx, tx, privateMemberID, workspaceID, editorID); !errors.Is(err, constant.ErrForbidden) {
		t.Fatalf("lockManagedProject() for editor = %v, want forbidden", err)
	}
	if err := lockManagedProject(ctx, tx, privateMemberID, workspaceID, ownerID); err != nil {
		t.Fatalf("lockManagedProject() for workspace owner: %v", err)
	}
	if err := lockReadableProject(ctx, tx, privateMemberID, workspaceID, memberID); err != nil {
		t.Fatalf("lockReadableProject() for private project member: %v", err)
	}
	if err := lockReadableProject(ctx, tx, privateMemberID, workspaceID, nonmemberID); !errors.Is(err, constant.ErrForbidden) {
		t.Fatalf("lockReadableProject() for workspace nonmember = %v, want forbidden", err)
	}
	if err := lockReadableProject(ctx, tx, workspaceProjectID, workspaceID, memberID); err != nil {
		t.Fatalf("lockReadableProject() for workspace project: %v", err)
	}
	for _, doc := range []struct {
		projectID  uuid.UUID
		title      string
		visibility string
	}{
		{privateMemberID, "Inherited project doc", "inherit"},
		{privateMemberID, "Hidden private doc", "private"},
		{workspaceProjectID, "Workspace doc", "workspace"},
		{workspaceProjectID, "Hidden workspace-project doc", "private"},
	} {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO documents (workspace_id, project_id, title, type, content, author_id, visibility)
			VALUES ($1, $2, $3, 'markdown', '', $4, $5::document_visibility)
		`, workspaceID, doc.projectID, doc.title, ownerID, doc.visibility); err != nil {
			t.Fatalf("create %s: %v", doc.title, err)
		}
	}

	repo := &Repository{db: tx}
	createRepo := &Repository{db: tx, tx: projectFixtureDB{Queryer: tx}}
	if _, err := createRepo.Create(ctx, model.Project{
		WorkspaceID: workspaceID,
		Name:        "Nonmember project",
		Visibility:  "workspace",
		CreatedBy:   nonmemberID,
	}, []string{"General"}); !errors.Is(err, constant.ErrForbidden) {
		t.Fatalf("Create() for workspace nonmember = %v, want forbidden", err)
	}
	if _, err := repo.GetByID(ctx, privateMemberID, memberID); err != nil {
		t.Fatalf("GetByID() for private project member: %v", err)
	}
	if _, err := repo.GetByID(ctx, privateHiddenID, memberID); !errors.Is(err, constant.ErrProjectNotFound) {
		t.Fatalf("GetByID() for nonmember = %v, want project not found", err)
	}
	if _, err := repo.GetByID(ctx, privateHiddenID, ownerID); err != nil {
		t.Fatalf("GetByID() for workspace owner: %v", err)
	}
	if _, err := repo.GetByID(ctx, workspaceProjectID, nonmemberID); !errors.Is(err, constant.ErrProjectNotFound) {
		t.Fatalf("GetByID() for workspace nonmember = %v, want project not found", err)
	}
	memberWorkspaceProject, err := repo.GetByID(ctx, workspaceProjectID, memberID)
	if err != nil {
		t.Fatalf("GetByID() for workspace project member: %v", err)
	}
	if memberWorkspaceProject.DocumentCount != 1 {
		t.Fatalf("member document count = %d, want 1 readable document", memberWorkspaceProject.DocumentCount)
	}
	ownerWorkspaceProject, err := repo.GetByID(ctx, workspaceProjectID, ownerID)
	if err != nil {
		t.Fatalf("GetByID() for workspace owner: %v", err)
	}
	if ownerWorkspaceProject.DocumentCount != 2 {
		t.Fatalf("owner document count = %d, want 2 readable documents", ownerWorkspaceProject.DocumentCount)
	}

	projects, err := repo.ListByWorkspace(ctx, workspaceID, memberID)
	if err != nil {
		t.Fatalf("ListByWorkspace(): %v", err)
	}
	visible := map[uuid.UUID]model.Project{}
	for _, project := range projects {
		visible[project.ID] = project
	}
	if _, ok := visible[privateMemberID]; !ok {
		t.Fatal("ListByWorkspace() omitted private project member")
	}
	if _, ok := visible[workspaceProjectID]; !ok {
		t.Fatal("ListByWorkspace() omitted workspace-visible project")
	}
	if _, ok := visible[privateHiddenID]; ok {
		t.Fatalf("ListByWorkspace() visibility = %v, want private member + workspace project only", visible)
	}
	if visible[privateMemberID].DocumentCount != 1 || visible[workspaceProjectID].DocumentCount != 1 {
		t.Fatalf("ListByWorkspace() document counts = (%d, %d), want 1 readable document per project", visible[privateMemberID].DocumentCount, visible[workspaceProjectID].DocumentCount)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM project_members WHERE project_id = $1 AND user_id = $2`, privateMemberID, memberID); err != nil {
		t.Fatalf("revoke private project membership: %v", err)
	}
	categories, err := repo.ListCategories(ctx, privateMemberID, workspaceID, memberID)
	if err != nil || len(categories) != 0 {
		t.Errorf("ListCategories() after project access revoke = (%+v, %v), want no private metadata", categories, err)
	}
	categoriesByProject, err := repo.fetchCategoriesForProjects(ctx, []uuid.UUID{privateMemberID}, workspaceID, memberID)
	if err != nil || len(categoriesByProject[privateMemberID]) != 0 {
		t.Errorf("fetchCategoriesForProjects() after project access revoke = (%+v, %v), want no private metadata", categoriesByProject, err)
	}
	members, err := repo.ListMembers(ctx, privateMemberID, workspaceID, memberID)
	if err != nil || len(members) != 0 {
		t.Errorf("ListMembers() after project access revoke = (%+v, %v), want no private roster", members, err)
	}
}

type projectFixtureDB struct{ database.Queryer }

func (db projectFixtureDB) WithTransaction(_ context.Context, fn func(database.Queryer) error) error {
	return fn(db.Queryer)
}

func (projectFixtureDB) Raw() *sql.DB { return nil }

func (projectFixtureDB) Close() error { return nil }

func insertProjectVisibilityUser(t *testing.T, ctx context.Context, db *sql.Tx) uuid.UUID {
	t.Helper()
	var userID uuid.UUID
	err := db.QueryRowContext(ctx, `
		INSERT INTO users (account_no, email, full_name) VALUES ($1, $2, 'Project Visibility Test') RETURNING id
	`, uuid.NewString(), fmt.Sprintf("project-visibility-%s@example.invalid", uuid.NewString())).Scan(&userID)
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	return userID
}
