// Package handler serves AI permissions, MCP API keys and audit to the User, and the
// MCP settings, audit, Skills and model usage to a Superadmin.
package handler

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"backend/internal/application/agent"
	"backend/internal/application/aitrace"
	"backend/internal/application/aiusage"
	mcpapp "backend/internal/application/mcp"
	"backend/internal/application/skills"
	mcprepo "backend/internal/infrastructure/repository/mcp"
	"backend/internal/presentation/middleware"
	"backend/internal/presentation/response"

	"github.com/google/uuid"
)

type Handler struct {
	permissions *agent.PermissionService
	mcp         *mcpapp.Service
	skills      *skills.Service
	usage       *aiusage.Service
	planLimits  aiusage.PlanLimitStore
	quotas      aiusage.QuotaStore
	traces      *aitrace.Service
}

func New(permissions *agent.PermissionService, mcp *mcpapp.Service, skillService *skills.Service, usage *aiusage.Service) *Handler {
	return &Handler{permissions: permissions, mcp: mcp, skills: skillService, usage: usage}
}

// WithPlanLimits lets a Superadmin read and change the Usage limit of each Plan.
func (h *Handler) WithPlanLimits(store aiusage.PlanLimitStore) *Handler {
	h.planLimits = store
	return h
}

// WithQuotas lets a Superadmin see each User's spend and reset it.
func (h *Handler) WithQuotas(store aiusage.QuotaStore) *Handler {
	h.quotas = store
	return h
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

func fail(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, mcpapp.ErrForbidden), errors.Is(err, skills.ErrForbidden), errors.Is(err, aiusage.ErrForbidden):
		response.Error(w, http.StatusForbidden, "only a superadmin can do this")
	case errors.Is(err, aitrace.ErrForbidden):
		response.Error(w, http.StatusForbidden, "only a superadmin can do this")
	case errors.Is(err, aitrace.ErrNotFound):
		response.Error(w, http.StatusNotFound, "there is no such trace; it may be older than the retention")
	case errors.Is(err, aitrace.ErrInvalid):
		response.Error(w, http.StatusBadRequest, "trace retention must be a whole number of days from 1 to 365")
	case errors.Is(err, aiusage.ErrInvalidLimit):
		response.Error(w, http.StatusBadRequest, "a limit needs a Plan name of up to 50 characters and a whole number of tokens from 1 to 1,000,000,000,000")
	case errors.Is(err, agent.ErrUnknownCapability):
		response.Error(w, http.StatusBadRequest, "one of the AI permissions is not known")
	case errors.Is(err, mcpapp.ErrInvalid):
		response.Error(w, http.StatusBadRequest, "check the values: a key needs a name and a lifetime of 7, 30 or 90 days or none; limits must be positive")
	case errors.Is(err, skills.ErrInvalid):
		response.Error(w, http.StatusBadRequest, skills.ErrInvalid.Error())
	case errors.Is(err, mcprepo.ErrSkillNameTaken):
		response.Error(w, http.StatusConflict, "another skill already has this name")
	default:
		response.Error(w, http.StatusInternalServerError, "something went wrong; try again")
	}
}

// AIPermissions returns the catalog and what the User allows.
func (h *Handler) AIPermissions(w http.ResponseWriter, r *http.Request) {
	id, ok := actor(w, r)
	if !ok {
		return
	}
	allowed, err := h.permissions.Permissions(r.Context(), id)
	if err != nil {
		fail(w, err)
		return
	}
	_ = response.Data(w, http.StatusOK, map[string]any{"catalog": agent.Catalog, "allowed": allowed})
}

func (h *Handler) SetAIPermissions(w http.ResponseWriter, r *http.Request) {
	id, ok := actor(w, r)
	if !ok {
		return
	}
	var body struct {
		Allowed []string `json:"allowed"`
	}
	if err := response.DecodeJSON(r, &body); err != nil {
		response.Error(w, http.StatusBadRequest, "the request is not valid JSON")
		return
	}
	allowed, err := h.permissions.SetPermissions(r.Context(), id, body.Allowed)
	if err != nil {
		fail(w, err)
		return
	}
	_ = response.Data(w, http.StatusOK, map[string]any{"catalog": agent.Catalog, "allowed": allowed})
}

func (h *Handler) ListKeys(w http.ResponseWriter, r *http.Request) {
	id, ok := actor(w, r)
	if !ok {
		return
	}
	keys, err := h.mcp.ListKeys(r.Context(), id)
	if err != nil {
		fail(w, err)
		return
	}
	_ = response.Data(w, http.StatusOK, map[string]any{"keys": keys})
}

// CreateKey returns the secret once; it is never shown again.
func (h *Handler) CreateKey(w http.ResponseWriter, r *http.Request) {
	id, ok := actor(w, r)
	if !ok {
		return
	}
	var body struct {
		Name          string `json:"name"`
		ExpiresInDays int    `json:"expiresInDays"`
	}
	if err := response.DecodeJSON(r, &body); err != nil {
		response.Error(w, http.StatusBadRequest, "the request is not valid JSON")
		return
	}
	key, secret, err := h.mcp.CreateKey(r.Context(), id, body.Name, body.ExpiresInDays)
	if err != nil {
		fail(w, err)
		return
	}
	_ = response.Data(w, http.StatusCreated, map[string]any{"key": key, "secret": secret})
}

func (h *Handler) RevokeKey(w http.ResponseWriter, r *http.Request) {
	id, ok := actor(w, r)
	if !ok {
		return
	}
	keyID, err := uuid.Parse(r.PathValue("keyID"))
	if err != nil {
		response.Error(w, http.StatusBadRequest, "invalid key id")
		return
	}
	revoked, err := h.mcp.RevokeKey(r.Context(), id, keyID)
	if err != nil {
		fail(w, err)
		return
	}
	if !revoked {
		response.Error(w, http.StatusNotFound, "there is no such active key")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) MyAudit(w http.ResponseWriter, r *http.Request) {
	id, ok := actor(w, r)
	if !ok {
		return
	}
	entries, err := h.mcp.MyAudit(r.Context(), id, 100)
	if err != nil {
		fail(w, err)
		return
	}
	_ = response.Data(w, http.StatusOK, map[string]any{"entries": entries})
}

func (h *Handler) MCPSettings(w http.ResponseWriter, r *http.Request) {
	id, ok := actor(w, r)
	if !ok {
		return
	}
	settings, err := h.mcp.SettingsFor(r.Context(), id)
	if err != nil {
		fail(w, err)
		return
	}
	_ = response.Data(w, http.StatusOK, settings)
}

func (h *Handler) SaveMCPSettings(w http.ResponseWriter, r *http.Request) {
	id, ok := actor(w, r)
	if !ok {
		return
	}
	var body mcpapp.Settings
	if err := response.DecodeJSON(r, &body); err != nil {
		response.Error(w, http.StatusBadRequest, "the request is not valid JSON")
		return
	}
	saved, err := h.mcp.SaveSettings(r.Context(), id, body)
	if err != nil {
		fail(w, err)
		return
	}
	_ = response.Data(w, http.StatusOK, saved)
}

func (h *Handler) AllAudit(w http.ResponseWriter, r *http.Request) {
	id, ok := actor(w, r)
	if !ok {
		return
	}
	entries, err := h.mcp.AllAudit(r.Context(), id, 200)
	if err != nil {
		fail(w, err)
		return
	}
	_ = response.Data(w, http.StatusOK, map[string]any{"entries": entries})
}

func (h *Handler) Usage(w http.ResponseWriter, r *http.Request) {
	id, ok := actor(w, r)
	if !ok {
		return
	}
	days, _ := strconv.Atoi(r.URL.Query().Get("days"))
	summary, err := h.usage.Summary(r.Context(), id, days)
	if err != nil {
		fail(w, err)
		return
	}
	_ = response.Data(w, http.StatusOK, summary)
}

// PlanLimits lists what each Plan allows per User per month.
func (h *Handler) PlanLimits(w http.ResponseWriter, r *http.Request) {
	id, ok := actor(w, r)
	if !ok {
		return
	}
	limits, err := h.usage.PlanLimits(r.Context(), id, h.planLimits)
	if err != nil {
		fail(w, err)
		return
	}
	_ = response.Data(w, http.StatusOK, map[string]any{"limits": limits})
}

// SetPlanLimit changes what one Plan allows.
func (h *Handler) SetPlanLimit(w http.ResponseWriter, r *http.Request) {
	id, ok := actor(w, r)
	if !ok {
		return
	}
	var body struct {
		MonthlyTokens int64 `json:"monthlyTokens"`
	}
	if err := response.DecodeJSON(r, &body); err != nil {
		fail(w, aiusage.ErrInvalidLimit)
		return
	}
	plan := r.PathValue("plan")
	if err := h.usage.SetPlanLimit(r.Context(), id, h.planLimits, plan, body.MonthlyTokens); err != nil {
		fail(w, err)
		return
	}
	_ = response.Data(w, http.StatusOK, aiusage.PlanLimit{Plan: strings.TrimSpace(plan), MonthlyTokens: body.MonthlyTokens})
}

// Quotas lists this month's use per User and Workspace.
func (h *Handler) Quotas(w http.ResponseWriter, r *http.Request) {
	id, ok := actor(w, r)
	if !ok {
		return
	}
	quotas, err := h.usage.Quotas(r.Context(), id, h.quotas)
	if err != nil {
		fail(w, err)
		return
	}
	_ = response.Data(w, http.StatusOK, map[string]any{"quotas": quotas})
}

// ResetQuota gives one User their allowance back in one Workspace.
func (h *Handler) ResetQuota(w http.ResponseWriter, r *http.Request) {
	id, ok := actor(w, r)
	if !ok {
		return
	}
	workspaceID, wErr := uuid.Parse(r.PathValue("workspaceID"))
	userID, uErr := uuid.Parse(r.PathValue("userID"))
	if wErr != nil || uErr != nil {
		response.Error(w, http.StatusBadRequest, "the user or workspace id is not valid")
		return
	}
	if err := h.usage.ResetQuota(r.Context(), id, h.quotas, userID, workspaceID); err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ListSkills is open to every signed-in User, for the chat's / picker.
func (h *Handler) ListSkills(w http.ResponseWriter, r *http.Request) {
	if _, ok := actor(w, r); !ok {
		return
	}
	list, err := h.skills.List(r.Context())
	if err != nil {
		fail(w, err)
		return
	}
	_ = response.Data(w, http.StatusOK, map[string]any{"skills": list})
}

type skillBody struct {
	Name         string `json:"name"`
	Description  string `json:"description"`
	Instructions string `json:"instructions"`
}

func (h *Handler) saveSkill(w http.ResponseWriter, r *http.Request, id uuid.UUID, status int) {
	userID, ok := actor(w, r)
	if !ok {
		return
	}
	var body skillBody
	if err := response.DecodeJSON(r, &body); err != nil {
		response.Error(w, http.StatusBadRequest, "the request is not valid JSON")
		return
	}
	saved, err := h.skills.Save(r.Context(), userID, skills.Skill{ID: id, Name: body.Name, Description: body.Description, Instructions: body.Instructions})
	if err != nil {
		fail(w, err)
		return
	}
	_ = response.Data(w, status, saved)
}

func (h *Handler) CreateSkill(w http.ResponseWriter, r *http.Request) {
	h.saveSkill(w, r, uuid.Nil, http.StatusCreated)
}

func (h *Handler) UpdateSkill(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("skillID"))
	if err != nil {
		response.Error(w, http.StatusBadRequest, "invalid skill id")
		return
	}
	h.saveSkill(w, r, id, http.StatusOK)
}

func (h *Handler) DeleteSkill(w http.ResponseWriter, r *http.Request) {
	userID, ok := actor(w, r)
	if !ok {
		return
	}
	id, err := uuid.Parse(r.PathValue("skillID"))
	if err != nil {
		response.Error(w, http.StatusBadRequest, "invalid skill id")
		return
	}
	deleted, err := h.skills.Delete(r.Context(), userID, id)
	if err != nil {
		fail(w, err)
		return
	}
	if !deleted {
		response.Error(w, http.StatusNotFound, "there is no such skill")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
