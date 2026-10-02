package document

import (
	"context"
	"database/sql"

	"backend/internal/domain/documentbody"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

// applyBodyDiff persists only the nodes that differ between before and after,
// in a fixed number of statements regardless of document size. Unchanged rows
// are not rewritten. Comment anchors on removed nodes become orphans; anchors
// on surviving nodes are untouched.
func applyBodyDiff(ctx context.Context, tx database.Queryer, documentID uuid.UUID, before, after documentbody.Body) error {
	beforeByID := make(map[uuid.UUID]documentbody.Node, len(before.Nodes))
	for _, node := range before.Nodes {
		beforeByID[node.NodeID] = node
	}
	afterIDs := make(map[uuid.UUID]struct{}, len(after.Nodes))
	var upserts []documentbody.Node
	var reordered []string
	for _, node := range after.Nodes {
		afterIDs[node.NodeID] = struct{}{}
		old, exists := beforeByID[node.NodeID]
		if exists && sameNodeRow(old, node) {
			continue
		}
		upserts = append(upserts, node)
		if exists && node.ParentID != nil && old.SiblingOrder != node.SiblingOrder {
			reordered = append(reordered, node.NodeID.String())
		}
	}
	var removed []string
	for _, node := range before.Nodes {
		if _, kept := afterIDs[node.NodeID]; !kept {
			removed = append(removed, node.NodeID.String())
		}
	}

	if len(removed) > 0 {
		if _, err := tx.ExecContext(ctx, `
			UPDATE comment_threads SET anchor_node_id = NULL, anchor_state = 'orphan'
			WHERE document_id = $1 AND anchor_node_id = ANY($2::uuid[])
		`, documentID, removed); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
			DELETE FROM document_nodes WHERE document_id = $1 AND node_id = ANY($2::uuid[])
		`, documentID, removed); err != nil {
			return err
		}
	}
	if len(reordered) > 0 {
		// The sibling-order unique index is checked per row, so rows that swap or
		// shift positions first move to unused negative orders.
		if _, err := tx.ExecContext(ctx, `
			UPDATE document_nodes SET sibling_order = -sibling_order - 1
			WHERE document_id = $1 AND node_id = ANY($2::uuid[])
		`, documentID, reordered); err != nil {
			return err
		}
	}
	if len(upserts) == 0 {
		return nil
	}

	ids := make([]string, len(upserts))
	parents := make([]sql.NullString, len(upserts))
	orders := make([]float64, len(upserts))
	types := make([]string, len(upserts))
	contents := make([]string, len(upserts))
	attributes := make([]string, len(upserts))
	versions := make([]int64, len(upserts))
	for i, node := range upserts {
		ids[i] = node.NodeID.String()
		if node.ParentID != nil {
			parents[i] = sql.NullString{String: node.ParentID.String(), Valid: true}
		}
		orders[i], types[i], contents[i] = node.SiblingOrder, node.Type, node.Content
		attributes[i], versions[i] = string(node.Attributes), node.Version
	}
	parentValues := make([]*string, len(parents))
	for i := range parents {
		if parents[i].Valid {
			parentValues[i] = &parents[i].String
		}
	}
	_, err := tx.ExecContext(ctx, `
		INSERT INTO document_nodes (document_id, node_id, parent_id, sibling_order, node_type, content, attributes, version)
		SELECT $1, n.node_id::uuid, n.parent_id::uuid, n.sibling_order, n.node_type, n.content, n.attributes::jsonb, n.version
		FROM unnest($2::text[], $3::text[], $4::float8[], $5::text[], $6::text[], $7::text[], $8::bigint[])
			AS n(node_id, parent_id, sibling_order, node_type, content, attributes, version)
		ON CONFLICT (node_id) DO UPDATE SET
			parent_id = EXCLUDED.parent_id, sibling_order = EXCLUDED.sibling_order,
			node_type = EXCLUDED.node_type, content = EXCLUDED.content,
			attributes = EXCLUDED.attributes, version = EXCLUDED.version, updated_at = NOW()
	`, documentID, ids, parentValues, orders, types, contents, attributes, versions)
	return err
}

// sameNodeRow reports whether the stored row already matches the node,
// including its position and version.
func sameNodeRow(stored, next documentbody.Node) bool {
	return sameNode(stored, next) && stored.SiblingOrder == next.SiblingOrder && stored.Version == next.Version
}
