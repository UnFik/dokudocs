package collaboration

import (
	"context"
	"errors"

	"github.com/google/uuid"
)

var (
	ErrInvalidMoveNode   = errors.New("invalid MoveNode command")
	ErrMoveCommandReplay = errors.New("MoveNode command ID was reused with a different request")
)

type MoveNodeCommand struct {
	WorkspaceID       uuid.UUID
	DocumentID        uuid.UUID
	CommandID         uuid.UUID
	BodyEpoch         int64
	BodySchemaVersion int
	NodeID            uuid.UUID
	TargetParentID    uuid.UUID
	BeforeNodeID      *uuid.UUID
}

type MoveNodeResult struct {
	DocumentID  uuid.UUID `json:"documentID"`
	CommandID   uuid.UUID `json:"commandID"`
	BodyEpoch   int64     `json:"bodyEpoch"`
	BodyVersion int64     `json:"bodyVersion"`
	Changed     bool      `json:"changed"`
}

type MoveNodeWriter interface {
	MoveNode(context.Context, Actor, MoveNodeCommand) (MoveNodeResult, error)
}

type MoveNodeUseCase struct {
	writer MoveNodeWriter
}

func NewMoveNodeUseCase(writer MoveNodeWriter) *MoveNodeUseCase {
	return &MoveNodeUseCase{writer: writer}
}

func (u *MoveNodeUseCase) Move(ctx context.Context, actor Actor, command MoveNodeCommand) (MoveNodeResult, error) {
	if u == nil || u.writer == nil || actor.UserID == uuid.Nil || command.WorkspaceID == uuid.Nil ||
		command.DocumentID == uuid.Nil || command.CommandID == uuid.Nil || command.BodyEpoch < 1 ||
		command.BodySchemaVersion < 1 || command.NodeID == uuid.Nil || command.TargetParentID == uuid.Nil {
		return MoveNodeResult{}, ErrInvalidMoveNode
	}
	result, err := u.writer.MoveNode(ctx, actor, command)
	if err != nil {
		return MoveNodeResult{}, err
	}
	if result.DocumentID != command.DocumentID || result.CommandID != command.CommandID ||
		result.BodyEpoch < command.BodyEpoch || result.BodyVersion < 1 {
		return MoveNodeResult{}, ErrInvalidMoveNode
	}
	return result, nil
}
