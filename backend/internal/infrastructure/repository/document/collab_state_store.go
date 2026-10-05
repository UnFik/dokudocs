package document

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"

	"backend/internal/application/collaboration"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

// ErrCollabDocumentNotFound is the application's error for a document that is not in the workspace.
var ErrCollabDocumentNotFound = collaboration.ErrCollabDocumentNotFound

// CollabStateStore keeps what the collaboration service sends: the Yjs state of a
// document and the JSON derived from it, written together.
type CollabStateStore struct {
	db database.DB
}

func NewCollabStateStore(db database.DB) *CollabStateStore {
	return &CollabStateStore{db: db}
}

// LoadDocument returns the state and the JSON content. Either is nil when the
// document has none; a document outside the workspace is not found.
func (s *CollabStateStore) LoadDocument(ctx context.Context, workspaceID, documentID uuid.UUID) ([]byte, json.RawMessage, error) {
	var content []byte
	err := s.db.QueryRowContext(ctx, `SELECT content_json FROM documents WHERE id = $1 AND workspace_id = $2`, documentID, workspaceID).Scan(&content)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil, ErrCollabDocumentNotFound
	}
	if err != nil {
		return nil, nil, err
	}
	var state []byte
	err = s.db.QueryRowContext(ctx, `SELECT encoded_state FROM document_collab_states WHERE document_id = $1`, documentID).Scan(&state)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, content, nil
	}
	return state, content, err
}

// StoreState replaces the state, the JSON and the Markdown derived from it in one transaction. A document that
// is not in the workspace is refused before anything is written.
func (s *CollabStateStore) StoreState(ctx context.Context, workspaceID, documentID uuid.UUID, state []byte, content json.RawMessage, markdown string) error {
	return s.db.WithTransaction(ctx, func(tx database.Queryer) error {
		result, err := tx.ExecContext(ctx, `
			UPDATE documents SET content_json = $3, content = $4, updated_at = NOW()
			WHERE id = $1 AND workspace_id = $2
		`, documentID, workspaceID, []byte(content), markdown)
		if err != nil {
			return err
		}
		if affected, err := result.RowsAffected(); err != nil {
			return err
		} else if affected == 0 {
			return ErrCollabDocumentNotFound
		}
		_, err = tx.ExecContext(ctx, `
			INSERT INTO document_collab_states (document_id, encoded_state)
			VALUES ($1, $2)
			ON CONFLICT (document_id) DO UPDATE SET encoded_state = EXCLUDED.encoded_state, updated_at = NOW()
		`, documentID, state)
		return err
	})
}
