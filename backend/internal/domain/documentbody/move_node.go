package documentbody

import (
	"math"
	"sort"

	"github.com/google/uuid"
)

type MoveNodeCommand struct {
	NodeID         uuid.UUID
	TargetParentID uuid.UUID
	BeforeNodeID   *uuid.UUID
}

// MoveNode applies one server-ordered move to an existing node. A nil
// BeforeNodeID appends to the target parent; sibling order remains server-owned.
func MoveNode(body Body, command MoveNodeCommand) (Body, error) {
	if err := Validate(body); err != nil {
		return Body{}, err
	}
	if command.NodeID == uuid.Nil || command.TargetParentID == uuid.Nil || command.NodeID == command.TargetParentID {
		return Body{}, invalid("node and target parent are required")
	}

	movingIndex := -1
	var moving Node
	existsTargetParent := false
	for index, node := range body.Nodes {
		if node.NodeID == command.NodeID {
			movingIndex, moving = index, node
		}
		if node.NodeID == command.TargetParentID {
			existsTargetParent = true
		}
	}
	if movingIndex < 0 || moving.ParentID == nil {
		return Body{}, invalid("root or missing node cannot be moved")
	}
	if !existsTargetParent {
		return Body{}, invalid("target parent does not exist")
	}
	if isOpaque(moving.Type) {
		return Body{}, invalid("opaque node %s cannot be moved", moving.NodeID)
	}
	if command.BeforeNodeID != nil && *command.BeforeNodeID == moving.NodeID && *moving.ParentID == command.TargetParentID {
		return body, nil
	}

	targetSiblings := orderedChildren(body.Nodes, command.TargetParentID, command.NodeID)
	insertionIndex := len(targetSiblings)
	if command.BeforeNodeID != nil {
		insertionIndex = -1
		for index, sibling := range targetSiblings {
			if sibling.NodeID == *command.BeforeNodeID {
				insertionIndex = index
				break
			}
		}
		if insertionIndex < 0 {
			return Body{}, invalid("before node is not a child of the target parent")
		}
	}
	finalSiblings := make([]Node, 0, len(targetSiblings)+1)
	finalSiblings = append(finalSiblings, targetSiblings[:insertionIndex]...)
	finalSiblings = append(finalSiblings, moving)
	finalSiblings = append(finalSiblings, targetSiblings[insertionIndex:]...)
	if *moving.ParentID == command.TargetParentID {
		current := orderedChildren(body.Nodes, command.TargetParentID, uuid.Nil)
		if sameNodeOrder(current, finalSiblings) {
			return body, nil
		}
	}
	if moving.Version == math.MaxInt64 {
		return Body{}, invalid("node %s version is exhausted", moving.NodeID)
	}

	order, canAllocate := allocateSiblingOrder(targetSiblings, insertionIndex)
	orders := make(map[uuid.UUID]float64, len(finalSiblings))
	if canAllocate {
		for _, sibling := range targetSiblings {
			orders[sibling.NodeID] = sibling.SiblingOrder
		}
		orders[moving.NodeID] = order
	} else {
		for index, sibling := range finalSiblings {
			orders[sibling.NodeID] = float64(index + 1)
		}
	}

	result := body
	result.Nodes = append([]Node(nil), body.Nodes...)
	for index := range result.Nodes {
		node := &result.Nodes[index]
		if node.NodeID == command.NodeID {
			parentID := command.TargetParentID
			node.ParentID = &parentID
			node.SiblingOrder = orders[node.NodeID]
			node.Version++
			continue
		}
		if node.ParentID != nil && *node.ParentID == command.TargetParentID {
			if updatedOrder, exists := orders[node.NodeID]; exists {
				node.SiblingOrder = updatedOrder
			}
		}
	}
	if err := Validate(result); err != nil {
		return Body{}, err
	}
	authorized := map[uuid.UUID]struct{}{command.NodeID: {}}
	if err := ValidateExistingStructure(body, result, authorized); err != nil {
		return Body{}, err
	}
	if err := ValidateOpaquePreservation(body, result); err != nil {
		return Body{}, err
	}
	return result, nil
}

func orderedChildren(nodes []Node, parentID, excludeID uuid.UUID) []Node {
	children := make([]Node, 0)
	for _, node := range nodes {
		if node.ParentID != nil && *node.ParentID == parentID && node.NodeID != excludeID {
			children = append(children, node)
		}
	}
	sort.Slice(children, func(i, j int) bool { return children[i].SiblingOrder < children[j].SiblingOrder })
	return children
}

func allocateSiblingOrder(siblings []Node, index int) (float64, bool) {
	if index < 0 || index > len(siblings) {
		return 0, false
	}
	if len(siblings) == 0 {
		return 1, true
	}
	var order float64
	switch {
	case index == 0:
		order = siblings[0].SiblingOrder - 1
	case index == len(siblings):
		order = siblings[len(siblings)-1].SiblingOrder + 1
	default:
		left, right := siblings[index-1].SiblingOrder, siblings[index].SiblingOrder
		order = left + (right-left)/2
		if !(left < order && order < right) {
			return 0, false
		}
	}
	if math.IsInf(order, 0) || math.IsNaN(order) {
		return 0, false
	}
	for _, sibling := range siblings {
		if sibling.SiblingOrder == order {
			return 0, false
		}
	}
	return order, true
}

func sameNodeOrder(left, right []Node) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index].NodeID != right[index].NodeID {
			return false
		}
	}
	return true
}
