package document

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"

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

// StoreState replaces the state, the JSON, the Markdown derived from it and the
// suggestion index in one transaction. A document that is not in the workspace
// is refused before anything is written.
func (s *CollabStateStore) StoreState(ctx context.Context, workspaceID, documentID uuid.UUID, state []byte, content json.RawMessage, markdown string, suggestions []collaboration.Suggestion, options ...collaboration.StoreOption) error {
	applied := collaboration.ApplyStoreOptions(options)
	return s.db.WithTransaction(ctx, func(tx database.Queryer) error {
		var authorID uuid.UUID
		var bodyVersion int64
		err := tx.QueryRowContext(ctx, `
			UPDATE documents SET content_json = $3, content = $4, body_version = body_version + 1, updated_at = NOW(),
			    updated_by = COALESCE($5, updated_by)
			WHERE id = $1 AND workspace_id = $2
			RETURNING author_id, body_version
		`, documentID, workspaceID, string(content), markdown, applied.UpdatedBy).Scan(&authorID, &bodyVersion)
		if errors.Is(err, sql.ErrNoRows) {
			return ErrCollabDocumentNotFound
		}
		if err != nil {
			return err
		}
		if _, err = tx.ExecContext(ctx, `
			INSERT INTO document_collab_states (document_id, encoded_state)
			VALUES ($1, $2)
			ON CONFLICT (document_id) DO UPDATE SET encoded_state = EXCLUDED.encoded_state, updated_at = NOW()
		`, documentID, state); err != nil {
			return err
		}
		if err := reconcileSuggestions(ctx, tx, documentID, suggestions); err != nil {
			return err
		}
		return storeAutoRevision(ctx, tx, documentID, authorID, markdown, content, bodyVersion, 0)
	})
}

// reconcileSuggestions makes the index match the suggestions in the document:
// new ones are pending, ones that left are closed, ones that came back are
// pending again. An author who is not a user gets no row.
func reconcileSuggestions(ctx context.Context, tx database.Queryer, documentID uuid.UUID, suggestions []collaboration.Suggestion) error {
	ids := make([]string, 0, len(suggestions))
	authors := make([]string, 0, len(suggestions))
	for _, suggestion := range suggestions {
		ids = append(ids, suggestion.ID.String())
		authors = append(authors, suggestion.Author.String())
	}
	idArray, authorArray := "{"+strings.Join(ids, ",")+"}", "{"+strings.Join(authors, ",")+"}"
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO document_suggestions (document_id, suggestion_id, proposer_id)
		SELECT $1, s.id, s.author
		FROM unnest($2::uuid[], $3::uuid[]) AS s(id, author)
		WHERE EXISTS (SELECT 1 FROM users u WHERE u.id = s.author)
		ON CONFLICT (document_id, suggestion_id) DO UPDATE
		SET status = 'pending', decider_id = NULL, decided_at = NULL
		WHERE document_suggestions.status = 'closed'
	`, documentID, idArray, authorArray); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, `
		UPDATE document_suggestions
		SET status = 'closed', decider_id = proposer_id, decided_at = NOW()
		WHERE document_id = $1 AND status = 'pending' AND suggestion_id <> ALL($2::uuid[])
	`, documentID, idArray)
	return err
}
