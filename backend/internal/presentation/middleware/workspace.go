package middleware

import (
	"context"
	"net/http"
	"strings"

	usecasecontract "backend/internal/domain/contract/usecase"
	"backend/internal/presentation/response"

	"github.com/google/uuid"
)

const (
	workspaceIDContextKey   = contextKey("workspace-id")
	workspaceRoleContextKey = contextKey("workspace-role")
)

func RequireWorkspace(service usecasecontract.WorkspaceUseCase) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			user, ok := UserFromContext(r.Context())
			if !ok {
				response.Error(w, http.StatusUnauthorized, "unauthorized")
				return
			}
			rawID := r.Header.Get("X-Workspace-Id")
			if strings.TrimSpace(rawID) == "" {
				rawID = r.URL.Query().Get("workspace_id")
			}
			if strings.TrimSpace(rawID) == "" {
				response.Error(w, http.StatusBadRequest, "missing X-Workspace-Id header")
				return
			}
			wsID, err := uuid.Parse(rawID)
			if err != nil {
				response.Error(w, http.StatusBadRequest, "invalid workspace ID")
				return
			}
			userUUID, err := uuid.Parse(user.ID)
			if err != nil {
				response.Error(w, http.StatusUnauthorized, "invalid user ID")
				return
			}
			role, err := service.GetUserRole(r.Context(), wsID, userUUID)
			if err != nil {
				response.Error(w, http.StatusForbidden, "not a member of this workspace")
				return
			}

			ctx := context.WithValue(r.Context(), workspaceIDContextKey, wsID)
			ctx = context.WithValue(ctx, workspaceRoleContextKey, role)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func WorkspaceFromContext(ctx context.Context) (uuid.UUID, string, bool) {
	wsID, ok1 := ctx.Value(workspaceIDContextKey).(uuid.UUID)
	role, ok2 := ctx.Value(workspaceRoleContextKey).(string)
	return wsID, role, ok1 && ok2
}

// ContextWithWorkspace sets what RequireWorkspace would, for handlers tested without it.
func ContextWithWorkspace(ctx context.Context, workspaceID uuid.UUID, role string) context.Context {
	ctx = context.WithValue(ctx, workspaceIDContextKey, workspaceID)
	return context.WithValue(ctx, workspaceRoleContextKey, role)
}
