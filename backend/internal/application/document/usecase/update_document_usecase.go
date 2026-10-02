package usecase

import (
	"context"
	"strings"

	"backend/constant"
	"backend/internal/application/document/dto"
	"backend/internal/domain/model"
)

func (u *useCase) UpdateDocument(ctx context.Context, input dto.UpdateDocumentInput) (data model.Document, err error) {
	doc, err := u.GetDocument(ctx, input.ID, input.WorkspaceID, input.UserID)
	if err != nil {
		return data, err
	}
	canManage, err := u.canManageDoc(ctx, doc, input.WorkspaceID, input.UserID)
	if err != nil || !canManage {
		return data, constant.ErrForbidden
	}

	if input.Title != "" {
		doc.Title = strings.TrimSpace(input.Title)
	}
	if input.Content != "" {
		doc.Content = input.Content
	}
	if input.Visibility != "" {
		doc.Visibility = input.Visibility
	}
	if input.Tags != nil {
		doc.Tags = input.Tags
	}
	if input.IsDraft != nil {
		doc.IsDraft = *input.IsDraft
	}
	if input.ProjectID != nil {
		if !sameProject(doc.ProjectID, input.ProjectID) {
			if err := u.checkProjectWorkspace(ctx, input.ProjectID, doc.WorkspaceID, input.UserID); err != nil {
				return data, err
			}
		}
		doc.ProjectID = input.ProjectID
	}

	if err = u.docRepo.UpdateAuthorized(ctx, doc, input.Categories, input.UserID); err != nil {
		return data, err
	}
	data, err = u.GetDocument(ctx, input.ID, input.WorkspaceID, input.UserID)
	if err != nil {
		return data, err
	}
	return data, nil
}
