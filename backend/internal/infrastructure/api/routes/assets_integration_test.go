//go:build integration

package routes

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"mime/multipart"
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

// A 1x1 PNG.
var pngBytes = []byte{
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
	0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
	0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
	0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
	0x42, 0x60, 0x82,
}

func TestAssetsHTTPUploadReadSharingAndSweep(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Fatal("TEST_DATABASE_URL is required for integration tests")
	}
	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	ctx := context.Background()
	editorID, viewerID, strangerID := uuid.New(), uuid.New(), uuid.New()
	workspaceID, documentID := uuid.New(), uuid.New()
	for _, id := range []uuid.UUID{editorID, viewerID, strangerID} {
		if _, err := db.ExecContext(ctx, `INSERT INTO users (id, account_no, email, full_name) VALUES ($1, $2, $3, 'Asset test user')`, id, uuid.NewString(), fmt.Sprintf("asset-%s@example.invalid", id)); err != nil {
			t.Fatalf("create user: %v", err)
		}
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO workspaces (id, name, slug, created_by) VALUES ($1, 'Asset test', $2, $3)`, workspaceID, "asset-"+workspaceID.String(), editorID); err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	for _, id := range []uuid.UUID{editorID, viewerID} {
		if _, err := db.ExecContext(ctx, `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'member')`, workspaceID, id); err != nil {
			t.Fatalf("add member: %v", err)
		}
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO documents (id, workspace_id, title, type, author_id, visibility, share_token) VALUES ($1, $2, 'Assets', 'markdown', $3, 'private', 'asset-public-token')`, documentID, workspaceID, editorID); err != nil {
		t.Fatalf("create document: %v", err)
	}
	for id, level := range map[uuid.UUID]string{editorID: "owner", viewerID: "view"} {
		if _, err := db.ExecContext(ctx, `INSERT INTO document_accesses (document_id, user_id, access_level) VALUES ($1, $2, $3::document_access_level)`, documentID, id, level); err != nil {
			t.Fatalf("grant access: %v", err)
		}
	}
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(), `DELETE FROM workspaces WHERE id = $1`, workspaceID)
		for _, id := range []uuid.UUID{editorID, viewerID, strangerID} {
			_, _ = db.ExecContext(context.Background(), `DELETE FROM users WHERE id = $1`, id)
		}
		_ = db.Close()
	})

	assetDir := t.TempDir()
	app := container.New(database.NewSQLDB(db), logger.New(), validator.New())
	api := InitRoutes(app, config.Config{JWTSecret: "asset-test-secret", AccessTokenTTL: time.Hour, AssetDir: assetDir, MaxUploadBytes: 1 << 20})
	token := func(id uuid.UUID) string {
		user, err := jwtmanager.NewManager("asset-test-secret", time.Hour).Issue(model.AuthUser{ID: id, AccountNo: "a-" + id.String(), Email: fmt.Sprintf("asset-%s@example.invalid", id), Roles: []string{"member"}})
		if err != nil {
			t.Fatalf("issue token: %v", err)
		}
		return user.AccessToken
	}
	call := func(method, path string, body *bytes.Buffer, contentType string, as uuid.UUID, workspace bool) *httptest.ResponseRecorder {
		t.Helper()
		if body == nil {
			body = &bytes.Buffer{}
		}
		req := httptest.NewRequest(method, path, body)
		if as != uuid.Nil {
			req.Header.Set("Authorization", "Bearer "+token(as))
		}
		if workspace {
			req.Header.Set("X-Workspace-Id", workspaceID.String())
		}
		if contentType != "" {
			req.Header.Set("Content-Type", contentType)
		}
		rec := httptest.NewRecorder()
		api.ServeHTTP(rec, req)
		return rec
	}
	upload := func(as uuid.UUID, name string, content []byte) *httptest.ResponseRecorder {
		var form bytes.Buffer
		writer := multipart.NewWriter(&form)
		part, _ := writer.CreateFormFile("file", name)
		_, _ = part.Write(content)
		_ = writer.Close()
		return call(http.MethodPost, "/api/v1/documents/"+documentID.String()+"/assets", &form, writer.FormDataContentType(), as, true)
	}
	type uploaded struct {
		Data struct {
			ID          string `json:"id"`
			URL         string `json:"url"`
			ContentType string `json:"contentType"`
			FileName    string `json:"fileName"`
			Inline      bool   `json:"inline"`
		} `json:"data"`
	}

	// An editor uploads an image; the type comes from its bytes.
	created := upload(editorID, "pixel.png", pngBytes)
	if created.Code != http.StatusCreated {
		t.Fatalf("upload = %d %s, want 201", created.Code, created.Body.String())
	}
	var asset uploaded
	_ = json.Unmarshal(created.Body.Bytes(), &asset)
	if asset.Data.ContentType != "image/png" || !asset.Data.Inline || asset.Data.URL != "/api/v1/documents/"+documentID.String()+"/assets/"+asset.Data.ID {
		t.Fatalf("uploaded = %+v, want an inline png with its url", asset.Data)
	}

	// Someone who can only view may not upload; a stranger may not read.
	if got := upload(viewerID, "pixel.png", pngBytes).Code; got != http.StatusForbidden {
		t.Fatalf("viewer upload = %d, want 403", got)
	}
	read := call(http.MethodGet, asset.Data.URL, nil, "", editorID, true)
	if read.Code != http.StatusOK || !bytes.Equal(read.Body.Bytes(), pngBytes) || read.Header().Get("Content-Type") != "image/png" || read.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("editor read = %d %q nosniff=%q, want the png", read.Code, read.Header().Get("Content-Type"), read.Header().Get("X-Content-Type-Options"))
	}
	if got := call(http.MethodGet, asset.Data.URL, nil, "", viewerID, true).Code; got != http.StatusOK {
		t.Fatalf("viewer read = %d, want 200", got)
	}
	if got := call(http.MethodGet, asset.Data.URL, nil, "", strangerID, true).Code; got == http.StatusOK {
		t.Fatalf("stranger read = %d, want it refused", got)
	}

	// The page's public link serves its assets only when the page is shared.
	publicPath := "/api/v1/public/documents/asset-public-token/assets/" + asset.Data.ID
	if got := call(http.MethodGet, publicPath, nil, "", uuid.Nil, false).Code; got != http.StatusNotFound {
		t.Fatalf("public read of a private page = %d, want 404", got)
	}
	if _, err := db.ExecContext(ctx, `UPDATE documents SET visibility = 'public_link', is_draft = FALSE WHERE id = $1`, documentID); err != nil {
		t.Fatalf("share the document: %v", err)
	}
	if got := call(http.MethodGet, publicPath, nil, "", uuid.Nil, false).Code; got != http.StatusOK {
		t.Fatalf("public read of a shared page = %d, want 200", got)
	}

	// A file that is not media is a download, whatever its name says.
	script := upload(editorID, "evil.html", []byte("<script>alert(1)</script>"))
	var file uploaded
	_ = json.Unmarshal(script.Body.Bytes(), &file)
	download := call(http.MethodGet, file.Data.URL, nil, "", editorID, true)
	if file.Data.Inline || download.Header().Get("Content-Type") != "application/octet-stream" || download.Header().Get("Content-Disposition") == "" {
		t.Fatalf("html upload inline=%v type=%q disposition=%q, want an octet-stream download", file.Data.Inline, download.Header().Get("Content-Type"), download.Header().Get("Content-Disposition"))
	}

	// Too large is refused.
	if got := upload(editorID, "big.bin", make([]byte, 2<<20)).Code; got != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversize upload = %d, want 413", got)
	}

	// The sweep keeps what the page refers to, and removes the rest once it is old enough.
	if _, err := db.ExecContext(ctx, `UPDATE documents SET content_json = $2::jsonb WHERE id = $1`, documentID, fmt.Sprintf(`{"type":"doc","content":[{"type":"image","attrs":{"bodyAttributes":"{\"src\":\"%s\"}"}}]}`, asset.Data.URL)); err != nil {
		t.Fatalf("reference the asset: %v", err)
	}
	if _, err := db.ExecContext(ctx, `UPDATE document_assets SET created_at = NOW() - interval '3 days' WHERE document_id = $1`, documentID); err != nil {
		t.Fatalf("age the assets: %v", err)
	}
	removed, err := SweepAssets(ctx, app, config.Config{AssetDir: assetDir}, 24*time.Hour)
	if err != nil {
		t.Fatalf("sweep: %v", err)
	}
	var left int
	_ = db.QueryRowContext(ctx, `SELECT count(*) FROM document_assets WHERE document_id = $1`, documentID).Scan(&left)
	if removed != 1 || left != 1 {
		t.Fatalf("sweep removed %d and left %d, want it to remove the unreferenced html file and keep the image", removed, left)
	}
}
