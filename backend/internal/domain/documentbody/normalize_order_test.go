package documentbody

import (
	"testing"

	"github.com/google/uuid"
)

func TestNormalizeSiblingOrderNumbersChildrenFromZeroKeepingTheirOrder(t *testing.T) {
	documentID, rootID, a, b, c, run := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	body := Body{DocumentID: documentID, RootNodeID: rootID, Nodes: []Node{
		node(documentID, rootID, nil, 7, "document"),
		node(documentID, c, &rootID, 30.5, "paragraph"),
		node(documentID, a, &rootID, 1, "paragraph"),
		node(documentID, b, &rootID, 2, "paragraph"),
		node(documentID, run, &a, 5, "run"),
	}}

	got := NormalizeSiblingOrder(body)

	want := map[uuid.UUID]float64{rootID: 0, a: 0, b: 1, c: 2, run: 0}
	for _, n := range got.Nodes {
		if n.SiblingOrder != want[n.NodeID] {
			t.Errorf("node %s order = %v, want %v", n.NodeID, n.SiblingOrder, want[n.NodeID])
		}
	}
	if body.Nodes[1].SiblingOrder != 30.5 {
		t.Fatal("NormalizeSiblingOrder modified its input")
	}
}
