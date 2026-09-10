package usecase

import (
	"context"

	"backend/internal/application/auth/dto"
)

type AuthUseCase interface {
	Login(ctx context.Context, req dto.LoginRequest) (data dto.LoginResponse, err error)
	Register(ctx context.Context, req dto.RegisterRequest) (data dto.LoginResponse, err error)
	VerifyToken(tokenString string) (data dto.ResponseUser, err error)
}
