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

	deleted, err := DeleteNode(body, DeleteNodeCommand{NodeIDs: []uuid.UUID{quoteID}})
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
			if _, err := DeleteNode(body, DeleteNodeCommand{NodeIDs: []uuid.UUID{test.nodeID}}); !errors.Is(err, ErrInvalid) {
				t.Fatalf("DeleteNode() error = %v, want %v", err, ErrInvalid)
			}
		})
	}
}

func TestDeleteNodeRemovesSeveralSubtreesAtomically(t *testing.T) {
	documentID := uuid.New()
	rootID, firstID, firstRunID, secondID, thirdID := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	root := node(documentID, rootID, nil, 0, "document")
	first := node(documentID, firstID, &rootID, 0, "paragraph")
	firstRun := node(documentID, firstRunID, &firstID, 0, "run")
	firstRun.Content = "remove with its block"
	second := node(documentID, secondID, &rootID, 1, "paragraph")
	third := node(documentID, thirdID, &rootID, 2, "paragraph")
	body := Body{DocumentID: documentID, RootNodeID: rootID, Nodes: []Node{root, first, firstRun, second, third}}

	// The run is listed with its own ancestor and the first block twice: both must collapse.
	deleted, err := DeleteNode(body, DeleteNodeCommand{NodeIDs: []uuid.UUID{firstID, firstRunID, firstID, thirdID}})
	if err != nil {
		t.Fatalf("DeleteNode(): %v", err)
	}
	if len(deleted.Nodes) != 2 || deleted.Nodes[0].NodeID != rootID || deleted.Nodes[1].NodeID != secondID {
		t.Fatalf("DeleteNode() nodes = %+v, want only root and the untouched block", deleted.Nodes)
	}
}

func TestDeleteNodeRejectsWholeBatchWhenOneNodeIsInvalid(t *testing.T) {
	documentID := uuid.New()
	rootID, firstID, opaqueID := uuid.New(), uuid.New(), uuid.New()
	root := node(documentID, rootID, nil, 0, "document")
	first := node(documentID, firstID, &rootID, 0, "paragraph")
	opaque := node(documentID, opaqueID, &rootID, 1, "opaque")
	opaque.Content = "preserve this source"
	body := Body{DocumentID: documentID, RootNodeID: rootID, Nodes: []Node{root, first, opaque}}

	for name, ids := range map[string][]uuid.UUID{
		"empty":   nil,
		"opaque":  {firstID, opaqueID},
		"missing": {firstID, uuid.New()},
		"root":    {firstID, rootID},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := DeleteNode(body, DeleteNodeCommand{NodeIDs: ids}); !errors.Is(err, ErrInvalid) {
				t.Fatalf("DeleteNode() error = %v, want %v", err, ErrInvalid)
			}
		})
	}
}
