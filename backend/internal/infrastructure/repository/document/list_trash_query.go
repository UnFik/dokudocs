package document

import (
	"context"
	"time"

	"backend/internal/domain/model"

	"github.com/google/uuid"
)

func (r *Repository) ListTrash(ctx context.Context, workspaceID uuid.UUID) ([]model.TrashItem, error) {
	const query = `
		SELECT d.id, d.workspace_id, d.project_id, COALESCE(p.name, ''), d.title, d.type::text,
		       d.author_id, u.full_name, u.email, COALESCE(u.avatar_url, ''),
		       d.created_at, d.updated_at, d.deleted_at, d.deleted_by,
		       COALESCE(du.full_name, ''), COALESCE(du.email, ''), COALESCE(du.avatar_url, '')
		FROM documents d
		LEFT JOIN projects p ON p.id = d.project_id
		JOIN users u ON u.id = d.author_id
		LEFT JOIN users du ON du.id = d.deleted_by
		WHERE d.workspace_id = $1 AND d.deleted_at IS NOT NULL
		ORDER BY d.deleted_at DESC
	`
	rows, err := r.db.QueryContext(ctx, query, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]model.TrashItem, 0)
	now := time.Now()

	for rows.Next() {
		var d model.Document
		var deletedAt time.Time
		var deletedByID *uuid.UUID
		var delName, delEmail, delAvatar string

		if err := rows.Scan(
			&d.ID, &d.WorkspaceID, &d.ProjectID, &d.ProjectName, &d.Title, &d.Type,
			&d.AuthorID, &d.Author.Name, &d.Author.Email, &d.Author.Avatar,
			&d.CreatedAt, &d.UpdatedAt, &deletedAt, &deletedByID,
			&delName, &delEmail, &delAvatar,
		); err != nil {
			return nil, err
		}
		d.Author.ID = d.AuthorID
		d.DeletedAt = &deletedAt
		d.DeletedBy = deletedByID

		delBy := model.UserAuthor{
			Name:   delName,
			Email:  delEmail,
			Avatar: delAvatar,
		}
		if deletedByID != nil {
			delBy.ID = *deletedByID
		}

		daysPassed := int(now.Sub(deletedAt).Hours() / 24)
		daysRemaining := 30 - daysPassed
		if daysRemaining < 0 {
			daysRemaining = 0
		}

		items = append(items, model.TrashItem{
			ID:            d.ID,
			DocID:         d.ID,
			Document:      d,
			DeletedAt:     deletedAt,
			DeletedBy:     delBy,
			DaysRemaining: daysRemaining,
		})
	}
	return items, rows.Err()
}
