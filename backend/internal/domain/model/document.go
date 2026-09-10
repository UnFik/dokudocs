package model

import (
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
	ID                   uuid.UUID   `json:"id"`
	WorkspaceID          uuid.UUID   `json:"workspaceId"`
	ProjectID            *uuid.UUID  `json:"projectId,omitempty"`
	ProjectName          string      `json:"projectName,omitempty"`
	Title                string      `json:"title"`
	Type                 string      `json:"type"` // markdown, dbdiagram, mermaid
	Content              string      `json:"content"`
	AuthorID             uuid.UUID   `json:"authorId"`
	Author               UserAuthor  `json:"author"`
	Tags                 []string    `json:"tags"`
	IsDraft              bool        `json:"isDraft"`
	Visibility           string      `json:"visibility"` // workspace, private, public_link, inherit
	ShareToken           string      `json:"shareToken,omitempty"`
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

type TrashItem struct {
	ID            uuid.UUID   `json:"id"`
	DocID         uuid.UUID   `json:"docId"`
	Document      Document    `json:"document"`
	DeletedAt     time.Time   `json:"deletedAt"`
	DeletedBy     UserAuthor  `json:"deletedBy"`
	DaysRemaining int         `json:"daysRemaining"`
}

type DocumentAccess struct {
	DocumentID  uuid.UUID  `json:"documentId"`
	UserID      uuid.UUID  `json:"userId"`
	AccessLevel string     `json:"accessLevel"` // owner, edit, comment, view
	CreatedAt   time.Time  `json:"createdAt"`
	User        UserAuthor `json:"user"`
}
