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
	tx database.DB
}

func NewRepository(db database.DB) *Repository {
	return &Repository{db: db, tx: db}
}

func projectReadAccessPredicate(actorPlaceholder string) string {
	return fmt.Sprintf(`(
		EXISTS (
			SELECT 1 FROM workspace_members wm_project_read
			WHERE wm_project_read.workspace_id = p.workspace_id
			  AND wm_project_read.user_id = %[1]s
		)
		AND (
			p.visibility = 'workspace'
			OR EXISTS (
				SELECT 1 FROM workspace_members wm_project_admin
				WHERE wm_project_admin.workspace_id = p.workspace_id
				  AND wm_project_admin.user_id = %[1]s
				  AND wm_project_admin.role IN ('owner', 'admin')
			)
			OR EXISTS (
				SELECT 1 FROM project_members pm_project_read
				WHERE pm_project_read.project_id = p.id
				  AND pm_project_read.user_id = %[1]s
			)
		)
	)`, actorPlaceholder)
}

const projectDocumentReadPredicate = `(
	(
		d.author_id = $2
		OR EXISTS (
			SELECT 1 FROM workspace_members wm_doc_admin
			WHERE wm_doc_admin.workspace_id = d.workspace_id AND wm_doc_admin.user_id = $2
			  AND wm_doc_admin.role IN ('owner', 'admin')
		)
		OR EXISTS (
			SELECT 1 FROM document_accesses da_doc_read
			WHERE da_doc_read.document_id = d.id AND da_doc_read.user_id = $2
		)
		OR d.visibility = 'workspace'
		OR (d.visibility = 'inherit' AND (p.visibility = 'workspace' OR pm.project_id IS NOT NULL))
	)
	AND (
		NOT d.is_draft
		OR d.author_id = $2
		OR EXISTS (
			SELECT 1 FROM workspace_members wm_doc_edit
			WHERE wm_doc_edit.workspace_id = d.workspace_id AND wm_doc_edit.user_id = $2
			  AND wm_doc_edit.role IN ('owner', 'admin')
		)
		OR EXISTS (
			SELECT 1 FROM document_accesses da_doc_edit
			WHERE da_doc_edit.document_id = d.id AND da_doc_edit.user_id = $2
			  AND da_doc_edit.access_level IN ('owner', 'edit')
		)
		OR (d.visibility IN ('inherit', 'workspace') AND pm.role IN ('manager', 'editor'))
	)
)`

func (r *Repository) fetchCategoriesForProjects(ctx context.Context, projectIDs []uuid.UUID, workspaceID, userID uuid.UUID) (map[uuid.UUID][]model.ProjectCategory, error) {
	placeholders := make([]string, len(projectIDs))
	args := make([]any, len(projectIDs)+2)
	for i, id := range projectIDs {
		placeholders[i] = fmt.Sprintf("$%d", i+1)
		args[i] = id
	}
	workspacePlaceholder := fmt.Sprintf("$%d", len(projectIDs)+1)
	actorPlaceholder := fmt.Sprintf("$%d", len(projectIDs)+2)
	args[len(projectIDs)] = workspaceID
	args[len(projectIDs)+1] = userID

	query := fmt.Sprintf(`
		SELECT c.id, c.project_id, c.name, c.color_id, c.sort_order, c.created_at
		FROM project_categories c
		JOIN projects p ON p.id = c.project_id
		WHERE c.project_id IN (%s)
		  AND p.workspace_id = %s
		  AND p.deleted_at IS NULL
		  AND `+projectReadAccessPredicate(actorPlaceholder)+`
		ORDER BY sort_order ASC, created_at ASC
	`, strings.Join(placeholders, ", "), workspacePlaceholder)

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
