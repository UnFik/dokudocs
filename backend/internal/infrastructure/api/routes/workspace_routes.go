package routes

import (
	appauth "backend/internal/application/auth/usecase"
	appws "backend/internal/application/workspace/usecase"
	"backend/internal/config"
	"backend/internal/infrastructure/runtime/container"
	wshandler "backend/internal/presentation/workspace/handler"
)

func addWorkspaceRoutes(f Router, c *container.Container, cfg config.Config) {
	authUseCase := appauth.NewUseCase(c.DB, cfg.JWTSecret, cfg.AccessTokenTTL)
	authRequired := signedIn(authUseCase, cfg)

	workspaceUseCase := appws.NewUseCase(c.DB, appws.WithMailer(c.Mailer, cfg.PublicAppURL))
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
	wsGroup.Get("/{id}/members/{userId}/profile", workspaceHandler.GetMemberProfile)
	wsGroup.Delete("/{id}/members/{userId}", workspaceHandler.RemoveMember)

	// Invitations: mailed single-use links, bound to the invited email.
	sending := rateLimit(cfg.RateLimitInviteSendPerMin, cfg)
	wsGroup.Post("/{id}/invites", workspaceHandler.InviteMember, sending)
	wsGroup.Get("/{id}/invites", workspaceHandler.ListInvites)
	wsGroup.Post("/{id}/invites/{inviteId}/resend", workspaceHandler.ResendInvite, sending)
	wsGroup.Delete("/{id}/invites/{inviteId}", workspaceHandler.RevokeInvite)

	lookup := rateLimit(cfg.RateLimitInviteLookupPerMin, cfg)
	inviteGroup := f.Group("/invites")
	inviteGroup.Post("/preview", workspaceHandler.PreviewInvite, lookup)
	inviteGroup.Post("/accept", workspaceHandler.AcceptInvite, lookup, authRequired)
}
