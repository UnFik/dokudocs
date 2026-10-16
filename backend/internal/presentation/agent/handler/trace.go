package handler

import (
	"net/http"
	"strconv"
	"time"

	"backend/internal/application/aitrace"
	"backend/internal/presentation/response"

	"github.com/google/uuid"
)

// WithTraces lets a Superadmin follow requests through the Agent and set the gate and router.
func (h *Handler) WithTraces(service *aitrace.Service) *Handler {
	h.traces = service
	return h
}

// traceFilter reads the filter of a list from the query; a value that cannot be read is an error.
func traceFilter(r *http.Request) (aitrace.Filter, bool) {
	q := r.URL.Query()
	var f aitrace.Filter
	for key, target := range map[string]**uuid.UUID{"userId": &f.UserID, "workspaceId": &f.WorkspaceID, "conversationId": &f.ConversationID} {
		if raw := q.Get(key); raw != "" {
			id, err := uuid.Parse(raw)
			if err != nil {
				return f, false
			}
			*target = &id
		}
	}
	for key, target := range map[string]**time.Time{"since": &f.Since, "until": &f.Until} {
		if raw := q.Get(key); raw != "" {
			at, err := time.Parse(time.RFC3339, raw)
			if err != nil {
				return f, false
			}
			*target = &at
		}
	}
	for key, target := range map[string]*int{"limit": &f.Limit, "offset": &f.Offset} {
		if raw := q.Get(key); raw != "" {
			n, err := strconv.Atoi(raw)
			if err != nil || n < 0 {
				return f, false
			}
			*target = n
		}
	}
	if raw := q.Get("minDurationMs"); raw != "" {
		n, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || n < 0 {
			return f, false
		}
		f.MinDurationMS = n
	}
	f.Outcome, f.Node = q.Get("outcome"), q.Get("node")
	f.FailedOnly = q.Get("failed") == "true"
	return f, true
}

func (h *Handler) TraceRuns(w http.ResponseWriter, r *http.Request) {
	id, ok := actor(w, r)
	if !ok {
		return
	}
	filter, ok := traceFilter(r)
	if !ok {
		response.Error(w, http.StatusBadRequest, "a filter is not valid: ids are UUIDs, times are RFC 3339 and numbers are whole and not negative")
		return
	}
	runs, total, err := h.traces.List(r.Context(), id, filter)
	if err != nil {
		fail(w, err)
		return
	}
	_ = response.Data(w, http.StatusOK, map[string]any{"runs": runs, "total": total})
}

func (h *Handler) TraceRun(w http.ResponseWriter, r *http.Request) {
	id, ok := actor(w, r)
	if !ok {
		return
	}
	run, err := uuid.Parse(r.PathValue("runID"))
	if err != nil {
		response.Error(w, http.StatusBadRequest, "invalid run ID")
		return
	}
	out, err := h.traces.Run(r.Context(), id, run)
	if err != nil {
		fail(w, err)
		return
	}
	_ = response.Data(w, http.StatusOK, out)
}

func (h *Handler) HarnessSettings(w http.ResponseWriter, r *http.Request) {
	id, ok := actor(w, r)
	if !ok {
		return
	}
	settings, err := h.traces.SettingsFor(r.Context(), id)
	if err != nil {
		fail(w, err)
		return
	}
	_ = response.Data(w, http.StatusOK, settings)
}

func (h *Handler) SaveHarnessSettings(w http.ResponseWriter, r *http.Request) {
	id, ok := actor(w, r)
	if !ok {
		return
	}
	var body aitrace.Settings
	if err := response.DecodeJSON(r, &body); err != nil {
		response.Error(w, http.StatusBadRequest, "the request is not valid JSON")
		return
	}
	saved, err := h.traces.SaveSettings(r.Context(), id, body)
	if err != nil {
		fail(w, err)
		return
	}
	_ = response.Data(w, http.StatusOK, saved)
}
