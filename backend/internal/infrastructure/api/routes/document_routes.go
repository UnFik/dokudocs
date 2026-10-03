package routes

import (
	"context"
	"net/http"

	"github.com/google/uuid"

	appauth "backend/internal/application/auth/usecase"
	appcollab "backend/internal/application/collaboration"
	appdoc "backend/internal/application/document/usecase"
	appchat "backend/internal/application/rag/usecase"
	appws "backend/internal/application/workspace/usecase"
	"backend/internal/config"
	collabws "backend/internal/infrastructure/collaboration/websocket"
	docrepo "backend/internal/infrastructure/repository/document"
	userrepo "backend/internal/infrastructure/repository/user"
	"backend/internal/infrastructure/runtime/container"
	dochandler "backend/internal/presentation/document/handler"
	"backend/internal/presentation/middleware"
)

func addDocumentRoutes(f Router, c *container.Container, cfg config.Config) func(context.Context) error {
	authUseCase := appauth.NewUseCase(c.DB, cfg.JWTSecret, cfg.AccessTokenTTL)
	authRequired := middleware.ValidateToken(authUseCase)

	workspaceUseCase := appws.NewUseCase(c.DB)
	workspaceRequired := middleware.RequireWorkspace(workspaceUseCase)

	docUseCase := appdoc.NewUseCase(c.DB)
	docHandler := dochandler.NewHandler(docUseCase, c.Validator)
	bodyRepository := docrepo.NewRepository(c.DB)
	revisionHandler := dochandler.NewRevisionHandler(appdoc.NewDocumentRevisionUseCase(bodyRepository))
	bodyInitialization := appcollab.NewBodyInitializationUseCase(bodyRepository)
	bodyReader := appcollab.NewBodyReadUseCase(bodyRepository)
	publicBodyReader := appcollab.NewPublicBodyReadUseCase(bodyRepository)
	bodyMover := appcollab.NewMoveNodeUseCase(bodyRepository)
	bodyDeleter := appcollab.NewDeleteNodeUseCase(bodyRepository)
	suggestionService := appdoc.NewSuggestionUseCase(bodyRepository)
	suggestionHandler := dochandler.NewSuggestionHandler(suggestionService)
	ragChat := dochandler.NewRAGChatHandler(appchat.NewChatUseCase(bodyRepository, c.RAGAnswerModel, c.RAGEmbeddingModel))
	publicBodyHandler := dochandler.NewPublicBodyHandler(publicBodyReader)
	collaborationServer := collabws.NewServer(authUseCase, bodyReader, bodyRepository, cfg.AllowedOrigin, c.CollaborationBroker).
		WithProfiles(presenceProfiles{users: userrepo.NewRepository(c.DB)}).
		WithRevisionFlusher(bodyRepository)
	if c.CollaborationPresence != nil {
		collaborationServer.WithPresenceStore(c.CollaborationPresence)
	}
	bodyHandler := dochandler.NewBodyHandler(bodyInitialization, bodyReader, bodyMover, bodyDeleter).WithRoomNotifier(collaborationServer)

	// Public Shared Documents (No auth required)
	f.Get("/public/documents/{shareToken}", docHandler.GetPublic)
	f.Get("/public/documents/{shareToken}/body", publicBodyHandler.GetBody)

	// Documents group protected by auth and workspace middleware
	docGroup := f.Group("/documents", authRequired, workspaceRequired)
	f.Handle(http.MethodGet, "/collaboration/{id}", collaborationServer)

	// Documents CRUD & Operations
	docGroup.Get("", docHandler.List)
	docGroup.Post("", docHandler.Create)
	docGroup.Post("/{id}/body/initialize", bodyHandler.InitializeBody)
	docGroup.Get("/{id}/body", bodyHandler.GetBody)
	docGroup.Get("/{id}/suggestions", suggestionHandler.List)
	docGroup.Post("/{id}/suggestions/{suggestionID}/replies", suggestionHandler.Reply)
	docGroup.Post("/{id}/suggestions/{suggestionID}/resolve", suggestionHandler.Resolve)
	docGroup.Post("/{id}/suggestions/{suggestionID}/reopen", suggestionHandler.Reopen)
	docGroup.Post("/{id}/body/move", bodyHandler.MoveNode)
	docGroup.Post("/{id}/body/delete", bodyHandler.DeleteNode)
	docGroup.Get("/{id}/revisions", revisionHandler.List)
	docGroup.Post("/{id}/revisions", revisionHandler.CreateNamed)
	docGroup.Post("/{id}/revisions/{revisionID}/restore", revisionHandler.Restore)
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
	return collaborationServer.Shutdown
}

// presenceProfiles labels WebSocket presence with the user's profile name and avatar.
type presenceProfiles struct {
	users *userrepo.Repository
}

func (p presenceProfiles) PresenceProfile(ctx context.Context, id uuid.UUID) (collabws.PresenceUser, error) {
	profile, err := p.users.FindByID(ctx, id)
	if err != nil {
		return collabws.PresenceUser{}, err
	}
	return collabws.PresenceUser{UserID: id, Name: profile.FullName, AvatarURL: profile.AvatarURL}, nil
}
