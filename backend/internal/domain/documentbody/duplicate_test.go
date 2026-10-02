package documentbody

import (
	"encoding/json"
	"testing"

	"github.com/google/uuid"
)

func TestCloneForDocumentRekeysNodesAndSourceMetadata(t *testing.T) {
	source, ids := moveFixture()
	root := findNodeIndex(source, ids["root"])
	source.Nodes[root].Attributes = json.RawMessage(`{"sourceGaps":{"` + ids["first"].String() + `":"\n\n"}}`)

	cloned, err := CloneForDocument(source, uuid.New())
	if err != nil {
		t.Fatalf("CloneForDocument(): %v", err)
	}
	if cloned.DocumentID == source.DocumentID || cloned.RootNodeID == source.RootNodeID || len(cloned.Nodes) != len(source.Nodes) {
		t.Fatalf("clone identity/size = %s/%s/%d", cloned.DocumentID, cloned.RootNodeID, len(cloned.Nodes))
	}
	for index, node := range source.Nodes {
		copyNode := cloned.Nodes[index]
		if copyNode.DocumentID != cloned.DocumentID || copyNode.NodeID == node.NodeID || copyNode.Version != 1 ||
			copyNode.Type != node.Type || copyNode.Content != node.Content || copyNode.SiblingOrder != node.SiblingOrder {
			t.Fatalf("cloned node %d = %+v, source = %+v", index, copyNode, node)
		}
		if node.ParentID != nil {
			parent := findNodeValue(cloned, *copyNode.ParentID)
			if parent.NodeID == uuid.Nil || parent.NodeID == *node.ParentID {
				t.Fatalf("cloned node %s has invalid cloned parent %s", copyNode.NodeID, *copyNode.ParentID)
			}
		}
	}
	var rootAttributes struct {
		SourceGaps map[string]string `json:"sourceGaps"`
	}
	if err := json.Unmarshal(findNodeValue(cloned, cloned.RootNodeID).Attributes, &rootAttributes); err != nil {
		t.Fatalf("decode cloned root attributes: %v", err)
	}
	newFirstID := cloned.Nodes[findNodeIndex(source, ids["first"])].NodeID
	if got := rootAttributes.SourceGaps[newFirstID.String()]; got != "\n\n" || len(rootAttributes.SourceGaps) != 1 {
		t.Fatalf("cloned source gaps = %v", rootAttributes.SourceGaps)
	}
}

func TestCloneForDocumentRejectsInvalidTarget(t *testing.T) {
	source, _ := moveFixture()
	for _, target := range []uuid.UUID{uuid.Nil, source.DocumentID} {
		if _, err := CloneForDocument(source, target); err == nil {
			t.Fatalf("CloneForDocument() accepted target %s", target)
		}
	}
}

func findNodeIndex(body Body, id uuid.UUID) int {
	for index, node := range body.Nodes {
		if node.NodeID == id {
			return index
		}
	}
	return -1
}
