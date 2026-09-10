package routes

import (
	appauth "backend/internal/application/auth/usecase"
	appdoc "backend/internal/application/document/usecase"
	appws "backend/internal/application/workspace/usecase"
	"backend/internal/config"
	"backend/internal/infrastructure/runtime/container"
	dochandler "backend/internal/presentation/document/handler"
	"backend/internal/presentation/middleware"
)

func addDocumentRoutes(f Router, c *container.Container, cfg config.Config) {
	authUseCase := appauth.NewUseCase(c.DB, cfg.JWTSecret, cfg.AccessTokenTTL)
	authRequired := middleware.ValidateToken(authUseCase)

	workspaceUseCase := appws.NewUseCase(c.DB)
	workspaceRequired := middleware.RequireWorkspace(workspaceUseCase)

	docUseCase := appdoc.NewUseCase(c.DB)
	docHandler := dochandler.NewHandler(docUseCase, c.Validator)

	// Public Shared Documents (No auth required)
	f.Get("/public/documents/{shareToken}", docHandler.GetPublic)

	// Documents group protected by auth and workspace middleware
	docGroup := f.Group("/documents", authRequired, workspaceRequired)

	// Documents CRUD & Operations
	docGroup.Get("", docHandler.List)
	docGroup.Post("", docHandler.Create)
	docGroup.Get("/{id}", docHandler.Get)
	docGroup.Put("/{id}", docHandler.Update)
	docGroup.Put("/{id}/thumbnails", docHandler.UpdateThumbnails)
	docGroup.Put("/{id}/move", docHandler.Move)
	docGroup.Post("/{id}/duplicate", docHandler.Duplicate)
	docGroup.Post("/{id}/view", docHandler.RecordView)
	docGroup.Post("/{id}/star", docHandler.ToggleStar)
	docGroup.Post("/{id}/share-token", docHandler.CreateShareToken)
	docGroup.Delete("/{id}", docHandler.MoveToTrash)
	docGroup.Post("/{id}/restore", docHandler.Restore)
	docGroup.Delete("/{id}/permanent", docHandler.PermanentDelete)

	// Document Accesses
	docGroup.Get("/{id}/accesses", docHandler.ListAccesses)
	docGroup.Post("/{id}/accesses", docHandler.AddAccess)
	docGroup.Delete("/{id}/accesses/{accessId}", docHandler.RemoveAccess)

	// Trash group protected by auth and workspace middleware
	trashGroup := f.Group("/trash", authRequired, workspaceRequired)
	trashGroup.Get("", docHandler.ListTrash)
	trashGroup.Delete("", docHandler.EmptyTrash)
}
