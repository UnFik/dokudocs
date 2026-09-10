package routes

import (
	appauth "backend/internal/application/auth/usecase"
	appws "backend/internal/application/workspace/usecase"
	"backend/internal/config"
	"backend/internal/infrastructure/runtime/container"
	"backend/internal/presentation/middleware"
	wshandler "backend/internal/presentation/workspace/handler"
)

func addWorkspaceRoutes(f Router, c *container.Container, cfg config.Config) {
	authUseCase := appauth.NewUseCase(c.DB, cfg.JWTSecret, cfg.AccessTokenTTL)
	authRequired := middleware.ValidateToken(authUseCase)

	workspaceUseCase := appws.NewUseCase(c.DB)
	workspaceHandler := wshandler.NewHandler(workspaceUseCase, c.Validator)

	wsGroup := f.Group("/workspaces", authRequired)

	// Workspaces CRUD
	wsGroup.Get("", workspaceHandler.List)
	wsGroup.Post("", workspaceHandler.Create)
	wsGroup.Get("/{id}", workspaceHandler.Get)
	wsGroup.Put("/{id}", workspaceHandler.Update)
	wsGroup.Delete("/{id}", workspaceHandler.Delete)

	// Workspace Members
	wsGroup.Get("/{id}/members", workspaceHandler.GetMembers)
	wsGroup.Post("/{id}/invites", workspaceHandler.AddMember)
	wsGroup.Delete("/{id}/members/{userId}", workspaceHandler.RemoveMember)
}
