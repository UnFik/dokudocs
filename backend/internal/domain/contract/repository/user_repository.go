package repository

import (
	"context"

	"backend/internal/domain/model"
)

type UserRepository interface {
	FindByEmail(ctx context.Context, email string) (model.AuthUser, error)
}
