package handler

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"backend/internal/application/airuns"
	"backend/internal/application/aisettings"
	"backend/internal/presentation/response"
	"backend/internal/presentation/sse"

	"github.com/google/uuid"
)

// runDeadline bounds a connection test (the tester allows the provider 40 seconds)
// and the save that follows it.
const runDeadline = 45 * time.Second

// WithRuns lets Test and Save run on the server and be followed afterwards.
func (h *Handler) WithRuns(runs *airuns.Service) *Handler {
	h.runs = runs
	return h
}

type runBody struct {
	settingBody
	// Operation is "test" or "save".
	Operation string `json:"operation"`
}

// StartRun begins a connection test, or a test followed by a save, and returns at once.
// @Summary Run an AI provider test or save
// @Tags Platform
// @Accept json
// @Produce json
// @Security BearerAuth
// @Success 202 {object} response.Envelope
// @Router /platform/ai/{purpose}/runs [post]
func (h *Handler) StartRun(w http.ResponseWriter, r *http.Request) {
	id, ok := actor(w, r)
	p, valid := purpose(w, r)
	if !ok || !valid || h.runs == nil {
		return
	}
	var body runBody
	if err := response.DecodeJSON(r, &body); err != nil {
		response.Error(w, http.StatusBadRequest, "the request is not valid JSON")
		return
	}
	if body.Operation != "test" && body.Operation != "save" {
		response.Error(w, http.StatusBadRequest, `the operation must be "test" or "save"`)
		return
	}
	input := body.input()
	if err := h.service.Validate(r.Context(), id, p, input); err != nil {
		fail(w, err)
		return
	}
	key := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if key == "" {
		key = uuid.NewString()
	}
	// The key is hashed with the rest, so the run record never holds it.
	sum := sha256.Sum256([]byte(fmt.Sprintf("%s\x00%s\x00%s\x00%s\x00%s\x00%s", body.Operation, p, input.BaseURL, input.Protocol, input.Model, input.APIKey)))
	run, _, err := h.runs.Start(r.Context(), airuns.Start{
		OwnerID: id, Kind: body.Operation, Subject: p, IdempotencyKey: key,
		Fingerprint: hex.EncodeToString(sum[:]), Deadline: time.Now().Add(runDeadline),
	}, func(ctx context.Context) (json.RawMessage, error) {
		if body.Operation == "test" {
			report, err := h.service.Check(ctx, id, p, input)
			if err != nil {
				return nil, publicFailure(err)
			}
			return json.Marshal(map[string]any{"operation": "test", "streaming": report.Streaming})
		}
		saved, err := h.service.SaveChecked(ctx, id, p, input)
		if err != nil {
			return nil, publicFailure(err)
		}
		return json.Marshal(map[string]any{"operation": "save", "streaming": saved.Report.Streaming, "overview": saved.Overview})
	})
	if err != nil {
		runFail(w, err)
		return
	}
	_ = response.Data(w, http.StatusAccepted, run)
}

// publicFailure keeps only a message that is safe to show: the provider's own
// words about the connection, never the key or an internal error.
func publicFailure(err error) error {
	var connection *aisettings.ConnectionError
	switch {
	case errors.As(err, &connection):
		return &airuns.PublicError{Message: "The connection test failed: " + connection.Message}
	case errors.Is(err, aisettings.ErrStale), errors.Is(err, aisettings.ErrInvalid), errors.Is(err, aisettings.ErrForbidden):
		return &airuns.PublicError{Message: err.Error()}
	}
	return err
}

func runFail(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, airuns.ErrConflict):
		response.Error(w, http.StatusUnprocessableEntity, "this Idempotency-Key was used for a different request")
	case errors.Is(err, airuns.ErrCapacity), errors.Is(err, airuns.ErrBusy):
		response.Error(w, http.StatusServiceUnavailable, "too many AI jobs are running; try again shortly")
	default:
		response.Error(w, http.StatusInternalServerError, "the AI settings could not be read or saved; try again")
	}
}

// LatestRun is the newest test or save of a purpose by the signed-in Superadmin, so
// the page can show its outcome again after being closed.
// @Summary Latest AI provider test or save
// @Tags Platform
// @Produce json
// @Security BearerAuth
// @Success 200 {object} response.Envelope
// @Router /platform/ai/{purpose}/runs/latest [get]
func (h *Handler) LatestRun(w http.ResponseWriter, r *http.Request) {
	id, ok := actor(w, r)
	p, valid := purpose(w, r)
	if !ok || !valid || h.runs == nil {
		return
	}
	if err := h.service.Authorize(r.Context(), id); err != nil {
		fail(w, err)
		return
	}
	run, err := h.runs.LatestBySubject(r.Context(), id, []string{"test", "save"}, p)
	if errors.Is(err, airuns.ErrNotFound) {
		_ = response.Data(w, http.StatusOK, nil)
		return
	}
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "the AI settings could not be read or saved; try again")
		return
	}
	_ = response.Data(w, http.StatusOK, run)
}

const progressPoll = 2 * time.Second

// ProgressEvents follows the re-embedding of documents for a new embedding model.
// Each event is the whole current state; the stream ends when no model is pending.
// @Summary Follow re-embedding progress
// @Tags Platform
// @Produce text/event-stream
// @Security BearerAuth
// @Router /platform/ai/embedding/events [get]
func (h *Handler) ProgressEvents(w http.ResponseWriter, r *http.Request) {
	id, ok := actor(w, r)
	if !ok || h.runs == nil {
		return
	}
	overview, err := h.service.Overview(r.Context(), id)
	if err != nil {
		fail(w, err)
		return
	}
	stream := sse.Open(w)
	var last string
	beat := time.Now()
	tick := time.NewTicker(progressPoll)
	defer tick.Stop()
	for {
		state := map[string]any{"pending": overview.EmbeddingPending != nil}
		if overview.EmbeddingPending != nil {
			state["model"] = overview.EmbeddingPending.Model
		}
		if overview.Progress != nil {
			state["done"], state["total"] = overview.Progress.Done, overview.Progress.Total
		}
		raw, _ := json.Marshal(state)
		if string(raw) != last {
			if !stream.Event("", "progress", raw) {
				return
			}
			last, beat = string(raw), time.Now()
		}
		if overview.EmbeddingPending == nil {
			return
		}
		select {
		case <-r.Context().Done():
			return
		case <-h.runs.Done():
			return
		case <-tick.C:
		}
		if overview, err = h.service.Overview(r.Context(), id); err != nil {
			return
		}
		if time.Since(beat) > 15*time.Second {
			if !stream.Heartbeat() {
				return
			}
			beat = time.Now()
		}
	}
}
