package document

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"backend/constant"
	"backend/internal/domain/model"
)

func (r *Repository) GetByShareToken(ctx context.Context, token string) (model.Document, error) {
	const query = `
		SELECT d.id, d.workspace_id, d.project_id, ''::text, d.title, d.type::text,
		       d.content,
		       d.author_id, u.full_name, u.email, COALESCE(u.avatar_url, ''),
		       COALESCE(array_to_string(d.tags, ','), ''), d.is_draft, d.visibility::text,
		       COALESCE(d.thumbnail, ''), COALESCE(d.thumbnail_dark, ''),
		       COALESCE(d.thumbnail_preview, ''), COALESCE(d.thumbnail_preview_dark, ''),
		       d.created_at, d.updated_at
		FROM documents d
		JOIN users u ON u.id = d.author_id
		WHERE d.share_token = $1
		  AND d.visibility = 'public_link'
		  AND d.is_draft = FALSE
		  AND d.deleted_at IS NULL
	`
	var d model.Document
	var tagsStr string
	err := r.db.QueryRowContext(ctx, query, token).Scan(
		&d.ID, &d.WorkspaceID, &d.ProjectID, &d.ProjectName, &d.Title, &d.Type,
		&d.Content, &d.AuthorID, &d.Author.Name, &d.Author.Email, &d.Author.Avatar,
		&tagsStr, &d.IsDraft, &d.Visibility,
		&d.Thumbnail, &d.ThumbnailDark,
		&d.ThumbnailPreview, &d.ThumbnailPreviewDark,
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
	d.Categories = make([]string, 0)
	return d, nil
}
