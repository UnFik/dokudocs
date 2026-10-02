package document

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"

	"backend/constant"
	"backend/internal/application/collaboration"
	"backend/internal/domain/documentbody"
	"backend/internal/domain/model"
	"backend/internal/domain/policy"
	"backend/internal/infrastructure/collaboration/yjs"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

func (r *Repository) CreateSuggestion(ctx context.Context, workspaceID uuid.UUID, suggestion model.DocumentSuggestion) error {
	if r.tx == nil {
		return errors.New("creating suggestion requires a transaction-capable database")
	}
	return r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		doc, access, err := lockDocumentAccess(ctx, tx, suggestion.DocumentID, workspaceID, suggestion.ProposerID, false, nil)
		if err != nil {
			return err
		}
		if !policy.CanSuggest(doc, access) {
			return constant.ErrForbidden
		}
		_, err = tx.ExecContext(ctx, `
			INSERT INTO document_suggestions (
				document_id, suggestion_id, proposer_id, base_body_version, base_body_epoch,
				operation_schema_version, provenance, operations, summary, reason
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		`, suggestion.DocumentID, suggestion.SuggestionID, suggestion.ProposerID,
			suggestion.BaseBodyVersion, suggestion.BaseBodyEpoch, suggestion.OperationSchemaVersion,
			suggestion.Provenance, suggestion.Operations, suggestion.Summary, suggestion.Reason)
		return err
	})
}

func (r *Repository) ListSuggestions(ctx context.Context, workspaceID, documentID, actorID uuid.UUID) ([]model.DocumentSuggestion, error) {
	result := make([]model.DocumentSuggestion, 0)
	err := r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		doc, access, err := lockDocumentAccess(ctx, tx, documentID, workspaceID, actorID, false, nil)
		if err != nil {
			return err
		}
		if !policy.CanReadDocument(doc, access) {
			return constant.ErrDocumentNotFound
		}
		canDecide := policy.CanDecideSuggestion(doc, access)
		rows, err := tx.QueryContext(ctx, `
			SELECT document_id, suggestion_id, proposer_id, decider_id, base_body_version,
			       base_body_epoch, operation_schema_version, provenance, operations,
			       summary, reason, conflict_reason, status, created_at, decided_at
			FROM document_suggestions
			WHERE document_id = $1
			ORDER BY created_at ASC, suggestion_id ASC
		`, documentID)
		if err != nil {
			return err
		}
		defer rows.Close()

		for rows.Next() {
			var suggestion model.DocumentSuggestion
			var deciderID sql.NullString
			var decidedAt sql.NullTime
			if err := rows.Scan(
				&suggestion.DocumentID, &suggestion.SuggestionID, &suggestion.ProposerID,
				&deciderID, &suggestion.BaseBodyVersion, &suggestion.BaseBodyEpoch,
				&suggestion.OperationSchemaVersion, &suggestion.Provenance, &suggestion.Operations,
				&suggestion.Summary, &suggestion.Reason, &suggestion.ConflictReason, &suggestion.Status, &suggestion.CreatedAt,
				&decidedAt,
			); err != nil {
				return err
			}
			if deciderID.Valid {
				parsed, err := uuid.Parse(deciderID.String)
				if err != nil {
					return err
				}
				suggestion.DeciderID = &parsed
			}
			if decidedAt.Valid {
				parsed := decidedAt.Time
				suggestion.DecidedAt = &parsed
			}
			if suggestion.ProposerID == actorID || canDecide {
				result = append(result, suggestion)
			}
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}

func (r *Repository) RejectSuggestion(ctx context.Context, workspaceID, documentID, suggestionID, deciderID uuid.UUID) error {
	if r.tx == nil {
		return errors.New("rejecting suggestion requires a transaction-capable database")
	}
	return r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		doc, access, err := lockDocumentAccess(ctx, tx, documentID, workspaceID, deciderID, false, nil)
		if err != nil {
			return err
		}
		if !policy.CanDecideSuggestion(doc, access) {
			return constant.ErrForbidden
		}
		result, err := tx.ExecContext(ctx, `
			UPDATE document_suggestions
			SET status = 'rejected', decider_id = $3, decided_at = NOW()
			WHERE document_id = $1 AND suggestion_id = $2 AND status = 'pending'
		`, documentID, suggestionID, deciderID)
		if err != nil {
			return err
		}
		if rows, err := result.RowsAffected(); err != nil {
			return err
		} else if rows == 1 {
			return nil
		}
		var status string
		if err := tx.QueryRowContext(ctx, `
			SELECT status FROM document_suggestions WHERE document_id = $1 AND suggestion_id = $2
		`, documentID, suggestionID).Scan(&status); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return constant.ErrDocumentNotFound
			}
			return err
		}
		if status == "rejected" {
			return nil
		}
		return errors.New("suggestion already decided")
	})
}

type suggestionOperation struct {
	Op             string          `json:"op"`
	NodeID         uuid.UUID       `json:"nodeID"`
	TargetParentID uuid.UUID       `json:"targetParentID"`
	BeforeNodeID   *uuid.UUID      `json:"beforeNodeID"`
	ParentID       uuid.UUID       `json:"parentID"`
	Type           string          `json:"type"`
	Content        string          `json:"content"`
	Attributes     json.RawMessage `json:"attributes"`
}

func (r *Repository) AcceptSuggestion(ctx context.Context, workspaceID, documentID, suggestionID, deciderID uuid.UUID) error {
	if r.tx == nil {
		return errors.New("accept suggestion requires a transaction-capable database")
	}
	conflicted := false
	err := r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		doc, access, err := lockDocumentAccess(ctx, tx, documentID, workspaceID, deciderID, false, nil)
		if err != nil {
			return err
		}
		if !policy.CanDecideSuggestion(doc, access) {
			return constant.ErrForbidden
		}

		var status string
		var baseVersion, baseEpoch, schemaVersion int64
		var operations []byte
		if err := tx.QueryRowContext(ctx, `
			SELECT status, base_body_version, base_body_epoch, operation_schema_version, operations
			FROM document_suggestions
			WHERE document_id = $1 AND suggestion_id = $2
			FOR UPDATE
		`, documentID, suggestionID).Scan(&status, &baseVersion, &baseEpoch, &schemaVersion, &operations); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return constant.ErrDocumentNotFound
			}
			return err
		}
		if status == "accepted" {
			return nil
		}
		if status != "pending" {
			return collaboration.ErrSuggestionConflict
		}
		if schemaVersion != 1 {
			if err := markSuggestionConflicted(ctx, tx, documentID, suggestionID, deciderID, "schema"); err != nil {
				return err
			}
			conflicted = true
			return nil
		}

		var rootIDText sql.NullString
		var bodyVersion, bodyEpoch int64
		var bodySchemaVersion int
		if err := tx.QueryRowContext(ctx, `
			SELECT root_node_id::text, body_version, body_epoch, body_schema_version
			FROM documents WHERE id = $1 AND workspace_id = $2 AND type = 'markdown' AND deleted_at IS NULL
			FOR UPDATE
		`, documentID, workspaceID).Scan(&rootIDText, &bodyVersion, &bodyEpoch, &bodySchemaVersion); err != nil {
			return err
		}
		if !rootIDText.Valid || bodySchemaVersion != 1 || baseVersion != bodyVersion || baseEpoch != bodyEpoch {
			if err := markSuggestionConflicted(ctx, tx, documentID, suggestionID, deciderID, "base"); err != nil {
				return err
			}
			conflicted = true
			return nil
		}
		rootID, err := uuid.Parse(rootIDText.String)
		if err != nil {
			return err
		}
		before, err := loadDocumentBody(ctx, tx, documentID, rootID)
		if err != nil {
			return err
		}
		var encodedState []byte
		var stateSchemaVersion int
		if err := tx.QueryRowContext(ctx, `SELECT encoded_state, schema_version FROM document_collab_states WHERE document_id = $1`, documentID).Scan(&encodedState, &stateSchemaVersion); err != nil {
			return err
		}
		if stateSchemaVersion != bodySchemaVersion {
			if err := markSuggestionConflicted(ctx, tx, documentID, suggestionID, deciderID, "state-schema"); err != nil {
				return err
			}
			conflicted = true
			return nil
		}
		projected, err := yjs.ProjectV1(encodedState, documentID)
		if err != nil {
			return err
		}
		if !sameBody(before, projected) {
			return constant.ErrDocumentConflict
		}

		var ops []suggestionOperation
		if err := json.Unmarshal(operations, &ops); err != nil || len(ops) == 0 {
			if err := markSuggestionConflicted(ctx, tx, documentID, suggestionID, deciderID, "operations-json"); err != nil {
				return err
			}
			conflicted = true
			return nil
		}
		after := before
		after.Nodes = append([]documentbody.Node(nil), before.Nodes...)
		epochChanged := false
		for _, operation := range ops {
			if operation.NodeID == uuid.Nil || (operation.Op != "replace_text" && operation.Op != "insert" && operation.Op != "delete" && operation.Op != "move" && operation.Op != "format") {
				if err := markSuggestionConflicted(ctx, tx, documentID, suggestionID, deciderID, "operation-envelope"); err != nil {
					return err
				}
				conflicted = true
				return nil
			}
			found := false
			for index := range after.Nodes {
				if after.Nodes[index].NodeID != operation.NodeID {
					continue
				}
				if after.Nodes[index].Type == "document" || after.Nodes[index].Type == "opaque" || after.Nodes[index].Type == "opaque-inline" {
					if err := markSuggestionConflicted(ctx, tx, documentID, suggestionID, deciderID, "opaque-node"); err != nil {
						return err
					}
					conflicted = true
					return nil
				}
				switch operation.Op {
				case "replace_text":
					after.Nodes[index].Content = operation.Content
					after.Nodes[index].Version++
				case "format":
					formatted, formatErr := formatRunAttributes(after.Nodes[index], operation.Attributes)
					if formatErr != nil {
						if err := markSuggestionConflicted(ctx, tx, documentID, suggestionID, deciderID, "format"); err != nil {
							return err
						}
						conflicted = true
						return nil
					}
					after.Nodes[index].Attributes = formatted
					after.Nodes[index].Version++
					epochChanged = true
				case "delete":
					var deleteErr error
					after, deleteErr = documentbody.DeleteNode(after, documentbody.DeleteNodeCommand{NodeIDs: []uuid.UUID{operation.NodeID}})
					if deleteErr != nil {
						if err := markSuggestionConflicted(ctx, tx, documentID, suggestionID, deciderID, "delete"); err != nil {
							return err
						}
						conflicted = true
						return nil
					}
					epochChanged = true
				case "move":
					var moveErr error
					after, moveErr = documentbody.MoveNode(after, documentbody.MoveNodeCommand{NodeID: operation.NodeID, TargetParentID: operation.TargetParentID, BeforeNodeID: operation.BeforeNodeID})
					if moveErr != nil {
						if err := markSuggestionConflicted(ctx, tx, documentID, suggestionID, deciderID, "move"); err != nil {
							return err
						}
						conflicted = true
						return nil
					}
					epochChanged = true
				}
				found = true
				break
			}
			if operation.Op == "insert" {
				if err := appendSuggestionNode(&after, operation); err != nil {
					if err := markSuggestionConflicted(ctx, tx, documentID, suggestionID, deciderID, "insert"); err != nil {
						return err
					}
					conflicted = true
					return nil
				}
				epochChanged = true
				found = true
			}
			if !found {
				if err := markSuggestionConflicted(ctx, tx, documentID, suggestionID, deciderID, "missing-node"); err != nil {
					return err
				}
				conflicted = true
				return nil
			}
		}
		if err := documentbody.Validate(after); err != nil {
			if err := markSuggestionConflicted(ctx, tx, documentID, suggestionID, deciderID, "invalid-body"); err != nil {
				return err
			}
			conflicted = true
			return nil
		}
		if sameBody(before, after) {
			if err := markSuggestionConflicted(ctx, tx, documentID, suggestionID, deciderID, "no-change"); err != nil {
				return err
			}
			conflicted = true
			return nil
		}
		if bodyVersion == 1<<63-1 || (epochChanged && bodyEpoch == 1<<63-1) {
			return constant.ErrDocumentConflict
		}
		bodyVersion++
		if epochChanged {
			bodyEpoch++
		}
		var encoded []byte
		if epochChanged {
			encoded, err = yjs.EncodeBodyV1(after)
		} else {
			encoded, err = yjs.ApplyTextChangesV1(encodedState, before, after)
		}
		if err != nil {
			if err := markSuggestionConflicted(ctx, tx, documentID, suggestionID, deciderID, "state-projection"); err != nil {
				return err
			}
			conflicted = true
			return nil
		}
		if err := replaceDocumentBody(ctx, tx, documentID, after); err != nil {
			return err
		}
		if result, err := tx.ExecContext(ctx, `UPDATE documents SET body_version = $2, body_epoch = $3, updated_at = NOW() WHERE id = $1 AND body_version = $4 AND body_epoch = $5`, documentID, bodyVersion, bodyEpoch, baseVersion, baseEpoch); err != nil {
			return err
		} else if rows, _ := result.RowsAffected(); rows != 1 {
			return constant.ErrDocumentConflict
		}
		if result, err := tx.ExecContext(ctx, `UPDATE document_collab_states SET encoded_state = $2, updated_at = NOW() WHERE document_id = $1 AND schema_version = $3`, documentID, encoded, bodySchemaVersion); err != nil {
			return err
		} else if rows, _ := result.RowsAffected(); rows != 1 {
			return collaboration.ErrBodyNotInitialized
		}
		if err := storeAutoRevision(ctx, tx, documentID, deciderID, after, bodyVersion, bodySchemaVersion, 0); err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `UPDATE document_suggestions SET status = 'accepted', decider_id = $3, decided_at = NOW() WHERE document_id = $1 AND suggestion_id = $2 AND status = 'pending'`, documentID, suggestionID, deciderID)
		if err != nil {
			return err
		}
		if epochChanged {
			requestHash := sha256.Sum256(operations)
			resultJSON, err := json.Marshal(map[string]any{
				"suggestionID": suggestionID, "bodyEpoch": bodyEpoch, "bodyVersion": bodyVersion,
			})
			if err != nil {
				return err
			}
			_, err = tx.ExecContext(ctx, `
				INSERT INTO document_command_receipts
					(document_id, command_id, body_epoch, actor_id, request_hash, body_version, result)
				VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
				ON CONFLICT (document_id, command_id) DO NOTHING
			`, documentID, suggestionID, baseEpoch, deciderID, requestHash[:], bodyVersion, resultJSON)
			return err
		}
		return nil
	})
	if err == nil && conflicted {
		return collaboration.ErrSuggestionConflict
	}
	return err
}

func markSuggestionConflicted(ctx context.Context, tx database.Queryer, documentID, suggestionID, deciderID uuid.UUID, reason string) error {
	if _, err := tx.ExecContext(ctx, `UPDATE document_suggestions SET status = 'conflicted', conflict_reason = $4, decider_id = $3, decided_at = NOW() WHERE document_id = $1 AND suggestion_id = $2 AND status = 'pending'`, documentID, suggestionID, deciderID, reason); err != nil {
		return err
	}
	return nil
}

func appendSuggestionNode(body *documentbody.Body, operation suggestionOperation) error {
	if body == nil || operation.NodeID == uuid.Nil || operation.ParentID == uuid.Nil || operation.Type == "" {
		return errors.New("insert node requires id, parent, and type")
	}
	if operation.NodeID == body.RootNodeID {
		return errors.New("cannot insert the document root")
	}
	for _, node := range body.Nodes {
		if node.NodeID == operation.NodeID {
			return errors.New("insert node already exists")
		}
		if node.NodeID == operation.ParentID && (node.Type == "opaque" || node.Type == "opaque-inline") {
			return errors.New("cannot insert under opaque node")
		}
	}
	parentFound := false
	maxOrder := -1.0
	for _, node := range body.Nodes {
		if node.NodeID == operation.ParentID {
			parentFound = true
		}
		if node.ParentID != nil && *node.ParentID == operation.ParentID && node.SiblingOrder > maxOrder {
			maxOrder = node.SiblingOrder
		}
	}
	if !parentFound {
		return errors.New("insert parent does not exist")
	}
	attributes := operation.Attributes
	if len(attributes) == 0 {
		attributes = json.RawMessage(`{}`)
	}
	parentID := operation.ParentID
	body.Nodes = append(body.Nodes, documentbody.Node{
		DocumentID: body.DocumentID, NodeID: operation.NodeID, ParentID: &parentID,
		SiblingOrder: maxOrder + 1, Type: operation.Type, Content: operation.Content,
		Attributes: attributes, Version: 1,
	})
	return nil
}

var formatAttributeNames = map[string]bool{"bold": true, "italic": true, "strike": true, "code": true}

// formatRunAttributes sets or clears the boolean format marks on a run; other
// attributes (links) are left untouched.
func formatRunAttributes(node documentbody.Node, requested json.RawMessage) (json.RawMessage, error) {
	if node.Type != "run" {
		return nil, errors.New("format applies to a run")
	}
	var changes map[string]bool
	if err := json.Unmarshal(requested, &changes); err != nil || len(changes) == 0 {
		return nil, errors.New("format needs boolean marks")
	}
	current := map[string]any{}
	if len(node.Attributes) > 0 {
		if err := json.Unmarshal(node.Attributes, &current); err != nil {
			return nil, err
		}
	}
	for name, on := range changes {
		if !formatAttributeNames[name] {
			return nil, errors.New("unsupported format mark")
		}
		if on {
			current[name] = true
		} else {
			delete(current, name)
		}
	}
	return json.Marshal(current)
}
