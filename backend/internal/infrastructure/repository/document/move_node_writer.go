package document

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"

	"backend/constant"
	"backend/internal/application/collaboration"
	"backend/internal/domain/documentbody"
	"backend/internal/domain/policy"
	"backend/internal/infrastructure/collaboration/yjs"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

type moveNodeHashPayload struct {
	CommandType       string     `json:"commandType"`
	BodyEpoch         int64      `json:"bodyEpoch"`
	BodySchemaVersion int        `json:"bodySchemaVersion"`
	NodeID            uuid.UUID  `json:"nodeID"`
	TargetParentID    uuid.UUID  `json:"targetParentID"`
	BeforeNodeID      *uuid.UUID `json:"beforeNodeID"`
}

func (r *Repository) MoveNode(ctx context.Context, actor collaboration.Actor, command collaboration.MoveNodeCommand) (collaboration.MoveNodeResult, error) {
	if actor.UserID == uuid.Nil || command.WorkspaceID == uuid.Nil || command.DocumentID == uuid.Nil ||
		command.CommandID == uuid.Nil || command.BodyEpoch < 1 || command.BodySchemaVersion < 1 ||
		command.NodeID == uuid.Nil || command.TargetParentID == uuid.Nil {
		return collaboration.MoveNodeResult{}, collaboration.ErrInvalidMoveNode
	}
	if r.tx == nil {
		return collaboration.MoveNodeResult{}, errors.New("MoveNode requires a transaction-capable database")
	}
	requestBytes, err := json.Marshal(moveNodeHashPayload{
		CommandType: "move_node",
		BodyEpoch:   command.BodyEpoch, BodySchemaVersion: command.BodySchemaVersion,
		NodeID: command.NodeID, TargetParentID: command.TargetParentID, BeforeNodeID: command.BeforeNodeID,
	})
	if err != nil {
		return collaboration.MoveNodeResult{}, err
	}
	requestHash := sha256.Sum256(requestBytes)
	var result collaboration.MoveNodeResult
	err = r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		doc, access, err := lockDocumentAccess(ctx, tx, command.DocumentID, command.WorkspaceID, actor.UserID, false, nil)
		if err != nil {
			return err
		}
		if !policy.CanEditDocument(doc, access) {
			return constant.ErrForbidden
		}

		if receipt, found, err := findMoveNodeReceipt(ctx, tx, actor.UserID, command, requestHash); err != nil {
			return err
		} else if found {
			result = receipt
			return nil
		}

		var rootIDText sql.NullString
		var bodyVersion, bodyEpoch int64
		var bodySchemaVersion int
		if err := tx.QueryRowContext(ctx, `
			SELECT root_node_id::text, body_version, body_epoch, body_schema_version
			FROM documents WHERE id = $1 AND workspace_id = $2 AND type = 'markdown' AND deleted_at IS NULL
		`, command.DocumentID, command.WorkspaceID).Scan(&rootIDText, &bodyVersion, &bodyEpoch, &bodySchemaVersion); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return constant.ErrDocumentNotFound
			}
			return err
		}
		if !rootIDText.Valid {
			return collaboration.ErrBodyNotInitialized
		}
		if bodyEpoch != command.BodyEpoch {
			return collaboration.ErrStaleBodyEpoch
		}
		if bodySchemaVersion != command.BodySchemaVersion {
			return collaboration.ErrBodySchemaMismatch
		}
		rootID, err := uuid.Parse(rootIDText.String)
		if err != nil {
			return err
		}

		before, err := loadDocumentBody(ctx, tx, command.DocumentID, rootID)
		if err != nil {
			return err
		}
		var persisted []byte
		var stateSchemaVersion int
		if err := tx.QueryRowContext(ctx, `
			SELECT encoded_state, schema_version FROM document_collab_states WHERE document_id = $1
		`, command.DocumentID).Scan(&persisted, &stateSchemaVersion); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return collaboration.ErrBodyNotInitialized
			}
			return err
		}
		if stateSchemaVersion != bodySchemaVersion {
			return collaboration.ErrBodySchemaMismatch
		}
		persistedBody, suggestions, err := yjs.ProjectWithSuggestionsV1(persisted, command.DocumentID)
		if err != nil {
			return err
		}
		if len(suggestions) > 0 {
			return collaboration.ErrSuggestionsPending
		}
		if err := setNodeVersions(before, &persistedBody); err != nil {
			return err
		}
		if !sameBody(before, persistedBody) {
			return constant.ErrDocumentConflict
		}

		after, err := documentbody.MoveNode(before, documentbody.MoveNodeCommand{
			NodeID: command.NodeID, TargetParentID: command.TargetParentID, BeforeNodeID: command.BeforeNodeID,
		})
		if err != nil {
			return fmt.Errorf("%w: %v", collaboration.ErrInvalidMoveNode, err)
		}
		changed := !documentbody.SameContent(before, after)
		result = collaboration.MoveNodeResult{
			DocumentID: command.DocumentID, CommandID: command.CommandID,
			BodyEpoch: bodyEpoch, BodyVersion: bodyVersion, Changed: changed,
		}
		if changed {
			// ponytail: every move advances the document epoch and holds all old pending edits for review; add per-node translation only if users need unaffected edits replayed automatically.
			if bodyEpoch == math.MaxInt64 || bodyVersion == math.MaxInt64 {
				return constant.ErrDocumentConflict
			}
			result.BodyEpoch++
			result.BodyVersion++
			encodedState, err := yjs.EncodeBodyV1(after)
			if err != nil {
				return err
			}
			if err := replaceDocumentBody(ctx, tx, command.DocumentID, after); err != nil {
				return err
			}
			updatedDocument, err := tx.ExecContext(ctx, `
				UPDATE documents SET body_version = $2, body_epoch = $3, updated_at = NOW()
				WHERE id = $1 AND root_node_id = $4 AND body_version = $5 AND body_epoch = $6
			`, command.DocumentID, result.BodyVersion, result.BodyEpoch, rootID, bodyVersion, bodyEpoch)
			if err != nil {
				return err
			}
			if rows, err := updatedDocument.RowsAffected(); err != nil {
				return err
			} else if rows != 1 {
				return constant.ErrDocumentConflict
			}
			updatedState, err := tx.ExecContext(ctx, `
				UPDATE document_collab_states SET encoded_state = $2, updated_at = NOW()
				WHERE document_id = $1 AND schema_version = $3
			`, command.DocumentID, encodedState, bodySchemaVersion)
			if err != nil {
				return err
			}
			if rows, err := updatedState.RowsAffected(); err != nil {
				return err
			} else if rows != 1 {
				return collaboration.ErrBodyNotInitialized
			}
			if err := storeAutoRevision(ctx, tx, command.DocumentID, actor.UserID, after, result.BodyVersion, bodySchemaVersion, 0); err != nil {
				return err
			}
		}
		resultJSON, err := json.Marshal(result)
		if err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `
			INSERT INTO document_command_receipts
				(document_id, command_id, body_epoch, actor_id, request_hash, body_version, result)
			VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
		`, command.DocumentID, command.CommandID, command.BodyEpoch, actor.UserID, requestHash[:], result.BodyVersion, resultJSON)
		return err
	})
	if err != nil {
		return collaboration.MoveNodeResult{}, err
	}
	return result, nil
}

func findMoveNodeReceipt(ctx context.Context, tx database.Queryer, actorID uuid.UUID, command collaboration.MoveNodeCommand, requestHash [sha256.Size]byte) (collaboration.MoveNodeResult, bool, error) {
	var bodyEpoch, bodyVersion int64
	var storedActor uuid.UUID
	var storedHash, rawResult []byte
	err := tx.QueryRowContext(ctx, `
		SELECT body_epoch, actor_id, request_hash, body_version, result
		FROM document_command_receipts WHERE document_id = $1 AND command_id = $2
	`, command.DocumentID, command.CommandID).Scan(&bodyEpoch, &storedActor, &storedHash, &bodyVersion, &rawResult)
	if errors.Is(err, sql.ErrNoRows) {
		return collaboration.MoveNodeResult{}, false, nil
	}
	if err != nil {
		return collaboration.MoveNodeResult{}, false, err
	}
	if bodyEpoch != command.BodyEpoch || storedActor != actorID || !bytes.Equal(storedHash, requestHash[:]) {
		return collaboration.MoveNodeResult{}, false, collaboration.ErrMoveCommandReplay
	}
	var result collaboration.MoveNodeResult
	if err := json.Unmarshal(rawResult, &result); err != nil || result.DocumentID != command.DocumentID ||
		result.CommandID != command.CommandID || result.BodyVersion != bodyVersion || result.BodyEpoch < command.BodyEpoch {
		return collaboration.MoveNodeResult{}, false, collaboration.ErrMoveCommandReplay
	}
	return result, true, nil
}
