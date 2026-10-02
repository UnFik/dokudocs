package collaboration

import (
	"context"
	"errors"

	"github.com/google/uuid"
)

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
	NodeIDs           []uuid.UUID
}

// DeleteNodeResult echoes the deleted roots. NodeID is NodeIDs[0], kept so
// clients that only know single-node commands can still match the receipt.
type DeleteNodeResult struct {
	DocumentID  uuid.UUID   `json:"documentID"`
	CommandID   uuid.UUID   `json:"commandID"`
	NodeID      uuid.UUID   `json:"nodeID"`
	NodeIDs     []uuid.UUID `json:"nodeIDs"`
	BodyEpoch   int64       `json:"bodyEpoch"`
	BodyVersion int64       `json:"bodyVersion"`
	Changed     bool        `json:"changed"`
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
		command.BodySchemaVersion < 1 || !validDeleteNodeIDs(command.NodeIDs) {
		return DeleteNodeResult{}, ErrInvalidDeleteNode
	}
	result, err := u.writer.DeleteNode(ctx, actor, command)
	if err != nil {
		return DeleteNodeResult{}, err
	}
	if result.DocumentID != command.DocumentID || result.CommandID != command.CommandID || !SameNodeIDs(result.NodeIDs, command.NodeIDs) ||
		result.BodyEpoch < command.BodyEpoch || result.BodyVersion < 1 || !result.Changed {
		return DeleteNodeResult{}, ErrInvalidDeleteNode
	}
	return result, nil
}

// MaxDeleteNodeIDs bounds one batch so a request cannot ask for an unbounded body rewrite.
const MaxDeleteNodeIDs = 5000

func validDeleteNodeIDs(ids []uuid.UUID) bool {
	if len(ids) == 0 || len(ids) > MaxDeleteNodeIDs {
		return false
	}
	for _, id := range ids {
		if id == uuid.Nil {
			return false
		}
	}
	return true
}

// SameNodeIDs reports whether both lists hold the same IDs in the same order.
func SameNodeIDs(left, right []uuid.UUID) bool {
	if len(left) != len(right) {
		return false
	}
	for i := range left {
		if left[i] != right[i] {
			return false
		}
	}
	return true
}
