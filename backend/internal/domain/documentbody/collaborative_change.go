package documentbody

import (
	"bytes"
	"sort"

	"github.com/google/uuid"
)

// ValidateCollaborativeChange validates a Yjs edit without a MoveNode or
// DeleteNode command. It accepts exactly what Validate(after),
// ValidateExistingStructure(before, after, nil) and
// ValidateOpaquePreservation(before, after) accept together, assuming before
// is already valid, but parses attributes and compares sibling order only for
// nodes the edit touched. A typing edit therefore costs one pass over the map
// of nodes instead of four full validations.
func ValidateCollaborativeChange(before, after Body) error {
	if before.DocumentID != after.DocumentID || before.RootNodeID != after.RootNodeID {
		return invalid("collaborative projection must keep the document root")
	}
	old := make(map[uuid.UUID]Node, len(before.Nodes))
	for _, node := range before.Nodes {
		old[node.NodeID] = node
	}
	changed := make(map[uuid.UUID]struct{})
	touchedParents := make(map[uuid.UUID]struct{})
	present := make(map[uuid.UUID]struct{}, len(after.Nodes))
	for _, node := range after.Nodes {
		present[node.NodeID] = struct{}{}
		previous, existed := old[node.NodeID]
		if !existed {
			changed[node.NodeID] = struct{}{}
			if node.ParentID != nil {
				touchedParents[*node.ParentID] = struct{}{}
			}
			continue
		}
		if previous.Type != node.Type {
			return invalid("existing node %s changed type", node.NodeID)
		}
		if !sameParent(previous.ParentID, node.ParentID) {
			return invalid("existing node %s changed parent without MoveNode", node.NodeID)
		}
		if isOpaque(previous.Type) && (previous.Content != node.Content || previous.Version != node.Version) {
			return invalid("opaque node %s was removed or changed", node.NodeID)
		}
		if previous.DocumentID != node.DocumentID || previous.Content != node.Content ||
			previous.Version != node.Version || !bytes.Equal(previous.Attributes, node.Attributes) {
			changed[node.NodeID] = struct{}{}
		}
		if previous.SiblingOrder != node.SiblingOrder {
			changed[node.NodeID] = struct{}{}
			if node.ParentID != nil {
				touchedParents[*node.ParentID] = struct{}{}
			}
		}
	}
	for _, node := range before.Nodes {
		if _, kept := present[node.NodeID]; !kept {
			return invalid("existing node %s was deleted without DeleteNode", node.NodeID)
		}
	}

	if err := validateBody(after, func(node Node) bool {
		_, touched := changed[node.NodeID]
		return touched
	}); err != nil {
		return err
	}

	// Inserting a node may renumber its siblings; what must not change is the
	// order of the siblings that existed before.
	if len(touchedParents) == 0 {
		return nil
	}
	survivorsUnder := func(nodes []Node) map[uuid.UUID][]Node {
		result := make(map[uuid.UUID][]Node, len(touchedParents))
		for _, node := range nodes {
			if node.ParentID == nil {
				continue
			}
			if _, touched := touchedParents[*node.ParentID]; !touched {
				continue
			}
			if _, existed := old[node.NodeID]; !existed {
				continue
			}
			result[*node.ParentID] = append(result[*node.ParentID], node)
		}
		for parentID := range result {
			siblings := result[parentID]
			sort.Slice(siblings, func(i, j int) bool { return siblings[i].SiblingOrder < siblings[j].SiblingOrder })
		}
		return result
	}
	beforeOrder, afterOrder := survivorsUnder(before.Nodes), survivorsUnder(after.Nodes)
	for parentID := range touchedParents {
		left, right := beforeOrder[parentID], afterOrder[parentID]
		if len(left) != len(right) {
			return invalid("existing siblings under node %s were reordered without MoveNode", parentID)
		}
		for i := range left {
			if left[i].NodeID != right[i].NodeID {
				return invalid("existing siblings under node %s were reordered without MoveNode", parentID)
			}
		}
	}
	return nil
}
