package model

import (
	"time"

	"github.com/google/uuid"
)

type Project struct {
	ID             uuid.UUID         `json:"id"`
	WorkspaceID    uuid.UUID         `json:"workspaceId"`
	Name           string            `json:"name"`
	Description    string            `json:"description"`
	LogoURL        string            `json:"logoUrl"`
	ColorBadge     string            `json:"colorBadge"`
	Visibility     string            `json:"visibility"`
	IsStarred      bool              `json:"isStarred"`
	StarredAt      *time.Time        `json:"starredAt,omitempty"`
	Categories     []ProjectCategory `json:"categories,omitempty"`
	CategoryNames  []string          `json:"categoryNames,omitempty"`
	CategoryColors map[string]string `json:"categoryColors,omitempty"`
	DocumentCount  int               `json:"documentCount"`
	Role           string            `json:"role,omitempty"` // User's role in this project (if direct member)
	CreatedBy      uuid.UUID         `json:"createdBy"`
	CreatedAt      time.Time         `json:"createdAt"`
	UpdatedAt      time.Time         `json:"updatedAt"`
	DeletedAt      *time.Time        `json:"deletedAt,omitempty"`
}

type ProjectCategory struct {
	ID        uuid.UUID `json:"id"`
	ProjectID uuid.UUID `json:"projectId"`
	Name      string    `json:"name"`
	ColorID   string    `json:"colorId"`
	SortOrder int       `json:"sortOrder"`
	CreatedAt time.Time `json:"createdAt"`
}

type ProjectMemberUser struct {
	ID        uuid.UUID `json:"id"`
	Email     string    `json:"email"`
	FullName  string    `json:"name"`
	AvatarURL string    `json:"avatar"`
}

type ProjectMember struct {
	ID        string            `json:"id"` // projectID:userID composite or string
	ProjectID uuid.UUID         `json:"projectId"`
	UserID    uuid.UUID         `json:"userId"`
	Role      string            `json:"role"` // 'manager', 'editor', 'viewer'
	CreatedAt time.Time         `json:"createdAt"`
	User      ProjectMemberUser `json:"user"`
}
