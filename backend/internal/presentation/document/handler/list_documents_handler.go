package handler

import (
	"net/http"

	"backend/internal/domain/contract/repository"
	"backend/internal/presentation/response"

	"github.com/google/uuid"
)

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
		if pid, err := uuid.Parse(projStr); err == nil {
			filter.ProjectID = &pid
		}
	}

	docs, err := h.service.ListDocuments(r.Context(), wsID, userID, filter)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	_ = response.Data(w, http.StatusOK, docs)
}
