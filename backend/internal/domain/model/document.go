package model

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

type UserAuthor struct {
	ID     uuid.UUID `json:"id"`
	Name   string    `json:"name"`
	Email  string    `json:"email"`
	Avatar string    `json:"avatar"`
}

type Document struct {
	ID          uuid.UUID  `json:"id"`
	WorkspaceID uuid.UUID  `json:"workspaceId"`
	ProjectID   *uuid.UUID `json:"projectId,omitempty"`
	ProjectName string     `json:"projectName,omitempty"`
	Title       string     `json:"title"`
	Type        string     `json:"type"` // markdown, dbdiagram, mermaid, architecture
	Content     string     `json:"content"`
	// ContentJSON is the editor document as ProseMirror JSON; only the single-document read fills it.
	ContentJSON json.RawMessage `json:"contentJSON,omitempty"`
	AuthorID    uuid.UUID       `json:"authorId"`
	Author      UserAuthor      `json:"author"`
	// UpdatedBy is the person whose edit was stored last; nil before the first edit. Only the single-document read fills it.
	UpdatedBy            *UserAuthor `json:"updatedBy,omitempty"`
	Tags                 []string    `json:"tags"`
	IsDraft              bool        `json:"isDraft"`
	Visibility           string      `json:"visibility"` // workspace, private, public_link, inherit
	Thumbnail            string      `json:"thumbnail,omitempty"`
	ThumbnailDark        string      `json:"thumbnailDark,omitempty"`
	ThumbnailPreview     string      `json:"thumbnailPreview,omitempty"`
	ThumbnailPreviewDark string      `json:"thumbnailPreviewDark,omitempty"`
	IsStarred            bool        `json:"isStarred"`
	StarredAt            *time.Time  `json:"starredAt,omitempty"`
	IsShared             bool        `json:"isShared"`
	ViewCount            int         `json:"viewCount"`
	LastViewedAt         *time.Time  `json:"lastViewedAt,omitempty"`
	Categories           []string    `json:"categories"`
	Category             string      `json:"category,omitempty"` // Primary / first category
	CreatedAt            time.Time   `json:"createdAt"`
	UpdatedAt            time.Time   `json:"updatedAt"`
	DeletedAt            *time.Time  `json:"deletedAt,omitempty"`
	DeletedBy            *uuid.UUID  `json:"deletedBy,omitempty"`
	DeletedByUser        *UserAuthor `json:"deletedByUser,omitempty"`
}

type DocumentRevision struct {
	ID            uuid.UUID       `json:"id"`
	DocumentID    uuid.UUID       `json:"documentId"`
	AuthorID      uuid.UUID       `json:"authorId"`
	VersionNumber int             `json:"versionNumber"`
	Title         string          `json:"title,omitempty"`
	Content       string          `json:"content"`
	IsNamed       bool            `json:"isNamed"`
	ContentJSON   json.RawMessage `json:"contentJSON,omitempty"`
	BodyVersion   *int64          `json:"bodyVersion,omitempty"`
	CreatedAt     time.Time       `json:"createdAt"`
	UpdatedAt     time.Time       `json:"updatedAt"`
}

type DocumentRestoreResult struct {
	DocumentID       uuid.UUID `json:"documentId"`
	RevisionID       uuid.UUID `json:"revisionId"`
	SourceRevisionID uuid.UUID `json:"sourceRevisionId"`
	BodyVersion      int64     `json:"bodyVersion"`
}

type TrashItem struct {
	ID            uuid.UUID  `json:"id"`
	DocID         uuid.UUID  `json:"docId"`
	Document      Document   `json:"document"`
	DeletedAt     time.Time  `json:"deletedAt"`
	DeletedBy     UserAuthor `json:"deletedBy"`
	DaysRemaining int        `json:"daysRemaining"`
}

type DocumentAccess struct {
	DocumentID  uuid.UUID  `json:"documentId"`
	UserID      uuid.UUID  `json:"userId"`
	AccessLevel string     `json:"accessLevel"` // owner, edit, comment, view
	CreatedAt   time.Time  `json:"createdAt"`
	User        UserAuthor `json:"user"`
}

type DocumentSuggestion struct {
	DocumentID     uuid.UUID         `json:"documentId"`
	SuggestionID   uuid.UUID         `json:"suggestionId"`
	ProposerID     uuid.UUID         `json:"proposerId"`
	ProposerName   string            `json:"proposerName"`
	DeciderID      *uuid.UUID        `json:"deciderId,omitempty"`
	ConflictReason string            `json:"conflictReason"`
	Status         string            `json:"status"`
	CreatedAt      time.Time         `json:"createdAt"`
	DecidedAt      *time.Time        `json:"decidedAt,omitempty"`
	ResolvedAt     *time.Time        `json:"resolvedAt,omitempty"`
	ResolvedBy     *uuid.UUID        `json:"resolvedBy,omitempty"`
	Replies        []SuggestionReply `json:"replies"`
}

// SuggestionReply is one message in a suggestion's discussion thread.
type SuggestionReply struct {
	DocumentID   uuid.UUID `json:"documentId"`
	SuggestionID uuid.UUID `json:"suggestionId"`
	ReplyID      uuid.UUID `json:"replyId"`
	AuthorID     uuid.UUID `json:"authorId"`
	Body         string    `json:"body"`
	CreatedAt    time.Time `json:"createdAt"`
}

// CommentThread is a discussion anchored to text in a document.
type CommentThread struct {
	ID           uuid.UUID       `json:"id"`
	DocumentID   uuid.UUID       `json:"documentId"`
	AuthorID     uuid.UUID       `json:"authorId"`
	AuthorName   string          `json:"authorName"`
	SelectedText string          `json:"selectedText"`
	Content      string          `json:"content"`
	Anchor       json.RawMessage `json:"anchor,omitempty"`
	CreatedAt    time.Time       `json:"createdAt"`
	EditedAt     *time.Time      `json:"editedAt,omitempty"`
	ResolvedAt   *time.Time      `json:"resolvedAt,omitempty"`
	ResolvedBy   *uuid.UUID      `json:"resolvedBy,omitempty"`
	Replies      []CommentReply  `json:"replies"`
}

// CommentReply is one message after the first in a comment thread.
type CommentReply struct {
	ID         uuid.UUID `json:"id"`
	ThreadID   uuid.UUID `json:"threadId"`
	AuthorID   uuid.UUID `json:"authorId"`
	AuthorName string    `json:"authorName"`
	Content    string    `json:"content"`
	CreatedAt  time.Time `json:"createdAt"`
	// EditedAt is set once the author has changed the text.
	EditedAt *time.Time `json:"editedAt,omitempty"`
}
