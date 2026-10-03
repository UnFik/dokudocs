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

// ListComments returns a document's threads with their replies, oldest first.
// Anyone who can read the document can read its comments.
func (r *Repository) ListComments(ctx context.Context, workspaceID, documentID, actorID uuid.UUID) ([]model.CommentThread, error) {
	result := make([]model.CommentThread, 0)
	err := r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		doc, access, err := lockDocumentAccess(ctx, tx, documentID, workspaceID, actorID, false, nil)
		if err != nil {
			return err
		}
		if !policy.CanReadDocument(doc, access) {
			return constant.ErrDocumentNotFound
		}
		rows, err := tx.QueryContext(ctx, `
			SELECT t.id, t.author_id, u.full_name, t.selected_text, t.content, t.anchor,
			       t.created_at, t.edited_at, t.is_resolved, t.resolved_at, t.resolved_by
			FROM comment_threads t
			JOIN users u ON u.id = t.author_id
			WHERE t.document_id = $1
			ORDER BY t.created_at ASC, t.id ASC
		`, documentID)
		if err != nil {
			return err
		}
		defer rows.Close()
		index := map[uuid.UUID]int{}
		for rows.Next() {
			thread := model.CommentThread{DocumentID: documentID, Replies: []model.CommentReply{}}
			var anchor []byte
			var resolved bool
			var resolvedAt, editedAt sql.NullTime
			var resolvedBy sql.NullString
			if err := rows.Scan(&thread.ID, &thread.AuthorID, &thread.AuthorName, &thread.SelectedText,
				&thread.Content, &anchor, &thread.CreatedAt, &editedAt, &resolved, &resolvedAt, &resolvedBy); err != nil {
				return err
			}
			if editedAt.Valid {
				at := editedAt.Time
				thread.EditedAt = &at
			}
			thread.Anchor = anchor
			if resolved {
				at := thread.CreatedAt
				if resolvedAt.Valid {
					at = resolvedAt.Time
				}
				thread.ResolvedAt = &at
				if resolvedBy.Valid {
					parsed, err := uuid.Parse(resolvedBy.String)
					if err != nil {
						return err
					}
					thread.ResolvedBy = &parsed
				}
			}
			index[thread.ID] = len(result)
			result = append(result, thread)
		}
		if err := rows.Err(); err != nil {
			return err
		}
		if len(result) == 0 {
			return nil
		}
		replies, err := tx.QueryContext(ctx, `
			SELECT p.id, p.thread_id, p.author_id, u.full_name, p.content, p.created_at, p.edited_at
			FROM comment_replies p
			JOIN comment_threads t ON t.id = p.thread_id
			JOIN users u ON u.id = p.author_id
			WHERE t.document_id = $1
			ORDER BY p.created_at ASC, p.id ASC
		`, documentID)
		if err != nil {
			return err
		}
		defer replies.Close()
		for replies.Next() {
			var reply model.CommentReply
			var editedAt sql.NullTime
			if err := replies.Scan(&reply.ID, &reply.ThreadID, &reply.AuthorID, &reply.AuthorName, &reply.Content, &reply.CreatedAt, &editedAt); err != nil {
				return err
			}
			if editedAt.Valid {
				at := editedAt.Time
				reply.EditedAt = &at
			}
			if i, ok := index[reply.ThreadID]; ok {
				result[i].Replies = append(result[i].Replies, reply)
			}
		}
		return replies.Err()
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}

func canDiscuss(doc model.Document, access policy.DocumentAccessContext) error {
	if !policy.CanReadDocument(doc, access) {
		return constant.ErrDocumentNotFound
	}
	if !policy.CanSuggest(doc, access) && !policy.CanDecideSuggestion(doc, access) {
		return constant.ErrForbidden
	}
	return nil
}

// threadInDocument is a lookup that does not reveal threads of other documents.
func threadInDocument(ctx context.Context, tx database.Queryer, documentID, threadID uuid.UUID) error {
	var exists bool
	if err := tx.QueryRowContext(ctx, `
		SELECT EXISTS (SELECT 1 FROM comment_threads WHERE id = $1 AND document_id = $2)
	`, threadID, documentID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return constant.ErrDocumentNotFound
	}
	return nil
}

// CreateComment starts a thread. Retrying the same thread ID is a no-op.
func (r *Repository) CreateComment(ctx context.Context, workspaceID uuid.UUID, thread model.CommentThread) error {
	if r.tx == nil {
		return errors.New("commenting requires a transaction-capable database")
	}
	return r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		doc, access, err := lockDocumentAccess(ctx, tx, thread.DocumentID, workspaceID, thread.AuthorID, false, nil)
		if err != nil {
			return err
		}
		if err := canDiscuss(doc, access); err != nil {
			return err
		}
		var anchor any
		if len(thread.Anchor) > 0 {
			anchor = []byte(thread.Anchor)
		}
		_, err = tx.ExecContext(ctx, `
			INSERT INTO comment_threads (id, document_id, author_id, selected_text, content, anchor)
			VALUES ($1, $2, $3, $4, $5, $6)
			ON CONFLICT (id) DO NOTHING
		`, thread.ID, thread.DocumentID, thread.AuthorID, thread.SelectedText, thread.Content, anchor)
		return err
	})
}

// CreateCommentReply adds a message to a thread. Replying to a resolved thread
// reopens it. Retrying the same reply ID is a no-op.
func (r *Repository) CreateCommentReply(ctx context.Context, workspaceID, documentID uuid.UUID, reply model.CommentReply) error {
	if r.tx == nil {
		return errors.New("replying requires a transaction-capable database")
	}
	return r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		doc, access, err := lockDocumentAccess(ctx, tx, documentID, workspaceID, reply.AuthorID, false, nil)
		if err != nil {
			return err
		}
		if err := canDiscuss(doc, access); err != nil {
			return err
		}
		if err := threadInDocument(ctx, tx, documentID, reply.ThreadID); err != nil {
			return err
		}
		result, err := tx.ExecContext(ctx, `
			INSERT INTO comment_replies (id, thread_id, author_id, content)
			VALUES ($1, $2, $3, $4)
			ON CONFLICT (id) DO NOTHING
		`, reply.ID, reply.ThreadID, reply.AuthorID, reply.Content)
		if err != nil {
			return err
		}
		if rows, err := result.RowsAffected(); err != nil || rows == 0 {
			return err
		}
		_, err = tx.ExecContext(ctx, `
			UPDATE comment_threads
			SET is_resolved = FALSE, resolved_at = NULL, resolved_by = NULL, updated_at = NOW()
			WHERE id = $1
		`, reply.ThreadID)
		return err
	})
}

// SetCommentResolved closes or reopens a thread.
func (r *Repository) SetCommentResolved(ctx context.Context, workspaceID, documentID, threadID, actorID uuid.UUID, resolved bool) error {
	if r.tx == nil {
		return errors.New("resolving requires a transaction-capable database")
	}
	return r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		doc, access, err := lockDocumentAccess(ctx, tx, documentID, workspaceID, actorID, false, nil)
		if err != nil {
			return err
		}
		if err := canDiscuss(doc, access); err != nil {
			return err
		}
		if err := threadInDocument(ctx, tx, documentID, threadID); err != nil {
			return err
		}
		if resolved {
			_, err = tx.ExecContext(ctx, `
				UPDATE comment_threads
				SET is_resolved = TRUE, resolved_at = COALESCE(resolved_at, NOW()), resolved_by = COALESCE(resolved_by, $2), updated_at = NOW()
				WHERE id = $1
			`, threadID, actorID)
		} else {
			_, err = tx.ExecContext(ctx, `
				UPDATE comment_threads
				SET is_resolved = FALSE, resolved_at = NULL, resolved_by = NULL, updated_at = NOW()
				WHERE id = $1
			`, threadID)
		}
		return err
	})
}

// authorOf returns who wrote a thread, or not found.
func commentThreadAuthor(ctx context.Context, tx database.Queryer, documentID, threadID uuid.UUID) (uuid.UUID, error) {
	var author uuid.UUID
	err := tx.QueryRowContext(ctx, `
		SELECT author_id FROM comment_threads WHERE id = $1 AND document_id = $2
	`, threadID, documentID).Scan(&author)
	if errors.Is(err, sql.ErrNoRows) {
		return uuid.Nil, constant.ErrDocumentNotFound
	}
	return author, err
}

func commentReplyAuthor(ctx context.Context, tx database.Queryer, documentID, threadID, replyID uuid.UUID) (uuid.UUID, error) {
	var author uuid.UUID
	err := tx.QueryRowContext(ctx, `
		SELECT p.author_id
		FROM comment_replies p
		JOIN comment_threads t ON t.id = p.thread_id
		WHERE p.id = $1 AND p.thread_id = $2 AND t.document_id = $3
	`, replyID, threadID, documentID).Scan(&author)
	if errors.Is(err, sql.ErrNoRows) {
		return uuid.Nil, constant.ErrDocumentNotFound
	}
	return author, err
}

// UpdateComment changes a thread's first message. Only its author may.
func (r *Repository) UpdateComment(ctx context.Context, workspaceID, documentID, threadID, actorID uuid.UUID, content string) error {
	if r.tx == nil {
		return errors.New("editing requires a transaction-capable database")
	}
	return r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		doc, access, err := lockDocumentAccess(ctx, tx, documentID, workspaceID, actorID, false, nil)
		if err != nil {
			return err
		}
		if err := canDiscuss(doc, access); err != nil {
			return err
		}
		author, err := commentThreadAuthor(ctx, tx, documentID, threadID)
		if err != nil {
			return err
		}
		if author != actorID {
			return constant.ErrForbidden
		}
		_, err = tx.ExecContext(ctx, `
			UPDATE comment_threads SET content = $2, edited_at = NOW(), updated_at = NOW() WHERE id = $1
		`, threadID, content)
		return err
	})
}

// UpdateCommentReply changes a reply. Only its author may.
func (r *Repository) UpdateCommentReply(ctx context.Context, workspaceID, documentID, threadID, replyID, actorID uuid.UUID, content string) error {
	if r.tx == nil {
		return errors.New("editing requires a transaction-capable database")
	}
	return r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		doc, access, err := lockDocumentAccess(ctx, tx, documentID, workspaceID, actorID, false, nil)
		if err != nil {
			return err
		}
		if err := canDiscuss(doc, access); err != nil {
			return err
		}
		author, err := commentReplyAuthor(ctx, tx, documentID, threadID, replyID)
		if err != nil {
			return err
		}
		if author != actorID {
			return constant.ErrForbidden
		}
		_, err = tx.ExecContext(ctx, `
			UPDATE comment_replies SET content = $2, edited_at = NOW(), updated_at = NOW() WHERE id = $1
		`, replyID, content)
		return err
	})
}

// DeleteComment removes a thread and its replies. Its author or an editor may.
func (r *Repository) DeleteComment(ctx context.Context, workspaceID, documentID, threadID, actorID uuid.UUID) error {
	if r.tx == nil {
		return errors.New("deleting requires a transaction-capable database")
	}
	return r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		doc, access, err := lockDocumentAccess(ctx, tx, documentID, workspaceID, actorID, false, nil)
		if err != nil {
			return err
		}
		if err := canDiscuss(doc, access); err != nil {
			return err
		}
		author, err := commentThreadAuthor(ctx, tx, documentID, threadID)
		if err != nil {
			return err
		}
		if author != actorID && !policy.CanDecideSuggestion(doc, access) {
			return constant.ErrForbidden
		}
		_, err = tx.ExecContext(ctx, `DELETE FROM comment_threads WHERE id = $1`, threadID)
		return err
	})
}

// DeleteCommentReply removes one reply. Its author or an editor may.
func (r *Repository) DeleteCommentReply(ctx context.Context, workspaceID, documentID, threadID, replyID, actorID uuid.UUID) error {
	if r.tx == nil {
		return errors.New("deleting requires a transaction-capable database")
	}
	return r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		doc, access, err := lockDocumentAccess(ctx, tx, documentID, workspaceID, actorID, false, nil)
		if err != nil {
			return err
		}
		if err := canDiscuss(doc, access); err != nil {
			return err
		}
		author, err := commentReplyAuthor(ctx, tx, documentID, threadID, replyID)
		if err != nil {
			return err
		}
		if author != actorID && !policy.CanDecideSuggestion(doc, access) {
			return constant.ErrForbidden
		}
		_, err = tx.ExecContext(ctx, `DELETE FROM comment_replies WHERE id = $1`, replyID)
		return err
	})
}
