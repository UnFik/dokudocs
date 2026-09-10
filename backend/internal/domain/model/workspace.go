package model

import (
	"time"

	"github.com/google/uuid"
)

type Workspace struct {
	ID        uuid.UUID `json:"id"`
	Name      string    `json:"name"`
	Slug      string    `json:"slug"`
	Plan      string    `json:"plan"`
	LogoURL   string    `json:"logoUrl"`
	Role      string    `json:"role"` // Current user's role in this workspace
	CreatedBy uuid.UUID `json:"createdBy"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type WorkspaceMember struct {
	WorkspaceID uuid.UUID `json:"workspaceId"`
	UserID      uuid.UUID `json:"userId"`
	Email       string    `json:"email"`
	FullName    string    `json:"fullName"`
	AvatarURL   string    `json:"avatarUrl"`
	Role        string    `json:"role"`
	JoinedAt    time.Time `json:"joinedAt"`
}
