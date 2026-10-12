//go:build integration

package routes

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	jwtmanager "backend/internal/application/jwt"
	"backend/internal/config"
	"backend/internal/domain/model"
	"backend/internal/infrastructure/database"
	"backend/internal/infrastructure/logger"
	documentrepo "backend/internal/infrastructure/repository/document"
	"backend/internal/infrastructure/runtime/container"
	"backend/internal/infrastructure/validator"

	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"
)

type searchHit struct {
	ID        uuid.UUID `json:"id"`
	Title     string    `json:"title"`
	Type      string    `json:"type"`
	MatchedOn string    `json:"matchedOn"`
	Snippet   string    `json:"snippet"`
}

type documentSearchFixture struct {
	t           *testing.T
	ctx         context.Context
	db          *sql.DB
	repo        *documentrepo.Repository
	api         http.Handler
	workspaceID uuid.UUID
	owner       uuid.UUID
	member      uuid.UUID
	tokens      map[uuid.UUID]string
}

func newDocumentSearchFixture(t *testing.T) *documentSearchFixture {
	t.Helper()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Fatal("TEST_DATABASE_URL is required for integration tests")
	}
	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	f := &documentSearchFixture{
		t: t, ctx: context.Background(), db: db, workspaceID: uuid.New(),
		owner: uuid.New(), member: uuid.New(), tokens: map[uuid.UUID]string{},
	}
	f.repo = documentrepo.NewRepository(database.NewSQLDB(db))
	for _, id := range []uuid.UUID{f.owner, f.member} {
		f.exec(`INSERT INTO users (id, account_no, email, full_name) VALUES ($1, $2, $3, 'Search test user')`,
			id, uuid.NewString(), fmt.Sprintf("search-%s@example.invalid", id))
	}
	f.exec(`INSERT INTO workspaces (id, name, slug, created_by) VALUES ($1, 'Search test', $2, $3)`,
		f.workspaceID, "search-"+f.workspaceID.String(), f.owner)
	f.exec(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner'), ($1, $3, 'member')`,
		f.workspaceID, f.owner, f.member)
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(), `DELETE FROM workspaces WHERE created_by = ANY($1::uuid[])`,
			fmt.Sprintf("{%s,%s}", f.owner, f.member))
		_, _ = db.ExecContext(context.Background(), `DELETE FROM users WHERE id = ANY($1::uuid[])`,
			fmt.Sprintf("{%s,%s}", f.owner, f.member))
		_ = db.Close()
	})

	app := container.New(database.NewSQLDB(db), logger.New(), validator.New())
	f.api = InitRoutes(app, config.Config{JWTSecret: "search-test-secret", AccessTokenTTL: time.Hour})
	manager := jwtmanager.NewManager("search-test-secret", time.Hour)
	for _, id := range []uuid.UUID{f.owner, f.member} {
		user, err := manager.Issue(model.AuthUser{
			ID: id, AccountNo: "search-" + id.String(), Email: fmt.Sprintf("search-%s@example.invalid", id), Roles: []string{"member"},
		})
		if err != nil {
			t.Fatalf("issue access token: %v", err)
		}
		f.tokens[id] = user.AccessToken
	}
	return f
}

func (f *documentSearchFixture) exec(query string, args ...any) {
	f.t.Helper()
	if _, err := f.db.ExecContext(f.ctx, query, args...); err != nil {
		f.t.Fatalf("%s: %v", query, err)
	}
}

// document seeds one document in the fixture workspace; a non-empty paragraph
// becomes its indexed body.
func (f *documentSearchFixture) document(title, docType, visibility, paragraph string) uuid.UUID {
	f.t.Helper()
	id := uuid.New()
	f.exec(`INSERT INTO documents (id, workspace_id, title, type, author_id, visibility) VALUES ($1, $2, $3, $4::document_type, $5, $6::document_visibility)`,
		id, f.workspaceID, title, docType, f.owner, visibility)
	f.exec(`INSERT INTO document_accesses (document_id, user_id, access_level) VALUES ($1, $2, 'owner')`, id, f.owner)
	if paragraph != "" {
		f.exec(`UPDATE documents SET content_json = $2::jsonb WHERE id = $1`, id,
			ragJSON(ragBlock("paragraph", uuid.New(), "", paragraph)))
		if _, err := f.repo.RebuildRAGIndex(f.ctx, id); err != nil {
			f.t.Fatalf("index document: %v", err)
		}
	}
	return id
}

func (f *documentSearchFixture) search(as uuid.UUID, query string) []searchHit {
	f.t.Helper()
	return f.searchIn(as, f.workspaceID, "q="+url.QueryEscape(query))
}

func (f *documentSearchFixture) searchIn(as, workspaceID uuid.UUID, rawQuery string) []searchHit {
	f.t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/documents/search?"+rawQuery, nil)
	req.Header.Set("Authorization", "Bearer "+f.tokens[as])
	req.Header.Set("X-Workspace-Id", workspaceID.String())
	rec := httptest.NewRecorder()
	f.api.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		f.t.Fatalf("GET search %q = %d %s, want 200", rawQuery, rec.Code, rec.Body.String())
	}
	var envelope struct {
		Data []searchHit `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
		f.t.Fatalf("decode search response %s: %v", rec.Body.String(), err)
	}
	return envelope.Data
}

func titles(hits []searchHit) []string {
	out := make([]string, len(hits))
	for i, hit := range hits {
		out[i] = hit.Title
	}
	return out
}

func containsTitle(hits []searchHit, title string) bool {
	for _, hit := range hits {
		if hit.Title == title {
			return true
		}
	}
	return false
}

func TestDocumentSearchMatchesTitlesTheActorMayRead(t *testing.T) {
	f := newDocumentSearchFixture(t)
	f.document("Quarterly roadmap", "markdown", "workspace", "")
	f.document("Roadmap diagram", "architecture", "workspace", "")
	f.document("Roadmap secrets", "markdown", "private", "")
	deleted := f.document("Roadmap archive", "markdown", "workspace", "")
	f.exec(`UPDATE documents SET deleted_at = now() WHERE id = $1`, deleted)
	otherWorkspace := uuid.New()
	f.exec(`INSERT INTO workspaces (id, name, slug, created_by) VALUES ($1, 'Elsewhere', $2, $3)`, otherWorkspace, "elsewhere-"+otherWorkspace.String(), f.owner)
	f.exec(`INSERT INTO documents (workspace_id, title, type, author_id, visibility) VALUES ($1, 'Roadmap elsewhere', 'markdown', $2, 'workspace')`, otherWorkspace, f.owner)

	hits := f.search(f.member, "roadmap")

	for _, want := range []string{"Quarterly roadmap", "Roadmap diagram"} {
		if !containsTitle(hits, want) {
			t.Errorf("member search = %v, want it to include %q", titles(hits), want)
		}
	}
	for _, unwanted := range []string{"Roadmap secrets", "Roadmap archive", "Roadmap elsewhere"} {
		if containsTitle(hits, unwanted) {
			t.Errorf("member search = %v, must not include %q", titles(hits), unwanted)
		}
	}
	if !containsTitle(f.search(f.owner, "roadmap"), "Roadmap secrets") {
		t.Errorf("owner search should include the private document it can read")
	}
}

func TestDocumentSearchFindsBodyTextWithASnippet(t *testing.T) {
	f := newDocumentSearchFixture(t)
	f.document("Release notes", "markdown", "workspace", "The database migration finishes in November after review.")
	f.document("Private journal", "markdown", "private", "The zebra protocol is confidential.")
	repeated := f.document("Glossary", "markdown", "workspace", "Latency means delay. Another latency note.")
	f.exec(`UPDATE documents SET content_json = $2::jsonb WHERE id = $1`, repeated, ragJSON(
		ragBlock("paragraph", uuid.New(), "", "Latency means delay between request and answer."),
		ragBlock("paragraph", uuid.New(), "", "Reduce latency by caching the latency-sensitive path."),
	))
	if _, err := f.repo.RebuildRAGIndex(f.ctx, repeated); err != nil {
		t.Fatalf("reindex: %v", err)
	}
	stale := f.document("Old draft", "markdown", "workspace", "A xylophone appears in the first version.")
	f.exec(`UPDATE documents SET body_version = body_version + 1 WHERE id = $1`, stale)

	hits := f.search(f.member, "november")
	if len(hits) != 1 || hits[0].Title != "Release notes" || hits[0].MatchedOn != "body" {
		t.Fatalf("search november = %+v, want one body hit on Release notes", hits)
	}
	if !strings.Contains(hits[0].Snippet, "\x01November\x02") {
		t.Errorf("snippet = %q, want the match wrapped in \\x01 and \\x02", hits[0].Snippet)
	}

	if hits := f.search(f.member, "zebra"); len(hits) != 0 {
		t.Errorf("member found a private body: %+v", hits)
	}
	if hits := f.search(f.owner, "zebra"); len(hits) != 1 {
		t.Errorf("owner search zebra = %+v, want the private journal", hits)
	}
	if hits := f.search(f.member, "xylophone"); len(hits) != 0 {
		t.Errorf("stale index produced a hit: %+v", hits)
	}
	if hits := f.search(f.member, "latency"); len(hits) != 1 {
		t.Errorf("search latency = %+v, want the document once", hits)
	}
}

func TestDocumentSearchTreatsOddAndShortQueriesAsPlainText(t *testing.T) {
	f := newDocumentSearchFixture(t)
	f.document("Annual plan", "markdown", "workspace", "Budget for the year.")
	f.document("100% coverage", "markdown", "workspace", "")

	if hits := f.search(f.member, "a"); len(hits) != 0 {
		t.Errorf("one-letter query = %v, want none", titles(hits))
	}
	for _, query := range []string{"'", "&", "|", ":", "!", "*", "(", ")", `\`, "a & | b", "plan:*)(", "'; DROP TABLE documents; --"} {
		f.search(f.member, query)
	}
	if hits := f.search(f.member, "0%"); len(hits) != 1 || hits[0].Title != "100% coverage" {
		t.Errorf("search 0%% = %v, want only the title that contains a percent sign", titles(hits))
	}
	if hits := f.search(f.member, "n_"); len(hits) != 0 {
		t.Errorf("search n_ = %v, want none: an underscore is not a wildcard", titles(hits))
	}

	for i := range 25 {
		f.document(fmt.Sprintf("Bulk note %02d", i), "markdown", "workspace", "")
	}
	if got := len(f.searchIn(f.member, f.workspaceID, "q=bulk&limit=100")); got != 20 {
		t.Errorf("limit=100 returned %d hits, want the maximum of 20", got)
	}
	if got := len(f.searchIn(f.member, f.workspaceID, "q=bulk")); got != 8 {
		t.Errorf("default limit returned %d hits, want 8", got)
	}
}

func TestDocumentSearchWithoutAQueryListsRecentReadableDocuments(t *testing.T) {
	f := newDocumentSearchFixture(t)
	oldest := f.document("Oldest viewed last", "markdown", "workspace", "")
	middle := f.document("Middle", "markdown", "workspace", "")
	newest := f.document("Newest", "markdown", "workspace", "")
	f.document("Hidden", "markdown", "private", "")
	gone := f.document("Gone", "markdown", "workspace", "")
	f.exec(`UPDATE documents SET deleted_at = now() WHERE id = $1`, gone)
	f.exec(`UPDATE documents SET updated_at = now() - interval '3 days' WHERE id = $1`, oldest)
	f.exec(`UPDATE documents SET updated_at = now() - interval '2 days' WHERE id = $1`, middle)
	f.exec(`UPDATE documents SET updated_at = now() - interval '1 day' WHERE id = $1`, newest)
	f.exec(`INSERT INTO document_views (user_id, document_id, last_viewed_at) VALUES ($1, $2, now())`, f.member, oldest)

	hits := f.search(f.member, "")

	want := []string{"Oldest viewed last", "Newest", "Middle"}
	if got := titles(hits); fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("recent documents = %v, want %v: the member's last view first, then the latest edit", got, want)
	}
	for _, hit := range hits {
		if hit.MatchedOn != "" || hit.Snippet != "" {
			t.Errorf("recent hit %q carries matchedOn %q and snippet %q, want neither", hit.Title, hit.MatchedOn, hit.Snippet)
		}
	}
	if got := len(f.searchIn(f.member, f.workspaceID, "limit=2")); got != 2 {
		t.Errorf("limit=2 returned %d recent documents, want 2", got)
	}
}
