package airuns

import (
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
)

var (
	ErrNotFound = errors.New("AI run not found")
	ErrConflict = errors.New("idempotency key already used for another request")
	ErrBusy     = errors.New("an AI run is already active")
	ErrTerminal = errors.New("the AI run is no longer active")
	ErrInvalid  = errors.New("invalid AI run event")
	ErrLimit    = errors.New("AI run output limit exceeded")
)

type Start struct {
	OwnerID                           uuid.UUID
	WorkspaceID, ConversationID       *uuid.UUID
	Kind, IdempotencyKey, Fingerprint string
	InstanceID                        uuid.UUID
	Deadline                          time.Time
}

type Event struct {
	Sequence int64           `json:"sequence"`
	Type     string          `json:"type"`
	Data     json.RawMessage `json:"data"`
}

type Run struct {
	ID             uuid.UUID       `json:"id"`
	OwnerID        uuid.UUID       `json:"-"`
	Fingerprint    string          `json:"-"`
	WorkspaceID    *uuid.UUID      `json:"workspaceID,omitempty"`
	ConversationID *uuid.UUID      `json:"conversationID,omitempty"`
	Kind           string          `json:"kind"`
	Status         string          `json:"status"`
	Draft          string          `json:"draft"`
	Sequence       int64           `json:"sequence"`
	Result         json.RawMessage `json:"result,omitempty"`
	Error          string          `json:"error,omitempty"`
	StartedAt      time.Time       `json:"startedAt"`
	UpdatedAt      time.Time       `json:"updatedAt"`
	Deadline       time.Time       `json:"deadline"`
}
