package documentbody

import "github.com/google/uuid"

type DeleteNodeCommand struct {
	NodeID uuid.UUID
}

// MaxDeleteNodes bounds one batch so a single command stays a bounded write.
const MaxDeleteNodes = 5000

// DeleteNode removes an existing non-root subtree. Opaque source stays intact
// until an importer or restore replaces the complete body explicitly.
func DeleteNode(body Body, command DeleteNodeCommand) (Body, error) {
	return DeleteNodes(body, []uuid.UUID{command.NodeID})
}

// DeleteNodes removes the union of the named non-root subtrees in one step. A
// named node may sit inside another named subtree; the result is the same as
// deleting only the outer one. Either every subtree is removed or none is.
func DeleteNodes(body Body, nodeIDs []uuid.UUID) (Body, error) {
	if err := Validate(body); err != nil {
		return Body{}, err
	}
	if len(nodeIDs) == 0 || len(nodeIDs) > MaxDeleteNodes {
		return Body{}, invalid("a delete needs between 1 and %d nodes", MaxDeleteNodes)
	}

	children := make(map[uuid.UUID][]Node, len(body.Nodes))
	nodesByID := make(map[uuid.UUID]Node, len(body.Nodes))
	for _, node := range body.Nodes {
		nodesByID[node.NodeID] = node
		if node.ParentID != nil {
			children[*node.ParentID] = append(children[*node.ParentID], node)
		}
	}

	deleted := make(map[uuid.UUID]struct{})
	for _, nodeID := range nodeIDs {
		if nodeID == uuid.Nil || nodeID == body.RootNodeID {
			return Body{}, invalid("root or missing node cannot be deleted")
		}
		if _, found := nodesByID[nodeID]; !found {
			return Body{}, invalid("node %s does not exist", nodeID)
		}
		stack := []uuid.UUID{nodeID}
		for len(stack) > 0 {
			id := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			if _, seen := deleted[id]; seen {
				continue
			}
			node := nodesByID[id]
			if isOpaque(node.Type) {
				return Body{}, invalid("opaque node %s cannot be deleted", node.NodeID)
			}
			deleted[id] = struct{}{}
			for _, child := range children[id] {
				stack = append(stack, child.NodeID)
			}
		}
	}

	result := body
	result.Nodes = make([]Node, 0, len(body.Nodes)-len(deleted))
	for _, node := range body.Nodes {
		if _, remove := deleted[node.NodeID]; !remove {
			result.Nodes = append(result.Nodes, node)
		}
	}
	if err := Validate(result); err != nil {
		return Body{}, err
	}
	return result, nil
}
