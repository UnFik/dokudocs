package project

import (
	"context"

	"backend/internal/domain/model"

	"github.com/google/uuid"
)

func (r *Repository) ListByWorkspace(ctx context.Context, workspaceID, userID uuid.UUID) ([]model.Project, error) {
	const query = `
		SELECT p.id, p.workspace_id, p.name, COALESCE(p.description, ''), COALESCE(p.logo_url, ''),
		       COALESCE(p.color_badge, '#3b82f6'), p.visibility::text, p.created_by, p.created_at, p.updated_at,
		       (ps.project_id IS NOT NULL) AS is_starred, ps.starred_at,
		       COALESCE(pm.role::text, '') AS member_role,
		       COUNT(DISTINCT d.id) AS document_count
		FROM projects p
		LEFT JOIN project_stars ps ON ps.project_id = p.id AND ps.user_id = $2
		LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $2
		LEFT JOIN documents d ON d.project_id = p.id AND d.deleted_at IS NULL
		WHERE p.workspace_id = $1 AND p.deleted_at IS NULL
		GROUP BY p.id, ps.project_id, ps.starred_at, pm.role
		ORDER BY p.created_at DESC
	`
	rows, err := r.db.QueryContext(ctx, query, workspaceID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	projects := make([]model.Project, 0)
	var projectIDs []uuid.UUID
	for rows.Next() {
		var p model.Project
		if err := rows.Scan(
			&p.ID, &p.WorkspaceID, &p.Name, &p.Description, &p.LogoURL,
			&p.ColorBadge, &p.Visibility, &p.CreatedBy, &p.CreatedAt, &p.UpdatedAt,
			&p.IsStarred, &p.StarredAt, &p.Role, &p.DocumentCount,
		); err != nil {
			return nil, err
		}
		p.CategoryColors = make(map[string]string)
		projects = append(projects, p)
		projectIDs = append(projectIDs, p.ID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	if len(projectIDs) > 0 {
		catsByProject, err := r.fetchCategoriesForProjects(ctx, projectIDs)
		if err != nil {
			return nil, err
		}
		for i := range projects {
			cats := catsByProject[projects[i].ID]
			projects[i].Categories = cats
			for _, c := range cats {
				projects[i].CategoryNames = append(projects[i].CategoryNames, c.Name)
				projects[i].CategoryColors[c.Name] = c.ColorID
			}
		}
	}

	return projects, nil
}
