package repository

import (
	"context"

	"backend/internal/domain/model"
	"github.com/google/uuid"
)

type UserRepository interface {
	FindByEmail(ctx context.Context, email string) (model.AuthUser, error)
	FindByID(ctx context.Context, id uuid.UUID) (model.UserProfile, error)
	Create(ctx context.Context, user model.AuthUser, fullName string) error
	UpdateProfile(ctx context.Context, id uuid.UUID, fullName, phone, bio, avatarURL string) error
	GetSettings(ctx context.Context, userID uuid.UUID) (model.UserSettings, error)
	UpdateSettings(ctx context.Context, settings model.UserSettings) error
	Search(ctx context.Context, query string, limit int) ([]model.UserSummary, error)
	// MarkEmailVerified records that the address was proven; it keeps an earlier date.
	MarkEmailVerified(ctx context.Context, id uuid.UUID) error
}
