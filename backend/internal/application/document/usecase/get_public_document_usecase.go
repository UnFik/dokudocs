package usecase

import (
	"context"
	"strings"

	"backend/constant"
	"backend/internal/domain/model"
	"backend/internal/domain/policy"
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
	if !policy.CanReadDocument(data, policy.DocumentAccessContext{PublicLinkTokenValid: true}) {
		return model.Document{}, constant.ErrDocumentNotFound
	}
	return data, nil
}
