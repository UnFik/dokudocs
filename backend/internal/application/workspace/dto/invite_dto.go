package dto

import "github.com/google/uuid"

type InviteMemberInput struct {
	WorkspaceID uuid.UUID
	Email       string
	Role        string
	ActorID     uuid.UUID
}
