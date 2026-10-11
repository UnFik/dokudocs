// Package handler serves the Superadmin's AI provider settings.
package handler

import (
	"errors"
	"net/http"
	"time"

	"backend/internal/application/aisettings"
	"backend/internal/presentation/middleware"
	"backend/internal/presentation/response"

	"github.com/google/uuid"
)

type Handler struct{ service *aisettings.Service }

func New(service *aisettings.Service) *Handler { return &Handler{service: service} }

type settingBody struct {
	BaseURL  string `json:"baseURL"`
	Protocol string `json:"protocol"`
	Model    string `json:"model"`
	// APIKey is write-only; empty keeps the stored key.
	APIKey string `json:"apiKey"`
}

func (b settingBody) input() aisettings.Input {
	return aisettings.Input{BaseURL: b.BaseURL, Protocol: b.Protocol, Model: b.Model, APIKey: b.APIKey}
}

func actor(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	u, ok := middleware.UserFromContext(r.Context())
	id, err := uuid.Parse(u.ID)
	if !ok || err != nil {
		response.Error(w, http.StatusUnauthorized, "unauthorized")
		return uuid.Nil, false
	}
	return id, true
}

// purpose accepts only the two purposes a person can write; pending is the server's own.
func purpose(w http.ResponseWriter, r *http.Request) (string, bool) {
	switch p := r.PathValue("purpose"); p {
	case aisettings.PurposeAnswer, aisettings.PurposeEmbedding:
		return p, true
	}
	response.Error(w, http.StatusNotFound, "there is no such AI setting")
	return "", false
}

func fail(w http.ResponseWriter, err error) {
	var connection *aisettings.ConnectionError
	switch {
	case errors.Is(err, aisettings.ErrForbidden):
		response.Error(w, http.StatusForbidden, "only a superadmin can change the AI provider")
	case errors.Is(err, aisettings.ErrInvalid):
		response.Error(w, http.StatusBadRequest, err.Error())
	case errors.As(err, &connection):
		response.ErrorWithCode(w, http.StatusUnprocessableEntity, "connection_failed", "The connection test failed: "+connection.Message)
	default:
		response.Error(w, http.StatusInternalServerError, "the AI settings could not be read or saved; try again")
	}
}

// Overview returns both settings, the pending embedding model and its progress.
// @Summary AI provider settings
// @Tags Platform
// @Produce json
// @Security BearerAuth
// @Success 200 {object} response.Envelope
// @Failure 403 {object} response.ErrorEnvelope
// @Router /platform/ai [get]
func (h *Handler) Overview(w http.ResponseWriter, r *http.Request) {
	id, ok := actor(w, r)
	if !ok {
		return
	}
	overview, err := h.service.Overview(r.Context(), id)
	if err != nil {
		fail(w, err)
		return
	}
	_ = response.Data(w, http.StatusOK, overview)
}

// Save keeps a setting once its connection test passes.
// @Summary Save an AI provider setting
// @Tags Platform
// @Accept json
// @Produce json
// @Security BearerAuth
// @Success 200 {object} response.Envelope
// @Failure 400 {object} response.ErrorEnvelope
// @Failure 403 {object} response.ErrorEnvelope
// @Failure 422 {object} response.ErrorEnvelope
// @Router /platform/ai/{purpose} [put]
func (h *Handler) Save(w http.ResponseWriter, r *http.Request) {
	id, ok := actor(w, r)
	p, valid := purpose(w, r)
	if !ok || !valid {
		return
	}
	var body settingBody
	if err := response.DecodeJSON(r, &body); err != nil {
		response.Error(w, http.StatusBadRequest, "the request is not valid JSON")
		return
	}
	overview, err := h.service.Save(r.Context(), id, p, body.input())
	if err != nil {
		fail(w, err)
		return
	}
	_ = response.Data(w, http.StatusOK, overview)
}

// Test checks a setting against the provider without saving it.
// @Summary Test an AI provider setting
// @Tags Platform
// @Accept json
// @Produce json
// @Security BearerAuth
// @Success 200 {object} response.Envelope
// @Failure 422 {object} response.ErrorEnvelope
// @Router /platform/ai/{purpose}/test [post]
func (h *Handler) Test(w http.ResponseWriter, r *http.Request) {
	id, ok := actor(w, r)
	p, valid := purpose(w, r)
	if !ok || !valid {
		return
	}
	var body settingBody
	if err := response.DecodeJSON(r, &body); err != nil {
		response.Error(w, http.StatusBadRequest, "the request is not valid JSON")
		return
	}
	if err := h.service.Test(r.Context(), id, p, body.input()); err != nil {
		fail(w, err)
		return
	}
	_ = response.Data(w, http.StatusOK, map[string]bool{"ok": true})
}

type changeView struct {
	Purpose   string                            `json:"purpose"`
	ChangedBy *uuid.UUID                        `json:"changedBy"`
	ChangedAt time.Time                         `json:"changedAt"`
	Changes   map[string]aisettings.FieldChange `json:"changes"`
}

// Changes lists the newest audit entries.
// @Summary AI provider setting changes
// @Tags Platform
// @Produce json
// @Security BearerAuth
// @Success 200 {object} response.Envelope
// @Router /platform/ai/changes [get]
func (h *Handler) Changes(w http.ResponseWriter, r *http.Request) {
	id, ok := actor(w, r)
	if !ok {
		return
	}
	list, err := h.service.Changes(r.Context(), id, 50)
	if err != nil {
		fail(w, err)
		return
	}
	out := make([]changeView, len(list))
	for i, c := range list {
		out[i] = changeView{Purpose: c.Purpose, ChangedAt: c.ChangedAt, Changes: c.Changes}
		if c.ChangedBy != uuid.Nil {
			by := c.ChangedBy
			out[i].ChangedBy = &by
		}
	}
	_ = response.Data(w, http.StatusOK, map[string]any{"changes": out})
}
