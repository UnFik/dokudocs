package dto

import "github.com/google/uuid"

type UpdateWorkspaceInput struct {
	ID      uuid.UUID
	Name    string
	Plan    string
	LogoURL string
	UserID  uuid.UUID
}
