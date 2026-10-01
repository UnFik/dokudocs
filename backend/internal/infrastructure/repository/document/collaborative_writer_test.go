package document

import (
	"encoding/json"
	"testing"

	"backend/internal/domain/documentbody"

	"github.com/google/uuid"
)

func TestCollaborativeBodyComparisonIgnoresOrderReindexing(t *testing.T) {
	documentID, rootID, firstID, secondID := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	first, second := bodyNode(documentID, firstID, rootID, 1), bodyNode(documentID, secondID, rootID, 2)
	before := documentbody.Body{DocumentID: documentID, RootNodeID: rootID, Nodes: []documentbody.Node{
		{DocumentID: documentID, NodeID: rootID, Type: "document", Attributes: json.RawMessage(`{}`), Version: 1},
		first, second,
	}}
	after := documentbody.Body{DocumentID: documentID, RootNodeID: rootID, Nodes: []documentbody.Node{
		{DocumentID: documentID, NodeID: rootID, Type: "document", Attributes: json.RawMessage(`{}`), Version: 1},
		bodyNode(documentID, firstID, rootID, 10), bodyNode(documentID, secondID, rootID, 20),
	}}
	if !sameBody(before, after) {
		t.Fatal("sibling reindex changed the semantic body")
	}
	if err := setNodeVersions(before, &after); err != nil {
		t.Fatalf("setNodeVersions(): %v", err)
	}
	if after.Nodes[1].Version != first.Version || after.Nodes[2].Version != second.Version {
		t.Fatal("sibling reindex incremented node versions")
	}

	reordered := after
	reordered.Nodes = append([]documentbody.Node(nil), after.Nodes...)
	reordered.Nodes[1].SiblingOrder, reordered.Nodes[2].SiblingOrder = 20, 10
	if sameBody(before, reordered) {
		t.Fatal("sibling reorder was treated as reindexing")
	}
}

func bodyNode(documentID, nodeID, parentID uuid.UUID, order float64) documentbody.Node {
	return documentbody.Node{
		DocumentID: documentID, NodeID: nodeID, ParentID: &parentID,
		SiblingOrder: order, Type: "paragraph", Attributes: json.RawMessage(`{}`), Version: 1,
	}
}
