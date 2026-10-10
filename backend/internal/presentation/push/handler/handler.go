// Package handler registers browsers for push and tells them how to.
package handler

import (
	"context"
	"net/http"
	"strings"

	"backend/internal/presentation/middleware"
	"backend/internal/presentation/response"

	"github.com/google/uuid"
)

const maxTokenLength = 4096

// TokenStore keeps the browsers a person registered.
type TokenStore interface {
	Save(ctx context.Context, userID uuid.UUID, token, userAgent string) error
	Remove(ctx context.Context, userID uuid.UUID, token string) error
}

// WebConfig is what a browser needs to register with Firebase. None of it is
// secret: Firebase web settings are meant to ship to every browser.
type WebConfig struct {
	APIKey    string
	AppID     string
	SenderID  string
	ProjectID string
	VAPIDKey  string
}

type Handler struct {
	tokens TokenStore
	web    *WebConfig
}

// New serves push; a nil web config means push is not set up on this server.
func New(tokens TokenStore, web *WebConfig) *Handler { return &Handler{tokens: tokens, web: web} }

func actor(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	u, ok := middleware.UserFromContext(r.Context())
	id, err := uuid.Parse(u.ID)
	if !ok || err != nil {
		response.Error(w, http.StatusUnauthorized, "unauthorized")
		return uuid.Nil, false
	}
	return id, true
}

type firebaseSettings struct {
	APIKey            string `json:"apiKey"`
	ProjectID         string `json:"projectId"`
	AppID             string `json:"appId"`
	MessagingSenderID string `json:"messagingSenderId"`
}

type configResponse struct {
	Enabled  bool              `json:"enabled"`
	VAPIDKey string            `json:"vapidKey,omitempty"`
	Firebase *firebaseSettings `json:"firebase,omitempty"`
}

// Config says whether push is on, and with what settings a browser registers.
func (h *Handler) Config(w http.ResponseWriter, r *http.Request) {
	if _, ok := actor(w, r); !ok {
		return
	}
	if h.web == nil {
		_ = response.Data(w, http.StatusOK, configResponse{})
		return
	}
	_ = response.Data(w, http.StatusOK, configResponse{
		Enabled:  true,
		VAPIDKey: h.web.VAPIDKey,
		Firebase: &firebaseSettings{
			APIKey: h.web.APIKey, ProjectID: h.web.ProjectID, AppID: h.web.AppID, MessagingSenderID: h.web.SenderID,
		},
	})
}

type tokenRequest struct {
	Token string `json:"token"`
}

func readToken(w http.ResponseWriter, r *http.Request) (string, bool) {
	var body tokenRequest
	if err := response.DecodeJSON(r, &body); err != nil {
		response.Error(w, http.StatusBadRequest, "invalid json body")
		return "", false
	}
	token := strings.TrimSpace(body.Token)
	if token == "" || len(token) > maxTokenLength || strings.ContainsAny(token, " \t\r\n") {
		response.Error(w, http.StatusBadRequest, "invalid token")
		return "", false
	}
	return token, true
}

// Register remembers this browser for the signed-in person.
func (h *Handler) Register(w http.ResponseWriter, r *http.Request) {
	userID, ok := actor(w, r)
	if !ok {
		return
	}
	token, ok := readToken(w, r)
	if !ok {
		return
	}
	agent := r.UserAgent()
	if len(agent) > 300 {
		agent = agent[:300]
	}
	if err := h.tokens.Save(r.Context(), userID, token, agent); err != nil {
		response.Error(w, http.StatusInternalServerError, "could not register this browser")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Unregister forgets this browser, for instance when notifications are turned off.
func (h *Handler) Unregister(w http.ResponseWriter, r *http.Request) {
	userID, ok := actor(w, r)
	if !ok {
		return
	}
	token, ok := readToken(w, r)
	if !ok {
		return
	}
	if err := h.tokens.Remove(r.Context(), userID, token); err != nil {
		response.Error(w, http.StatusInternalServerError, "could not remove this browser")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
