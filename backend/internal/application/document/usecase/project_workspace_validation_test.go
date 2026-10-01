package usecase

import (
	"context"
	"testing"

	"backend/constant"
	"backend/internal/application/document/dto"
	"backend/internal/domain/contract/repository"
	"backend/internal/domain/model"

	"github.com/google/uuid"
)

type projectWorkspaceDocumentRepoStub struct {
	repository.DocumentRepository
	doc         model.Document
	accessLevel string
	moveCalls   int
	createCalls int
}

func (r *projectWorkspaceDocumentRepoStub) GetByID(context.Context, uuid.UUID, uuid.UUID) (model.Document, error) {
	return r.doc, nil
}

func (r *projectWorkspaceDocumentRepoStub) GetUserAccessLevel(context.Context, uuid.UUID, uuid.UUID) (string, error) {
	if r.accessLevel != "" {
		return r.accessLevel, nil
	}
	return "", constant.ErrAccessNotFound
}

func (r *projectWorkspaceDocumentRepoStub) Move(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, *uuid.UUID) error {
	r.moveCalls++
	return nil
}

func (r *projectWorkspaceDocumentRepoStub) Create(context.Context, model.Document, []string) (model.Document, error) {
	r.createCalls++
	return model.Document{}, nil
}

func TestCreateDocumentRejectsProjectFromAnotherWorkspace(t *testing.T) {
	userID := uuid.New()
	workspaceID := uuid.New()
	projectID := uuid.New()
	docRepo := &projectWorkspaceDocumentRepoStub{}
	uc := NewUseCaseWithRepos(
		docRepo,
		getDocumentWorkspaceRepoStub{role: "member"},
		nil,
		getDocumentProjectRepoStub{project: model.Project{ID: projectID, WorkspaceID: uuid.New()}},
	)

	_, err := uc.CreateDocument(context.Background(), dto.CreateDocumentInput{
		WorkspaceID: workspaceID,
		ProjectID:   &projectID,
		UserID:      userID,
	})
	if err != constant.ErrProjectNotFound {
		t.Fatalf("CreateDocument() error = %v, want %v", err, constant.ErrProjectNotFound)
	}
	if docRepo.createCalls != 0 {
		t.Fatal("CreateDocument() persisted document in a different workspace's project")
	}
}

func TestMoveDocumentRejectsProjectFromAnotherWorkspace(t *testing.T) {
	userID := uuid.New()
	workspaceID := uuid.New()
	projectID := uuid.New()
	docRepo := &projectWorkspaceDocumentRepoStub{doc: model.Document{
		ID:          uuid.New(),
		WorkspaceID: workspaceID,
		AuthorID:    userID,
		Visibility:  "workspace",
	}, accessLevel: "owner"}
	uc := NewUseCaseWithRepos(
		docRepo,
		getDocumentWorkspaceRepoStub{role: "member"},
		nil,
		getDocumentProjectRepoStub{project: model.Project{ID: projectID, WorkspaceID: uuid.New()}},
	)

	err := uc.MoveDocument(context.Background(), docRepo.doc.ID, workspaceID, userID, &projectID)
	if err != constant.ErrProjectNotFound {
		t.Fatalf("MoveDocument() error = %v, want %v", err, constant.ErrProjectNotFound)
	}
	if docRepo.moveCalls != 0 {
		t.Fatal("MoveDocument() persisted move into a different workspace's project")
	}
}
