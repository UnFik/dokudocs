package usecase

import (
	"context"
	"errors"
	"strings"
	"unicode/utf8"

	"backend/internal/domain/model"

	"github.com/google/uuid"
)

var ErrInvalidRevisionRequest = errors.New("invalid document revision request")

type RevisionRepository interface {
	ListDocumentRevisions(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) ([]model.DocumentRevision, error)
	CreateNamedDocumentRevision(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, string) (model.DocumentRevision, error)
	RestoreDocumentRevision(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID) (model.DocumentRestoreResult, error)
}

type DocumentRevisionUseCase struct {
	repo RevisionRepository
}

func NewDocumentRevisionUseCase(repo RevisionRepository) *DocumentRevisionUseCase {
	return &DocumentRevisionUseCase{repo: repo}
}

func (u *DocumentRevisionUseCase) List(ctx context.Context, documentID, workspaceID, actorID uuid.UUID) ([]model.DocumentRevision, error) {
	if documentID == uuid.Nil || workspaceID == uuid.Nil || actorID == uuid.Nil {
		return nil, ErrInvalidRevisionRequest
	}
	return u.repo.ListDocumentRevisions(ctx, documentID, workspaceID, actorID)
}

func (u *DocumentRevisionUseCase) CreateNamed(ctx context.Context, documentID, workspaceID, actorID uuid.UUID, title string) (model.DocumentRevision, error) {
	title = strings.TrimSpace(title)
	if documentID == uuid.Nil || workspaceID == uuid.Nil || actorID == uuid.Nil || title == "" || strings.ContainsRune(title, '\x00') || utf8.RuneCountInString(title) > 255 {
		return model.DocumentRevision{}, ErrInvalidRevisionRequest
	}
	return u.repo.CreateNamedDocumentRevision(ctx, documentID, workspaceID, actorID, title)
}

func (u *DocumentRevisionUseCase) Restore(ctx context.Context, documentID, revisionID, workspaceID, actorID, requestID uuid.UUID) (model.DocumentRestoreResult, error) {
	if documentID == uuid.Nil || revisionID == uuid.Nil || workspaceID == uuid.Nil || actorID == uuid.Nil || requestID == uuid.Nil {
		return model.DocumentRestoreResult{}, ErrInvalidRevisionRequest
	}
	return u.repo.RestoreDocumentRevision(ctx, documentID, revisionID, workspaceID, actorID, requestID)
}
