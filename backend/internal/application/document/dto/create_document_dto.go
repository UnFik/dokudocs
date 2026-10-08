package dto

import (
	"encoding/json"

	"github.com/google/uuid"
)

type CreateDocumentInput struct {
	WorkspaceID uuid.UUID
	UserID      uuid.UUID
	RequestID   uuid.UUID
	Title       string
	Type        string
	Content     string
	// ContentJSON is the document as ProseMirror JSON, for a Markdown document.
	ContentJSON json.RawMessage
	Visibility  string
	Tags        []string
	Categories  []string
	IsDraft     bool
	ProjectID   *uuid.UUID
}
