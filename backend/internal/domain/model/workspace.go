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

// MemberProfile is what a hover card shows of a workspace member to the others.
// It leaves out what a member keeps private, such as the phone number.
type MemberProfile struct {
	UserID    uuid.UUID `json:"userId"`
	Email     string    `json:"email"`
	FullName  string    `json:"fullName"`
	AvatarURL string    `json:"avatarUrl"`
	Bio       string    `json:"bio"`
	Role      string    `json:"role"`
	JoinedAt  time.Time `json:"joinedAt"`
}

// WorkspaceInvite is an offer to join a workspace, sent to one email address.
// The link token is never kept here; only its hash is stored.
type WorkspaceInvite struct {
	ID          uuid.UUID `json:"id"`
	WorkspaceID uuid.UUID `json:"workspaceId"`
	Email       string    `json:"email"`
	Role        string    `json:"role"`
	InvitedBy   uuid.UUID `json:"invitedBy"`
	ExpiresAt   time.Time `json:"expiresAt"`
	CreatedAt   time.Time `json:"createdAt"`
	LastSentAt  time.Time `json:"lastSentAt"`
}

// InvitePreview is what someone with the link may see before signing in.
type InvitePreview struct {
	WorkspaceName string
	InviterName   string
	Role          string
	// Email is the invited address, masked by the use case.
	Email string
}
