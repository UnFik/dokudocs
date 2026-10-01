package document

import (
	"context"
	"database/sql"

	"backend/constant"
	"backend/internal/domain/model"

	"github.com/google/uuid"
)

func (r *Repository) GetTrashedByID(ctx context.Context, id uuid.UUID) (model.Document, error) {
	const query = `
		SELECT id, workspace_id, author_id, deleted_at
		FROM documents
		WHERE id = $1 AND deleted_at IS NOT NULL
	`
	var doc model.Document
	var deletedAt sql.NullTime
	if err := r.db.QueryRowContext(ctx, query, id).Scan(&doc.ID, &doc.WorkspaceID, &doc.AuthorID, &deletedAt); err != nil {
		if err == sql.ErrNoRows {
			return doc, constant.ErrDocumentNotFound
		}
		return doc, err
	}
	if deletedAt.Valid {
		doc.DeletedAt = &deletedAt.Time
	}
	return doc, nil
}
