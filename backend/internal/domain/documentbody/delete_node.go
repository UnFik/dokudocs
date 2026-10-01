package documentbody

import "github.com/google/uuid"

type DeleteNodeCommand struct {
	NodeID uuid.UUID
}

// DeleteNode removes an existing non-root subtree. Opaque source stays intact
// until an importer or restore replaces the complete body explicitly.
func DeleteNode(body Body, command DeleteNodeCommand) (Body, error) {
	if err := Validate(body); err != nil {
		return Body{}, err
	}
	if command.NodeID == uuid.Nil || command.NodeID == body.RootNodeID {
		return Body{}, invalid("root or missing node cannot be deleted")
	}

	children := make(map[uuid.UUID][]Node, len(body.Nodes))
	nodesByID := make(map[uuid.UUID]Node, len(body.Nodes))
	for _, node := range body.Nodes {
		nodesByID[node.NodeID] = node
		if node.ParentID != nil {
			children[*node.ParentID] = append(children[*node.ParentID], node)
		}
	}
	if _, found := nodesByID[command.NodeID]; !found {
		return Body{}, invalid("node %s does not exist", command.NodeID)
	}

	deleted := make(map[uuid.UUID]struct{})
	stack := []uuid.UUID{command.NodeID}
	for len(stack) > 0 {
		id := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		node := nodesByID[id]
		if isOpaque(node.Type) {
			return Body{}, invalid("opaque node %s cannot be deleted", node.NodeID)
		}
		deleted[id] = struct{}{}
		for _, child := range children[id] {
			stack = append(stack, child.NodeID)
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
