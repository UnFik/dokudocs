package project

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"backend/constant"
	"backend/internal/domain/model"
	"backend/internal/infrastructure/database"

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
	if r.tx == nil {
		return p, fmt.Errorf("project create requires a transaction-capable database")
	}
	err := r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		var workspaceRole string
		err := tx.QueryRowContext(ctx, `
			SELECT role::text FROM workspace_members
			WHERE workspace_id = $1 AND user_id = $2
			FOR SHARE
		`, p.WorkspaceID, p.CreatedBy).Scan(&workspaceRole)
		if errors.Is(err, sql.ErrNoRows) {
			return constant.ErrForbidden
		}
		if err != nil {
			return err
		}
		if err := tx.QueryRowContext(ctx, insertProject, p.ID, p.WorkspaceID, p.Name, p.Description, p.LogoURL, p.ColorBadge, p.Visibility, p.CreatedBy).Scan(
			&p.CreatedAt, &p.UpdatedAt,
		); err != nil {
			return err
		}

		const insertMember = `
		INSERT INTO project_members (project_id, user_id, role)
		VALUES ($1, $2, 'manager'::project_member_role)
		ON CONFLICT (project_id, user_id) DO NOTHING
		`
		if _, err := tx.ExecContext(ctx, insertMember, p.ID, p.CreatedBy); err != nil {
			return err
		}

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
			if err := tx.QueryRowContext(ctx, insertCat, cat.ID, cat.ProjectID, cat.Name, cat.ColorID, cat.SortOrder).Scan(&cat.CreatedAt); err != nil {
				return err
			}
			p.Categories = append(p.Categories, cat)
			p.CategoryNames = append(p.CategoryNames, cat.Name)
			p.CategoryColors[cat.Name] = cat.ColorID
		}
		p.Role = "manager"
		return nil
	})
	if err != nil {
		return p, err
	}

	return p, nil
}
