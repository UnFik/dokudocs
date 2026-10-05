package document

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"

	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

// ErrCollabDocumentNotFound means the document does not exist in that workspace.
var ErrCollabDocumentNotFound = errors.New("collaboration document not found")

// CollabStateStore keeps what the collaboration service sends: the Yjs state of a
// document and the JSON derived from it, written together.
type CollabStateStore struct {
	db database.DB
}

func NewCollabStateStore(db database.DB) *CollabStateStore {
	return &CollabStateStore{db: db}
}

// LoadState returns nil, nil for a document that has no state yet.
func (s *CollabStateStore) LoadState(ctx context.Context, documentID uuid.UUID) ([]byte, error) {
	var state []byte
	err := s.db.QueryRowContext(ctx, `SELECT encoded_state FROM document_collab_states WHERE document_id = $1`, documentID).Scan(&state)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return state, err
}

// StoreState replaces the state and the JSON in one transaction. A document that
// is not in the workspace is refused before anything is written.
func (s *CollabStateStore) StoreState(ctx context.Context, workspaceID, documentID uuid.UUID, state []byte, content json.RawMessage) error {
	return s.db.WithTransaction(ctx, func(tx database.Queryer) error {
		result, err := tx.ExecContext(ctx, `
			UPDATE documents SET content_json = $3, updated_at = NOW()
			WHERE id = $1 AND workspace_id = $2
		`, documentID, workspaceID, []byte(content))
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
