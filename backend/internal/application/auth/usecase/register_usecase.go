package usecase

import (
	"context"
	"fmt"
	"strings"
	"time"

	"backend/constant"
	"backend/internal/application/auth/dto"
	"backend/internal/application/utils"
	"backend/internal/domain/model"

	"github.com/google/uuid"
)

func (u *useCase) Register(ctx context.Context, req dto.RegisterRequest) (data dto.LoginResponse, err error) {
	email := strings.TrimSpace(strings.ToLower(req.Email))
	if email == "" || strings.TrimSpace(req.Password) == "" {
		return data, constant.ErrMissingCredential
	}
	existing, err := u.users.FindByEmail(ctx, email)
	if err == nil && existing.Email != "" {
		return data, constant.ErrEmailAlreadyExists
	}
	hash, err := utils.HashPassword(req.Password)
	if err != nil {
		return data, err
	}
	fullName := strings.TrimSpace(req.FullName)
	if fullName == "" {
		fullName = strings.Split(email, "@")[0]
	}
	accountNo := fmt.Sprintf("ACC%d", time.Now().UnixNano()%1000000)
	user := model.AuthUser{
		ID:           uuid.New(),
		AccountNo:    accountNo,
		Email:        email,
		PasswordHash: hash,
		Roles:        []string{"member"},
		CreatedAt:    time.Now(),
		UpdatedAt:    time.Now(),
	}
	if err = u.users.Create(ctx, user, fullName); err != nil {
		return data, err
	}

	data, err = u.tokens.Issue(user)
	if err != nil {
		return data, err
	}

	return data, nil
}
