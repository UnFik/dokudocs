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
	// SetAvatar stores the picture and returns the profile. It gives
	// constant.ErrAvatarTooLarge or constant.ErrInvalidAvatar for a picture that
	// breaks the rules, and removes the file it replaces.
	SetAvatar(ctx context.Context, userID uuid.UUID, data []byte) (model.UserProfile, error)
	// RemoveAvatar clears the picture; it is not an error to have none.
	RemoveAvatar(ctx context.Context, userID uuid.UUID) error
	// OpenAvatar returns a stored picture and its type, or constant.ErrAvatarNotFound.
	OpenAvatar(ctx context.Context, key string) (data []byte, contentType string, err error)
	SearchUsers(ctx context.Context, query string, limit int) (data []model.UserSummary, err error)
}
