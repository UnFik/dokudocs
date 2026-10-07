package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"backend/constant"
	"backend/internal/application/auth/dto"
	docrepo "backend/internal/infrastructure/repository/document"
	"backend/internal/presentation/middleware"

	"github.com/google/uuid"
)

type fakeArchitecture struct {
	uses     []docrepo.ArchitectureUse
	versions []docrepo.ArchitectureVersion
	created  struct{ label, description string }
	err      error
}

func (f *fakeArchitecture) ArchitectureUses(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) ([]docrepo.ArchitectureUse, error) {
	return f.uses, f.err
}
func (f *fakeArchitecture) ListArchitectureVersions(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) ([]docrepo.ArchitectureVersion, error) {
	return f.versions, f.err
}
func (f *fakeArchitecture) CreateArchitectureVersion(_ context.Context, _, _, _ uuid.UUID, label, description string) (docrepo.ArchitectureVersion, error) {
	f.created.label, f.created.description = label, description
	return docrepo.ArchitectureVersion{ID: uuid.New(), Label: label}, f.err
}
func (f *fakeArchitecture) UpdateArchitectureVersion(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID, string, string) error {
	return f.err
}
func (f *fakeArchitecture) DeleteArchitectureVersion(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID) error {
	return f.err
}

func architectureRequest(method, path string, body any) *http.Request {
	var raw []byte
	if body != nil {
		raw, _ = json.Marshal(body)
	}
	r := httptest.NewRequest(method, path, bytes.NewReader(raw))
	r.SetPathValue("id", uuid.NewString())
	r.SetPathValue("versionID", uuid.NewString())
	r.Header.Set("X-Workspace-ID", uuid.NewString())
	return r.WithContext(middleware.ContextWithWorkspace(middleware.ContextWithUser(r.Context(), dto.ResponseUser{ID: uuid.NewString()}), uuid.New(), "member"))
}

func TestArchitectureEndpoints(t *testing.T) {
	archID := uuid.New()
	source := &fakeArchitecture{uses: []docrepo.ArchitectureUse{{ArchitectureID: archID, Title: "Prod", ElementID: "api", ElementName: "API"}}}
	h := NewArchitectureHandler(source)

	rec := httptest.NewRecorder()
	h.Uses(rec, architectureRequest(http.MethodGet, "/api/v1/documents/x/architecture-uses", nil))
	if rec.Code != http.StatusOK || !bytes.Contains(rec.Body.Bytes(), []byte(`"elementName":"API"`)) {
		t.Fatalf("uses = %d %s", rec.Code, rec.Body.String())
	}

	rec = httptest.NewRecorder()
	h.CreateVersion(rec, architectureRequest(http.MethodPost, "/api/v1/documents/x/architecture-versions", map[string]string{"label": "v1.0", "description": "MVP"}))
	if rec.Code != http.StatusCreated || source.created.label != "v1.0" || source.created.description != "MVP" {
		t.Fatalf("create = %d %s (%+v)", rec.Code, rec.Body.String(), source.created)
	}

	rec = httptest.NewRecorder()
	h.CreateVersion(rec, architectureRequest(http.MethodPost, "/api/v1/documents/x/architecture-versions", map[string]string{"label": "  "}))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("an empty label = %d, want 400", rec.Code)
	}

	for err, want := range map[error]int{constant.ErrForbidden: http.StatusForbidden, constant.ErrDocumentConflict: http.StatusConflict, nil: http.StatusNoContent} {
		source.err = err
		rec = httptest.NewRecorder()
		h.DeleteVersion(rec, architectureRequest(http.MethodDelete, "/api/v1/documents/x/architecture-versions/y", nil))
		if rec.Code != want {
			t.Fatalf("delete with %v = %d, want %d", err, rec.Code, want)
		}
	}
	source.err = nil
	rec = httptest.NewRecorder()
	h.UpdateVersion(rec, architectureRequest(http.MethodPatch, "/api/v1/documents/x/architecture-versions/y", map[string]string{"label": "v1.1", "description": ""}))
	if rec.Code != http.StatusNoContent {
		t.Fatalf("update = %d", rec.Code)
	}
}
