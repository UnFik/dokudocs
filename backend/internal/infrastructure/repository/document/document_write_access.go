package document

import (
	"context"
	"database/sql"
	"errors"
	"sort"

	"backend/constant"
	"backend/internal/domain/model"
	"backend/internal/domain/policy"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

// lockDocumentAccess follows ADR 0011: workspace members, projects and project members in UUID order, document, direct grant.
func lockDocumentAccess(ctx context.Context, tx database.Queryer, docID, workspaceID, actorID uuid.UUID, trashed bool, targetProjectID *uuid.UUID, additionalMemberIDs ...uuid.UUID) (model.Document, policy.DocumentAccessContext, error) {
	return lockDocumentAccessWithPlacement(ctx, tx, docID, workspaceID, actorID, trashed, targetProjectID, false, additionalMemberIDs...)
}

func lockDocumentAccessWithPlacement(ctx context.Context, tx database.Queryer, docID, workspaceID, actorID uuid.UUID, trashed bool, targetProjectID *uuid.UUID, requirePlacement bool, additionalMemberIDs ...uuid.UUID) (model.Document, policy.DocumentAccessContext, error) {
	var doc model.Document
	var access policy.DocumentAccessContext
	var actualWorkspaceID uuid.UUID
	var initialProjectID *uuid.UUID
	var initialDeletedAt sql.NullTime
	if err := tx.QueryRowContext(ctx, `
		SELECT workspace_id, project_id, deleted_at FROM documents WHERE id = $1
	`, docID).Scan(&actualWorkspaceID, &initialProjectID, &initialDeletedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return doc, access, constant.ErrDocumentNotFound
		}
		return doc, access, err
	}
	if actualWorkspaceID != workspaceID {
		return doc, access, constant.ErrDocumentNotFound
	}
	if initialDeletedAt.Valid != trashed {
		return doc, access, constant.ErrDocumentNotFound
	}
	placementProjectID := targetProjectID
	if requirePlacement && placementProjectID == nil {
		placementProjectID = initialProjectID
	}

	memberIDs := append(additionalMemberIDs, actorID)
	sort.Slice(memberIDs, func(i, j int) bool { return memberIDs[i].String() < memberIDs[j].String() })
	var workspaceRole string
	var previousMemberID uuid.UUID
	for i, memberID := range memberIDs {
		if i > 0 && memberID == previousMemberID {
			continue
		}
		previousMemberID = memberID
		var role string
		if err := tx.QueryRowContext(ctx, `
			SELECT role::text FROM workspace_members
			WHERE workspace_id = $1 AND user_id = $2
			FOR SHARE
		`, workspaceID, memberID).Scan(&role); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return doc, access, constant.ErrForbidden
			}
			return doc, access, err
		}
		if memberID == actorID {
			workspaceRole = role
		}
	}

	projectIDs := make([]uuid.UUID, 0, 2)
	if initialProjectID != nil {
		projectIDs = append(projectIDs, *initialProjectID)
	}
	if placementProjectID != nil && !sameProject(initialProjectID, placementProjectID) {
		projectIDs = append(projectIDs, *placementProjectID)
	}
	sort.Slice(projectIDs, func(i, j int) bool { return projectIDs[i].String() < projectIDs[j].String() })
	projectVisibility := make(map[uuid.UUID]string, len(projectIDs))
	projectRoles := make(map[uuid.UUID]string, len(projectIDs))
	for _, projectID := range projectIDs {
		var visibility string
		err := tx.QueryRowContext(ctx, `
			SELECT visibility::text FROM projects
			WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL
			FOR SHARE
		`, projectID, workspaceID).Scan(&visibility)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return model.Document{}, access, err
		}
		if errors.Is(err, sql.ErrNoRows) {
			if targetProjectID != nil && projectID == *targetProjectID {
				return model.Document{}, access, constant.ErrProjectNotFound
			}
			continue
		}
		projectVisibility[projectID] = visibility
	}
	for _, projectID := range projectIDs {
		if _, exists := projectVisibility[projectID]; !exists {
			continue
		}
		var role string
		err := tx.QueryRowContext(ctx, `
			SELECT role::text FROM project_members
			WHERE project_id = $1 AND user_id = $2
			FOR SHARE
		`, projectID, actorID).Scan(&role)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return model.Document{}, access, err
		}
		if err == nil {
			projectRoles[projectID] = role
		}
	}
	if initialProjectID != nil {
		access.ProjectVisibility = projectVisibility[*initialProjectID]
		access.ProjectRole = projectRoles[*initialProjectID]
	}
	if placementProjectID != nil && (requirePlacement || !sameProject(initialProjectID, placementProjectID)) {
		if !policy.CanPlaceDocumentInProject(projectVisibility[*placementProjectID], projectRoles[*placementProjectID], workspaceRole) {
			return model.Document{}, access, constant.ErrForbidden
		}
	}

	var deletedAt sql.NullTime
	query := `
		SELECT id, workspace_id, project_id, author_id, is_draft, visibility::text, updated_at, deleted_at
		FROM documents
		WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL
		FOR UPDATE
	`
	if trashed {
		query = `
			SELECT id, workspace_id, project_id, author_id, is_draft, visibility::text, updated_at, deleted_at
			FROM documents
			WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NOT NULL
			FOR UPDATE
		`
	}
	err := tx.QueryRowContext(ctx, query, docID, workspaceID).Scan(
		&doc.ID, &doc.WorkspaceID, &doc.ProjectID, &doc.AuthorID, &doc.IsDraft,
		&doc.Visibility, &doc.UpdatedAt, &deletedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return model.Document{}, access, constant.ErrDocumentNotFound
	}
	if err != nil {
		return model.Document{}, access, err
	}
	if deletedAt.Valid {
		doc.DeletedAt = &deletedAt.Time
	}
	if !sameProject(initialProjectID, doc.ProjectID) {
		return model.Document{}, access, constant.ErrDocumentConflict
	}

	var grant string
	grantErr := tx.QueryRowContext(ctx, `
		SELECT access_level::text FROM document_accesses
		WHERE document_id = $1 AND user_id = $2
		FOR SHARE
	`, docID, actorID).Scan(&grant)
	if grantErr != nil && !errors.Is(grantErr, sql.ErrNoRows) {
		return model.Document{}, access, grantErr
	}
	if grantErr == nil {
		access.DocumentGrant = grant
	}
	access.UserID = actorID
	access.WorkspaceRole = workspaceRole
	return doc, access, nil
}

func (r *Repository) withReadableDocument(ctx context.Context, docID, workspaceID, actorID uuid.UUID, mutate func(database.Queryer) error) error {
	return r.withReadableDocumentPlacement(ctx, docID, workspaceID, actorID, false, mutate)
}

func (r *Repository) withReadableDocumentPlacement(ctx context.Context, docID, workspaceID, actorID uuid.UUID, requirePlacement bool, mutate func(database.Queryer) error) error {
	return r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		doc, access, err := lockDocumentAccessWithPlacement(ctx, tx, docID, workspaceID, actorID, false, nil, requirePlacement)
		if err != nil {
			return err
		}
		if !policy.CanReadDocument(doc, access) {
			return constant.ErrDocumentNotFound
		}
		return mutate(tx)
	})
}

func sameProject(left, right *uuid.UUID) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}
