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
	"backend/internal/application/collaboration"
	contractrepo "backend/internal/domain/contract/repository"
	"backend/internal/domain/documentbody"
	"backend/internal/domain/model"
	"backend/internal/domain/policy"
	"backend/internal/infrastructure/collaboration/yjs"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

func (r *Repository) Create(ctx context.Context, doc model.Document, categoryNames []string) (model.Document, error) {
	return r.create(ctx, doc, categoryNames, uuid.Nil, nil, 0)
}

func (r *Repository) CreateIdempotent(ctx context.Context, doc model.Document, categoryNames []string, requestID uuid.UUID) (model.Document, error) {
	if requestID == uuid.Nil {
		return model.Document{}, constant.ErrInvalidIdempotencyKey
	}
	return r.create(ctx, doc, categoryNames, requestID, nil, 0)
}

func (r *Repository) CreateMarkdownIdempotent(ctx context.Context, input contractrepo.MarkdownDocumentCreate) (model.Document, error) {
	if input.RequestID == uuid.Nil {
		return model.Document{}, constant.ErrInvalidIdempotencyKey
	}
	if input.Document.ID == uuid.Nil || input.Document.Type != "markdown" || input.Document.Content != "" ||
		input.Body.DocumentID != input.Document.ID {
		return model.Document{}, collaboration.ErrInvalidBodyInitialization
	}
	if input.BodySchemaVersion != yjs.BodySchemaVersionV1 {
		return model.Document{}, collaboration.ErrBodySchemaMismatch
	}
	return r.create(ctx, input.Document, input.Categories, input.RequestID, &input.Body, input.BodySchemaVersion)
}

func (r *Repository) create(
	ctx context.Context,
	doc model.Document,
	categoryNames []string,
	requestID uuid.UUID,
	initialBody *documentbody.Body,
	bodySchemaVersion int,
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
	var encodedBody []byte
	if initialBody != nil {
		if doc.Type != "markdown" || doc.Content != "" || initialBody.DocumentID != doc.ID {
			return model.Document{}, collaboration.ErrInvalidBodyInitialization
		}
		if bodySchemaVersion != yjs.BodySchemaVersionV1 {
			return model.Document{}, collaboration.ErrBodySchemaMismatch
		}
		var err error
		encodedBody, err = yjs.EncodeBodyV1(*initialBody)
		if err != nil {
			return model.Document{}, collaboration.ErrInvalidBodyInitialization
		}
	}
	var requestHash [sha256.Size]byte
	var requestKind any
	var storedRequestID any
	var storedRequestHash any
	if requestID != uuid.Nil {
		var err error
		requestHash, err = createRequestHash(doc, categoryNames, initialBody, bodySchemaVersion)
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
				creation_request_kind, creation_request_id, creation_request_hash
			) VALUES (
				$1, $2, $3, $4, $5::document_type, $6, $7, $8, $9, $10::document_visibility, $11, $12, $13
			)
			ON CONFLICT (author_id, creation_request_kind, creation_request_id)
			WHERE creation_request_id IS NOT NULL DO NOTHING
			RETURNING id, created_at, updated_at
		`
		var insertedID uuid.UUID
		err := tx.QueryRowContext(
			ctx, insertQuery,
			doc.ID, doc.WorkspaceID, doc.ProjectID, doc.Title, doc.Type, doc.Content,
			doc.AuthorID, tagsSQL, doc.IsDraft, doc.Visibility, requestKind, storedRequestID, storedRequestHash,
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
		if initialBody == nil {
			return nil
		}
		if err := insertDocumentNodes(ctx, tx, *initialBody); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO document_collab_states (document_id, encoded_state, schema_version)
			VALUES ($1, $2, $3)
		`, doc.ID, encodedBody, bodySchemaVersion); err != nil {
			return err
		}
		result, err := tx.ExecContext(ctx, `
			UPDATE documents SET root_node_id = $2
			WHERE id = $1 AND root_node_id IS NULL
		`, doc.ID, initialBody.RootNodeID)
		if err != nil {
			return err
		}
		rows, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if rows != 1 {
			return constant.ErrDocumentConflict
		}
		return storeAutoRevision(ctx, tx, doc.ID, doc.AuthorID, *initialBody, 1, bodySchemaVersion, 0)
	})
	if err != nil {
		return doc, err
	}

	return r.GetByID(ctx, doc.ID, doc.AuthorID)
}

func createRequestHash(doc model.Document, categoryNames []string, initialBody *documentbody.Body, bodySchemaVersion int) ([sha256.Size]byte, error) {
	if categoryNames == nil {
		categoryNames = []string{}
	}
	payload, err := json.Marshal(struct {
		WorkspaceID       uuid.UUID
		ProjectID         *uuid.UUID
		Title             string
		Type              string
		Content           string
		AuthorID          uuid.UUID
		Tags              []string
		IsDraft           bool
		Visibility        string
		Categories        []string
		InitialBody       *documentbody.Body `json:",omitempty"`
		BodySchemaVersion int                `json:",omitempty"`
	}{
		WorkspaceID:       doc.WorkspaceID,
		ProjectID:         doc.ProjectID,
		Title:             doc.Title,
		Type:              doc.Type,
		Content:           doc.Content,
		AuthorID:          doc.AuthorID,
		Tags:              doc.Tags,
		IsDraft:           doc.IsDraft,
		Visibility:        doc.Visibility,
		Categories:        categoryNames,
		InitialBody:       initialBody,
		BodySchemaVersion: bodySchemaVersion,
	})
	if err != nil {
		return [sha256.Size]byte{}, err
	}
	return sha256.Sum256(payload), nil
}
