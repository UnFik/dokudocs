package presenter

import "github.com/google/uuid"

type UpdateDocumentRequest struct {
	Title      string     `json:"title"`
	Content    string     `json:"content"`
	Visibility string     `json:"visibility"`
	Tags       []string   `json:"tags"`
	Categories []string   `json:"categories"`
	IsDraft    *bool      `json:"isDraft"`
	ProjectID  *uuid.UUID `json:"projectId"`
}
