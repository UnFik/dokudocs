package dto

import "github.com/google/uuid"

type UpdateProjectInput struct {
	ID          uuid.UUID
	WorkspaceID uuid.UUID
	UserID      uuid.UUID
	Name        string
	Description string
	LogoURL     string
	ColorBadge  string
	Visibility  string
}
