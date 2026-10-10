package handler

import (
	"context"
	"github.com/google/uuid"

	"backend/internal/application/auth/dto"
)

type fakeAuthUseCase struct {
	loginResp dto.LoginResponse
	loginErr  error
	user      dto.ResponseUser
	verifyErr error
}

func (f fakeAuthUseCase) Login(context.Context, dto.LoginRequest) (dto.LoginResponse, error) {
	return f.loginResp, f.loginErr
}

func (f fakeAuthUseCase) Register(context.Context, dto.RegisterRequest) (dto.LoginResponse, error) {
	return f.loginResp, f.loginErr
}

func (f fakeAuthUseCase) VerifyToken(string) (dto.ResponseUser, error) {
	return f.user, f.verifyErr
}

func (f fakeAuthUseCase) SendVerificationEmail(context.Context, uuid.UUID) error { return nil }

func (f fakeAuthUseCase) VerifyEmail(context.Context, string) (dto.LoginResponse, error) {
	return f.loginResp, f.loginErr
}
