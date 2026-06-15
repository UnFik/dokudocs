package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"backend/constant"
	"backend/internal/application/auth/dto"
	"backend/internal/infrastructure/validator"
	"backend/internal/presentation/middleware"
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

func (f fakeAuthUseCase) VerifyToken(string) (dto.ResponseUser, error) {
	return f.user, f.verifyErr
}

func TestLoginHandlerSuccessEnvelope(t *testing.T) {
	h := NewHandler(fakeAuthUseCase{loginResp: dto.LoginResponse{AccessToken: "token", User: dto.ResponseUser{Email: "admin@example.com"}}}, validator.New())
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(`{"email":"admin@example.com","password":"password123"}`))
	h.Login(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d", recorder.Code)
	}
	if !strings.Contains(recorder.Body.String(), `"data"`) || !strings.Contains(recorder.Body.String(), `"accessToken":"token"`) {
		t.Fatalf("body = %q", recorder.Body.String())
	}
}

func TestLoginHandlerValidationError(t *testing.T) {
	h := NewHandler(fakeAuthUseCase{}, validator.New())
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(`{}`))
	h.Login(recorder, request)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d", recorder.Code)
	}
}

func TestLoginHandlerBadCredentials(t *testing.T) {
	h := NewHandler(fakeAuthUseCase{loginErr: constant.ErrInvalidCredentials}, validator.New())
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(`{"email":"admin@example.com","password":"wrong"}`))
	h.Login(recorder, request)
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d", recorder.Code)
	}
}

func TestMeHandlerValidToken(t *testing.T) {
	user := dto.ResponseUser{Email: "admin@example.com"}
	svc := fakeAuthUseCase{user: user}
	h := NewHandler(svc, validator.New())
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	request.Header.Set("Authorization", "Bearer token")
	middleware.ValidateToken(svc)(http.HandlerFunc(h.Me)).ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d", recorder.Code)
	}
	if strings.Contains(recorder.Body.String(), "PasswordHash") {
		t.Fatalf("body leaked password hash: %q", recorder.Body.String())
	}
}
