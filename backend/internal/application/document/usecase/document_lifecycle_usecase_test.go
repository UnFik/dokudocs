package usecase

import (
	"context"
	"errors"
	"testing"
	"time"

	"backend/constant"
	"backend/internal/domain/contract/repository"
	"backend/internal/domain/model"

	"github.com/google/uuid"
)

type lifecycleDocumentRepoStub struct {
	repository.DocumentRepository
	doc           model.Document
	accessLevel   string
	accessErr     error
	restoreCalled bool
	deleteCalled  bool
}

func (r *lifecycleDocumentRepoStub) GetTrashedByID(context.Context, uuid.UUID) (model.Document, error) {
	return r.doc, nil
}

func (r *lifecycleDocumentRepoStub) GetUserAccessLevel(context.Context, uuid.UUID, uuid.UUID) (string, error) {
	if r.accessErr != nil {
		return "", r.accessErr
	}
	return r.accessLevel, nil
}

func (r *lifecycleDocumentRepoStub) Restore(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) error {
	r.restoreCalled = true
	return nil
}

func (r *lifecycleDocumentRepoStub) PermanentDelete(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) error {
	r.deleteCalled = true
	return nil
}

type lifecycleWorkspaceRepoStub struct {
	repository.WorkspaceRepository
	role string
	err  error
}

func (r lifecycleWorkspaceRepoStub) GetUserRole(context.Context, uuid.UUID, uuid.UUID) (string, error) {
	return r.role, r.err
}

func TestRestoreDocumentRequiresOwnershipAndActualWorkspace(t *testing.T) {
	userID := uuid.New()
	workspaceID := uuid.New()
	otherWorkspaceID := uuid.New()
	doc := model.Document{ID: uuid.New(), WorkspaceID: otherWorkspaceID}
	docRepo := &lifecycleDocumentRepoStub{doc: doc, accessErr: constant.ErrAccessNotFound}
	uc := NewUseCaseWithRepos(docRepo, lifecycleWorkspaceRepoStub{role: "member"}, nil, nil)

	err := uc.RestoreDocument(context.Background(), doc.ID, workspaceID, userID)
	if !errors.Is(err, constant.ErrDocumentNotFound) {
		t.Fatalf("RestoreDocument() error = %v, want %v", err, constant.ErrDocumentNotFound)
	}
	if docRepo.restoreCalled {
		t.Fatal("RestoreDocument() mutated a document from another workspace")
	}
}

func TestPermanentDeleteRequiresDocumentOwnerOrWorkspaceAdmin(t *testing.T) {
	userID := uuid.New()
	workspaceID := uuid.New()
	deletedAt := time.Now()
	doc := model.Document{ID: uuid.New(), WorkspaceID: workspaceID, DeletedAt: &deletedAt}
	docRepo := &lifecycleDocumentRepoStub{doc: doc, accessErr: constant.ErrAccessNotFound}
	uc := NewUseCaseWithRepos(docRepo, lifecycleWorkspaceRepoStub{role: "member"}, nil, nil)

	err := uc.PermanentDelete(context.Background(), doc.ID, workspaceID, userID)
	if !errors.Is(err, constant.ErrForbidden) {
		t.Fatalf("PermanentDelete() error = %v, want %v", err, constant.ErrForbidden)
	}
	if docRepo.deleteCalled {
		t.Fatal("PermanentDelete() mutated a document without owner access")
	}
}

func TestRestoreDocumentAllowsDocumentOwner(t *testing.T) {
	userID := uuid.New()
	workspaceID := uuid.New()
	deletedAt := time.Now()
	doc := model.Document{ID: uuid.New(), WorkspaceID: workspaceID, DeletedAt: &deletedAt}
	docRepo := &lifecycleDocumentRepoStub{doc: doc, accessLevel: "owner"}
	uc := NewUseCaseWithRepos(docRepo, lifecycleWorkspaceRepoStub{role: "member"}, nil, nil)

	if err := uc.RestoreDocument(context.Background(), doc.ID, workspaceID, userID); err != nil {
		t.Fatalf("RestoreDocument() error = %v, want nil", err)
	}
	if !docRepo.restoreCalled {
		t.Fatal("RestoreDocument() did not restore document owner can manage")
	}
}
