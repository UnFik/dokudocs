package document

import (
	"context"
	"strings"

	"backend/constant"
	"backend/internal/domain/model"
)

func (r *Repository) Update(ctx context.Context, doc model.Document, categoryNames []string) error {
	tagsSQL := "{" + strings.Join(doc.Tags, ",") + "}"
	const query = `
		UPDATE documents
		SET title = $2, content = $3, tags = $4, is_draft = $5,
		    visibility = $6::document_visibility, project_id = $7, updated_at = NOW()
		WHERE id = $1 AND deleted_at IS NULL
	`
	res, err := r.db.ExecContext(ctx, query, doc.ID, doc.Title, doc.Content, tagsSQL, doc.IsDraft, doc.Visibility, doc.ProjectID)
	if err != nil {
		return err
	}
	rows, _ := res.RowsAffected()
	if rows == 0 {
		return constant.ErrDocumentNotFound
	}

	if categoryNames != nil && doc.ProjectID != nil {
		_, _ = r.db.ExecContext(ctx, `DELETE FROM document_category_mappings WHERE document_id = $1`, doc.ID)
		for _, catName := range categoryNames {
			trimmed := strings.TrimSpace(catName)
			if trimmed == "" {
				continue
			}
			const mapQuery = `
				INSERT INTO document_category_mappings (document_id, category_id)
				SELECT $1, id FROM project_categories
				WHERE project_id = $2 AND name ILIKE $3
				ON CONFLICT DO NOTHING
			`
			_, _ = r.db.ExecContext(ctx, mapQuery, doc.ID, *doc.ProjectID, trimmed)
		}
	}

	return nil
}
