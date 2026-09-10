package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"backend/constant"
	"backend/internal/application/auth/dto"
	"backend/internal/infrastructure/validator"
)

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
