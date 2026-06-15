package middleware

import (
	"context"
	"net/http"
	"strings"

	"backend/constant"
	"backend/internal/application/auth/dto"
	usecasecontract "backend/internal/domain/contract/usecase"
	"backend/internal/presentation/response"
)

type contextKey string

const userContextKey = contextKey("auth-user")

func ValidateToken(service usecasecontract.AuthUseCase) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			header := r.Header.Get("Authorization")
			if strings.TrimSpace(header) == "" {
				response.Error(w, http.StatusUnauthorized, "missing bearer token")
				return
			}
			const prefix = "Bearer "
			if !strings.HasPrefix(header, prefix) || strings.TrimSpace(strings.TrimPrefix(header, prefix)) == "" {
				response.Error(w, http.StatusUnauthorized, constant.ErrInvalidToken.Error())
				return
			}
			user, err := service.VerifyToken(strings.TrimSpace(strings.TrimPrefix(header, prefix)))
			if err != nil {
				response.Error(w, http.StatusUnauthorized, constant.ErrInvalidToken.Error())
				return
			}
			ctx := context.WithValue(r.Context(), userContextKey, user)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func UserFromContext(ctx context.Context) (dto.ResponseUser, bool) {
	user, ok := ctx.Value(userContextKey).(dto.ResponseUser)
	return user, ok
}
