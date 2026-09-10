package usecase

import (
	"context"

	"backend/internal/domain/model"
)

func (u *useCase) UpdateSettings(ctx context.Context, settings model.UserSettings) (data model.UserSettings, err error) {
	if err = u.repo.UpdateSettings(ctx, settings); err != nil {
		return data, err
	}

	data, err = u.repo.GetSettings(ctx, settings.UserID)
	if err != nil {
		return data, err
	}

	return data, nil
}
