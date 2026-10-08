package usecase

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"backend/internal/application/document/dto"
	"backend/internal/domain/model"
)

// ErrInvalidContentJSON means contentJSON does not fit the document: not a JSON object for
// Markdown, not a canvas for Architecture, or given for a type that has none.
var ErrInvalidContentJSON = errors.New("contentJSON must be a JSON object on a Markdown document or a canvas on an Architecture document")

// emptyCanvas is the content of a new Architecture document.
const emptyCanvas = `{"version":1,"nodes":[],"connections":[]}`

// validCanvas reports whether raw is version 1 of the Architecture canvas, with lists of nodes and connections.
func validCanvas(raw json.RawMessage) bool {
	var canvas struct {
		Version     int               `json:"version"`
		Nodes       []json.RawMessage `json:"nodes"`
		Connections []json.RawMessage `json:"connections"`
	}
	if json.Unmarshal(raw, &canvas) != nil || canvas.Version != 1 || canvas.Nodes == nil || canvas.Connections == nil {
		return false
	}
	return true
}

func (u *useCase) CreateDocument(ctx context.Context, input dto.CreateDocumentInput) (data model.Document, err error) {
	if _, err = u.checkWorkspaceMembership(ctx, input.WorkspaceID, input.UserID); err != nil {
		return data, err
	}
	if err = u.checkProjectWorkspace(ctx, input.ProjectID, input.WorkspaceID, input.UserID); err != nil {
		return data, err
	}
	title := strings.TrimSpace(input.Title)
	if title == "" {
		title = "Untitled Document"
	}
	docType := input.Type
	if docType == "" {
		docType = "markdown"
	}
	visibility := input.Visibility
	if visibility == "" {
		visibility = "inherit"
	}
	tags := input.Tags
	if tags == nil {
		tags = []string{}
	}

	doc := model.Document{
		WorkspaceID: input.WorkspaceID,
		ProjectID:   input.ProjectID,
		Title:       title,
		Type:        docType,
		Content:     input.Content,
		AuthorID:    input.UserID,
		Tags:        tags,
		IsDraft:     input.IsDraft,
		Visibility:  visibility,
	}

	switch {
	case docType == "architecture":
		// The text in content is derived from the canvas by the collaboration service.
		doc.Content = ""
		doc.ContentJSON = json.RawMessage(emptyCanvas)
		if len(input.ContentJSON) > 0 {
			if !validCanvas(input.ContentJSON) {
				return data, ErrInvalidContentJSON
			}
			doc.ContentJSON = input.ContentJSON
		}
	case len(input.ContentJSON) > 0:
		var object map[string]json.RawMessage
		if docType != "markdown" || json.Unmarshal(input.ContentJSON, &object) != nil || object == nil {
			return data, ErrInvalidContentJSON
		}
		doc.ContentJSON = input.ContentJSON
	}
	data, err = u.docRepo.CreateIdempotent(ctx, doc, input.Categories, input.RequestID)
	if err != nil {
		return data, err
	}
	return data, nil
}
