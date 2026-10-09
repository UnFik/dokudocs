// Package collaboration holds what the collaboration service asks of the API.
package collaboration

import (
	"context"
	"errors"

	"github.com/google/uuid"
)

// ErrCollabDocumentNotFound means the document does not exist in that workspace.
var ErrCollabDocumentNotFound = errors.New("collaboration document not found")

// ErrInvalidCollabContent means the JSON does not fit the document's type, such
// as a DBML or Mermaid body that is not exactly {"source": "..."}.
var ErrInvalidCollabContent = errors.New("collaboration content does not fit the document type")

// ErrCollabReplaced means a restore replaced the record the room was opened on;
// what the room holds must not be written over the current one.
var ErrCollabReplaced = errors.New("collaboration record was replaced")

// RoomAccess is one user's current access to a document.
type RoomAccess struct {
	CanRead    bool
	CanEdit    bool
	CanSuggest bool
}

// RoomHead is each requested user's access to a document.
type RoomHead struct {
	Access map[uuid.UUID]RoomAccess
	// DocumentType is the kind of document the room holds: markdown, architecture, dbdiagram or mermaid.
	DocumentType string
	// ReplacementID is the record the room must hold; a room opened on another one is stale.
	ReplacementID uuid.UUID
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

// StoreOptions are the extras a store may carry beyond the state itself.
type StoreOptions struct {
	// UpdatedBy is the user whose edit the store is for, when it is known.
	UpdatedBy *uuid.UUID
	// Thumbnail is the SVG drawn on an architecture document's card; empty
	// clears it. Nil leaves the stored one as it is (Markdown rooms send none).
	Thumbnail *string
	// ReplacementID is the record the room was opened on. When set, the store is
	// refused with ErrCollabReplaced if a restore has replaced that record since.
	ReplacementID *uuid.UUID
}

type StoreOption func(*StoreOptions)

func WithUpdatedBy(id uuid.UUID) StoreOption {
	return func(options *StoreOptions) { options.UpdatedBy = &id }
}

func WithThumbnail(svg string) StoreOption {
	return func(options *StoreOptions) { options.Thumbnail = &svg }
}

func WithReplacementID(id uuid.UUID) StoreOption {
	return func(options *StoreOptions) { options.ReplacementID = &id }
}

func ApplyStoreOptions(options []StoreOption) StoreOptions {
	var applied StoreOptions
	for _, option := range options {
		option(&applied)
	}
	return applied
}
