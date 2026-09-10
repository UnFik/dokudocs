package handler

import (
	"context"

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
