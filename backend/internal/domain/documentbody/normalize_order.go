package documentbody

import (
	"sort"

	"github.com/google/uuid"
)

// NormalizeSiblingOrder renumbers each parent's children 0, 1, 2, ... in their
// current order, the numbering the Yjs projection reports. Stored rows that use
// any other numbering differ from every projection, so the first commit would
// rewrite all of them. The root keeps order 0 and the input is not modified.
func NormalizeSiblingOrder(body Body) Body {
	result := body
	result.Nodes = append([]Node(nil), body.Nodes...)
	children := make(map[uuid.UUID][]int)
	for index, node := range result.Nodes {
		if node.ParentID != nil {
			children[*node.ParentID] = append(children[*node.ParentID], index)
		} else {
			result.Nodes[index].SiblingOrder = 0
		}
	}
	for _, indexes := range children {
		sort.SliceStable(indexes, func(i, j int) bool {
			return result.Nodes[indexes[i]].SiblingOrder < result.Nodes[indexes[j]].SiblingOrder
		})
		for order, index := range indexes {
			result.Nodes[index].SiblingOrder = float64(order)
		}
	}
	return result
}
