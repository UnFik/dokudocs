package usecase

import (
	"context"

	"backend/internal/application/user/dto"
	"backend/internal/domain/model"

	"github.com/google/uuid"
)

type UserUseCase interface {
	GetProfile(ctx context.Context, userID uuid.UUID) (data model.UserProfile, err error)
	UpdateProfile(ctx context.Context, input dto.UpdateProfileInput) (data model.UserProfile, err error)
	GetSettings(ctx context.Context, userID uuid.UUID) (data model.UserSettings, err error)
	UpdateSettings(ctx context.Context, settings model.UserSettings) (data model.UserSettings, err error)
	SearchUsers(ctx context.Context, query string, limit int) (data []model.UserSummary, err error)
}
