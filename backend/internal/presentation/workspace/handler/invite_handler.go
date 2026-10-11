package handler

import (
	"errors"
	"net/http"

	"backend/constant"
	"backend/internal/application/workspace/dto"
	_ "backend/internal/domain/model"
	"backend/internal/presentation/request"
	"backend/internal/presentation/response"
	"backend/internal/presentation/workspace/presenter"

	"github.com/google/uuid"
)

// inviteFailure writes the reply for an invitation error. Unknown, used,
// revoked and expired links all read the same, so a guess learns nothing.
func inviteFailure(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, constant.ErrForbidden):
		response.Error(w, http.StatusForbidden, "forbidden: insufficient permission")
	case errors.Is(err, constant.ErrInvalidInvite):
		response.Error(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, constant.ErrAlreadyMember):
		response.ErrorWithCode(w, http.StatusConflict, "already_member", err.Error())
	case errors.Is(err, constant.ErrInviteLimit):
		response.ErrorWithCode(w, http.StatusConflict, "invite_limit", err.Error())
	case errors.Is(err, constant.ErrInviteTooSoon):
		w.Header().Set("Retry-After", "60")
		response.Error(w, http.StatusTooManyRequests, err.Error())
	case errors.Is(err, constant.ErrEmailNotConfigured):
		response.Error(w, http.StatusServiceUnavailable, err.Error())
	case errors.Is(err, constant.ErrEmailNotSent):
		response.Error(w, http.StatusBadGateway, constant.ErrEmailNotSent.Error())
	case errors.Is(err, constant.ErrInviteNotFound):
		response.Error(w, http.StatusNotFound, constant.ErrInviteNotFound.Error())
	case errors.Is(err, constant.ErrInviteEmailMismatch):
		response.ErrorWithCode(w, http.StatusForbidden, "invite_email_mismatch", err.Error())
	case errors.Is(err, constant.ErrEmailNotVerified):
		response.ErrorWithCode(w, http.StatusForbidden, "email_not_verified", err.Error())
	default:
		response.Error(w, http.StatusInternalServerError, "internal server error")
	}
}

// inviteTarget reads the actor and the workspace of a request.
func inviteTarget(w http.ResponseWriter, r *http.Request) (actorID, workspaceID uuid.UUID, ok bool) {
	actorID, err := getUserUUID(r)
	if err != nil {
		response.Error(w, http.StatusUnauthorized, err.Error())
		return uuid.Nil, uuid.Nil, false
	}
	workspaceID, err = uuid.Parse(r.PathValue("id"))
	if err != nil {
		response.Error(w, http.StatusBadRequest, "invalid workspace ID")
		return uuid.Nil, uuid.Nil, false
	}
	return actorID, workspaceID, true
}

// InviteMember mails someone a link to join the workspace.
// @Summary Invite a person to the workspace
// @Description Sends a single-use link to the email. The reply is the same whether or not the address has an account.
// @Tags Workspace
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path string true "Workspace ID (UUID)"
// @Param request body presenter.InviteMemberRequest true "Invitation"
// @Success 201 {object} response.Envelope{data=model.WorkspaceInvite}
// @Failure 400 {object} response.ErrorEnvelope
// @Failure 403 {object} response.ErrorEnvelope
// @Failure 409 {object} response.ErrorEnvelope
// @Failure 429 {object} response.ErrorEnvelope
// @Failure 503 {object} response.ErrorEnvelope
// @Router /workspaces/{id}/invites [post]
func (h *Handler) InviteMember(w http.ResponseWriter, r *http.Request) {
	actorID, workspaceID, ok := inviteTarget(w, r)
	if !ok {
		return
	}
	var req presenter.InviteMemberRequest
	if err := response.DecodeJSON(r, &req); err != nil {
		response.Error(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if err := h.validate.Struct(req); err != nil {
		response.Error(w, http.StatusBadRequest, request.ValidationTitle(err))
		return
	}
	invite, err := h.service.InviteMember(r.Context(), dto.InviteMemberInput{
		WorkspaceID: workspaceID, Email: req.Email, Role: req.Role, ActorID: actorID,
	})
	if err != nil {
		inviteFailure(w, err)
		return
	}
	_ = response.Data(w, http.StatusCreated, invite)
}

// ListInvites lists the invitations nobody has used yet.
// @Summary List pending workspace invitations
// @Tags Workspace
// @Produce json
// @Security BearerAuth
// @Param id path string true "Workspace ID (UUID)"
// @Success 200 {object} response.Envelope{data=[]model.WorkspaceInvite}
// @Failure 403 {object} response.ErrorEnvelope
// @Router /workspaces/{id}/invites [get]
func (h *Handler) ListInvites(w http.ResponseWriter, r *http.Request) {
	actorID, workspaceID, ok := inviteTarget(w, r)
	if !ok {
		return
	}
	invites, err := h.service.ListInvites(r.Context(), workspaceID, actorID)
	if err != nil {
		inviteFailure(w, err)
		return
	}
	_ = response.Data(w, http.StatusOK, invites)
}

// ResendInvite mails a pending invitation again under a new link.
// @Summary Send a workspace invitation again
// @Tags Workspace
// @Security BearerAuth
// @Param id path string true "Workspace ID (UUID)"
// @Param inviteId path string true "Invitation ID (UUID)"
// @Success 204
// @Failure 403 {object} response.ErrorEnvelope
// @Failure 404 {object} response.ErrorEnvelope
// @Failure 429 {object} response.ErrorEnvelope
// @Router /workspaces/{id}/invites/{inviteId}/resend [post]
func (h *Handler) ResendInvite(w http.ResponseWriter, r *http.Request) {
	actorID, workspaceID, ok := inviteTarget(w, r)
	if !ok {
		return
	}
	inviteID, err := uuid.Parse(r.PathValue("inviteId"))
	if err != nil {
		response.Error(w, http.StatusBadRequest, "invalid invitation ID")
		return
	}
	if _, err := h.service.ResendInvite(r.Context(), workspaceID, inviteID, actorID); err != nil {
		inviteFailure(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// RevokeInvite cancels a pending invitation.
// @Summary Revoke a workspace invitation
// @Tags Workspace
// @Security BearerAuth
// @Param id path string true "Workspace ID (UUID)"
// @Param inviteId path string true "Invitation ID (UUID)"
// @Success 204
// @Failure 403 {object} response.ErrorEnvelope
// @Failure 404 {object} response.ErrorEnvelope
// @Router /workspaces/{id}/invites/{inviteId} [delete]
func (h *Handler) RevokeInvite(w http.ResponseWriter, r *http.Request) {
	actorID, workspaceID, ok := inviteTarget(w, r)
	if !ok {
		return
	}
	inviteID, err := uuid.Parse(r.PathValue("inviteId"))
	if err != nil {
		response.Error(w, http.StatusBadRequest, "invalid invitation ID")
		return
	}
	if err := h.service.RevokeInvite(r.Context(), workspaceID, inviteID, actorID); err != nil {
		inviteFailure(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// PreviewInvite shows what an invitation link offers. It needs no sign-in; the
// token goes in the body so it never reaches an access log.
// @Summary Preview a workspace invitation
// @Tags Workspace
// @Accept json
// @Produce json
// @Param request body presenter.InviteTokenRequest true "Link token"
// @Success 200 {object} response.Envelope{data=presenter.InvitePreviewResponse}
// @Failure 404 {object} response.ErrorEnvelope
// @Router /invites/preview [post]
func (h *Handler) PreviewInvite(w http.ResponseWriter, r *http.Request) {
	var req presenter.InviteTokenRequest
	if err := response.DecodeJSON(r, &req); err != nil {
		response.Error(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if err := h.validate.Struct(req); err != nil {
		response.Error(w, http.StatusBadRequest, request.ValidationTitle(err))
		return
	}
	preview, err := h.service.PreviewInvite(r.Context(), req.Token)
	if err != nil {
		inviteFailure(w, err)
		return
	}
	_ = response.Data(w, http.StatusOK, presenter.InvitePreviewResponse{
		WorkspaceName: preview.WorkspaceName,
		InviterName:   preview.InviterName,
		Role:          preview.Role,
		Email:         preview.Email,
	})
}

// AcceptInvite joins the workspace as the signed-in User.
// @Summary Accept a workspace invitation
// @Tags Workspace
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body presenter.InviteTokenRequest true "Link token"
// @Success 200 {object} response.Envelope{data=presenter.AcceptInviteResponse}
// @Failure 403 {object} response.ErrorEnvelope
// @Failure 404 {object} response.ErrorEnvelope
// @Router /invites/accept [post]
func (h *Handler) AcceptInvite(w http.ResponseWriter, r *http.Request) {
	userID, err := getUserUUID(r)
	if err != nil {
		response.Error(w, http.StatusUnauthorized, err.Error())
		return
	}
	var req presenter.InviteTokenRequest
	if err := response.DecodeJSON(r, &req); err != nil {
		response.Error(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if err := h.validate.Struct(req); err != nil {
		response.Error(w, http.StatusBadRequest, request.ValidationTitle(err))
		return
	}
	workspaceID, err := h.service.AcceptInvite(r.Context(), req.Token, userID)
	if err != nil {
		inviteFailure(w, err)
		return
	}
	_ = response.Data(w, http.StatusOK, presenter.AcceptInviteResponse{WorkspaceID: workspaceID.String()})
}
