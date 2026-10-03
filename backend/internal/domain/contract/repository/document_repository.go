package repository

import (
	"context"

	"backend/internal/domain/documentbody"
	"backend/internal/domain/model"
	"github.com/google/uuid"
)

type MarkdownDocumentCreate struct {
	Document          model.Document
	Categories        []string
	RequestID         uuid.UUID
	Body              documentbody.Body
	BodySchemaVersion int
}

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
	CreateIdempotent(ctx context.Context, doc model.Document, categoryNames []string, requestID uuid.UUID) (model.Document, error)
	CreateMarkdownIdempotent(ctx context.Context, input MarkdownDocumentCreate) (model.Document, error)
	DuplicateAuthorized(ctx context.Context, docID, workspaceID, actorID, requestID uuid.UUID) (model.Document, error)
	UpdateAuthorized(ctx context.Context, doc model.Document, categoryNames []string, actorID uuid.UUID) error
	UpdateThumbnails(ctx context.Context, id, workspaceID, actorID uuid.UUID, thumb, thumbDark, thumbPreview, thumbPreviewDark string) error
	Move(ctx context.Context, id, workspaceID, actorID uuid.UUID, targetProjectID *uuid.UUID) error
	RecordView(ctx context.Context, docID, workspaceID, userID uuid.UUID) error
	ToggleStar(ctx context.Context, docID, workspaceID, userID uuid.UUID) (bool, error)
	SetShareToken(ctx context.Context, docID, workspaceID, actorID uuid.UUID, token, visibility string) (string, error)

	// Trash
	SoftDelete(ctx context.Context, id, workspaceID, actorID uuid.UUID) error
	ListTrash(ctx context.Context, workspaceID, userID uuid.UUID) ([]model.TrashItem, error)
	GetTrashedByID(ctx context.Context, id uuid.UUID) (model.Document, error)
	Restore(ctx context.Context, id, workspaceID, actorID uuid.UUID) error
	PermanentDelete(ctx context.Context, id, workspaceID, actorID uuid.UUID) error
	EmptyTrash(ctx context.Context, workspaceID, actorID uuid.UUID) error

	// Accesses
	ListAccesses(ctx context.Context, docID, actorID uuid.UUID) ([]model.DocumentAccess, error)
	AddOrUpdateAccess(ctx context.Context, docID, workspaceID, actorID, userID uuid.UUID, level string) error
	RemoveAccess(ctx context.Context, docID, workspaceID, actorID, userID uuid.UUID) error
	GetUserAccessLevel(ctx context.Context, docID, userID uuid.UUID) (string, error)
}

type SuggestionRepository interface {
	ListSuggestions(ctx context.Context, workspaceID, documentID, actorID uuid.UUID) ([]model.DocumentSuggestion, error)
	CreateSuggestionReply(ctx context.Context, workspaceID uuid.UUID, reply model.SuggestionReply) error
	SetSuggestionResolved(ctx context.Context, workspaceID, documentID, suggestionID, actorID uuid.UUID, resolved bool) error
}

type CommentRepository interface {
	ListComments(ctx context.Context, workspaceID, documentID, actorID uuid.UUID) ([]model.CommentThread, error)
	CreateComment(ctx context.Context, workspaceID uuid.UUID, thread model.CommentThread) error
	CreateCommentReply(ctx context.Context, workspaceID, documentID uuid.UUID, reply model.CommentReply) error
	SetCommentResolved(ctx context.Context, workspaceID, documentID, threadID, actorID uuid.UUID, resolved bool) error
}
