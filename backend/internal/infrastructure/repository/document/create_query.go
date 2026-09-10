package document

import (
	"context"
	"strings"

	"backend/internal/domain/model"

	"github.com/google/uuid"
)

func (r *Repository) Create(ctx context.Context, doc model.Document, categoryNames []string) (model.Document, error) {
	if doc.ID == uuid.Nil {
		doc.ID = uuid.New()
	}
	if doc.Visibility == "" {
		doc.Visibility = "inherit"
	}
	if doc.Tags == nil {
		doc.Tags = make([]string, 0)
	}

	tagsSQL := "{" + strings.Join(doc.Tags, ",") + "}"

	const insertQuery = `
		INSERT INTO documents (
			id, workspace_id, project_id, title, type, content, author_id, tags, is_draft, visibility
		) VALUES (
			$1, $2, $3, $4, $5::document_type, $6, $7, $8, $9, $10::document_visibility
		) RETURNING created_at, updated_at
	`
	err := r.db.QueryRowContext(
		ctx, insertQuery,
		doc.ID, doc.WorkspaceID, doc.ProjectID, doc.Title, doc.Type, doc.Content,
		doc.AuthorID, tagsSQL, doc.IsDraft, doc.Visibility,
	).Scan(&doc.CreatedAt, &doc.UpdatedAt)
	if err != nil {
		return doc, err
	}

	// Add category mappings
	doc.Categories = make([]string, 0)
	if doc.ProjectID != nil && len(categoryNames) > 0 {
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
			if _, err := r.db.ExecContext(ctx, mapQuery, doc.ID, *doc.ProjectID, trimmed); err == nil {
				doc.Categories = append(doc.Categories, trimmed)
			}
		}
		if len(doc.Categories) > 0 {
			doc.Category = doc.Categories[0]
		}
	}

	// Add creator as owner in document_accesses
	const insertAccess = `
		INSERT INTO document_accesses (document_id, user_id, access_level)
		VALUES ($1, $2, 'owner'::document_access_level)
		ON CONFLICT DO NOTHING
	`
	_, _ = r.db.ExecContext(ctx, insertAccess, doc.ID, doc.AuthorID)

	return r.GetByID(ctx, doc.ID, doc.AuthorID)
}
