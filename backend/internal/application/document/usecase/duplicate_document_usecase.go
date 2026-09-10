package usecase

import (
	"context"
	"fmt"

	"backend/internal/domain/model"

	"github.com/google/uuid"
)

func (u *useCase) DuplicateDocument(ctx context.Context, id, workspaceID, userID uuid.UUID) (data model.Document, err error) {
	doc, err := u.GetDocument(ctx, id, workspaceID, userID)
	if err != nil {
		return data, err
	}

	copyTitle := fmt.Sprintf("Copy of %s", doc.Title)
	clone := model.Document{
		WorkspaceID: workspaceID,
		ProjectID:   doc.ProjectID,
		Title:       copyTitle,
		Type:        doc.Type,
		Content:     doc.Content,
		AuthorID:    userID,
		Tags:        doc.Tags,
		IsDraft:     doc.IsDraft,
		Visibility:  doc.Visibility,
	}

	data, err = u.docRepo.Create(ctx, clone, doc.Categories)
	if err != nil {
		return data, err
	}
	return data, nil
}
