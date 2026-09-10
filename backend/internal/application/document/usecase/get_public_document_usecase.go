package usecase

import (
	"context"
	"strings"

	"backend/constant"
	"backend/internal/domain/model"
)

func (u *useCase) GetPublicDocument(ctx context.Context, shareToken string) (data model.Document, err error) {
	shareToken = strings.TrimSpace(shareToken)
	if shareToken == "" {
		return data, constant.ErrDocumentNotFound
	}
	data, err = u.docRepo.GetByShareToken(ctx, shareToken)
	if err != nil {
		return data, err
	}
	return data, nil
}
