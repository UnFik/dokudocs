package documentbody

import (
	"bytes"
	"encoding/json"
	"reflect"
	"sort"

	"github.com/google/uuid"
)

// SameContent compares body meaning while ignoring node versions and numeric
// sibling keys; sibling order itself must remain the same.
func SameContent(left, right Body) bool {
	if left.DocumentID != right.DocumentID || left.RootNodeID != right.RootNodeID || len(left.Nodes) != len(right.Nodes) {
		return false
	}
	leftByID := make(map[uuid.UUID]Node, len(left.Nodes))
	for _, node := range left.Nodes {
		leftByID[node.NodeID] = node
	}
	for _, node := range right.Nodes {
		old, exists := leftByID[node.NodeID]
		if !exists || old.DocumentID != node.DocumentID || old.Type != node.Type || old.Content != node.Content || !sameParentID(old.ParentID, node.ParentID) || !sameAttributes(old.Attributes, node.Attributes) {
			return false
		}
	}
	return sameChildOrder(left.Nodes, right.Nodes)
}

func sameParentID(left, right *uuid.UUID) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}

func sameAttributes(left, right json.RawMessage) bool {
	if bytes.Equal(left, right) {
		return true
	}
	var leftValue, rightValue any
	if json.Unmarshal(left, &leftValue) != nil || json.Unmarshal(right, &rightValue) != nil {
		return false
	}
	return reflect.DeepEqual(leftValue, rightValue)
}

func sameChildOrder(left, right []Node) bool {
	children := func(nodes []Node) map[uuid.UUID][]Node {
		result := make(map[uuid.UUID][]Node)
		for _, node := range nodes {
			if node.ParentID != nil {
				parentID := *node.ParentID
				result[parentID] = append(result[parentID], node)
			}
		}
		for parentID := range result {
			sort.Slice(result[parentID], func(i, j int) bool {
				return result[parentID][i].SiblingOrder < result[parentID][j].SiblingOrder
			})
		}
		return result
	}
	leftChildren, rightChildren := children(left), children(right)
	if len(leftChildren) != len(rightChildren) {
		return false
	}
	for parentID, leftSiblings := range leftChildren {
		rightSiblings, exists := rightChildren[parentID]
		if !exists || len(leftSiblings) != len(rightSiblings) {
			return false
		}
		for index := range leftSiblings {
			if leftSiblings[index].NodeID != rightSiblings[index].NodeID {
				return false
			}
		}
	}
	return true
}
