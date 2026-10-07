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

func TestBacklinksListOnlyPagesTheReaderMaySee(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Fatal("TEST_DATABASE_URL is required for integration tests")
	}
	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	ctx := context.Background()
	authorID, readerID, otherID := uuid.New(), uuid.New(), uuid.New()
	workspaceID := uuid.New()
	target, open, hidden, trashed := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	for _, id := range []uuid.UUID{authorID, readerID, otherID} {
		if _, err := db.ExecContext(ctx, `INSERT INTO users (id, account_no, email, full_name) VALUES ($1, $2, $3, 'Backlink user')`, id, uuid.NewString(), fmt.Sprintf("back-%s@example.invalid", id)); err != nil {
			t.Fatalf("create user: %v", err)
		}
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO workspaces (id, name, slug, created_by) VALUES ($1, 'Backlinks', $2, $3)`, workspaceID, "back-"+workspaceID.String(), authorID); err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	for _, id := range []uuid.UUID{authorID, readerID, otherID} {
		if _, err := db.ExecContext(ctx, `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'member')`, workspaceID, id); err != nil {
			t.Fatalf("add member: %v", err)
		}
	}
	mention := fmt.Sprintf(`{"type":"doc","content":[{"type":"mention","attrs":{"bodyAttributes":"{\"kind\":\"document\",\"id\":\"%s\",\"label\":\"Target\"}"}}]}`, target)
	insert := func(id uuid.UUID, title, visibility string, author uuid.UUID, content string, deleted bool) {
		t.Helper()
		var deletedAt any
		if deleted {
			deletedAt = time.Now()
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO documents (id, workspace_id, title, type, author_id, visibility, content_json, deleted_at) VALUES ($1, $2, $3, 'markdown', $4, $5, $6::jsonb, $7)`, id, workspaceID, title, author, visibility, content, deletedAt); err != nil {
			t.Fatalf("create document %s: %v", title, err)
		}
	}
	insert(target, "Target", "workspace", authorID, `{}`, false)
	insert(open, "Mentions target", "workspace", authorID, mention, false)
	insert(hidden, "Private mention", "private", otherID, mention, false)
	insert(trashed, "Trashed mention", "workspace", authorID, mention, true)
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(), `DELETE FROM workspaces WHERE id = $1`, workspaceID)
		for _, id := range []uuid.UUID{authorID, readerID, otherID} {
			_, _ = db.ExecContext(context.Background(), `DELETE FROM users WHERE id = $1`, id)
		}
		_ = db.Close()
	})

	app := container.New(database.NewSQLDB(db), logger.New(), validator.New())
	api := InitRoutes(app, config.Config{JWTSecret: "back-secret", AccessTokenTTL: time.Hour, AssetDir: t.TempDir()})
	issued, err := jwtmanager.NewManager("back-secret", time.Hour).Issue(model.AuthUser{ID: readerID, AccountNo: "a", Email: "reader@example.invalid", Roles: []string{"member"}})
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/documents/"+target.String()+"/backlinks", nil)
	req.Header.Set("Authorization", "Bearer "+issued.AccessToken)
	req.Header.Set("X-Workspace-Id", workspaceID.String())
	rec := httptest.NewRecorder()
	api.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("backlinks = %d %s", rec.Code, rec.Body.String())
	}
	var body struct {
		Data []struct {
			ID    string `json:"id"`
			Title string `json:"title"`
		} `json:"data"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if len(body.Data) != 1 || body.Data[0].ID != open.String() || body.Data[0].Title != "Mentions target" {
		t.Fatalf("backlinks = %+v, want only the page the reader may see", body.Data)
	}
}
