package usecase

import (
	"context"

	"backend/internal/domain/model"

	"github.com/google/uuid"
)

func (u *useCase) GetProfile(ctx context.Context, userID uuid.UUID) (data model.UserProfile, err error) {
	data, err = u.repo.FindByID(ctx, userID)
	if err != nil {
		return data, err
	}
	return data, nil
}
