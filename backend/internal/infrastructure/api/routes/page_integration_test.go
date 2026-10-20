//go:build integration

package routes

import (
	"bytes"
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

// An HTML document is opened in two steps: the application asks for a ticket as
// the signed-in viewer, and the frame fetches the page from the content origin
// with the token in the address (ADR 0052).
func TestHTMLPageIsServedFromTheContentOriginToWhoeverCanStillRead(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Fatal("TEST_DATABASE_URL is required for integration tests")
	}
	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	ctx := context.Background()
	ownerID, viewerID, strangerID := uuid.New(), uuid.New(), uuid.New()
	workspaceID, documentID, markdownID := uuid.New(), uuid.New(), uuid.New()
	for _, id := range []uuid.UUID{ownerID, viewerID, strangerID} {
		if _, err := db.ExecContext(ctx, `INSERT INTO users (id, account_no, email, full_name) VALUES ($1, $2, $3, 'Page test user')`, id, uuid.NewString(), fmt.Sprintf("page-%s@example.invalid", id)); err != nil {
			t.Fatalf("create user: %v", err)
		}
	}
	mustExec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.ExecContext(ctx, query, args...); err != nil {
			t.Fatalf("seed %q: %v", query, err)
		}
	}
	mustExec(`INSERT INTO workspaces (id, name, slug, created_by) VALUES ($1, 'Page test', $2, $3)`, workspaceID, "page-"+workspaceID.String(), ownerID)
	for _, id := range []uuid.UUID{ownerID, viewerID} {
		mustExec(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'member')`, workspaceID, id)
	}
	const page = `<!doctype html><html><head><meta name="dokudocs-capabilities" content="theme"><title>T</title></head><body><p>hello page</p><script>alert(1)</script></body></html>`
	mustExec(`INSERT INTO documents (id, workspace_id, title, type, content, author_id, visibility) VALUES ($1, $2, 'A page', 'html', $3, $4, 'private')`, documentID, workspaceID, page, ownerID)
	mustExec(`INSERT INTO documents (id, workspace_id, title, type, content, author_id, visibility) VALUES ($1, $2, 'Notes', 'markdown', 'x', $3, 'private')`, markdownID, workspaceID, ownerID)
	for id, level := range map[uuid.UUID]string{ownerID: "owner", viewerID: "view"} {
		mustExec(`INSERT INTO document_accesses (document_id, user_id, access_level) VALUES ($1, $2, $3::document_access_level)`, documentID, id, level)
		mustExec(`INSERT INTO document_accesses (document_id, user_id, access_level) VALUES ($1, $2, $3::document_access_level)`, markdownID, id, level)
	}
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(), `DELETE FROM workspaces WHERE id = $1`, workspaceID)
		for _, id := range []uuid.UUID{ownerID, viewerID, strangerID} {
			_, _ = db.ExecContext(context.Background(), `DELETE FROM users WHERE id = $1`, id)
		}
		_ = db.Close()
	})

	app := container.New(database.NewSQLDB(db), logger.New(), validator.New())
	api := InitRoutes(app, config.Config{
		JWTSecret: "page-test-secret", AccessTokenTTL: time.Hour, AssetDir: t.TempDir(), MaxUploadBytes: 1 << 20,
		PublicAppURL: "https://app.example.test", ContentOrigin: "https://usercontent.example.test",
	})
	token := func(id uuid.UUID) string {
		user, err := jwtmanager.NewManager("page-test-secret", time.Hour).Issue(model.AuthUser{ID: id, AccountNo: "a-" + id.String(), Email: fmt.Sprintf("page-%s@example.invalid", id), Roles: []string{"member"}})
		if err != nil {
			t.Fatalf("issue token: %v", err)
		}
		return user.AccessToken
	}
	ticket := func(as, doc uuid.UUID) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/documents/"+doc.String()+"/page", &bytes.Buffer{})
		req.Host = "app.example.test"
		req.Header.Set("Authorization", "Bearer "+token(as))
		req.Header.Set("X-Workspace-Id", workspaceID.String())
		rec := httptest.NewRecorder()
		api.ServeHTTP(rec, req)
		return rec
	}
	fetch := func(host, path string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.Host = host
		rec := httptest.NewRecorder()
		api.ServeHTTP(rec, req)
		return rec
	}
	type issued struct {
		Data struct {
			URL          string   `json:"url"`
			Capabilities []string `json:"capabilities"`
		} `json:"data"`
	}

	// A viewer gets a ticket whose address is on the content origin.
	rec := ticket(viewerID, documentID)
	var got issued
	_ = json.Unmarshal(rec.Body.Bytes(), &got)
	if rec.Code != http.StatusOK || !strings.HasPrefix(got.Data.URL, "https://usercontent.example.test/content/p/") || strings.Join(got.Data.Capabilities, ",") != "theme" {
		t.Fatalf("ticket = %d %s, want an address on the content origin and the theme capability", rec.Code, rec.Body.String())
	}
	path := strings.TrimPrefix(got.Data.URL, "https://usercontent.example.test")

	// The page comes from the content host with the headers that confine it.
	served := fetch("usercontent.example.test", path)
	csp := served.Header().Get("Content-Security-Policy")
	if served.Code != http.StatusOK || !strings.Contains(served.Body.String(), "hello page") || !strings.Contains(served.Body.String(), "window.parent.postMessage") ||
		!strings.HasPrefix(csp, "sandbox allow-scripts;") || strings.Contains(csp, "allow-same-origin") || served.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("page = %d csp=%q body=%.120s", served.Code, csp, served.Body.String())
	}

	// The page route answers on the content host only, and the content host answers nothing else.
	if code := fetch("app.example.test", path).Code; code != http.StatusNotFound {
		t.Fatalf("page on the application host = %d, want 404", code)
	}
	if code := fetch("usercontent.example.test", "/api/v1/health").Code; code != http.StatusNotFound {
		t.Fatalf("api on the content host = %d, want 404", code)
	}

	// Someone who cannot read the page gets no ticket, and neither does a markdown document.
	if code := ticket(strangerID, documentID).Code; code == http.StatusOK {
		t.Fatalf("stranger ticket = %d, want it refused", code)
	}
	if code := ticket(viewerID, markdownID).Code; code != http.StatusBadRequest {
		t.Fatalf("ticket for a markdown document = %d, want 400", code)
	}
	if code := fetch("usercontent.example.test", "/content/p/forged.token").Code; code != http.StatusUnauthorized {
		t.Fatalf("forged token = %d, want 401", code)
	}

	// Access taken away after the ticket was issued: the frame can no longer load the page.
	mustExec(`DELETE FROM document_accesses WHERE document_id = $1 AND user_id = $2`, documentID, viewerID)
	mustExec(`UPDATE documents SET visibility = 'private' WHERE id = $1`, documentID)
	if code := fetch("usercontent.example.test", path).Code; code == http.StatusOK {
		t.Fatalf("page after access was removed = %d, want it refused", code)
	}

	// A trashed page is gone too.
	again := ticket(ownerID, documentID)
	_ = json.Unmarshal(again.Body.Bytes(), &got)
	path = strings.TrimPrefix(got.Data.URL, "https://usercontent.example.test")
	mustExec(`UPDATE documents SET deleted_at = NOW() WHERE id = $1`, documentID)
	if code := fetch("usercontent.example.test", path).Code; code != http.StatusNotFound {
		t.Fatalf("trashed page = %d, want 404", code)
	}
}
