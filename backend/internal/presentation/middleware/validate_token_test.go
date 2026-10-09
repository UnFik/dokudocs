package middleware_test

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"backend/internal/application/auth/dto"
	"backend/internal/infrastructure/logger"
	inframiddleware "backend/internal/infrastructure/middleware"
	"backend/internal/presentation/middleware"
)

type tokenOnly struct{}

func (tokenOnly) Login(context.Context, dto.LoginRequest) (dto.LoginResponse, error) {
	return dto.LoginResponse{}, nil
}
func (tokenOnly) Register(context.Context, dto.RegisterRequest) (dto.LoginResponse, error) {
	return dto.LoginResponse{}, nil
}
func (tokenOnly) VerifyToken(string) (dto.ResponseUser, error) {
	return dto.ResponseUser{ID: "user-7", Email: "someone@example.com"}, nil
}

func TestValidateTokenPutsTheUserOnTheRequestLogLine(t *testing.T) {
	var out bytes.Buffer
	ok := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
	handler := inframiddleware.Logger(logger.NewJSON(&out))(middleware.ValidateToken(tokenOnly{})(ok))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/users/me", nil)
	req.Header.Set("Authorization", "Bearer a-token")
	handler.ServeHTTP(httptest.NewRecorder(), req)

	if !strings.Contains(out.String(), `"user_id":"user-7"`) {
		t.Fatalf("log line has no user_id: %s", out.String())
	}
	if strings.Contains(out.String(), "someone@example.com") || strings.Contains(out.String(), "a-token") {
		t.Fatalf("log line carries the email or the token: %s", out.String())
	}
}
