package usecase

import (
	"context"
	"errors"
	"testing"

	"backend/constant"
	"backend/internal/application/document/dto"
	"backend/internal/domain/contract/repository"
	"backend/internal/domain/model"

	"github.com/google/uuid"
)

type getDocumentRepoStub struct {
	repository.DocumentRepository
	doc         model.Document
	accessLevel string
	accessErr   error
}

func (r getDocumentRepoStub) GetByID(context.Context, uuid.UUID, uuid.UUID) (model.Document, error) {
	return r.doc, nil
}

func (r getDocumentRepoStub) GetUserAccessLevel(context.Context, uuid.UUID, uuid.UUID) (string, error) {
	if r.accessErr != nil {
		return r.accessLevel, r.accessErr
	}
	if r.accessLevel == "" {
		return "", constant.ErrAccessNotFound
	}
	return r.accessLevel, nil
}

type documentUpdateRepoStub struct {
	getDocumentRepoStub
	updateCalled bool
}

func (r *documentUpdateRepoStub) UpdateAuthorized(context.Context, model.Document, []string, uuid.UUID) error {
	r.updateCalled = true
	return nil
}

type getDocumentWorkspaceRepoStub struct {
	repository.WorkspaceRepository
	role string
}

func (r getDocumentWorkspaceRepoStub) GetUserRole(context.Context, uuid.UUID, uuid.UUID) (string, error) {
	return r.role, nil
}

type getDocumentProjectRepoStub struct {
	repository.ProjectRepository
	project     model.Project
	projectRole string
}

func (r getDocumentProjectRepoStub) GetByID(context.Context, uuid.UUID, uuid.UUID) (model.Project, error) {
	return r.project, nil
}

func (r getDocumentProjectRepoStub) GetUserRole(context.Context, uuid.UUID, uuid.UUID) (string, error) {
	return r.projectRole, nil
}

func TestGetDocumentDoesNotRevealPrivateDocumentWithoutGrant(t *testing.T) {
	userID := uuid.New()
	workspaceID := uuid.New()
	doc := model.Document{
		ID:          uuid.New(),
		WorkspaceID: workspaceID,
		AuthorID:    uuid.New(),
		Visibility:  "private",
	}
	uc := NewUseCaseWithRepos(
		getDocumentRepoStub{doc: doc},
		getDocumentWorkspaceRepoStub{role: "member"},
		nil,
		nil,
	)

	got, err := uc.GetDocument(context.Background(), doc.ID, workspaceID, userID)
	if !errors.Is(err, constant.ErrDocumentNotFound) {
		t.Fatalf("GetDocument() error = %v, want %v", err, constant.ErrDocumentNotFound)
	}
	if got.ID != uuid.Nil {
		t.Fatalf("GetDocument() leaked document ID %s", got.ID)
	}
}

func TestGetDocumentAllowsWorkspaceAdminToReadPrivateDocument(t *testing.T) {
	userID, workspaceID := uuid.New(), uuid.New()
	doc := model.Document{
		ID:          uuid.New(),
		WorkspaceID: workspaceID,
		AuthorID:    uuid.New(),
		Visibility:  "private",
	}
	uc := NewUseCaseWithRepos(
		getDocumentRepoStub{doc: doc},
		getDocumentWorkspaceRepoStub{role: "admin"},
		nil,
		nil,
	)

	got, err := uc.GetDocument(context.Background(), doc.ID, workspaceID, userID)
	if err != nil {
		t.Fatalf("GetDocument() error = %v, want nil", err)
	}
	if got.ID != doc.ID {
		t.Fatalf("GetDocument() ID = %s, want %s", got.ID, doc.ID)
	}
}

func TestGetDocumentAllowsProjectMemberForInheritedPrivateProject(t *testing.T) {
	userID := uuid.New()
	workspaceID := uuid.New()
	projectID := uuid.New()
	doc := model.Document{
		ID:          uuid.New(),
		WorkspaceID: workspaceID,
		ProjectID:   &projectID,
		AuthorID:    uuid.New(),
		Visibility:  "inherit",
	}
	project := model.Project{
		ID:          projectID,
		WorkspaceID: workspaceID,
		Visibility:  "private",
		Role:        "viewer",
	}
	uc := NewUseCaseWithRepos(
		getDocumentRepoStub{doc: doc},
		getDocumentWorkspaceRepoStub{role: "member"},
		nil,
		getDocumentProjectRepoStub{project: project},
	)

	got, err := uc.GetDocument(context.Background(), doc.ID, workspaceID, userID)
	if err != nil {
		t.Fatalf("GetDocument() error = %v, want nil", err)
	}
	if got.ID != doc.ID {
		t.Fatalf("GetDocument() ID = %s, want %s", got.ID, doc.ID)
	}
}

func TestProjectEditorCannotReadPrivateDraftWithOnlyViewGrant(t *testing.T) {
	userID := uuid.New()
	workspaceID := uuid.New()
	projectID := uuid.New()
	doc := model.Document{
		ID:          uuid.New(),
		WorkspaceID: workspaceID,
		ProjectID:   &projectID,
		AuthorID:    uuid.New(),
		Visibility:  "private",
		IsDraft:     true,
	}
	uc := NewUseCaseWithRepos(
		getDocumentRepoStub{doc: doc, accessLevel: "view"},
		getDocumentWorkspaceRepoStub{role: "member"},
		nil,
		getDocumentProjectRepoStub{projectRole: "editor"},
	)

	if _, err := uc.GetDocument(context.Background(), doc.ID, workspaceID, userID); !errors.Is(err, constant.ErrDocumentNotFound) {
		t.Fatalf("GetDocument() error = %v, want %v", err, constant.ErrDocumentNotFound)
	}
}

func TestDocumentUpdateRequiresAnEffectiveEditGrant(t *testing.T) {
	for _, tc := range []struct {
		name         string
		grant        string
		authorIsUser bool
	}{
		{name: "author without owner grant", authorIsUser: true},
		{name: "view grant", grant: "view"},
		{name: "comment grant", grant: "comment"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			userID := uuid.New()
			workspaceID := uuid.New()
			authorID := uuid.New()
			if tc.authorIsUser {
				authorID = userID
			}
			doc := model.Document{
				ID:          uuid.New(),
				WorkspaceID: workspaceID,
				AuthorID:    authorID,
				Visibility:  "private",
			}
			docRepo := &documentUpdateRepoStub{getDocumentRepoStub: getDocumentRepoStub{
				doc:         doc,
				accessLevel: tc.grant,
			}}
			uc := NewUseCaseWithRepos(
				docRepo,
				getDocumentWorkspaceRepoStub{role: "member"},
				nil,
				nil,
			)

			_, err := uc.UpdateDocument(context.Background(), dto.UpdateDocumentInput{
				ID:          doc.ID,
				WorkspaceID: workspaceID,
				UserID:      userID,
				Title:       "Unauthorized edit",
			})
			if !errors.Is(err, constant.ErrForbidden) {
				t.Fatalf("UpdateDocument() error = %v, want %v", err, constant.ErrForbidden)
			}
			if docRepo.updateCalled {
				t.Fatal("UpdateDocument() wrote document without an effective edit grant")
			}
		})
	}
}
