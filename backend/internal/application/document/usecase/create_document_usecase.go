package usecase

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"backend/internal/application/document/dto"
	"backend/internal/domain/model"
)

// ErrInvalidContentJSON means contentJSON is not a JSON object, or the document is not Markdown.
var ErrInvalidContentJSON = errors.New("contentJSON must be a JSON object on a Markdown document")

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

	if len(input.ContentJSON) > 0 {
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
