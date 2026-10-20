package usecase

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"backend/internal/application/document/dto"
	"backend/internal/domain/model"

	"github.com/google/uuid"
)

func createHTML(input dto.CreateDocumentInput) (*contentJSONRepoStub, error) {
	repo := &contentJSONRepoStub{}
	uc := NewUseCaseWithRepos(repo, getDocumentWorkspaceRepoStub{role: "member"}, nil, nil)
	input.WorkspaceID, input.UserID, input.RequestID = uuid.New(), uuid.New(), uuid.New()
	input.Type = "html"
	_, err := uc.CreateDocument(context.Background(), input)
	return repo, err
}

func TestHTMLDocumentsAreCreatedOnlyFromMCP(t *testing.T) {
	const page = "<!doctype html><title>x</title><p>hi</p>"

	if _, err := createHTML(dto.CreateDocumentInput{Content: page}); !errors.Is(err, ErrHTMLNotWritable) {
		t.Fatalf("create from the API = %v, want ErrHTMLNotWritable", err)
	}

	repo, err := createHTML(dto.CreateDocumentInput{Content: page, FromMCP: true})
	if err != nil {
		t.Fatalf("create from MCP: %v", err)
	}
	if repo.created.Type != "html" || repo.created.Content != page || len(repo.created.ContentJSON) != 0 {
		t.Fatalf("created = %+v, want the page as text body and no Yjs-derived JSON", repo.created)
	}
}

func TestHTMLDocumentBodyIsLimitedToOneMiB(t *testing.T) {
	atLimit := strings.Repeat("a", MaxHTMLBytes)
	if _, err := createHTML(dto.CreateDocumentInput{Content: atLimit, FromMCP: true}); err != nil {
		t.Fatalf("page at the limit: %v", err)
	}
	if _, err := createHTML(dto.CreateDocumentInput{Content: atLimit + "a", FromMCP: true}); !errors.Is(err, ErrHTMLTooLarge) {
		t.Fatalf("page over the limit = %v, want ErrHTMLTooLarge", err)
	}
}

func TestHTMLDocumentTakesNoContentJSON(t *testing.T) {
	_, err := createHTML(dto.CreateDocumentInput{Content: "<p>x</p>", FromMCP: true, ContentJSON: json.RawMessage(`{"type":"doc"}`)})
	if !errors.Is(err, ErrInvalidContentJSON) {
		t.Fatalf("error = %v, want ErrInvalidContentJSON", err)
	}
}

func TestOnlyMCPChangesTheBodyOfAnHTMLDocument(t *testing.T) {
	userID, workspaceID := uuid.New(), uuid.New()
	doc := model.Document{ID: uuid.New(), WorkspaceID: workspaceID, AuthorID: userID, Type: "html", Content: "<p>old</p>", Visibility: "private"}
	update := func(input dto.UpdateDocumentInput) (*documentUpdateRepoStub, error) {
		repo := &documentUpdateRepoStub{getDocumentRepoStub: getDocumentRepoStub{doc: doc, accessLevel: "owner"}}
		uc := NewUseCaseWithRepos(repo, getDocumentWorkspaceRepoStub{role: "member"}, nil, nil)
		input.ID, input.WorkspaceID, input.UserID = doc.ID, workspaceID, userID
		_, err := uc.UpdateDocument(context.Background(), input)
		return repo, err
	}

	if repo, err := update(dto.UpdateDocumentInput{Content: "<p>new</p>"}); !errors.Is(err, ErrHTMLNotWritable) || repo.updateCalled {
		t.Fatalf("body change from the API = %v (written=%v), want it refused", err, repo.updateCalled)
	}
	if repo, err := update(dto.UpdateDocumentInput{Title: "Renamed"}); err != nil || !repo.updateCalled {
		t.Fatalf("rename = %v (written=%v), want it allowed", err, repo.updateCalled)
	}
	if repo, err := update(dto.UpdateDocumentInput{Content: "<p>new</p>", FromMCP: true}); err != nil || !repo.updateCalled {
		t.Fatalf("body change from MCP = %v (written=%v), want it allowed", err, repo.updateCalled)
	}
	if _, err := update(dto.UpdateDocumentInput{Content: strings.Repeat("a", MaxHTMLBytes+1), FromMCP: true}); !errors.Is(err, ErrHTMLTooLarge) {
		t.Fatalf("oversize body from MCP = %v, want ErrHTMLTooLarge", err)
	}
}
