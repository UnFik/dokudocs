package handler

import (
	"net/http"

	"backend/internal/domain/contract/repository"
	_ "backend/internal/domain/model"
	"backend/internal/presentation/response"

	"github.com/google/uuid"
)

// List retrieves documents matching the filter.
// @Summary List documents
// @Description Get list of documents in the active workspace
// @Tags Document
// @Produce json
// @Security BearerAuth
// @Param X-Workspace-Id header string true "Workspace ID (UUID)"
// @Param filterTab query string false "Filter tab (e.g. all, recent, starred, draft)"
// @Param search query string false "Search term"
// @Param category query string false "Category filter"
// @Param sortField query string false "Sort field (e.g. updated_at, title)"
// @Param sortOrder query string false "Sort order (asc, desc)"
// @Param projectId query string false "Filter by project ID (UUID)"
// @Success 200 {object} response.Envelope{data=[]model.Document}
// @Failure 400 {object} response.ErrorEnvelope
// @Failure 401 {object} response.ErrorEnvelope
// @Failure 403 {object} response.ErrorEnvelope
// @Failure 500 {object} response.ErrorEnvelope
// @Router /documents [get]
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	userID, wsID, err := getUserAndWorkspace(r)
	if err != nil {
		response.Error(w, http.StatusUnauthorized, err.Error())
		return
	}

	filter := repository.DocumentFilter{
		FilterTab: r.URL.Query().Get("filterTab"),
		Search:    r.URL.Query().Get("search"),
		Category:  r.URL.Query().Get("category"),
		SortField: r.URL.Query().Get("sortField"),
		SortOrder: r.URL.Query().Get("sortOrder"),
	}
	if projStr := r.URL.Query().Get("projectId"); projStr != "" {
		pid, err := uuid.Parse(projStr)
		if err != nil {
			response.Error(w, http.StatusBadRequest, "invalid project ID")
			return
		}
		filter.ProjectID = &pid
	}

	docs, err := h.service.ListDocuments(r.Context(), wsID, userID, filter)
	if err != nil {
		writeDocumentError(w, err)
		return
	}
	_ = response.Data(w, http.StatusOK, docs)
}
