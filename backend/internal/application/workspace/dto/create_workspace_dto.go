package dto

import "github.com/google/uuid"

type CreateWorkspaceInput struct {
	Name    string
	Plan    string
	LogoURL string
	UserID  uuid.UUID
}
