package usecase

import (
	"context"

	"backend/internal/application/auth/dto"

	"github.com/google/uuid"
)

// AccountUseCase is what the auth routes need on top of checking a token.
type AccountUseCase interface {
	AuthUseCase
	// SendVerificationEmail mails the User a link to prove the address; it does
	// nothing when the address is already verified.
	SendVerificationEmail(ctx context.Context, userID uuid.UUID) error
	// VerifyEmail uses a link up and returns a token that carries the verified flag.
	VerifyEmail(ctx context.Context, token string) (dto.LoginResponse, error)
}

type AuthUseCase interface {
	Login(ctx context.Context, req dto.LoginRequest) (data dto.LoginResponse, err error)
	Register(ctx context.Context, req dto.RegisterRequest) (data dto.LoginResponse, err error)
	VerifyToken(tokenString string) (data dto.ResponseUser, err error)
}
