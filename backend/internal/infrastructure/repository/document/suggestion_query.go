package document

import (
	"context"
	"database/sql"
	"errors"

	"backend/constant"
	"backend/internal/domain/model"
	"backend/internal/domain/policy"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

func (r *Repository) ListSuggestions(ctx context.Context, workspaceID, documentID, actorID uuid.UUID) ([]model.DocumentSuggestion, error) {
	result := make([]model.DocumentSuggestion, 0)
	err := r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		doc, access, err := lockDocumentAccess(ctx, tx, documentID, workspaceID, actorID, false, nil)
		if err != nil {
			return err
		}
		if !policy.CanReadDocument(doc, access) {
			return constant.ErrDocumentNotFound
		}
		rows, err := tx.QueryContext(ctx, `
			SELECT s.document_id, s.suggestion_id, s.proposer_id, s.decider_id,
			       s.conflict_reason, s.status, s.created_at, s.decided_at,
			       s.resolved_at, s.resolved_by, u.full_name
			FROM document_suggestions s
			JOIN users u ON u.id = s.proposer_id
			WHERE s.document_id = $1
			ORDER BY s.created_at ASC, s.suggestion_id ASC
		`, documentID)
		if err != nil {
			return err
		}
		defer rows.Close()

		for rows.Next() {
			var suggestion model.DocumentSuggestion
			var deciderID, resolvedBy sql.NullString
			var decidedAt, resolvedAt sql.NullTime
			if err := rows.Scan(
				&suggestion.DocumentID, &suggestion.SuggestionID, &suggestion.ProposerID,
				&deciderID, &suggestion.ConflictReason, &suggestion.Status, &suggestion.CreatedAt,
				&decidedAt, &resolvedAt, &resolvedBy, &suggestion.ProposerName,
			); err != nil {
				return err
			}
			if resolvedAt.Valid {
				parsed := resolvedAt.Time
				suggestion.ResolvedAt = &parsed
			}
			if resolvedBy.Valid {
				parsed, err := uuid.Parse(resolvedBy.String)
				if err != nil {
					return err
				}
				suggestion.ResolvedBy = &parsed
			}
			suggestion.Replies = []model.SuggestionReply{}
			if deciderID.Valid {
				parsed, err := uuid.Parse(deciderID.String)
				if err != nil {
					return err
				}
				suggestion.DeciderID = &parsed
			}
			if decidedAt.Valid {
				parsed := decidedAt.Time
				suggestion.DecidedAt = &parsed
			}
			result = append(result, suggestion)
		}
		if err := rows.Err(); err != nil {
			return err
		}
		return attachSuggestionReplies(ctx, tx, documentID, result)
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}

func suggestionVisibleTo(ctx context.Context, tx database.Queryer, doc model.Document, access policy.DocumentAccessContext, documentID, suggestionID uuid.UUID) error {
	if !policy.CanReadDocument(doc, access) {
		return constant.ErrDocumentNotFound
	}
	if !policy.CanSuggest(doc, access) && !policy.CanDecideSuggestion(doc, access) {
		return constant.ErrForbidden
	}
	var exists bool
	if err := tx.QueryRowContext(ctx, `
		SELECT EXISTS (SELECT 1 FROM document_suggestions WHERE document_id = $1 AND suggestion_id = $2)
	`, documentID, suggestionID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return constant.ErrDocumentNotFound
	}
	return nil
}

// CreateSuggestionReply adds a message to a suggestion's thread. Replying to a
// resolved thread reopens it. Retrying the same reply ID is a no-op.
func (r *Repository) CreateSuggestionReply(ctx context.Context, workspaceID uuid.UUID, reply model.SuggestionReply) error {
	if r.tx == nil {
		return errors.New("replying to a suggestion requires a transaction-capable database")
	}
	return r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		doc, access, err := lockDocumentAccess(ctx, tx, reply.DocumentID, workspaceID, reply.AuthorID, false, nil)
		if err != nil {
			return err
		}
		if err := suggestionVisibleTo(ctx, tx, doc, access, reply.DocumentID, reply.SuggestionID); err != nil {
			return err
		}
		result, err := tx.ExecContext(ctx, `
			INSERT INTO document_suggestion_replies (document_id, reply_id, suggestion_id, author_id, body)
			VALUES ($1, $2, $3, $4, $5)
			ON CONFLICT (document_id, reply_id) DO NOTHING
		`, reply.DocumentID, reply.ReplyID, reply.SuggestionID, reply.AuthorID, reply.Body)
		if err != nil {
			return err
		}
		if rows, err := result.RowsAffected(); err != nil || rows == 0 {
			return err
		}
		_, err = tx.ExecContext(ctx, `
			UPDATE document_suggestions SET resolved_at = NULL, resolved_by = NULL
			WHERE document_id = $1 AND suggestion_id = $2
		`, reply.DocumentID, reply.SuggestionID)
		return err
	})
}

// SetSuggestionResolved closes or reopens a suggestion's thread. It never
// changes the suggestion's status or the body, and works while it is pending.
func (r *Repository) SetSuggestionResolved(ctx context.Context, workspaceID, documentID, suggestionID, actorID uuid.UUID, resolved bool) error {
	if r.tx == nil {
		return errors.New("resolving a suggestion requires a transaction-capable database")
	}
	return r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		doc, access, err := lockDocumentAccess(ctx, tx, documentID, workspaceID, actorID, false, nil)
		if err != nil {
			return err
		}
		if err := suggestionVisibleTo(ctx, tx, doc, access, documentID, suggestionID); err != nil {
			return err
		}
		if resolved {
			_, err = tx.ExecContext(ctx, `
				UPDATE document_suggestions SET resolved_at = COALESCE(resolved_at, NOW()), resolved_by = COALESCE(resolved_by, $3)
				WHERE document_id = $1 AND suggestion_id = $2
			`, documentID, suggestionID, actorID)
		} else {
			_, err = tx.ExecContext(ctx, `
				UPDATE document_suggestions SET resolved_at = NULL, resolved_by = NULL
				WHERE document_id = $1 AND suggestion_id = $2
			`, documentID, suggestionID)
		}
		return err
	})
}

// attachSuggestionReplies fills each suggestion's replies, oldest first, with one
// query for the whole document.
func attachSuggestionReplies(ctx context.Context, tx database.Queryer, documentID uuid.UUID, suggestions []model.DocumentSuggestion) error {
	if len(suggestions) == 0 {
		return nil
	}
	index := make(map[uuid.UUID]int, len(suggestions))
	for i, suggestion := range suggestions {
		index[suggestion.SuggestionID] = i
	}
	rows, err := tx.QueryContext(ctx, `
		SELECT reply_id, suggestion_id, author_id, body, created_at
		FROM document_suggestion_replies
		WHERE document_id = $1
		ORDER BY created_at ASC, reply_id ASC
	`, documentID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		reply := model.SuggestionReply{DocumentID: documentID}
		if err := rows.Scan(&reply.ReplyID, &reply.SuggestionID, &reply.AuthorID, &reply.Body, &reply.CreatedAt); err != nil {
			return err
		}
		if i, ok := index[reply.SuggestionID]; ok {
			suggestions[i].Replies = append(suggestions[i].Replies, reply)
		}
	}
	return rows.Err()
}
