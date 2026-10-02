package usecase

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"backend/constant"
	"backend/internal/application/auth/dto"
	"backend/internal/application/utils"
)

func (u *useCase) Login(ctx context.Context, req dto.LoginRequest) (data dto.LoginResponse, err error) {
	email := strings.TrimSpace(strings.ToLower(req.Email))
	if email == "" || req.Password == "" {
		return data, constant.ErrMissingCredential
	}

	user, err := u.users.FindByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return data, constant.ErrInvalidCredentials
		}
		return data, err
	}
	if !utils.ComparePasswordHash(user.PasswordHash, req.Password) {
		return data, constant.ErrInvalidCredentials
	}

	data, err = u.tokens.Issue(user)
	if err != nil {
		return data, err
	}

	return data, nil
}
