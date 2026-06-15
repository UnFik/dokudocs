package repository

import (
	"context"

	"backend/internal/domain/model"
)

type UserRepository struct {
	User model.AuthUser
	Err  error
}

func (r UserRepository) FindByEmail(context.Context, string) (model.AuthUser, error) {
	return r.User, r.Err
}
