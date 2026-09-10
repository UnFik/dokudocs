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
}

func NewRepository(db database.Queryer) *Repository {
	return &Repository{db: db}
}

func (r *Repository) fetchCategoriesForDocuments(ctx context.Context, docIDs []uuid.UUID) (map[uuid.UUID][]string, error) {
	placeholders := make([]string, len(docIDs))
	args := make([]any, len(docIDs))
	for i, id := range docIDs {
		placeholders[i] = fmt.Sprintf("$%d", i+1)
		args[i] = id
	}
	query := fmt.Sprintf(`
		SELECT dcm.document_id, pc.name
		FROM document_category_mappings dcm
		JOIN project_categories pc ON pc.id = dcm.category_id
		WHERE dcm.document_id IN (%s)
		ORDER BY pc.sort_order ASC, pc.created_at ASC
	`, strings.Join(placeholders, ", "))

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
