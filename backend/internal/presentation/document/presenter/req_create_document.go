package presenter

import (
	"encoding/json"

	"github.com/google/uuid"
)

type CreateDocumentRequest struct {
	Title       string          `json:"title"`
	Type        string          `json:"type"`
	Content     string          `json:"content"`
	ContentJSON json.RawMessage `json:"contentJSON,omitempty"`
	Visibility  string          `json:"visibility"`
	Tags        []string        `json:"tags"`
	Categories  []string        `json:"categories"`
	IsDraft     bool            `json:"isDraft"`
	ProjectID   *uuid.UUID      `json:"projectId"`
}
