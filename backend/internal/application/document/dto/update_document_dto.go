package dto

import "github.com/google/uuid"

type UpdateDocumentInput struct {
	ID          uuid.UUID
	WorkspaceID uuid.UUID
	UserID      uuid.UUID
	Title       string
	Content     string
	Visibility  string
	Tags        []string
	Categories  []string
	IsDraft     *bool
	ProjectID   *uuid.UUID
}
