package project

import (
	"context"
	"database/sql"
	"errors"

	"backend/constant"
	"backend/internal/domain/model"

	"github.com/google/uuid"
)

func (r *Repository) GetByID(ctx context.Context, id, userID uuid.UUID) (model.Project, error) {
	const query = `
		SELECT p.id, p.workspace_id, p.name, COALESCE(p.description, ''), COALESCE(p.logo_url, ''),
		       COALESCE(p.color_badge, '#3b82f6'), p.visibility::text, p.created_by, p.created_at, p.updated_at,
		       (ps.project_id IS NOT NULL) AS is_starred, ps.starred_at,
		       COALESCE(pm.role::text, '') AS member_role,
		       (SELECT COUNT(*) FROM documents d WHERE d.project_id = p.id AND d.deleted_at IS NULL) AS document_count
		FROM projects p
		LEFT JOIN project_stars ps ON ps.project_id = p.id AND ps.user_id = $2
		LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $2
		WHERE p.id = $1 AND p.deleted_at IS NULL
	`
	var p model.Project
	err := r.db.QueryRowContext(ctx, query, id, userID).Scan(
		&p.ID, &p.WorkspaceID, &p.Name, &p.Description, &p.LogoURL,
		&p.ColorBadge, &p.Visibility, &p.CreatedBy, &p.CreatedAt, &p.UpdatedAt,
		&p.IsStarred, &p.StarredAt, &p.Role, &p.DocumentCount,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return p, constant.ErrProjectNotFound
	}
	if err != nil {
		return p, err
	}

	cats, err := r.ListCategories(ctx, p.ID)
	if err != nil {
		return p, err
	}
	p.Categories = cats
	p.CategoryColors = make(map[string]string)
	for _, c := range cats {
		p.CategoryNames = append(p.CategoryNames, c.Name)
		p.CategoryColors[c.Name] = c.ColorID
	}

	return p, nil
}
