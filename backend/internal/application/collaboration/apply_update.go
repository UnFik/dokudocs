package collaboration

import (
	"context"
	"errors"

	"github.com/google/uuid"
)

var (
	ErrInvalidUpdate  = errors.New("invalid collaborative update")
	ErrInvalidReceipt = errors.New("invalid collaborative commit receipt")
	ErrStaleBodyEpoch = errors.New("stale body epoch")
	// ErrConcurrentUpdate means another writer committed first. The update
	// itself was not judged; the client keeps it and sends it again.
	ErrConcurrentUpdate   = errors.New("another writer committed first")
	ErrBodySchemaMismatch = errors.New("body schema mismatch")
	ErrBodyNotInitialized = errors.New("document body is not initialized")
	ErrSuggestionConflict = errors.New("suggestion conflict")
	// ErrSuggesterUpdate refuses an update from a user without edit access that
	// does more than add, change, or remove their own suggestions (ADR 0027).
	ErrSuggesterUpdate = errors.New("a user without edit access may only change their own suggestions")
	// ErrSuggestionLimit refuses an update that would give one user more
	// suggestions on a document than the limit allows.
	ErrSuggestionLimit = errors.New("too many suggestions from one user on this document")
)

type Actor struct {
	UserID uuid.UUID
}

type Update struct {
	DocumentID        uuid.UUID
	UpdateID          uuid.UUID
	BodyEpoch         int64
	BodySchemaVersion int
	Bytes             []byte
}

type CommitReceipt struct {
	DocumentID  uuid.UUID
	UpdateID    uuid.UUID
	BodyEpoch   int64
	BodyVersion int64
	Changed     bool
}

type Writer interface {
	CommitUpdate(context.Context, Actor, Update) (CommitReceipt, error)
}

// Fanout publishes a durable update to other collaborators.
type Fanout interface {
	Publish(context.Context, CommitReceipt, Update) error
}

type BroadcastEvent struct {
	OriginID uuid.UUID
	Receipt  CommitReceipt
	Update   Update
}

type Broker interface {
	PublishEvent(context.Context, BroadcastEvent) error
	Subscribe(context.Context) (<-chan BroadcastEvent, error)
	Close() error
}

type UseCase struct {
	writer Writer
	fanout Fanout
}

func NewUseCase(writer Writer, fanout Fanout) *UseCase {
	return &UseCase{writer: writer, fanout: fanout}
}

func (u *UseCase) Apply(ctx context.Context, actor Actor, update Update) (CommitReceipt, error) {
	if actor.UserID == uuid.Nil || update.DocumentID == uuid.Nil || update.UpdateID == uuid.Nil ||
		update.BodyEpoch < 1 || update.BodySchemaVersion < 1 || len(update.Bytes) == 0 {
		return CommitReceipt{}, ErrInvalidUpdate
	}
	receipt, err := u.writer.CommitUpdate(ctx, actor, update)
	if err != nil {
		return CommitReceipt{}, err
	}
	if receipt.DocumentID != update.DocumentID || receipt.UpdateID != update.UpdateID ||
		receipt.BodyEpoch != update.BodyEpoch || receipt.BodyVersion < 1 {
		return CommitReceipt{}, ErrInvalidReceipt
	}
	return receipt, nil
}

// PublishAfterAck is called by the transport after sending the durable receipt
// to the originating client. A fan-out error cannot undo that commit or ACK.
func (u *UseCase) PublishAfterAck(ctx context.Context, receipt CommitReceipt, update Update) error {
	if receipt.DocumentID != update.DocumentID || receipt.UpdateID != update.UpdateID ||
		receipt.BodyEpoch != update.BodyEpoch || receipt.BodyVersion < 1 || len(update.Bytes) == 0 {
		return ErrInvalidReceipt
	}
	if !receipt.Changed {
		return nil
	}
	return u.fanout.Publish(ctx, receipt, update)
}

// PresenceEntry is one live connection of a user to a document.
type PresenceEntry struct {
	ConnectionID uuid.UUID
	UserID       uuid.UUID
	Name         string
	AvatarURL    string
}

// PresenceStore shares who is connected to a document across server
// instances. Entries expire unless refreshed, so a crashed instance cleans up
// after itself.
// RevisionFlusher brings the rolling auto revision up to the latest body once
// editing stops, because commits rewrite it only once per debounce interval.
type RevisionFlusher interface {
	FlushAutoRevision(ctx context.Context, documentID uuid.UUID) error
}

type PresenceStore interface {
	Heartbeat(ctx context.Context, documentID uuid.UUID, entry PresenceEntry) error
	Leave(ctx context.Context, documentID, connectionID uuid.UUID) error
	List(ctx context.Context, documentID uuid.UUID) ([]PresenceEntry, error)
	// Notify tells every instance that a document's presence changed.
	Notify(ctx context.Context, documentID uuid.UUID) error
	// Changes streams the IDs of documents whose presence changed anywhere.
	Changes(ctx context.Context) (<-chan uuid.UUID, error)
}
