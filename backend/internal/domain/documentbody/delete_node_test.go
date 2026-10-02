package documentbody

import (
	"errors"
	"testing"

	"github.com/google/uuid"
)

func TestDeleteNodeRemovesSubtreeAndPreservesSiblings(t *testing.T) {
	documentID := uuid.New()
	rootID, quoteID, nestedID, runID, siblingID := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	root := node(documentID, rootID, nil, 0, "document")
	quote := node(documentID, quoteID, &rootID, 0, "block-quote")
	nested := node(documentID, nestedID, &quoteID, 0, "paragraph")
	run := node(documentID, runID, &nestedID, 0, "run")
	run.Content = "remove with subtree"
	sibling := node(documentID, siblingID, &rootID, 1, "paragraph")
	body := Body{DocumentID: documentID, RootNodeID: rootID, Nodes: []Node{root, quote, nested, run, sibling}}

	deleted, err := DeleteNode(body, DeleteNodeCommand{NodeID: quoteID})
	if err != nil {
		t.Fatalf("DeleteNode(): %v", err)
	}
	if len(deleted.Nodes) != 2 || deleted.Nodes[0].NodeID != rootID || deleted.Nodes[1].NodeID != siblingID {
		t.Fatalf("DeleteNode() nodes = %+v, want only root and surviving sibling", deleted.Nodes)
	}
	if err := Validate(deleted); err != nil {
		t.Fatalf("DeleteNode() returned invalid body: %v", err)
	}
}

func TestDeleteNodeRejectsRootMissingAndOpaqueSubtrees(t *testing.T) {
	documentID := uuid.New()
	rootID, quoteID, opaqueID, paragraphID := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	root := node(documentID, rootID, nil, 0, "document")
	quote := node(documentID, quoteID, &rootID, 0, "block-quote")
	opaque := node(documentID, opaqueID, &quoteID, 0, "opaque")
	opaque.Content = "preserve this source"
	paragraph := node(documentID, paragraphID, &rootID, 1, "paragraph")
	body := Body{DocumentID: documentID, RootNodeID: rootID, Nodes: []Node{root, quote, opaque, paragraph}}

	tests := []struct {
		name   string
		nodeID uuid.UUID
	}{
		{name: "root", nodeID: rootID},
		{name: "missing", nodeID: uuid.New()},
		{name: "opaque descendant", nodeID: quoteID},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := DeleteNode(body, DeleteNodeCommand{NodeID: test.nodeID}); !errors.Is(err, ErrInvalid) {
				t.Fatalf("DeleteNode() error = %v, want %v", err, ErrInvalid)
			}
		})
	}
}

func TestDeleteNodesRemovesEverySubtreeOrNone(t *testing.T) {
	documentID := uuid.New()
	rootID, firstID, firstRunID, secondID, thirdID, opaqueID := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	root := node(documentID, rootID, nil, 0, "document")
	first := node(documentID, firstID, &rootID, 0, "paragraph")
	firstRun := node(documentID, firstRunID, &firstID, 0, "run")
	firstRun.Content = "gone"
	second := node(documentID, secondID, &rootID, 1, "paragraph")
	third := node(documentID, thirdID, &rootID, 2, "paragraph")
	opaque := node(documentID, opaqueID, &rootID, 3, "opaque")
	opaque.Content = "keep"
	body := Body{DocumentID: documentID, RootNodeID: rootID, Nodes: []Node{root, first, firstRun, second, third, opaque}}

	deleted, err := DeleteNodes(body, []uuid.UUID{firstID, thirdID, firstRunID, firstID})
	if err != nil {
		t.Fatalf("DeleteNodes(): %v", err)
	}
	if len(deleted.Nodes) != 3 || deleted.Nodes[1].NodeID != secondID || deleted.Nodes[2].NodeID != opaqueID {
		t.Fatalf("DeleteNodes() nodes = %+v, want root, second paragraph, opaque", deleted.Nodes)
	}

	if _, err := DeleteNodes(body, []uuid.UUID{firstID, opaqueID}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("DeleteNodes() with an opaque node = %v, want %v", err, ErrInvalid)
	}
	if len(body.Nodes) != 6 {
		t.Fatalf("DeleteNodes() changed its input")
	}
	for name, ids := range map[string][]uuid.UUID{
		"none": nil, "root": {firstID, rootID}, "missing": {firstID, uuid.New()},
	} {
		if _, err := DeleteNodes(body, ids); !errors.Is(err, ErrInvalid) {
			t.Fatalf("DeleteNodes(%s) = %v, want %v", name, err, ErrInvalid)
		}
	}
}

func TestDeleteNodesCanEmptyTheDocument(t *testing.T) {
	documentID := uuid.New()
	rootID, firstID, secondID := uuid.New(), uuid.New(), uuid.New()
	body := Body{DocumentID: documentID, RootNodeID: rootID, Nodes: []Node{
		node(documentID, rootID, nil, 0, "document"),
		node(documentID, firstID, &rootID, 0, "paragraph"),
		node(documentID, secondID, &rootID, 1, "paragraph"),
	}}
	deleted, err := DeleteNodes(body, []uuid.UUID{firstID, secondID})
	if err != nil || len(deleted.Nodes) != 1 || deleted.Nodes[0].NodeID != rootID {
		t.Fatalf("DeleteNodes() = (%+v, %v), want only the root", deleted.Nodes, err)
	}
}
