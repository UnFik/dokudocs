package usecase

import (
	"context"
	"strings"

	"backend/internal/application/document/dto"
	"backend/internal/domain/model"
)

func (u *useCase) CreateDocument(ctx context.Context, input dto.CreateDocumentInput) (data model.Document, err error) {
	if _, err = u.checkWorkspaceMembership(ctx, input.WorkspaceID, input.UserID); err != nil {
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

	data, err = u.docRepo.Create(ctx, doc, input.Categories)
	if err != nil {
		return data, err
	}
	return data, nil
}
