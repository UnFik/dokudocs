package document

import (
	"context"

	"backend/constant"
	"backend/internal/domain/policy"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

// Backlink is a page that mentions or links to another.
type Backlink struct {
	ID    uuid.UUID `json:"id"`
	Title string    `json:"title"`
}

// Backlinks lists the pages the actor may read whose body names documentID.
func (r *Repository) Backlinks(ctx context.Context, workspaceID, documentID, actorID uuid.UUID) ([]Backlink, error) {
	found := []Backlink{}
	err := r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		doc, access, err := lockDocumentAccess(ctx, tx, documentID, workspaceID, actorID, false, nil)
		if err != nil {
			return err
		}
		if !policy.CanReadDocument(doc, access) {
			return constant.ErrDocumentNotFound
		}
		rows, err := tx.QueryContext(ctx, `
			SELECT d.id, d.title
			FROM documents d
			WHERE d.workspace_id = $1 AND d.id <> $3 AND d.deleted_at IS NULL
			  AND strpos(d.content_json::text, $3::text) > 0
		`+documentReadPredicate+`
			ORDER BY d.updated_at DESC
			LIMIT 100
		`, workspaceID, actorID, documentID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var link Backlink
			if err := rows.Scan(&link.ID, &link.Title); err != nil {
				return err
			}
			found = append(found, link)
		}
		return rows.Err()
	})
	return found, err
}
