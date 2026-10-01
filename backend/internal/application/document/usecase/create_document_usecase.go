package usecase

import (
	"context"
	"strings"

	"backend/internal/application/collaboration"
	"backend/internal/application/document/dto"
	"backend/internal/domain/contract/repository"
	"backend/internal/domain/model"

	"github.com/google/uuid"
)

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
		ID:          input.DocumentID,
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

	if input.InitialBody != nil {
		if docType != "markdown" || input.DocumentID == uuid.Nil || input.Content != "" ||
			input.InitialBody.DocumentID != input.DocumentID || input.BodySchemaVersion < 1 {
			return data, collaboration.ErrInvalidBodyInitialization
		}
		return u.docRepo.CreateMarkdownIdempotent(ctx, repository.MarkdownDocumentCreate{
			Document: doc, Categories: input.Categories, RequestID: input.RequestID,
			Body: *input.InitialBody, BodySchemaVersion: input.BodySchemaVersion,
		})
	}
	doc.ID = uuid.Nil
	data, err = u.docRepo.CreateIdempotent(ctx, doc, input.Categories, input.RequestID)
	if err != nil {
		return data, err
	}
	return data, nil
}
