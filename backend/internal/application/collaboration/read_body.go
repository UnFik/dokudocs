package collaboration

import (
	"context"
	"errors"
	"strings"

	"backend/internal/domain/documentbody"

	"github.com/google/uuid"
)

var (
	ErrInvalidBodyRead       = errors.New("invalid document body read")
	ErrInvalidBodySnapshot   = errors.New("invalid document body snapshot")
	ErrInvalidPublicBodyRead = errors.New("invalid public document body read")
)

type BodySnapshot struct {
	BodyVersion int64
	BodyEpoch   int64
	// CompatEpoch is the oldest epoch whose history still continues into BodyEpoch.
	CompatEpoch       int64
	BodySchemaVersion int
	CanEdit           bool
	CanSuggest        bool
	Body              documentbody.Body
	EncodedState      []byte
}

// RoomAccess is one user's current access to a document.
type RoomAccess struct {
	CanRead    bool
	CanEdit    bool
	CanSuggest bool
}

// RoomHead is the lightweight state of a document for everyone in a room:
// version markers and each requested user's access, without the body.
type RoomHead struct {
	BodyVersion       int64
	BodyEpoch         int64
	BodySchemaVersion int
	Access            map[uuid.UUID]RoomAccess
}

// RoomReader evaluates access for many users with a fixed number of lock-free
// queries. Users that are not workspace members are absent or denied.
type RoomReader interface {
	ReadRoomHead(ctx context.Context, workspaceID, documentID uuid.UUID, userIDs []uuid.UUID) (RoomHead, error)
}

type BodyReader interface {
	ReadBody(context.Context, Actor, uuid.UUID, uuid.UUID) (BodySnapshot, error)
}

type BodyReadUseCase struct {
	reader BodyReader
}

func NewBodyReadUseCase(reader BodyReader) *BodyReadUseCase {
	return &BodyReadUseCase{reader: reader}
}

func (u *BodyReadUseCase) Read(ctx context.Context, actor Actor, workspaceID, documentID uuid.UUID) (BodySnapshot, error) {
	if actor.UserID == uuid.Nil || workspaceID == uuid.Nil || documentID == uuid.Nil {
		return BodySnapshot{}, ErrInvalidBodyRead
	}
	snapshot, err := u.reader.ReadBody(ctx, actor, workspaceID, documentID)
	if err != nil {
		return BodySnapshot{}, err
	}
	if snapshot.BodyVersion < 1 || snapshot.BodyEpoch < 1 || snapshot.BodySchemaVersion < 1 ||
		snapshot.Body.DocumentID != documentID || snapshot.Body.RootNodeID == uuid.Nil ||
		len(snapshot.Body.Nodes) == 0 || len(snapshot.EncodedState) == 0 || documentbody.Validate(snapshot.Body) != nil {
		return BodySnapshot{}, ErrInvalidBodySnapshot
	}
	return snapshot, nil
}

// ReadRoomHead delegates to the reader when it supports room reads.
func (u *BodyReadUseCase) ReadRoomHead(ctx context.Context, workspaceID, documentID uuid.UUID, userIDs []uuid.UUID) (RoomHead, error) {
	if workspaceID == uuid.Nil || documentID == uuid.Nil || len(userIDs) == 0 {
		return RoomHead{}, ErrInvalidBodyRead
	}
	reader, ok := u.reader.(RoomReader)
	if !ok {
		return RoomHead{}, ErrInvalidBodyRead
	}
	return reader.ReadRoomHead(ctx, workspaceID, documentID, userIDs)
}

type PublicBodySnapshot struct {
	BodyVersion       int64
	BodySchemaVersion int
	Body              documentbody.Body
}

type PublicBodyReader interface {
	ReadPublicBody(context.Context, string) (PublicBodySnapshot, error)
}

type PublicBodyReadUseCase struct {
	reader PublicBodyReader
}

func NewPublicBodyReadUseCase(reader PublicBodyReader) *PublicBodyReadUseCase {
	return &PublicBodyReadUseCase{reader: reader}
}

func (u *PublicBodyReadUseCase) Read(ctx context.Context, shareToken string) (PublicBodySnapshot, error) {
	shareToken = strings.TrimSpace(shareToken)
	if shareToken == "" {
		return PublicBodySnapshot{}, ErrInvalidPublicBodyRead
	}
	snapshot, err := u.reader.ReadPublicBody(ctx, shareToken)
	if err != nil {
		return PublicBodySnapshot{}, err
	}
	if snapshot.BodyVersion < 1 || snapshot.BodySchemaVersion < 1 ||
		snapshot.Body.DocumentID == uuid.Nil || snapshot.Body.RootNodeID == uuid.Nil ||
		len(snapshot.Body.Nodes) == 0 || documentbody.Validate(snapshot.Body) != nil {
		return PublicBodySnapshot{}, ErrInvalidBodySnapshot
	}
	return snapshot, nil
}
