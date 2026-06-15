package usecase

import (
	"context"

	"backend/internal/application/auth/dto"
)

type AuthUseCase interface {
	Login(ctx context.Context, req dto.LoginRequest) (dto.LoginResponse, error)
	VerifyToken(tokenString string) (dto.ResponseUser, error)
}
