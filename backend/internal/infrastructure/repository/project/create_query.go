package project

import (
	"context"

	"backend/internal/domain/model"

	"github.com/google/uuid"
)

func (r *Repository) Create(ctx context.Context, p model.Project, defaultCategories []string) (model.Project, error) {
	if p.ID == uuid.Nil {
		p.ID = uuid.New()
	}
	if p.Visibility == "" {
		p.Visibility = "workspace"
	}
	if p.ColorBadge == "" {
		p.ColorBadge = "#3b82f6"
	}

	const insertProject = `
		INSERT INTO projects (id, workspace_id, name, description, logo_url, color_badge, visibility, created_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7::project_visibility, $8)
		RETURNING created_at, updated_at
	`
	err := r.db.QueryRowContext(ctx, insertProject, p.ID, p.WorkspaceID, p.Name, p.Description, p.LogoURL, p.ColorBadge, p.Visibility, p.CreatedBy).Scan(
		&p.CreatedAt, &p.UpdatedAt,
	)
	if err != nil {
		return p, err
	}

	// Auto-assign creator as manager
	const insertMember = `
		INSERT INTO project_members (project_id, user_id, role)
		VALUES ($1, $2, 'manager'::project_member_role)
		ON CONFLICT (project_id, user_id) DO NOTHING
	`
	_, _ = r.db.ExecContext(ctx, insertMember, p.ID, p.CreatedBy)
	p.Role = "manager"

	// Insert default categories
	p.CategoryColors = make(map[string]string)
	for i, catName := range defaultCategories {
		if catName == "" {
			continue
		}
		cat := model.ProjectCategory{
			ID:        uuid.New(),
			ProjectID: p.ID,
			Name:      catName,
			ColorID:   "blue",
			SortOrder: i,
		}
		const insertCat = `
			INSERT INTO project_categories (id, project_id, name, color_id, sort_order)
			VALUES ($1, $2, $3, $4, $5)
			RETURNING created_at
		`
		if err := r.db.QueryRowContext(ctx, insertCat, cat.ID, cat.ProjectID, cat.Name, cat.ColorID, cat.SortOrder).Scan(&cat.CreatedAt); err == nil {
			p.Categories = append(p.Categories, cat)
			p.CategoryNames = append(p.CategoryNames, cat.Name)
			p.CategoryColors[cat.Name] = cat.ColorID
		}
	}

	return p, nil
}
