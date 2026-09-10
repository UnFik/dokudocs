package routes

import (
	appauth "backend/internal/application/auth/usecase"
	appproject "backend/internal/application/project/usecase"
	appws "backend/internal/application/workspace/usecase"
	"backend/internal/config"
	"backend/internal/infrastructure/runtime/container"
	"backend/internal/presentation/middleware"
	projecthandler "backend/internal/presentation/project/handler"
)

func addProjectRoutes(f Router, c *container.Container, cfg config.Config) {
	authUseCase := appauth.NewUseCase(c.DB, cfg.JWTSecret, cfg.AccessTokenTTL)
	authRequired := middleware.ValidateToken(authUseCase)

	workspaceUseCase := appws.NewUseCase(c.DB)
	workspaceRequired := middleware.RequireWorkspace(workspaceUseCase)

	projectUseCase := appproject.NewUseCase(c.DB)
	projectHandler := projecthandler.NewHandler(projectUseCase, c.Validator)

	// Projects group protected by auth and workspace middleware
	projectGroup := f.Group("/projects", authRequired, workspaceRequired)

	// Projects CRUD & Star
	projectGroup.Get("", projectHandler.List)
	projectGroup.Post("", projectHandler.Create)
	projectGroup.Get("/{id}", projectHandler.Get)
	projectGroup.Put("/{id}", projectHandler.Update)
	projectGroup.Delete("/{id}", projectHandler.Delete)
	projectGroup.Post("/{id}/star", projectHandler.ToggleStar)

	// Project Categories
	projectGroup.Get("/{id}/categories", projectHandler.ListCategories)
	projectGroup.Post("/{id}/categories", projectHandler.AddCategory)
	projectGroup.Put("/{id}/categories/reorder", projectHandler.ReorderCategories)
	projectGroup.Put("/{id}/categories/{categoryId}", projectHandler.UpdateCategory)
	projectGroup.Delete("/{id}/categories/{categoryId}", projectHandler.DeleteCategory)

	// Project Members
	projectGroup.Get("/{id}/members", projectHandler.ListMembers)
	projectGroup.Post("/{id}/members", projectHandler.AddMember)
	projectGroup.Delete("/{id}/members/{userId}", projectHandler.RemoveMember)
}
