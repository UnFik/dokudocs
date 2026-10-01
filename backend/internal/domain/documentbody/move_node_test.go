package documentbody

import (
	"math"
	"testing"

	"github.com/google/uuid"
)

func TestMoveNodeReordersAndReparents(t *testing.T) {
	body, ids := moveFixture()

	reordered, err := MoveNode(body, MoveNodeCommand{NodeID: ids["first"], TargetParentID: ids["root"], BeforeNodeID: uuidPointer(ids["third"])})
	if err != nil {
		t.Fatalf("reorder MoveNode(): %v", err)
	}
	if got := orderedChildren(reordered.Nodes, ids["root"], uuid.Nil); !sameNodeOrder(got, []Node{
		findNodeValue(reordered, ids["second"]), findNodeValue(reordered, ids["first"]),
		findNodeValue(reordered, ids["third"]), findNodeValue(reordered, ids["quote"]),
	}) {
		t.Fatalf("root child order = %v", nodeIDs(got))
	}
	if findNodeValue(reordered, ids["first"]).Version != 2 {
		t.Fatal("moved node version was not incremented")
	}

	reparented, err := MoveNode(body, MoveNodeCommand{NodeID: ids["first"], TargetParentID: ids["quote"]})
	if err != nil {
		t.Fatalf("reparent MoveNode(): %v", err)
	}
	if got := findNodeValue(reparented, ids["first"]); got.ParentID == nil || *got.ParentID != ids["quote"] {
		t.Fatalf("reparented node parent = %v", got.ParentID)
	}
	if err := Validate(reparented); err != nil {
		t.Fatalf("moved body invalid: %v", err)
	}
}

func TestMoveNodeNoOpAndInvalidTargets(t *testing.T) {
	body, ids := moveFixture()
	noOp, err := MoveNode(body, MoveNodeCommand{NodeID: ids["first"], TargetParentID: ids["root"], BeforeNodeID: uuidPointer(ids["second"])})
	if err != nil {
		t.Fatalf("no-op MoveNode(): %v", err)
	}
	if !sameNodeOrder(orderedChildren(noOp.Nodes, ids["root"], uuid.Nil), orderedChildren(body.Nodes, ids["root"], uuid.Nil)) ||
		findNodeValue(noOp, ids["first"]).Version != findNodeValue(body, ids["first"]).Version {
		t.Fatal("no-op move changed order or node version")
	}

	if _, err := MoveNode(body, MoveNodeCommand{NodeID: ids["first"], TargetParentID: ids["quote"], BeforeNodeID: uuidPointer(ids["third"])}); err == nil {
		t.Fatal("accepted a before-node from another parent")
	}

	documentID, rootID, outerID, innerID := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	nested := Body{DocumentID: documentID, RootNodeID: rootID, Nodes: []Node{
		node(documentID, rootID, nil, 0, "document"),
		node(documentID, outerID, &rootID, 1, "block-quote"),
		node(documentID, innerID, &outerID, 1, "block-quote"),
	}}
	if err := Validate(nested); err != nil {
		t.Fatalf("nested quote fixture: %v", err)
	}
	if _, err := MoveNode(nested, MoveNodeCommand{NodeID: outerID, TargetParentID: innerID}); err == nil {
		t.Fatal("accepted a move into a descendant")
	}
}

func TestMoveNodeReindexesWhenFloat64GapIsExhausted(t *testing.T) {
	documentID, rootID, quoteID := uuid.New(), uuid.New(), uuid.New()
	firstID, movingID, lastID := uuid.New(), uuid.New(), uuid.New()
	body := Body{DocumentID: documentID, RootNodeID: rootID, Nodes: []Node{
		node(documentID, rootID, nil, 0, "document"),
		node(documentID, quoteID, &rootID, 1, "block-quote"),
		node(documentID, firstID, &quoteID, 1, "paragraph"),
		node(documentID, lastID, &quoteID, math.Nextafter(1, 2), "paragraph"),
		node(documentID, movingID, &rootID, 2, "paragraph"),
	}}
	if err := Validate(body); err != nil {
		t.Fatalf("fixture body: %v", err)
	}
	moved, err := MoveNode(body, MoveNodeCommand{NodeID: movingID, TargetParentID: quoteID, BeforeNodeID: &lastID})
	if err != nil {
		t.Fatalf("MoveNode(): %v", err)
	}
	children := orderedChildren(moved.Nodes, quoteID, uuid.Nil)
	if len(children) != 3 || children[0].NodeID != firstID || children[1].NodeID != movingID || children[2].NodeID != lastID {
		t.Fatalf("reindexed child order = %v", nodeIDs(children))
	}
	for index, child := range children {
		if child.SiblingOrder != float64(index+1) {
			t.Fatalf("child %s order = %v, want %d", child.NodeID, child.SiblingOrder, index+1)
		}
	}
}

func TestMoveNodeRejectsOpaqueSubtree(t *testing.T) {
	documentID, rootID, quoteID, opaqueID, paragraphID := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	body := Body{DocumentID: documentID, RootNodeID: rootID, Nodes: []Node{
		node(documentID, rootID, nil, 0, "document"),
		node(documentID, quoteID, &rootID, 1, "block-quote"),
		node(documentID, opaqueID, &quoteID, 1, "opaque"),
		node(documentID, paragraphID, &rootID, 2, "paragraph"),
	}}
	if _, err := MoveNode(body, MoveNodeCommand{NodeID: quoteID, TargetParentID: rootID}); err == nil {
		t.Fatal("accepted moving an ancestor containing opaque source")
	}
}

func moveFixture() (Body, map[string]uuid.UUID) {
	documentID := uuid.New()
	ids := map[string]uuid.UUID{
		"root": uuid.New(), "first": uuid.New(), "second": uuid.New(),
		"third": uuid.New(), "quote": uuid.New(),
	}
	body := Body{DocumentID: documentID, RootNodeID: ids["root"], Nodes: []Node{
		node(documentID, ids["root"], nil, 0, "document"),
		node(documentID, ids["first"], uuidPointer(ids["root"]), 1, "paragraph"),
		node(documentID, ids["second"], uuidPointer(ids["root"]), 2, "paragraph"),
		node(documentID, ids["third"], uuidPointer(ids["root"]), 3, "paragraph"),
		node(documentID, ids["quote"], uuidPointer(ids["root"]), 4, "block-quote"),
	}}
	return body, ids
}

func findNodeValue(body Body, id uuid.UUID) Node {
	for _, node := range body.Nodes {
		if node.NodeID == id {
			return node
		}
	}
	return Node{}
}

func nodeIDs(nodes []Node) []uuid.UUID {
	ids := make([]uuid.UUID, len(nodes))
	for index, node := range nodes {
		ids[index] = node.NodeID
	}
	return ids
}
