// Package collaboration holds what the collaboration service asks of the API.
package collaboration

import (
	"context"
	"errors"

	"github.com/google/uuid"
)

// ErrCollabDocumentNotFound means the document does not exist in that workspace.
var ErrCollabDocumentNotFound = errors.New("collaboration document not found")

// RoomAccess is one user's current access to a document.
type RoomAccess struct {
	CanRead    bool
	CanEdit    bool
	CanSuggest bool
}

// RoomHead is each requested user's access to a document.
type RoomHead struct {
	Access map[uuid.UUID]RoomAccess
}

// RoomReader evaluates access for many users with a fixed number of lock-free
// queries. Users that are not workspace members are absent or denied.
type RoomReader interface {
	ReadRoomHead(ctx context.Context, workspaceID, documentID uuid.UUID, userIDs []uuid.UUID) (RoomHead, error)
}

// Suggestion is one suggestion found in a stored document.
type Suggestion struct {
	ID     uuid.UUID
	Author uuid.UUID
}
