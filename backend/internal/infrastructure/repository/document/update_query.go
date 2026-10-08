package document

import (
	"context"
	"fmt"
	"strings"

	"backend/constant"
	"backend/internal/domain/model"
	"backend/internal/domain/policy"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

func (r *Repository) UpdateAuthorized(ctx context.Context, doc model.Document, categoryNames []string, actorID uuid.UUID) error {
	if r.tx == nil {
		return fmt.Errorf("authorized document update requires a transaction-capable database")
	}
	return r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		current, access, err := lockDocumentAccess(ctx, tx, doc.ID, doc.WorkspaceID, actorID, false, doc.ProjectID)
		if err != nil {
			return err
		}
		if !policy.CanEditDocument(current, access) {
			return constant.ErrForbidden
		}
		if !doc.UpdatedAt.IsZero() && !doc.UpdatedAt.Equal(current.UpdatedAt) {
			return constant.ErrDocumentConflict
		}
		var currentType, currentContent string
		if err := tx.QueryRowContext(ctx, `
			SELECT type::text, content
			FROM documents WHERE id = $1 AND workspace_id = $2
		`, doc.ID, doc.WorkspaceID).Scan(&currentType, &currentContent); err != nil {
			return err
		}
		if hasCollabBody(currentType) {
			if doc.Content != "" && doc.Content != currentContent {
				return constant.ErrDocumentConflict
			}
			// The body is written only by the collaboration service.
			// Metadata reads mask initialized bodies, so always preserve this column.
			doc.Content = currentContent
		}

		tagsSQL := "{" + strings.Join(doc.Tags, ",") + "}"
		const query = `
			UPDATE documents
			SET title = $2, content = $3, tags = $4, is_draft = $5,
			    visibility = $6::document_visibility, project_id = $7,
			    share_token = CASE WHEN visibility = 'public_link' AND $6::document_visibility = 'public_link' THEN share_token ELSE NULL END,
			    updated_at = NOW()
			WHERE id = $1 AND workspace_id = $8 AND deleted_at IS NULL
		`
		res, err := tx.ExecContext(ctx, query, doc.ID, doc.Title, doc.Content, tagsSQL, doc.IsDraft, doc.Visibility, doc.ProjectID, doc.WorkspaceID)
		if err != nil {
			return err
		}
		rows, err := res.RowsAffected()
		if err != nil {
			return err
		}
		if rows == 0 {
			return constant.ErrDocumentNotFound
		}

		projectChanged := !sameProject(current.ProjectID, doc.ProjectID)
		if categoryNames != nil || projectChanged {
			if _, err := tx.ExecContext(ctx, `DELETE FROM document_category_mappings WHERE document_id = $1`, doc.ID); err != nil {
				return err
			}
			if categoryNames != nil && doc.ProjectID != nil {
				for _, categoryName := range categoryNames {
					name := strings.TrimSpace(categoryName)
					if name == "" {
						continue
					}
					const mapQuery = `
						INSERT INTO document_category_mappings (document_id, category_id)
						SELECT $1, id FROM project_categories
						WHERE project_id = $2 AND name ILIKE $3
						ON CONFLICT DO NOTHING
					`
					if _, err := tx.ExecContext(ctx, mapQuery, doc.ID, *doc.ProjectID, name); err != nil {
						return err
					}
				}
			}
		}
		return nil
	})
}
