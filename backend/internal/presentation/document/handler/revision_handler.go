package handler

import (
	"net/http"

	"backend/internal/application/document/usecase"
	_ "backend/internal/domain/model"
	"backend/internal/presentation/response"

	"github.com/google/uuid"
)

type RevisionHandler struct {
	service *usecase.DocumentRevisionUseCase
}

func NewRevisionHandler(service *usecase.DocumentRevisionUseCase) *RevisionHandler {
	return &RevisionHandler{service: service}
}

type createNamedRevisionRequest struct {
	Title string `json:"title"`
}

// List returns the revision history for a document the actor can read.
// @Summary List document revisions
// @Tags Document
// @Produce json
// @Security BearerAuth
// @Param X-Workspace-Id header string true "Workspace ID (UUID)"
// @Param id path string true "Document ID"
// @Success 200 {object} response.Envelope{data=[]model.DocumentRevision}
// @Failure 401 {object} response.ErrorEnvelope
// @Failure 403 {object} response.ErrorEnvelope
// @Failure 404 {object} response.ErrorEnvelope
// @Router /documents/{id}/revisions [get]
func (h *RevisionHandler) List(w http.ResponseWriter, r *http.Request) {
	actorID, workspaceID, err := getUserAndWorkspace(r)
	if err != nil {
		writeDocumentError(w, err)
		return
	}
	documentID, err := parsePathUUID(r, "id")
	if err != nil {
		response.Error(w, http.StatusBadRequest, "invalid document ID")
		return
	}
	revisions, err := h.service.List(r.Context(), documentID, workspaceID, actorID)
	if err != nil {
		writeDocumentError(w, err)
		return
	}
	_ = response.Data(w, http.StatusOK, revisions)
}

// CreateNamed captures an immutable snapshot of the current body.
// @Summary Create named document revision
// @Tags Document
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param X-Workspace-Id header string true "Workspace ID (UUID)"
// @Param id path string true "Document ID"
// @Param request body createNamedRevisionRequest true "Revision title"
// @Success 201 {object} response.Envelope{data=model.DocumentRevision}
// @Failure 400 {object} response.ErrorEnvelope
// @Failure 401 {object} response.ErrorEnvelope
// @Failure 403 {object} response.ErrorEnvelope
// @Failure 404 {object} response.ErrorEnvelope
// @Failure 409 {object} response.ErrorEnvelope
// @Router /documents/{id}/revisions [post]
func (h *RevisionHandler) CreateNamed(w http.ResponseWriter, r *http.Request) {
	actorID, workspaceID, err := getUserAndWorkspace(r)
	if err != nil {
		writeDocumentError(w, err)
		return
	}
	documentID, err := parsePathUUID(r, "id")
	if err != nil || documentID == uuid.Nil {
		response.Error(w, http.StatusBadRequest, "invalid document ID")
		return
	}
	var request createNamedRevisionRequest
	if err := response.DecodeJSON(r, &request); err != nil {
		response.Error(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	revision, err := h.service.CreateNamed(r.Context(), documentID, workspaceID, actorID, request.Title)
	if err != nil {
		if err == usecase.ErrInvalidRevisionRequest {
			response.Error(w, http.StatusBadRequest, "revision title must contain 1 to 255 characters")
			return
		}
		writeDocumentError(w, err)
		return
	}
	_ = response.Data(w, http.StatusCreated, revision)
}

// Restore applies an immutable AST revision as a new body epoch.
// @Summary Restore document revision
// @Tags Document
// @Produce json
// @Security BearerAuth
// @Param X-Workspace-Id header string true "Workspace ID (UUID)"
// @Param Idempotency-Key header string true "Stable restore request ID (UUID); reuse on retry"
// @Param id path string true "Document ID"
// @Param revisionID path string true "Revision ID"
// @Success 200 {object} response.Envelope{data=model.DocumentRestoreResult}
// @Failure 400 {object} response.ErrorEnvelope
// @Failure 401 {object} response.ErrorEnvelope
// @Failure 403 {object} response.ErrorEnvelope
// @Failure 404 {object} response.ErrorEnvelope
// @Failure 409 {object} response.ErrorEnvelope
// @Router /documents/{id}/revisions/{revisionID}/restore [post]
func (h *RevisionHandler) Restore(w http.ResponseWriter, r *http.Request) {
	actorID, workspaceID, err := getUserAndWorkspace(r)
	if err != nil {
		writeDocumentError(w, err)
		return
	}
	documentID, err := parsePathUUID(r, "id")
	if err != nil || documentID == uuid.Nil {
		response.Error(w, http.StatusBadRequest, "invalid document ID")
		return
	}
	revisionID, err := parsePathUUID(r, "revisionID")
	if err != nil || revisionID == uuid.Nil {
		response.Error(w, http.StatusBadRequest, "invalid revision ID")
		return
	}
	requestID, err := parseIdempotencyKey(r)
	if err != nil {
		response.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := h.service.Restore(r.Context(), documentID, revisionID, workspaceID, actorID, requestID)
	if err != nil {
		if err == usecase.ErrInvalidRevisionRequest {
			response.Error(w, http.StatusBadRequest, "invalid revision restore request")
			return
		}
		writeDocumentError(w, err)
		return
	}
	_ = response.Data(w, http.StatusOK, result)
}
