package dto

import "github.com/google/uuid"

type UpdateProjectInput struct {
	ID          uuid.UUID
	WorkspaceID uuid.UUID
	UserID      uuid.UUID
	Name        string
	Description *string // nil keeps the value, "" clears it
	LogoURL     *string // nil keeps the value, "" clears it
	ColorBadge  string
	Visibility  string
}
