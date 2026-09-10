package project

import (
	"context"
	"fmt"
	"strings"

	"backend/internal/domain/model"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

type Repository struct {
	db database.Queryer
}

func NewRepository(db database.Queryer) *Repository {
	return &Repository{db: db}
}

func (r *Repository) fetchCategoriesForProjects(ctx context.Context, projectIDs []uuid.UUID) (map[uuid.UUID][]model.ProjectCategory, error) {
	placeholders := make([]string, len(projectIDs))
	args := make([]any, len(projectIDs))
	for i, id := range projectIDs {
		placeholders[i] = fmt.Sprintf("$%d", i+1)
		args[i] = id
	}

	query := fmt.Sprintf(`
		SELECT id, project_id, name, color_id, sort_order, created_at
		FROM project_categories
		WHERE project_id IN (%s)
		ORDER BY sort_order ASC, created_at ASC
	`, strings.Join(placeholders, ", "))

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	res := make(map[uuid.UUID][]model.ProjectCategory)
	for rows.Next() {
		var c model.ProjectCategory
		if err := rows.Scan(&c.ID, &c.ProjectID, &c.Name, &c.ColorID, &c.SortOrder, &c.CreatedAt); err != nil {
			return nil, err
		}
		res[c.ProjectID] = append(res[c.ProjectID], c)
	}
	return res, rows.Err()
}
