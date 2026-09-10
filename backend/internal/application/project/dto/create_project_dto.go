package dto

import "github.com/google/uuid"

type CreateProjectInput struct {
	WorkspaceID uuid.UUID
	UserID      uuid.UUID
	Name        string
	Description string
	LogoURL     string
	ColorBadge  string
	Visibility  string
	Categories  []string
}
