package document

import (
	"context"
	"fmt"
	"strings"

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

func (r *Repository) fetchCategoriesForDocuments(ctx context.Context, docIDs []uuid.UUID, actorID uuid.UUID) (map[uuid.UUID][]string, error) {
	placeholders := make([]string, len(docIDs))
	args := make([]any, len(docIDs))
	for i, id := range docIDs {
		placeholders[i] = fmt.Sprintf("$%d", i+1)
		args[i] = id
	}
	actorPlaceholder := fmt.Sprintf("$%d", len(args)+1)
	args = append(args, actorID)
	query := fmt.Sprintf(`
		SELECT dcm.document_id, pc.name
		FROM document_category_mappings dcm
		JOIN documents d ON d.id = dcm.document_id
		JOIN project_categories pc ON pc.id = dcm.category_id
		JOIN projects p ON p.id = pc.project_id AND p.workspace_id = d.workspace_id AND p.deleted_at IS NULL
		WHERE dcm.document_id IN (%s) AND d.project_id = pc.project_id AND %s
		ORDER BY pc.sort_order ASC, pc.created_at ASC
	`, strings.Join(placeholders, ", "), projectMetadataPredicate(actorPlaceholder, "p"))

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	res := make(map[uuid.UUID][]string)
	for rows.Next() {
		var docID uuid.UUID
		var name string
		if err := rows.Scan(&docID, &name); err != nil {
			return nil, err
		}
		res[docID] = append(res[docID], name)
	}
	return res, rows.Err()
}
