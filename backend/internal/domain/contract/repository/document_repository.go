package repository

import (
	"context"

	"backend/internal/domain/model"
	"github.com/google/uuid"
)

type DocumentFilter struct {
	ProjectID *uuid.UUID
	FilterTab string // 'all', 'created_by_me', 'shared', 'starred'
	Search    string
	Category  string
	SortField string // 'lastViewedAt', 'updatedAt', 'createdAt', 'title'
	SortOrder string // 'asc', 'desc'
}

type DocumentRepository interface {
	List(ctx context.Context, workspaceID, userID uuid.UUID, filter DocumentFilter) ([]model.Document, error)
	GetByID(ctx context.Context, id, userID uuid.UUID) (model.Document, error)
	GetByShareToken(ctx context.Context, token string) (model.Document, error)
	Create(ctx context.Context, doc model.Document, categoryNames []string) (model.Document, error)
	Update(ctx context.Context, doc model.Document, categoryNames []string) error
	UpdateThumbnails(ctx context.Context, id uuid.UUID, thumb, thumbDark, thumbPreview, thumbPreviewDark string) error
	Move(ctx context.Context, id uuid.UUID, targetProjectID *uuid.UUID) error
	RecordView(ctx context.Context, docID, userID uuid.UUID) error
	ToggleStar(ctx context.Context, docID, userID uuid.UUID) (bool, error)
	SetShareToken(ctx context.Context, docID uuid.UUID, token, visibility string) error

	// Trash
	SoftDelete(ctx context.Context, id, userID uuid.UUID) error
	ListTrash(ctx context.Context, workspaceID uuid.UUID) ([]model.TrashItem, error)
	Restore(ctx context.Context, id uuid.UUID) error
	PermanentDelete(ctx context.Context, id uuid.UUID) error
	EmptyTrash(ctx context.Context, workspaceID uuid.UUID) error

	// Accesses
	ListAccesses(ctx context.Context, docID uuid.UUID) ([]model.DocumentAccess, error)
	AddOrUpdateAccess(ctx context.Context, docID, userID uuid.UUID, level string) error
	RemoveAccess(ctx context.Context, docID, userID uuid.UUID) error
	GetUserAccessLevel(ctx context.Context, docID, userID uuid.UUID) (string, error)
}
