package usecase

import (
	"context"

	"backend/internal/domain/model"

	"github.com/google/uuid"
)

func (u *useCase) GetSettings(ctx context.Context, userID uuid.UUID) (data model.UserSettings, err error) {
	data, err = u.repo.GetSettings(ctx, userID)
	if err != nil {
		return data, err
	}
	return data, nil
}
