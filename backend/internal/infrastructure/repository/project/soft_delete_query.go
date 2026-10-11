package project

import (
	"context"

	"backend/constant"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

func (r *Repository) SoftDelete(ctx context.Context, id, workspaceID, actorID uuid.UUID) error {
	return r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		if err := lockManagedProject(ctx, tx, id, workspaceID, actorID); err != nil {
			return err
		}
		const query = `UPDATE projects SET deleted_at = NOW() WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`
		res, err := tx.ExecContext(ctx, query, id, workspaceID)
		if err != nil {
			return err
		}
		rows, err := res.RowsAffected()
		if err != nil {
			return err
		}
		if rows == 0 {
			return constant.ErrProjectNotFound
		}
		// Documents outlive the project as drafts. "inherit" with no project is
		// readable by the whole workspace, so a private project's documents are
		// pinned to private instead of widening their audience.
		if _, err := tx.ExecContext(ctx, `
			DELETE FROM document_category_mappings
			WHERE document_id IN (
				SELECT id FROM documents WHERE project_id = $1 AND workspace_id = $2
			)
		`, id, workspaceID); err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `
			UPDATE documents d
			SET project_id = NULL,
			    is_draft = TRUE,
			    visibility = CASE
			        WHEN d.visibility <> 'inherit' THEN d.visibility
			        WHEN p.visibility = 'workspace' THEN 'workspace'::document_visibility
			        ELSE 'private'::document_visibility
			    END,
			    updated_at = NOW()
			FROM projects p
			WHERE p.id = $1 AND p.workspace_id = $2 AND d.project_id = p.id
		`, id, workspaceID)
		return err
	})
}
