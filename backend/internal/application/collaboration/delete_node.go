package collaboration

import (
	"context"
	"errors"

	"backend/internal/domain/documentbody"

	"github.com/google/uuid"
)

// MaxDeleteNodes mirrors the domain limit on one batch.
const MaxDeleteNodes = documentbody.MaxDeleteNodes

var (
	ErrInvalidDeleteNode   = errors.New("invalid DeleteNode command")
	ErrDeleteCommandReplay = errors.New("DeleteNode command ID was reused with a different request")
)

type DeleteNodeCommand struct {
	WorkspaceID       uuid.UUID
	DocumentID        uuid.UUID
	CommandID         uuid.UUID
	BodyEpoch         int64
	BodySchemaVersion int
	// NodeID deletes one subtree. NodeIDs deletes several at once in one epoch;
	// exactly one of the two is set.
	NodeID  uuid.UUID
	NodeIDs []uuid.UUID
}

// Targets lists the subtree roots the command removes.
func (c DeleteNodeCommand) Targets() []uuid.UUID {
	if c.NodeID != uuid.Nil {
		return []uuid.UUID{c.NodeID}
	}
	return c.NodeIDs
}

// Valid reports whether the command names one node, or two or more distinct nodes.
func (c DeleteNodeCommand) Valid() bool {
	if c.NodeID != uuid.Nil {
		return len(c.NodeIDs) == 0
	}
	if len(c.NodeIDs) < 2 || len(c.NodeIDs) > MaxDeleteNodes {
		return false
	}
	seen := make(map[uuid.UUID]struct{}, len(c.NodeIDs))
	for _, id := range c.NodeIDs {
		if _, dup := seen[id]; dup || id == uuid.Nil {
			return false
		}
		seen[id] = struct{}{}
	}
	return true
}

type DeleteNodeResult struct {
	DocumentID uuid.UUID `json:"documentID"`
	CommandID  uuid.UUID `json:"commandID"`
	NodeID     uuid.UUID `json:"nodeID"`
	// NodeIDs is set instead of NodeID for a batch delete.
	NodeIDs     []uuid.UUID `json:"nodeIDs,omitempty"`
	BodyEpoch   int64       `json:"bodyEpoch"`
	BodyVersion int64       `json:"bodyVersion"`
	Changed     bool        `json:"changed"`
}

// Matches reports whether the result answers the command.
func (r DeleteNodeResult) Matches(c DeleteNodeCommand) bool {
	if r.DocumentID != c.DocumentID || r.CommandID != c.CommandID || r.NodeID != c.NodeID || len(r.NodeIDs) != len(c.NodeIDs) {
		return false
	}
	for i := range r.NodeIDs {
		if r.NodeIDs[i] != c.NodeIDs[i] {
			return false
		}
	}
	return true
}

type DeleteNodeWriter interface {
	DeleteNode(context.Context, Actor, DeleteNodeCommand) (DeleteNodeResult, error)
}

type DeleteNodeUseCase struct {
	writer DeleteNodeWriter
}

func NewDeleteNodeUseCase(writer DeleteNodeWriter) *DeleteNodeUseCase {
	return &DeleteNodeUseCase{writer: writer}
}

func (u *DeleteNodeUseCase) Delete(ctx context.Context, actor Actor, command DeleteNodeCommand) (DeleteNodeResult, error) {
	if u == nil || u.writer == nil || actor.UserID == uuid.Nil || command.WorkspaceID == uuid.Nil ||
		command.DocumentID == uuid.Nil || command.CommandID == uuid.Nil || command.BodyEpoch < 1 ||
		command.BodySchemaVersion < 1 || !command.Valid() {
		return DeleteNodeResult{}, ErrInvalidDeleteNode
	}
	result, err := u.writer.DeleteNode(ctx, actor, command)
	if err != nil {
		return DeleteNodeResult{}, err
	}
	if !result.Matches(command) ||
		result.BodyEpoch < command.BodyEpoch || result.BodyVersion < 1 || !result.Changed {
		return DeleteNodeResult{}, ErrInvalidDeleteNode
	}
	return result, nil
}
