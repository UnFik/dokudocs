package usecase

import (
	"context"

	"backend/internal/domain/model"
)

func (u *useCase) SearchUsers(ctx context.Context, query string, limit int) (data []model.UserSummary, err error) {
	data, err = u.repo.Search(ctx, query, limit)
	if err != nil {
		return data, err
	}
	return data, nil
}
