package usecase

import (
	"context"
	"errors"
	"testing"

	"backend/internal/domain/model"

	"github.com/google/uuid"
)

type revisionRepoStub struct {
	err error
}

func (r revisionRepoStub) ListDocumentRevisions(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) ([]model.DocumentRevision, error) {
	return nil, nil
}
func (r revisionRepoStub) CreateNamedDocumentRevision(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, string) (model.DocumentRevision, error) {
	return model.DocumentRevision{}, nil
}
func (r revisionRepoStub) RestoreDocumentRevision(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID) (model.DocumentRestoreResult, error) {
	return model.DocumentRestoreResult{}, r.err
}

type reloaderStub struct{ rooms [][2]uuid.UUID }

func (r *reloaderStub) ReloadRoom(_ context.Context, workspaceID, documentID uuid.UUID) error {
	r.rooms = append(r.rooms, [2]uuid.UUID{workspaceID, documentID})
	return errors.New("service down")
}

func TestRestoreClosesTheOpenRoomAfterwardsAndSurvivesTheServiceBeingDown(t *testing.T) {
	reloader := &reloaderStub{}
	uc := NewDocumentRevisionUseCase(revisionRepoStub{}).WithRoomReloader(reloader)
	workspaceID, documentID := uuid.New(), uuid.New()
	if _, err := uc.Restore(context.Background(), documentID, uuid.New(), workspaceID, uuid.New(), uuid.New()); err != nil {
		t.Fatalf("Restore() = %v, want success even when the reload fails", err)
	}
	if len(reloader.rooms) != 1 || reloader.rooms[0] != [2]uuid.UUID{workspaceID, documentID} {
		t.Fatalf("reloaded rooms = %v, want the document's room once", reloader.rooms)
	}
}

func TestFailedRestoreLeavesTheRoomAlone(t *testing.T) {
	reloader := &reloaderStub{}
	uc := NewDocumentRevisionUseCase(revisionRepoStub{err: errors.New("conflict")}).WithRoomReloader(reloader)
	if _, err := uc.Restore(context.Background(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()); err == nil {
		t.Fatal("Restore() succeeded, want the repository error")
	}
	if len(reloader.rooms) != 0 {
		t.Fatalf("reloaded rooms = %v, want none", reloader.rooms)
	}
}
