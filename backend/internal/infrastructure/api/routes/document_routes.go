package routes

import (
	"backend/internal/application/asset"
	appauth "backend/internal/application/auth/usecase"
	appdoc "backend/internal/application/document/usecase"
	appchat "backend/internal/application/rag/usecase"
	appws "backend/internal/application/workspace/usecase"
	"backend/internal/config"
	"backend/internal/infrastructure/assetstore"
	"backend/internal/infrastructure/collabclient"
	docrepo "backend/internal/infrastructure/repository/document"
	"backend/internal/infrastructure/runtime/container"
	dochandler "backend/internal/presentation/document/handler"
	"backend/internal/presentation/middleware"
	"context"
	"time"
)

func addDocumentRoutes(f Router, c *container.Container, cfg config.Config) {
	authUseCase := appauth.NewUseCase(c.DB, cfg.JWTSecret, cfg.AccessTokenTTL)
	authRequired := middleware.ValidateToken(authUseCase)

	workspaceUseCase := appws.NewUseCase(c.DB)
	workspaceRequired := middleware.RequireWorkspace(workspaceUseCase)

	docUseCase := appdoc.NewUseCase(c.DB)
	docHandler := dochandler.NewHandler(docUseCase, c.Validator)
	bodyRepository := docrepo.NewRepository(c.DB)
	revisionHandler := dochandler.NewRevisionHandler(appdoc.NewDocumentRevisionUseCase(bodyRepository).WithRoomReloader(collabclient.New(cfg.CollabServiceURL, cfg.CollabServiceSecret)))
	suggestionService := appdoc.NewSuggestionUseCase(bodyRepository)
	suggestionHandler := dochandler.NewSuggestionHandler(suggestionService)
	ragChat := dochandler.NewRAGChatHandler(appchat.NewChatUseCase(bodyRepository, c.RAGAnswerModel, c.RAGEmbeddingModel))
	commentHandler := dochandler.NewCommentHandler(appdoc.NewCommentUseCase(bodyRepository))

	assetHandler := dochandler.NewAssetHandler(newAssetService(c, cfg), cfg.MaxUploadBytes)

	// Public Shared Documents (No auth required)
	f.Get("/public/documents/{shareToken}/assets/{assetID}", assetHandler.GetPublic)
	f.Get("/public/documents/{shareToken}", docHandler.GetPublic)

	// Documents group protected by auth and workspace middleware
	docGroup := f.Group("/documents", authRequired, workspaceRequired)

	// Documents CRUD & Operations
	docGroup.Get("", docHandler.List)
	docGroup.Post("", docHandler.Create)
	docGroup.Get("/{id}/suggestions", suggestionHandler.List)
	docGroup.Post("/{id}/suggestions/{suggestionID}/replies", suggestionHandler.Reply)
	docGroup.Post("/{id}/suggestions/{suggestionID}/resolve", suggestionHandler.Resolve)
	docGroup.Post("/{id}/suggestions/{suggestionID}/reopen", suggestionHandler.Reopen)
	docGroup.Get("/{id}/comments", commentHandler.List)
	docGroup.Post("/{id}/comments", commentHandler.Create)
	docGroup.Patch("/{id}/comments/{threadID}", commentHandler.Edit)
	docGroup.Delete("/{id}/comments/{threadID}", commentHandler.Delete)
	docGroup.Post("/{id}/comments/{threadID}/replies", commentHandler.Reply)
	docGroup.Patch("/{id}/comments/{threadID}/replies/{replyID}", commentHandler.EditReply)
	docGroup.Delete("/{id}/comments/{threadID}/replies/{replyID}", commentHandler.DeleteReply)
	docGroup.Post("/{id}/comments/{threadID}/resolve", commentHandler.Resolve)
	docGroup.Post("/{id}/comments/{threadID}/reopen", commentHandler.Reopen)
	docGroup.Get("/{id}/revisions", revisionHandler.List)
	docGroup.Post("/{id}/revisions", revisionHandler.CreateNamed)
	docGroup.Post("/{id}/revisions/{revisionID}/restore", revisionHandler.Restore)
	docGroup.Post("/{id}/assets", assetHandler.Upload)
	docGroup.Get("/{id}/assets/{assetID}", assetHandler.Get)
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

	chatGroup := f.Group("/rag/conversations", authRequired, workspaceRequired)
	chatGroup.Post("", ragChat.CreateConversation)
	chatGroup.Post("/{conversationID}/messages", ragChat.Ask)
	privateChatGroup := f.Group("/rag/conversations", authRequired)
	privateChatGroup.Get("", ragChat.ListConversations)
	privateChatGroup.Get("/{conversationID}", ragChat.GetConversation)
	privateChatGroup.Delete("/{conversationID}", ragChat.DeleteConversation)
}

func newAssetService(c *container.Container, cfg config.Config) *asset.Service {
	return asset.NewService(docrepo.NewAssetRepository(docrepo.NewRepository(c.DB)), assetstore.NewLocal(cfg.AssetDir), cfg.MaxUploadBytes)
}

// SweepAssets removes files no page or revision refers to any more.
func SweepAssets(ctx context.Context, c *container.Container, cfg config.Config, olderThan time.Duration) (int, error) {
	return newAssetService(c, cfg).Sweep(ctx, olderThan)
}
