package presenter

type InviteMemberRequest struct {
	Email string `json:"email" validate:"required"`
	Role  string `json:"role"`
}

type InviteTokenRequest struct {
	Token string `json:"token" validate:"required"`
}

type InvitePreviewResponse struct {
	WorkspaceName string `json:"workspaceName"`
	InviterName   string `json:"inviterName"`
	Role          string `json:"role"`
	Email         string `json:"email"`
}

type AcceptInviteResponse struct {
	WorkspaceID string `json:"workspaceId"`
}
