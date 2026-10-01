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
	NodeID            uuid.UUID
}

type DeleteNodeResult struct {
	DocumentID  uuid.UUID `json:"documentID"`
	CommandID   uuid.UUID `json:"commandID"`
	NodeID      uuid.UUID `json:"nodeID"`
	BodyEpoch   int64     `json:"bodyEpoch"`
	BodyVersion int64     `json:"bodyVersion"`
	Changed     bool      `json:"changed"`
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
		command.BodySchemaVersion < 1 || command.NodeID == uuid.Nil {
		return DeleteNodeResult{}, ErrInvalidDeleteNode
	}
	result, err := u.writer.DeleteNode(ctx, actor, command)
	if err != nil {
		return DeleteNodeResult{}, err
	}
	if result.DocumentID != command.DocumentID || result.CommandID != command.CommandID || result.NodeID != command.NodeID ||
		result.BodyEpoch < command.BodyEpoch || result.BodyVersion < 1 || !result.Changed {
		return DeleteNodeResult{}, ErrInvalidDeleteNode
	}
	return result, nil
}
