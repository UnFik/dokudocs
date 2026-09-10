package dto

import "github.com/google/uuid"

type CreateDocumentInput struct {
	WorkspaceID uuid.UUID
	UserID      uuid.UUID
	Title       string
	Type        string
	Content     string
	Visibility  string
	Tags        []string
	Categories  []string
	IsDraft     bool
	ProjectID   *uuid.UUID
}
