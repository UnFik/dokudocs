package document

import (
	"context"
	"fmt"
	"strings"

	"backend/internal/domain/contract/repository"
	"backend/internal/domain/model"

	"github.com/google/uuid"
)

func (r *Repository) List(ctx context.Context, workspaceID, userID uuid.UUID, filter repository.DocumentFilter) ([]model.Document, error) {
	query := `
		SELECT d.id, d.workspace_id, d.project_id, COALESCE(p.name, ''), d.title, d.type::text,
		       d.content, d.author_id, u.full_name, u.email, COALESCE(u.avatar_url, ''),
		       COALESCE(array_to_string(d.tags, ','), ''), d.is_draft, d.visibility::text,
		       COALESCE(d.share_token, ''), COALESCE(d.thumbnail, ''), COALESCE(d.thumbnail_dark, ''),
		       COALESCE(d.thumbnail_preview, ''), COALESCE(d.thumbnail_preview_dark, ''),
		       (ds.document_id IS NOT NULL) AS is_starred, ds.starred_at,
		       (da.document_id IS NOT NULL) AS is_shared,
		       COALESCE(dv.view_count, 0) AS view_count, dv.last_viewed_at,
		       d.created_at, d.updated_at
		FROM documents d
		LEFT JOIN projects p ON p.id = d.project_id
		JOIN users u ON u.id = d.author_id
		LEFT JOIN document_stars ds ON ds.document_id = d.id AND ds.user_id = $2
		LEFT JOIN document_accesses da ON da.document_id = d.id AND da.user_id = $2
		LEFT JOIN document_views dv ON dv.document_id = d.id AND dv.user_id = $2
		WHERE d.workspace_id = $1 AND d.deleted_at IS NULL
	`

	args := []any{workspaceID, userID}
	argIdx := 3

	if filter.ProjectID != nil {
		query += fmt.Sprintf(" AND d.project_id = $%d", argIdx)
		args = append(args, *filter.ProjectID)
		argIdx++
	}

	if filter.Search != "" {
		query += fmt.Sprintf(" AND (d.title ILIKE $%d OR d.content ILIKE $%d)", argIdx, argIdx)
		args = append(args, "%"+filter.Search+"%")
		argIdx++
	}

	switch filter.FilterTab {
	case "created_by_me":
		query += " AND d.author_id = $2"
	case "starred":
		query += " AND ds.document_id IS NOT NULL"
	case "shared":
		query += " AND (da.document_id IS NOT NULL OR d.author_id != $2)"
	}

	if filter.Category != "" {
		query += fmt.Sprintf(` AND EXISTS (
			SELECT 1 FROM document_category_mappings dcm
			JOIN project_categories pc ON pc.id = dcm.category_id
			WHERE dcm.document_id = d.id AND pc.name ILIKE $%d
		)`, argIdx)
		args = append(args, "%"+filter.Category+"%")
		argIdx++
	}

	// Sort
	sortCol := "d.updated_at"
	switch filter.SortField {
	case "lastViewedAt":
		sortCol = "dv.last_viewed_at"
	case "createdAt":
		sortCol = "d.created_at"
	case "title":
		sortCol = "d.title"
	}

	sortDir := "DESC"
	if strings.ToLower(filter.SortOrder) == "asc" {
		sortDir = "ASC"
	}

	if filter.SortField == "lastViewedAt" {
		query += fmt.Sprintf(" ORDER BY %s %s NULLS LAST", sortCol, sortDir)
	} else {
		query += fmt.Sprintf(" ORDER BY %s %s", sortCol, sortDir)
	}

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	docs := make([]model.Document, 0)
	var docIDs []uuid.UUID

	for rows.Next() {
		var d model.Document
		var tagsStr string
		if err := rows.Scan(
			&d.ID, &d.WorkspaceID, &d.ProjectID, &d.ProjectName, &d.Title, &d.Type,
			&d.Content, &d.AuthorID, &d.Author.Name, &d.Author.Email, &d.Author.Avatar,
			&tagsStr, &d.IsDraft, &d.Visibility,
			&d.ShareToken, &d.Thumbnail, &d.ThumbnailDark,
			&d.ThumbnailPreview, &d.ThumbnailPreviewDark,
			&d.IsStarred, &d.StarredAt,
			&d.IsShared,
			&d.ViewCount, &d.LastViewedAt,
			&d.CreatedAt, &d.UpdatedAt,
		); err != nil {
			return nil, err
		}
		d.Author.ID = d.AuthorID
		if tagsStr != "" {
			d.Tags = strings.Split(tagsStr, ",")
		} else {
			d.Tags = make([]string, 0)
		}
		d.Categories = make([]string, 0)
		docs = append(docs, d)
		docIDs = append(docIDs, d.ID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	if len(docIDs) > 0 {
		catMap, err := r.fetchCategoriesForDocuments(ctx, docIDs)
		if err == nil {
			for i := range docs {
				cats := catMap[docs[i].ID]
				if cats != nil {
					docs[i].Categories = cats
					if len(cats) > 0 {
						docs[i].Category = cats[0]
					}
				}
			}
		}
	}

	return docs, nil
}
