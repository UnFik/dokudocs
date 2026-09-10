package usecase

import (
	"context"

	"backend/internal/application/document/dto"
	"backend/internal/domain/contract/repository"
	"backend/internal/domain/model"

	"github.com/google/uuid"
)

type DocumentUseCase interface {
	ListDocuments(ctx context.Context, workspaceID, userID uuid.UUID, filter repository.DocumentFilter) (data []model.Document, err error)
	GetDocument(ctx context.Context, id, workspaceID, userID uuid.UUID) (data model.Document, err error)
	GetPublicDocument(ctx context.Context, shareToken string) (data model.Document, err error)
	CreateDocument(ctx context.Context, input dto.CreateDocumentInput) (data model.Document, err error)
	UpdateDocument(ctx context.Context, input dto.UpdateDocumentInput) (data model.Document, err error)
	UpdateThumbnails(ctx context.Context, id, workspaceID, userID uuid.UUID, thumb, thumbDark, thumbPreview, thumbPreviewDark string) (err error)
	MoveDocument(ctx context.Context, id, workspaceID, userID uuid.UUID, targetProjectID *uuid.UUID) (err error)
	DuplicateDocument(ctx context.Context, id, workspaceID, userID uuid.UUID) (data model.Document, err error)
	RecordView(ctx context.Context, id, workspaceID, userID uuid.UUID) (err error)
	ToggleStar(ctx context.Context, id, workspaceID, userID uuid.UUID) (data bool, err error)
	CreateShareToken(ctx context.Context, id, workspaceID, userID uuid.UUID) (data string, err error)

	// Trash
	MoveToTrash(ctx context.Context, id, workspaceID, userID uuid.UUID) (err error)
	ListTrash(ctx context.Context, workspaceID, userID uuid.UUID) (data []model.TrashItem, err error)
	RestoreDocument(ctx context.Context, id, workspaceID, userID uuid.UUID) (err error)
	PermanentDelete(ctx context.Context, id, workspaceID, userID uuid.UUID) (err error)
	EmptyTrash(ctx context.Context, workspaceID, userID uuid.UUID) (err error)

	// Accesses
	ListAccesses(ctx context.Context, docID, workspaceID, userID uuid.UUID) (data []model.DocumentAccess, err error)
	AddOrUpdateAccess(ctx context.Context, docID, workspaceID, actorID uuid.UUID, email, level string) (err error)
	RemoveAccess(ctx context.Context, docID, workspaceID, memberUserID, actorID uuid.UUID) (err error)
}
