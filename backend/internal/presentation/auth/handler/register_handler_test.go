package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"backend/internal/application/auth/dto"
	"backend/internal/infrastructure/validator"
)

func TestRegisterHandlerSuccess(t *testing.T) {
	h := NewHandler(fakeAuthUseCase{
		loginResp: dto.LoginResponse{AccessToken: "reg-token", User: dto.ResponseUser{Email: "new@example.com"}},
	}, validator.New())
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", strings.NewReader(`{"email":"new@example.com","password":"password123","fullName":"New User"}`))
	h.Register(recorder, request)
	if recorder.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusCreated)
	}
	if !strings.Contains(recorder.Body.String(), `"accessToken":"reg-token"`) {
		t.Fatalf("body = %q", recorder.Body.String())
	}
}
