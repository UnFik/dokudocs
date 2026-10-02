package documentbody

import "github.com/google/uuid"

type DeleteNodeCommand struct {
	NodeIDs []uuid.UUID
}

// DeleteNode removes existing non-root subtrees in one step. Opaque source
// stays intact until an importer or restore replaces the complete body
// explicitly. Listing a node together with its ancestor is allowed; the
// descendant goes away with the ancestor.
func DeleteNode(body Body, command DeleteNodeCommand) (Body, error) {
	if err := Validate(body); err != nil {
		return Body{}, err
	}
	if len(command.NodeIDs) == 0 {
		return Body{}, invalid("no node to delete")
	}
	for _, id := range command.NodeIDs {
		if id == uuid.Nil || id == body.RootNodeID {
			return Body{}, invalid("root or missing node cannot be deleted")
		}
	}

	children := make(map[uuid.UUID][]Node, len(body.Nodes))
	nodesByID := make(map[uuid.UUID]Node, len(body.Nodes))
	for _, node := range body.Nodes {
		nodesByID[node.NodeID] = node
		if node.ParentID != nil {
			children[*node.ParentID] = append(children[*node.ParentID], node)
		}
	}
	for _, id := range command.NodeIDs {
		if _, found := nodesByID[id]; !found {
			return Body{}, invalid("node %s does not exist", id)
		}
	}

	deleted := make(map[uuid.UUID]struct{})
	stack := append([]uuid.UUID(nil), command.NodeIDs...)
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
