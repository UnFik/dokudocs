package routes

import (
	"context"
	"net/http"

	"backend/internal/application/agent"
	"backend/internal/application/aiusage"
	appauth "backend/internal/application/auth/usecase"
	appdoc "backend/internal/application/document/usecase"
	mcpapp "backend/internal/application/mcp"
	appproject "backend/internal/application/project/usecase"
	"backend/internal/application/skills"
	appws "backend/internal/application/workspace/usecase"
	"backend/internal/config"
	"backend/internal/infrastructure/collabclient"
	"backend/internal/infrastructure/notification"
	agentrepo "backend/internal/infrastructure/repository/agent"
	aiusagerepo "backend/internal/infrastructure/repository/aiusage"
	settingsrepo "backend/internal/infrastructure/repository/aisettings"
	docrepo "backend/internal/infrastructure/repository/document"
	mcprepo "backend/internal/infrastructure/repository/mcp"
	"backend/internal/infrastructure/runtime/container"
	agenthandler "backend/internal/presentation/agent/handler"
	"backend/internal/presentation/mcpserver"
)

// agentKit is everything the Agent needs, built once per router: the same tools
// and executor serve chat, MCP and the settings pages.
type agentKit struct {
	permissions *agent.PermissionService
	executor    *agent.Executor
	chat        *agent.ChatService
	actions     *agentrepo.Store
	mcp         *mcpapp.Service
	skills      *skills.Service
	usage       *aiusage.Service
	ready       func(context.Context) bool
}

type notConfigured struct{}

func (notConfigured) Step(context.Context, []agent.Message, []agent.ToolSpec) (agent.Message, error) {
	return agent.Message{}, agent.ErrAgentNotConfigured
}

func newAgentKit(c *container.Container, cfg config.Config) *agentKit {
	store := agentrepo.NewStore(c.DB)
	superadmins := settingsrepo.NewStore(c.DB)
	mcpStore := mcprepo.NewStore(c.DB)
	documents := docrepo.NewRepository(c.DB)
	collab := collabclient.New(cfg.CollabServiceURL, cfg.CollabServiceSecret)
	var rooms agent.LiveRooms = collab
	if c.LiveRooms != nil {
		rooms = c.LiveRooms
	}
	mcpService := mcpapp.NewService(mcpStore, mcpStore, mcpStore, superadmins)
	skillService := skills.NewService(mcpStore, superadmins)
	permissions := agent.NewPermissionService(store)
	revisions := appdoc.NewDocumentRevisionUseCase(documents).WithRoomReloader(collab)
	content := agent.NewContentService(documents, rooms, revisions, store)
	tools := agent.DokudocsTools(agent.ToolDeps{
		Workspaces:  appws.NewUseCase(c.DB),
		Documents:   appdoc.NewUseCase(c.DB),
		Projects:    appproject.NewUseCase(c.DB),
		Comments:    appdoc.NewCommentUseCase(documents).WithDeliverer(notification.NewMentionDeliverer(c.Mailer, c.Push, cfg.PublicAppURL)),
		Suggestions: appdoc.NewSuggestionUseCase(documents),
		Revisions:   revisions,
		Search:      documents,
		Content:     content,
	})
	executor := agent.NewExecutor(permissions, tools, mcpService.MaxResultBytes)
	var model agent.Model = notConfigured{}
	ready := func(context.Context) bool { return false }
	if c.AgentModel != nil {
		model, ready = c.AgentModel, c.AgentModel.AgentReady
	}
	return &agentKit{
		permissions: permissions,
		executor:    executor,
		chat:        agent.NewChatService(model, executor, documents, store, skillService),
		actions:     store,
		mcp:         mcpService,
		skills:      skillService,
		usage:       aiusage.NewService(aiusagerepo.NewStore(c.DB), superadmins),
		ready:       ready,
	}
}

// addAgentRoutes serves /mcp, the User's AI permissions and MCP keys, and the
// Superadmin's MCP settings, audit, Skills and model usage.
func addAgentRoutes(mux *http.ServeMux, f Router, c *container.Container, cfg config.Config, kit *agentKit) {
	authRequired := signedIn(appauth.NewUseCase(c.DB, cfg.JWTSecret, cfg.AccessTokenTTL), cfg)
	h := agenthandler.New(kit.permissions, kit.mcp, kit.skills, kit.usage)

	// Under /api so the same proxy rule reaches it.
	mux.Handle("/api/v1/mcp", mcpserver.New(mcpserver.Deps{Keys: kit.mcp, Executor: kit.executor, Skills: kit.skills}))

	me := f.Group("/users/me", authRequired)
	me.Get("/ai-permissions", h.AIPermissions)
	me.Put("/ai-permissions", h.SetAIPermissions)
	me.Get("/mcp-keys", h.ListKeys)
	me.Post("/mcp-keys", h.CreateKey)
	me.Delete("/mcp-keys/{keyID}", h.RevokeKey)
	me.Get("/mcp-audit", h.MyAudit)

	f.Group("/skills", authRequired).Get("", h.ListSkills)

	platform := f.Group("/platform", authRequired)
	platform.Get("/mcp", h.MCPSettings)
	platform.Put("/mcp", h.SaveMCPSettings)
	platform.Get("/mcp/audit", h.AllAudit)
	platform.Get("/usage", h.Usage)
	platform.Post("/skills", h.CreateSkill)
	platform.Put("/skills/{skillID}", h.UpdateSkill)
	platform.Delete("/skills/{skillID}", h.DeleteSkill)
}
