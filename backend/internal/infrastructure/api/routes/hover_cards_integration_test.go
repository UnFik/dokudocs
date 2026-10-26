//go:build integration

package routes

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	jwtmanager "backend/internal/application/jwt"
	"backend/internal/config"
	"backend/internal/domain/model"
	"backend/internal/infrastructure/database"
	"backend/internal/infrastructure/logger"
	"backend/internal/infrastructure/runtime/container"
	"backend/internal/infrastructure/validator"

	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"
)

// hoverCardWorld is a workspace with an author and a reader, and an outsider who is in no workspace.
type hoverCardWorld struct {
	api         http.Handler
	db          *sql.DB
	workspaceID uuid.UUID
	authorID    uuid.UUID
	readerID    uuid.UUID
	outsiderID  uuid.UUID
}

func newHoverCardWorld(t *testing.T) *hoverCardWorld {
	t.Helper()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Fatal("TEST_DATABASE_URL is required for integration tests")
	}
	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	ctx := context.Background()
	world := &hoverCardWorld{
		db: db, workspaceID: uuid.New(),
		authorID: uuid.New(), readerID: uuid.New(), outsiderID: uuid.New(),
	}
	people := map[uuid.UUID]string{world.authorID: "Rina Putri", world.readerID: "Dewi Lestari", world.outsiderID: "Outsider"}
	for id, name := range people {
		if _, err := db.ExecContext(ctx, `INSERT INTO users (id, account_no, email, full_name, bio, phone_number) VALUES ($1, $2, $3, $4, $5, '+620000')`,
			id, uuid.NewString(), fmt.Sprintf("hover-%s@example.invalid", id), name, "Bio of "+name); err != nil {
			t.Fatalf("create user: %v", err)
		}
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO workspaces (id, name, slug, created_by) VALUES ($1, 'Hover cards', $2, $3)`, world.workspaceID, "hover-"+world.workspaceID.String(), world.authorID); err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	for id, role := range map[uuid.UUID]string{world.authorID: "owner", world.readerID: "member"} {
		if _, err := db.ExecContext(ctx, `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)`, world.workspaceID, id, role); err != nil {
			t.Fatalf("add member: %v", err)
		}
	}
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(), `DELETE FROM workspaces WHERE id = $1`, world.workspaceID)
		for id := range people {
			_, _ = db.ExecContext(context.Background(), `DELETE FROM users WHERE id = $1`, id)
		}
		_ = db.Close()
	})
	app := container.New(database.NewSQLDB(db), logger.New(), validator.New())
	world.api = InitRoutes(app, config.Config{JWTSecret: "hover-secret", AccessTokenTTL: time.Hour, AssetDir: t.TempDir()})
	return world
}

func (w *hoverCardWorld) get(t *testing.T, as uuid.UUID, path string) *httptest.ResponseRecorder {
	t.Helper()
	issued, err := jwtmanager.NewManager("hover-secret", time.Hour).Issue(model.AuthUser{ID: as, AccountNo: "a", Email: "hover@example.invalid", Roles: []string{"member"}})
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}
	req := httptest.NewRequest(http.MethodGet, path, nil)
	req.Header.Set("Authorization", "Bearer "+issued.AccessToken)
	req.Header.Set("X-Workspace-Id", w.workspaceID.String())
	rec := httptest.NewRecorder()
	w.api.ServeHTTP(rec, req)
	return rec
}

func (w *hoverCardWorld) document(t *testing.T, docType, title, visibility, content, thumbnail string) uuid.UUID {
	t.Helper()
	id := uuid.New()
	if _, err := w.db.ExecContext(context.Background(),
		`INSERT INTO documents (id, workspace_id, title, type, author_id, visibility, content, thumbnail) VALUES ($1, $2, $3, $4, $5, $6, $7, NULLIF($8, ''))`,
		id, w.workspaceID, title, docType, w.authorID, visibility, content, thumbnail); err != nil {
		t.Fatalf("create document %s: %v", title, err)
	}
	return id
}

func TestDocumentPreviewShowsATitleAnExcerptAndTheThumbnail(t *testing.T) {
	world := newHoverCardWorld(t)
	body := "# Launch plan\n\nShip the **new** editor with [mentions](/docs/x) and `code`.\n\n" + strings.Repeat("More words. ", 100)
	page := world.document(t, "markdown", "Launch plan", "workspace", body, "")
	diagram := world.document(t, "mermaid", "Flow", "workspace", "graph TD; A-->B", "<svg><rect/></svg>")

	rec := world.get(t, world.readerID, "/api/v1/documents/"+page.String()+"/preview")
	if rec.Code != http.StatusOK {
		t.Fatalf("preview = %d %s", rec.Code, rec.Body.String())
	}
	var markdown struct {
		Data struct {
			ID        string                `json:"id"`
			Title     string                `json:"title"`
			Type      string                `json:"type"`
			Excerpt   string                `json:"excerpt"`
			Content   string                `json:"content"`
			Author    struct{ Name string } `json:"author"`
			UpdatedAt string                `json:"updatedAt"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &markdown); err != nil {
		t.Fatalf("decode preview: %v", err)
	}
	got := markdown.Data
	if got.ID != page.String() || got.Title != "Launch plan" || got.Type != "markdown" || got.Author.Name != "Rina Putri" || got.UpdatedAt == "" {
		t.Errorf("preview = %+v", got)
	}
	if !strings.HasPrefix(got.Excerpt, "Launch plan Ship the new editor with mentions and code.") {
		t.Errorf("excerpt = %q, want the text without Markdown marks", got.Excerpt)
	}
	if n := len([]rune(got.Excerpt)); n > 301 {
		t.Errorf("excerpt has %d characters, want at most about 300", n)
	}
	if got.Content != "" {
		t.Error("preview carries the whole body")
	}

	rec = world.get(t, world.readerID, "/api/v1/documents/"+diagram.String()+"/preview")
	var drawn struct {
		Data struct {
			Thumbnail string `json:"thumbnail"`
			Excerpt   string `json:"excerpt"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &drawn); err != nil {
		t.Fatalf("decode diagram preview: %v", err)
	}
	if drawn.Data.Thumbnail != "<svg><rect/></svg>" {
		t.Errorf("diagram thumbnail = %q", drawn.Data.Thumbnail)
	}
}

func TestMemberProfileShowsWhoSomeoneIsToTheirWorkspace(t *testing.T) {
	world := newHoverCardWorld(t)
	base := "/api/v1/workspaces/" + world.workspaceID.String() + "/members/"

	rec := world.get(t, world.readerID, base+world.authorID.String()+"/profile")
	if rec.Code != http.StatusOK {
		t.Fatalf("profile = %d %s", rec.Code, rec.Body.String())
	}
	var body struct {
		Data map[string]any `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode profile: %v", err)
	}
	want := map[string]any{
		"userId":   world.authorID.String(),
		"fullName": "Rina Putri",
		"email":    fmt.Sprintf("hover-%s@example.invalid", world.authorID),
		"bio":      "Bio of Rina Putri",
		"role":     "owner",
	}
	for key, value := range want {
		if body.Data[key] != value {
			t.Errorf("profile %s = %v, want %v", key, body.Data[key], value)
		}
	}
	if body.Data["joinedAt"] == nil {
		t.Error("profile has no joinedAt")
	}
	if _, leaked := body.Data["phoneNumber"]; leaked {
		t.Error("profile carries the phone number")
	}
}

func TestMemberProfileIsForMembersOfTheSameWorkspaceOnly(t *testing.T) {
	world := newHoverCardWorld(t)
	base := "/api/v1/workspaces/" + world.workspaceID.String() + "/members/"

	if rec := world.get(t, world.outsiderID, base+world.authorID.String()+"/profile"); rec.Code != http.StatusForbidden {
		t.Errorf("profile for someone outside the workspace = %d, want 403", rec.Code)
	}
	if rec := world.get(t, world.readerID, base+world.outsiderID.String()+"/profile"); rec.Code != http.StatusNotFound {
		t.Errorf("profile of someone who is not a member = %d, want 404", rec.Code)
	}
}

func TestDocumentPreviewKeepsHiddenPagesHidden(t *testing.T) {
	world := newHoverCardWorld(t)
	private := world.document(t, "markdown", "Secret", "private", "only the author", "")
	open := world.document(t, "markdown", "Open", "workspace", "everyone", "")

	if rec := world.get(t, world.readerID, "/api/v1/documents/"+private.String()+"/preview"); rec.Code != http.StatusNotFound {
		t.Errorf("private page preview for another member = %d, want 404", rec.Code)
	}
	if rec := world.get(t, world.outsiderID, "/api/v1/documents/"+open.String()+"/preview"); rec.Code == http.StatusOK {
		t.Errorf("preview for someone outside the workspace = %d, want a refusal", rec.Code)
	}
	if rec := world.get(t, world.readerID, "/api/v1/documents/"+uuid.NewString()+"/preview"); rec.Code != http.StatusNotFound {
		t.Errorf("preview of a page that does not exist = %d, want 404", rec.Code)
	}
}
