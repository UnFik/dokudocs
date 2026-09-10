package document

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"backend/constant"
	"backend/internal/domain/model"

	"github.com/google/uuid"
)

func (r *Repository) GetByID(ctx context.Context, id, userID uuid.UUID) (model.Document, error) {
	const query = `
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
		WHERE d.id = $1 AND d.deleted_at IS NULL
	`
	var d model.Document
	var tagsStr string
	err := r.db.QueryRowContext(ctx, query, id, userID).Scan(
		&d.ID, &d.WorkspaceID, &d.ProjectID, &d.ProjectName, &d.Title, &d.Type,
		&d.Content, &d.AuthorID, &d.Author.Name, &d.Author.Email, &d.Author.Avatar,
		&tagsStr, &d.IsDraft, &d.Visibility,
		&d.ShareToken, &d.Thumbnail, &d.ThumbnailDark,
		&d.ThumbnailPreview, &d.ThumbnailPreviewDark,
		&d.IsStarred, &d.StarredAt,
		&d.IsShared,
		&d.ViewCount, &d.LastViewedAt,
		&d.CreatedAt, &d.UpdatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return d, constant.ErrDocumentNotFound
	}
	if err != nil {
		return d, err
	}
	d.Author.ID = d.AuthorID
	if tagsStr != "" {
		d.Tags = strings.Split(tagsStr, ",")
	} else {
		d.Tags = make([]string, 0)
	}

	catMap, _ := r.fetchCategoriesForDocuments(ctx, []uuid.UUID{d.ID})
	if cats, ok := catMap[d.ID]; ok {
		d.Categories = cats
		if len(cats) > 0 {
			d.Category = cats[0]
		}
	} else {
		d.Categories = make([]string, 0)
	}

	return d, nil
}
