package presenter

import (
	"encoding/json"

	"github.com/google/uuid"
)

type CreateDocumentRequest struct {
	Title       string                     `json:"title"`
	Type        string                     `json:"type"`
	Content     string                     `json:"content"`
	InitialBody *CreateMarkdownBodyRequest `json:"initialBody,omitempty"`
	Visibility  string                     `json:"visibility"`
	Tags        []string                   `json:"tags"`
	Categories  []string                   `json:"categories"`
	IsDraft     bool                       `json:"isDraft"`
	ProjectID   *uuid.UUID                 `json:"projectId"`
}

type CreateMarkdownBodyRequest struct {
	DocumentID        uuid.UUID                `json:"documentID"`
	BodySchemaVersion int                      `json:"bodySchemaVersion"`
	RootNodeID        uuid.UUID                `json:"rootNodeID"`
	Nodes             []CreateMarkdownBodyNode `json:"nodes"`
}

type CreateMarkdownBodyNode struct {
	NodeID       uuid.UUID       `json:"nodeID"`
	ParentID     *uuid.UUID      `json:"parentID"`
	SiblingOrder float64         `json:"siblingOrder"`
	Type         string          `json:"type"`
	Content      string          `json:"content"`
	Attributes   json.RawMessage `json:"attributes"`
}
