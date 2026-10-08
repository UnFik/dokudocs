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
	query := `
		SELECT d.id, d.workspace_id, d.project_id,
		       CASE WHEN p.id IS NOT NULL AND ` + projectMetadataPredicate("$2", "p") + ` THEN p.name ELSE '' END,
		       d.title, d.type::text,
		       d.content, d.content_json,
		       d.author_id, u.full_name, u.email, COALESCE(u.avatar_url, ''),
		       COALESCE(array_to_string(d.tags, ','), ''), d.is_draft, d.visibility::text,
		       COALESCE(d.thumbnail, ''), COALESCE(d.thumbnail_dark, ''),
		       COALESCE(d.thumbnail_preview, ''), COALESCE(d.thumbnail_preview_dark, ''),
		       (ds.document_id IS NOT NULL) AS is_starred, ds.starred_at,
		       (da.document_id IS NOT NULL) AS is_shared,
		       COALESCE(dv.view_count, 0) AS view_count, dv.last_viewed_at,
		       d.created_at, d.updated_at,
		       uu.id, COALESCE(uu.full_name, ''), COALESCE(uu.email, ''), COALESCE(uu.avatar_url, '')
		FROM documents d
		LEFT JOIN projects p ON p.id = d.project_id AND p.workspace_id = d.workspace_id AND p.deleted_at IS NULL
		JOIN users u ON u.id = d.author_id
		LEFT JOIN users uu ON uu.id = d.updated_by
		LEFT JOIN document_stars ds ON ds.document_id = d.id AND ds.user_id = $2
		LEFT JOIN document_accesses da ON da.document_id = d.id AND da.user_id = $2
		LEFT JOIN document_views dv ON dv.document_id = d.id AND dv.user_id = $2
		WHERE d.id = $1 AND d.deleted_at IS NULL
	` + documentReadPredicate
	var d model.Document
	var tagsStr string
	var contentJSON []byte
	var editorID uuid.NullUUID
	var editor model.UserAuthor
	err := r.db.QueryRowContext(ctx, query, id, userID).Scan(
		&d.ID, &d.WorkspaceID, &d.ProjectID, &d.ProjectName, &d.Title, &d.Type,
		&d.Content, &contentJSON, &d.AuthorID, &d.Author.Name, &d.Author.Email, &d.Author.Avatar,
		&tagsStr, &d.IsDraft, &d.Visibility,
		&d.Thumbnail, &d.ThumbnailDark,
		&d.ThumbnailPreview, &d.ThumbnailPreviewDark,
		&d.IsStarred, &d.StarredAt,
		&d.IsShared,
		&d.ViewCount, &d.LastViewedAt,
		&d.CreatedAt, &d.UpdatedAt,
		&editorID, &editor.Name, &editor.Email, &editor.Avatar,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return d, constant.ErrDocumentNotFound
	}
	if err != nil {
		return d, err
	}
	if hasCollabBody(d.Type) && len(contentJSON) > 0 {
		d.ContentJSON = contentJSON
	}
	if editorID.Valid {
		editor.ID = editorID.UUID
		d.UpdatedBy = &editor
	}
	d.Author.ID = d.AuthorID
	if tagsStr != "" {
		d.Tags = strings.Split(tagsStr, ",")
	} else {
		d.Tags = make([]string, 0)
	}

	catMap, _ := r.fetchCategoriesForDocuments(ctx, []uuid.UUID{d.ID}, userID)
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
