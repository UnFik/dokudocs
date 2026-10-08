package document

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"backend/constant"
	"backend/internal/domain/model"
	"backend/internal/domain/policy"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

func (r *Repository) Create(ctx context.Context, doc model.Document, categoryNames []string) (model.Document, error) {
	return r.create(ctx, doc, categoryNames, uuid.Nil)
}

func (r *Repository) CreateIdempotent(ctx context.Context, doc model.Document, categoryNames []string, requestID uuid.UUID) (model.Document, error) {
	if requestID == uuid.Nil {
		return model.Document{}, constant.ErrInvalidIdempotencyKey
	}
	return r.create(ctx, doc, categoryNames, requestID)
}

func (r *Repository) create(
	ctx context.Context,
	doc model.Document,
	categoryNames []string,
	requestID uuid.UUID,
) (model.Document, error) {
	if doc.ID == uuid.Nil {
		doc.ID = uuid.New()
	}
	if doc.Visibility == "" {
		doc.Visibility = "inherit"
	}
	if doc.Tags == nil {
		doc.Tags = make([]string, 0)
	}
	var requestHash [sha256.Size]byte
	var requestKind any
	var storedRequestID any
	var storedRequestHash any
	if requestID != uuid.Nil {
		var err error
		requestHash, err = createRequestHash(doc, categoryNames)
		if err != nil {
			return model.Document{}, err
		}
		requestKind, storedRequestID, storedRequestHash = "create", requestID, requestHash[:]
	}

	tagsSQL := "{" + strings.Join(doc.Tags, ",") + "}"
	if r.tx == nil {
		return doc, fmt.Errorf("document create requires a transaction-capable database")
	}
	err := r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		var workspaceRole string
		if err := tx.QueryRowContext(ctx, `
			SELECT role::text FROM workspace_members
			WHERE workspace_id = $1 AND user_id = $2
			FOR SHARE
		`, doc.WorkspaceID, doc.AuthorID).Scan(&workspaceRole); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return constant.ErrForbidden
			}
			return err
		}
		if doc.ProjectID != nil {
			var projectVisibility string
			if err := tx.QueryRowContext(ctx, `
				SELECT visibility::text FROM projects
				WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL
				FOR SHARE
			`, *doc.ProjectID, doc.WorkspaceID).Scan(&projectVisibility); err != nil {
				if errors.Is(err, sql.ErrNoRows) {
					return constant.ErrProjectNotFound
				}
				return err
			}
			projectRole := ""
			roleErr := tx.QueryRowContext(ctx, `
				SELECT role::text FROM project_members
				WHERE project_id = $1 AND user_id = $2
				FOR SHARE
			`, *doc.ProjectID, doc.AuthorID).Scan(&projectRole)
			if roleErr != nil && !errors.Is(roleErr, sql.ErrNoRows) {
				return roleErr
			}
			if !policy.CanPlaceDocumentInProject(projectVisibility, projectRole, workspaceRole) {
				return constant.ErrForbidden
			}
		}
		if requestID != uuid.Nil {
			var existingID uuid.UUID
			var existingHash []byte
			err := tx.QueryRowContext(ctx, `
				SELECT id, creation_request_hash FROM documents
				WHERE author_id = $1 AND creation_request_kind = 'create' AND creation_request_id = $2
			`, doc.AuthorID, requestID).Scan(&existingID, &existingHash)
			if err == nil {
				if !bytes.Equal(existingHash, requestHash[:]) {
					return constant.ErrDocumentConflict
				}
				doc.ID = existingID
				return nil
			}
			if !errors.Is(err, sql.ErrNoRows) {
				return err
			}
		}

		const insertQuery = `
			INSERT INTO documents (
				id, workspace_id, project_id, title, type, content, author_id, tags, is_draft, visibility,
				creation_request_kind, creation_request_id, creation_request_hash, content_json
			) VALUES (
				$1, $2, $3, $4, $5::document_type, $6, $7, $8, $9, $10::document_visibility, $11, $12, $13, $14
			)
			ON CONFLICT (author_id, creation_request_kind, creation_request_id)
			WHERE creation_request_id IS NOT NULL DO NOTHING
			RETURNING id, created_at, updated_at
		`
		var insertedID uuid.UUID
		err := tx.QueryRowContext(
			ctx, insertQuery,
			doc.ID, doc.WorkspaceID, doc.ProjectID, doc.Title, doc.Type, doc.Content,
			doc.AuthorID, tagsSQL, doc.IsDraft, doc.Visibility, requestKind, storedRequestID, storedRequestHash, nullableJSON(doc.ContentJSON),
		).Scan(&insertedID, &doc.CreatedAt, &doc.UpdatedAt)
		if errors.Is(err, sql.ErrNoRows) && requestID != uuid.Nil {
			var existingHash []byte
			err = tx.QueryRowContext(ctx, `
				SELECT id, creation_request_hash FROM documents
				WHERE author_id = $1 AND creation_request_kind = 'create' AND creation_request_id = $2
			`, doc.AuthorID, requestID).Scan(&doc.ID, &existingHash)
			if errors.Is(err, sql.ErrNoRows) {
				return constant.ErrDocumentConflict
			}
			if err != nil {
				return err
			}
			if !bytes.Equal(existingHash, requestHash[:]) {
				return constant.ErrDocumentConflict
			}
			return nil
		}
		if err != nil {
			return err
		}
		doc.ID = insertedID
		if doc.Type == "architecture" {
			if err := projectArchitectureLinks(ctx, tx, doc.WorkspaceID, doc.ID, doc.ContentJSON); err != nil {
				return err
			}
		}

		if doc.ProjectID != nil {
			for _, catName := range categoryNames {
				trimmed := strings.TrimSpace(catName)
				if trimmed == "" {
					continue
				}
				const mapQuery = `
					INSERT INTO document_category_mappings (document_id, category_id)
					SELECT $1, id FROM project_categories
					WHERE project_id = $2 AND name ILIKE $3
					ON CONFLICT DO NOTHING
				`
				if _, err := tx.ExecContext(ctx, mapQuery, doc.ID, *doc.ProjectID, trimmed); err != nil {
					return err
				}
			}
		}

		const insertAccess = `
			INSERT INTO document_accesses (document_id, user_id, access_level)
			VALUES ($1, $2, 'owner'::document_access_level)
		`
		_, err = tx.ExecContext(ctx, insertAccess, doc.ID, doc.AuthorID)
		if err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return doc, err
	}

	return r.GetByID(ctx, doc.ID, doc.AuthorID)
}

func createRequestHash(doc model.Document, categoryNames []string) ([sha256.Size]byte, error) {
	if categoryNames == nil {
		categoryNames = []string{}
	}
	payload, err := json.Marshal(struct {
		WorkspaceID uuid.UUID
		ProjectID   *uuid.UUID
		Title       string
		Type        string
		Content     string
		AuthorID    uuid.UUID
		Tags        []string
		IsDraft     bool
		Visibility  string
		Categories  []string
		ContentJSON json.RawMessage `json:",omitempty"`
	}{
		WorkspaceID: doc.WorkspaceID,
		ProjectID:   doc.ProjectID,
		Title:       doc.Title,
		Type:        doc.Type,
		Content:     doc.Content,
		AuthorID:    doc.AuthorID,
		Tags:        doc.Tags,
		IsDraft:     doc.IsDraft,
		Visibility:  doc.Visibility,
		Categories:  categoryNames,
		ContentJSON: doc.ContentJSON,
	})
	if err != nil {
		return [sha256.Size]byte{}, err
	}
	return sha256.Sum256(payload), nil
}

// nullableJSON is nil for no JSON, so the column stays NULL.
func nullableJSON(value json.RawMessage) any {
	if len(value) == 0 {
		return nil
	}
	return string(value)
}
