package document

import (
	"context"
	"database/sql"
	"errors"

	"backend/constant"
	"backend/internal/application/collaboration"
	"backend/internal/domain/model"
	"backend/internal/domain/policy"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

var _ collaboration.RoomReader = (*Repository)(nil)

// ReadRoomHead evaluates document access for many users with five plain
// SELECTs, however many users there are, and no row locks. ReadBody takes
// FOR UPDATE and FOR SHARE locks per user, which is right for a write but makes
// every fan-out and poll queue behind committers. Revocation still wins in
// transaction order: a revoke committed before these reads is seen by them.
func (r *Repository) ReadRoomHead(ctx context.Context, workspaceID, documentID uuid.UUID, userIDs []uuid.UUID) (collaboration.RoomHead, error) {
	head := collaboration.RoomHead{Access: make(map[uuid.UUID]collaboration.RoomAccess, len(userIDs))}
	ids := make([]string, len(userIDs))
	for i, id := range userIDs {
		ids[i] = id.String()
	}
	err := r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		var doc model.Document
		var deletedAt sql.NullTime
		var documentType string
		err := tx.QueryRowContext(ctx, `
			SELECT id, workspace_id, project_id, author_id, is_draft, visibility::text, updated_at, deleted_at,
			       type::text
			FROM documents WHERE id = $1 AND workspace_id = $2
		`, documentID, workspaceID).Scan(
			&doc.ID, &doc.WorkspaceID, &doc.ProjectID, &doc.AuthorID, &doc.IsDraft, &doc.Visibility, &doc.UpdatedAt,
			&deletedAt, &documentType,
		)
		if errors.Is(err, sql.ErrNoRows) {
			return constant.ErrDocumentNotFound
		}
		if err != nil {
			return err
		}
		if deletedAt.Valid || documentType != "markdown" {
			return nil // nobody may read a trashed or non-Markdown document
		}

		workspaceRoles, err := scanUserRoles(ctx, tx, `
			SELECT user_id, role::text FROM workspace_members WHERE workspace_id = $1 AND user_id = ANY($2::uuid[])
		`, workspaceID, ids)
		if err != nil {
			return err
		}
		var projectVisibility string
		var projectRoles map[uuid.UUID]string
		if doc.ProjectID != nil {
			err := tx.QueryRowContext(ctx, `
				SELECT visibility::text FROM projects WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL
			`, *doc.ProjectID, workspaceID).Scan(&projectVisibility)
			if err != nil && !errors.Is(err, sql.ErrNoRows) {
				return err
			}
			if err == nil {
				if projectRoles, err = scanUserRoles(ctx, tx, `
					SELECT user_id, role::text FROM project_members WHERE project_id = $1 AND user_id = ANY($2::uuid[])
				`, *doc.ProjectID, ids); err != nil {
					return err
				}
			}
		}
		grants, err := scanUserRoles(ctx, tx, `
			SELECT user_id, access_level::text FROM document_accesses WHERE document_id = $1 AND user_id = ANY($2::uuid[])
		`, documentID, ids)
		if err != nil {
			return err
		}

		for _, userID := range userIDs {
			context := policy.DocumentAccessContext{
				UserID: userID, WorkspaceRole: workspaceRoles[userID], ProjectVisibility: projectVisibility,
				ProjectRole: projectRoles[userID], DocumentGrant: grants[userID],
			}
			if policy.CanReadDocument(doc, context) {
				head.Access[userID] = collaboration.RoomAccess{CanRead: true, CanEdit: policy.CanEditDocument(doc, context), CanSuggest: policy.CanSuggest(doc, context)}
			}
		}
		return nil
	})
	if err != nil {
		return collaboration.RoomHead{}, err
	}
	return head, nil
}

func scanUserRoles(ctx context.Context, tx database.Queryer, query string, scope uuid.UUID, userIDs []string) (map[uuid.UUID]string, error) {
	rows, err := tx.QueryContext(ctx, query, scope, userIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	values := make(map[uuid.UUID]string)
	for rows.Next() {
		var userID uuid.UUID
		var value string
		if err := rows.Scan(&userID, &value); err != nil {
			return nil, err
		}
		values[userID] = value
	}
	return values, rows.Err()
}
