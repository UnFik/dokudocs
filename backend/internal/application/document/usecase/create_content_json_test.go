package usecase

import (
	"context"
	"encoding/json"
	"testing"

	"backend/internal/application/document/dto"
	"backend/internal/domain/model"

	"github.com/google/uuid"
)

type contentJSONRepoStub struct {
	projectWorkspaceDocumentRepoStub
	created model.Document
}

func (r *contentJSONRepoStub) CreateIdempotent(_ context.Context, doc model.Document, _ []string, _ uuid.UUID) (model.Document, error) {
	r.created = doc
	return doc, nil
}

func TestCreateDocumentKeepsAContentJSONObjectAndRefusesAnythingElse(t *testing.T) {
	create := func(docType string, contentJSON string) (*contentJSONRepoStub, error) {
		repo := &contentJSONRepoStub{}
		uc := NewUseCaseWithRepos(repo, getDocumentWorkspaceRepoStub{role: "member"}, nil, nil)
		_, err := uc.CreateDocument(context.Background(), dto.CreateDocumentInput{
			WorkspaceID: uuid.New(), UserID: uuid.New(), RequestID: uuid.New(), Type: docType, ContentJSON: json.RawMessage(contentJSON),
		})
		return repo, err
	}
	if repo, err := create("markdown", `{"type":"doc"}`); err != nil || string(repo.created.ContentJSON) != `{"type":"doc"}` {
		t.Fatalf("object = (%s, %v), want it stored", repo.created.ContentJSON, err)
	}
	for name, tc := range map[string]struct{ docType, body string }{
		"an array":  {"markdown", `[]`},
		"null":      {"markdown", `null`},
		"not JSON":  {"markdown", `{`},
		"a diagram": {"mermaid", `{"type":"doc"}`},
	} {
		if _, err := create(tc.docType, tc.body); err != ErrInvalidContentJSON {
			t.Fatalf("%s: error = %v, want ErrInvalidContentJSON", name, err)
		}
	}
}

func TestCreateArchitectureDocumentStartsWithAnEmptyCanvasOrAGivenOne(t *testing.T) {
	create := func(contentJSON string) (*contentJSONRepoStub, error) {
		repo := &contentJSONRepoStub{}
		uc := NewUseCaseWithRepos(repo, getDocumentWorkspaceRepoStub{role: "member"}, nil, nil)
		_, err := uc.CreateDocument(context.Background(), dto.CreateDocumentInput{
			WorkspaceID: uuid.New(), UserID: uuid.New(), RequestID: uuid.New(), Type: "architecture", ContentJSON: json.RawMessage(contentJSON),
		})
		return repo, err
	}
	repo, err := create("")
	if err != nil || string(repo.created.ContentJSON) != `{"version":1,"nodes":[],"connections":[]}` {
		t.Fatalf("no JSON = (%s, %v), want the empty canvas", repo.created.ContentJSON, err)
	}
	if repo.created.Content != "" {
		t.Fatalf("content = %q, want empty: it is derived from the canvas", repo.created.Content)
	}
	given := `{"version":1,"nodes":[{"id":"a","kind":"system","name":"API"}],"connections":[]}`
	if repo, err := create(given); err != nil || string(repo.created.ContentJSON) != given {
		t.Fatalf("a canvas = (%s, %v), want it stored", repo.created.ContentJSON, err)
	}
	for name, body := range map[string]string{
		"a Markdown body":     `{"type":"doc"}`,
		"another version":     `{"version":2,"nodes":[],"connections":[]}`,
		"nodes not a list":    `{"version":1,"nodes":{},"connections":[]}`,
		"connections missing": `{"version":1,"nodes":[]}`,
	} {
		if _, err := create(body); err != ErrInvalidContentJSON {
			t.Fatalf("%s: error = %v, want ErrInvalidContentJSON", name, err)
		}
	}
}
