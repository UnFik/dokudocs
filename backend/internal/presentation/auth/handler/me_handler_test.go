package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"backend/internal/application/auth/dto"
	"backend/internal/infrastructure/validator"
	"backend/internal/presentation/middleware"
)

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
