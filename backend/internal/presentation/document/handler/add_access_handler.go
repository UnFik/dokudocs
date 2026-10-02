package handler

import (
	"errors"
	"net/http"

	"backend/constant"
	"backend/internal/presentation/document/presenter"
	"backend/internal/presentation/response"
)

// AddAccess grants or updates user access to a document.
// @Summary Add or update document access
// @Description Grant document access to a user by email
// @Tags Document
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param X-Workspace-Id header string true "Workspace ID (UUID)"
// @Param id path string true "Document ID (UUID)"
// @Param request body presenter.AddAccessRequest true "Add access payload"
// @Success 201 {object} response.Envelope{data=map[string]string}
// @Failure 400 {object} response.ErrorEnvelope
// @Failure 401 {object} response.ErrorEnvelope
// @Failure 403 {object} response.ErrorEnvelope
// @Failure 404 {object} response.ErrorEnvelope
// @Failure 500 {object} response.ErrorEnvelope
// @Router /documents/{id}/accesses [post]
func (h *Handler) AddAccess(w http.ResponseWriter, r *http.Request) {
	userID, wsID, err := getUserAndWorkspace(r)
	if err != nil {
		response.Error(w, http.StatusUnauthorized, err.Error())
		return
	}
	id, err := parsePathUUID(r, "id")
	if err != nil {
		response.Error(w, http.StatusBadRequest, "invalid document ID")
		return
	}
	var req presenter.AddAccessRequest
	if err := response.DecodeJSON(r, &req); err != nil {
		response.Error(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if req.Email == "" {
		response.Error(w, http.StatusBadRequest, "email is required")
		return
	}
	if err := h.service.AddOrUpdateAccess(r.Context(), id, wsID, userID, req.Email, req.Level); err != nil {
		switch {
		case errors.Is(err, constant.ErrForbidden):
			response.Error(w, http.StatusForbidden, "forbidden: insufficient permission")
		case errors.Is(err, constant.ErrUserNotFound), errors.Is(err, constant.ErrDocumentNotFound), errors.Is(err, constant.ErrProjectNotFound):
			writeDocumentError(w, err)
		default:
			response.Error(w, http.StatusBadRequest, err.Error())
		}
		return
	}
	_ = response.Data(w, http.StatusCreated, map[string]string{"status": "access granted"})
}
