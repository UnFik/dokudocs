package document

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"

	"backend/constant"
	"backend/internal/application/collaboration"
	"backend/internal/domain/documentbody"
	"backend/internal/domain/policy"
	"backend/internal/infrastructure/collaboration/yjs"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

var _ collaboration.Writer = (*Repository)(nil)

type commentAnchor struct {
	threadID uuid.UUID
	nodeID   uuid.UUID
	state    string
}

func (r *Repository) CommitUpdate(ctx context.Context, actor collaboration.Actor, update collaboration.Update) (collaboration.CommitReceipt, error) {
	receipt := collaboration.CommitReceipt{
		DocumentID: update.DocumentID,
		UpdateID:   update.UpdateID,
		BodyEpoch:  update.BodyEpoch,
	}
	if actor.UserID == uuid.Nil || update.DocumentID == uuid.Nil || update.UpdateID == uuid.Nil ||
		update.BodyEpoch < 1 || update.BodySchemaVersion < 1 || len(update.Bytes) == 0 {
		return collaboration.CommitReceipt{}, collaboration.ErrInvalidUpdate
	}
	if r.tx == nil {
		return collaboration.CommitReceipt{}, errors.New("collaborative update requires a transaction-capable database")
	}

	var committed *commitCacheEntry
	// document is the decoded state this commit works on. It is handed to the
	// cache only when the transaction commits; otherwise it may hold an update
	// the database never accepted and is closed.
	var document *yjs.Document
	err := r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		committed = nil
		if document != nil {
			document.Close()
			document = nil
		}
		var workspaceID uuid.UUID
		if err := tx.QueryRowContext(ctx, `
			SELECT workspace_id FROM documents
			WHERE id = $1 AND type = 'markdown' AND deleted_at IS NULL
		`, update.DocumentID).Scan(&workspaceID); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return constant.ErrDocumentNotFound
			}
			return err
		}
		doc, access, err := lockDocumentAccess(ctx, tx, update.DocumentID, workspaceID, actor.UserID, false, nil)
		if err != nil {
			return err
		}
		// Edit access changes anything. Comment access may only suggest: the
		// update is judged below, once its effect is known (ADR 0027).
		canEdit := policy.CanEditDocument(doc, access)
		if !canEdit && !policy.CanSuggest(doc, access) {
			return constant.ErrForbidden
		}

		var rootIDText sql.NullString
		var bodyVersion, bodyEpoch int64
		var bodySchemaVersion int
		if err := tx.QueryRowContext(ctx, `
			SELECT root_node_id::text, body_version, body_epoch, body_schema_version
			FROM documents WHERE id = $1 AND workspace_id = $2 AND type = 'markdown' AND deleted_at IS NULL
		`, update.DocumentID, workspaceID).Scan(&rootIDText, &bodyVersion, &bodyEpoch, &bodySchemaVersion); err != nil {
			return err
		}
		if !rootIDText.Valid {
			return collaboration.ErrBodyNotInitialized
		}
		if update.BodyEpoch != bodyEpoch {
			return collaboration.ErrStaleBodyEpoch
		}
		if update.BodySchemaVersion != bodySchemaVersion {
			return collaboration.ErrBodySchemaMismatch
		}
		rootID, err := uuid.Parse(rootIDText.String)
		if err != nil {
			return err
		}

		var stateSchemaVersion int
		var stateRevision int64
		if err := tx.QueryRowContext(ctx, `
			SELECT schema_version, revision FROM document_collab_states WHERE document_id = $1
		`, update.DocumentID).Scan(&stateSchemaVersion, &stateRevision); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return collaboration.ErrBodyNotInitialized
			}
			return err
		}
		if stateSchemaVersion != bodySchemaVersion {
			return collaboration.ErrBodySchemaMismatch
		}
		key := commitCacheKey{rootID: rootID, bodyVersion: bodyVersion, bodyEpoch: bodyEpoch, schemaVersion: bodySchemaVersion, stateRevision: stateRevision}
		var persisted []byte
		var before documentbody.Body
		if cached, ok := r.commits.take(update.DocumentID, key); ok {
			persisted, before, document = cached.state, cached.body, cached.doc
		} else {
			// Full read: load the stored state and rows and check that they still
			// describe the same body. With diff writes this is what repairs a
			// divergence, so it must run whenever the cache cannot vouch for both.
			if err := tx.QueryRowContext(ctx, `
				SELECT encoded_state FROM document_collab_states WHERE document_id = $1
			`, update.DocumentID).Scan(&persisted); err != nil {
				return err
			}
			before, err = loadDocumentBody(ctx, tx, update.DocumentID, rootID)
			if err != nil {
				return err
			}
			persistedBody, err := yjs.ProjectV1(persisted, update.DocumentID)
			if err != nil {
				return err
			}
			if err := setNodeVersions(before, &persistedBody); err != nil {
				return err
			}
			if !sameBody(before, persistedBody) {
				return constant.ErrDocumentConflict
			}
		}

		if document == nil {
			if document, err = yjs.LoadDocumentV1(persisted); err != nil {
				return err
			}
		}
		merged, after, err := document.ApplyAndProjectV1(update.Bytes, update.DocumentID)
		if err != nil {
			return fmt.Errorf("merge collaborative update: %w", err)
		}
		if err := setNodeVersions(before, &after); err != nil {
			return err
		}
		if canEdit {
			if err := documentbody.ValidateCollaborativeChange(before, after); err != nil {
				return err
			}
		} else if err := validateSuggesterUpdate(before, after, persisted, merged, actor.UserID); err != nil {
			return err
		}

		stateChanged := !bytes.Equal(persisted, merged)
		bodyChanged := !sameBody(before, after)
		if !stateChanged {
			// A repeated update leaves the state as it was, so the decoded
			// document still matches the unchanged key.
			receipt.BodyVersion = bodyVersion
			committed = &commitCacheEntry{key: key, state: persisted, body: before, doc: document}
			return nil
		}
		if err := syncSuggestionIndex(ctx, tx, update.DocumentID, actor.UserID, persisted, merged); err != nil {
			return err
		}
		if bodyChanged {
			if bodyVersion == 1<<63-1 {
				return constant.ErrDocumentConflict
			}
			previousBodyVersion := bodyVersion
			bodyVersion++
			if err := applyBodyDiff(ctx, tx, update.DocumentID, before, after); err != nil {
				return err
			}
			updatedDocument, err := tx.ExecContext(ctx, `
				UPDATE documents SET body_version = $2, updated_at = NOW()
				WHERE id = $1 AND root_node_id = $3 AND body_version = $4 AND body_epoch = $5
			`, update.DocumentID, bodyVersion, rootID, previousBodyVersion, update.BodyEpoch)
			if err != nil {
				return err
			}
			if rows, err := updatedDocument.RowsAffected(); err != nil {
				return err
			} else if rows != 1 {
				return collaboration.ErrConcurrentUpdate
			}
		}
		var newRevision int64
		if err := tx.QueryRowContext(ctx, `
			UPDATE document_collab_states SET encoded_state = $2, updated_at = NOW()
			WHERE document_id = $1 AND schema_version = $3
			RETURNING revision
		`, update.DocumentID, merged, bodySchemaVersion).Scan(&newRevision); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return collaboration.ErrBodyNotInitialized
			}
			return err
		}
		// When only Yjs metadata changed, the rows were not rewritten, so the
		// cached body must stay the one that matches them.
		cachedBody := before
		if bodyChanged {
			cachedBody = after
		}
		committed = &commitCacheEntry{
			key:   commitCacheKey{rootID: rootID, bodyVersion: bodyVersion, bodyEpoch: bodyEpoch, schemaVersion: bodySchemaVersion, stateRevision: newRevision},
			state: merged,
			body:  cachedBody,
			doc:   document,
		}
		if bodyChanged {
			if err := storeAutoRevision(ctx, tx, update.DocumentID, actor.UserID, after, bodyVersion, bodySchemaVersion, r.revisionDebounce); err != nil {
				return err
			}
		}
		receipt.BodyVersion = bodyVersion
		receipt.Changed = true
		return nil
	})
	if err != nil || committed == nil {
		document.Close()
	}
	if err != nil {
		return collaboration.CommitReceipt{}, err
	}
	if committed != nil {
		r.commits.put(update.DocumentID, *committed)
	}
	return receipt, nil
}

func syncSuggestionIndex(
	ctx context.Context,
	tx database.Queryer,
	documentID, actorID uuid.UUID,
	beforeState, afterState []byte,
) error {
	before, err := yjs.SuggestionsV1(beforeState)
	if err != nil {
		return err
	}
	after, err := yjs.SuggestionsV1(afterState)
	if err != nil {
		return err
	}
	active := make(map[uuid.UUID]struct{}, len(after))
	for _, suggestion := range after {
		active[suggestion.ID] = struct{}{}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO document_suggestions (document_id, suggestion_id, proposer_id)
			VALUES ($1, $2, $3)
			ON CONFLICT (document_id, suggestion_id) DO NOTHING
		`, documentID, suggestion.ID, suggestion.Author); err != nil {
			return err
		}
	}
	for _, suggestion := range before {
		if _, remains := active[suggestion.ID]; remains {
			continue
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE document_suggestions
			SET status = 'closed', decider_id = $3, decided_at = NOW()
			WHERE document_id = $1 AND suggestion_id = $2 AND status = 'pending'
		`, documentID, suggestion.ID, actorID); err != nil {
			return err
		}
	}
	return nil
}

func loadDocumentBody(ctx context.Context, tx database.Queryer, documentID, rootID uuid.UUID) (documentbody.Body, error) {
	rows, err := tx.QueryContext(ctx, `
		SELECT node_id, parent_id, sibling_order, node_type, content, attributes, version
		FROM document_nodes WHERE document_id = $1
	`, documentID)
	if err != nil {
		return documentbody.Body{}, err
	}
	defer rows.Close()

	body := documentbody.Body{DocumentID: documentID, RootNodeID: rootID}
	for rows.Next() {
		var node documentbody.Node
		var parentID sql.NullString
		var attributes []byte
		if err := rows.Scan(&node.NodeID, &parentID, &node.SiblingOrder, &node.Type, &node.Content, &attributes, &node.Version); err != nil {
			return documentbody.Body{}, err
		}
		node.DocumentID = documentID
		node.Attributes = append(json.RawMessage(nil), attributes...)
		if parentID.Valid {
			id, err := uuid.Parse(parentID.String)
			if err != nil {
				return documentbody.Body{}, err
			}
			node.ParentID = &id
		}
		body.Nodes = append(body.Nodes, node)
	}
	if err := rows.Err(); err != nil {
		return documentbody.Body{}, err
	}
	if err := documentbody.Validate(body); err != nil {
		return documentbody.Body{}, err
	}
	return body, nil
}

func setNodeVersions(before documentbody.Body, after *documentbody.Body) error {
	oldNodes := make(map[uuid.UUID]documentbody.Node, len(before.Nodes))
	for _, node := range before.Nodes {
		oldNodes[node.NodeID] = node
	}
	for i := range after.Nodes {
		old, exists := oldNodes[after.Nodes[i].NodeID]
		if !exists {
			continue
		}
		if opaqueNode(after.Nodes[i].Type) {
			after.Nodes[i].Version = old.Version
		} else if sameNode(old, after.Nodes[i]) {
			after.Nodes[i].Version = old.Version
		} else {
			if old.Version == 1<<63-1 {
				return constant.ErrDocumentConflict
			}
			after.Nodes[i].Version = old.Version + 1
		}
	}
	return nil
}

func sameBody(left, right documentbody.Body) bool {
	return documentbody.SameContent(left, right)
}

func sameNode(left, right documentbody.Node) bool {
	if left.DocumentID != right.DocumentID || left.NodeID != right.NodeID || !sameOptionalUUID(left.ParentID, right.ParentID) ||
		left.Type != right.Type || left.Content != right.Content {
		return false
	}
	if bytes.Equal(left.Attributes, right.Attributes) {
		return true
	}
	leftAttributes, leftErr := canonicalAttributes(left.Attributes)
	rightAttributes, rightErr := canonicalAttributes(right.Attributes)
	return leftErr == nil && rightErr == nil && bytes.Equal(leftAttributes, rightAttributes)
}

func canonicalAttributes(raw json.RawMessage) ([]byte, error) {
	var attributes map[string]json.RawMessage
	if err := json.Unmarshal(raw, &attributes); err != nil || attributes == nil {
		return nil, documentbody.ErrInvalid
	}
	return json.Marshal(attributes)
}

func sameOptionalUUID(left, right *uuid.UUID) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}

func opaqueNode(nodeType string) bool {
	return nodeType == "opaque" || nodeType == "opaque-inline"
}

func replaceDocumentBody(ctx context.Context, tx database.Queryer, documentID uuid.UUID, after documentbody.Body) error {
	anchors, err := loadCommentAnchors(ctx, tx, documentID)
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE comment_threads SET anchor_node_id = NULL, anchor_state = 'orphan'
		WHERE document_id = $1 AND anchor_node_id IS NOT NULL
	`, documentID); err != nil {
		return err
	}
	// ponytail: replace the small AST snapshot atomically; switch to per-node writes if write amplification is measured to matter.
	if _, err := tx.ExecContext(ctx, `DELETE FROM document_nodes WHERE document_id = $1`, documentID); err != nil {
		return err
	}
	newNodeIDs := make(map[uuid.UUID]struct{}, len(after.Nodes))
	for _, node := range after.Nodes {
		newNodeIDs[node.NodeID] = struct{}{}
		var parentID any
		if node.ParentID != nil {
			parentID = *node.ParentID
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO document_nodes (document_id, node_id, parent_id, sibling_order, node_type, content, attributes, version)
			VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
		`, node.DocumentID, node.NodeID, parentID, node.SiblingOrder, node.Type, node.Content, string(node.Attributes), node.Version); err != nil {
			return err
		}
	}
	for _, anchor := range anchors {
		if _, exists := newNodeIDs[anchor.nodeID]; !exists {
			continue
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE comment_threads SET anchor_node_id = $2, anchor_state = $3 WHERE id = $1 AND document_id = $4
		`, anchor.threadID, anchor.nodeID, anchor.state, documentID); err != nil {
			return err
		}
	}
	return nil
}

func loadCommentAnchors(ctx context.Context, tx database.Queryer, documentID uuid.UUID) ([]commentAnchor, error) {
	rows, err := tx.QueryContext(ctx, `
		SELECT id, anchor_node_id, anchor_state FROM comment_threads
		WHERE document_id = $1 AND anchor_node_id IS NOT NULL FOR UPDATE
	`, documentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	anchors := make([]commentAnchor, 0)
	for rows.Next() {
		var anchor commentAnchor
		if err := rows.Scan(&anchor.threadID, &anchor.nodeID, &anchor.state); err != nil {
			return nil, err
		}
		anchors = append(anchors, anchor)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return anchors, nil
}
