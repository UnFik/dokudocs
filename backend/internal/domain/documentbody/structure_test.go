package documentbody

import (
	"errors"
	"testing"

	"github.com/google/uuid"
)

func TestValidateExistingStructure(t *testing.T) {
	documentID := uuid.New()
	rootID, firstID, secondID := uuid.New(), uuid.New(), uuid.New()
	root := node(documentID, rootID, nil, 0, "document")
	first := node(documentID, firstID, &rootID, 0, "paragraph")
	second := node(documentID, secondID, &rootID, 1, "paragraph")
	before := Body{DocumentID: documentID, RootNodeID: rootID, Nodes: []Node{root, first, second}}

	t.Run("rejects reorder without command", func(t *testing.T) {
		after := Body{DocumentID: documentID, RootNodeID: rootID, Nodes: []Node{
			root, node(documentID, firstID, &rootID, 1, "paragraph"),
			node(documentID, secondID, &rootID, 0, "paragraph"),
		}}
		if err := ValidateExistingStructure(before, after, nil); !errors.Is(err, ErrInvalid) {
			t.Fatalf("ValidateExistingStructure() error = %v, want %v", err, ErrInvalid)
		}
		if err := ValidateExistingStructure(before, after, map[uuid.UUID]struct{}{firstID: {}}); err != nil {
			t.Fatalf("authorized reorder: %v", err)
		}
	})

	t.Run("allows insert without changing existing sibling order", func(t *testing.T) {
		thirdID := uuid.New()
		after := Body{DocumentID: documentID, RootNodeID: rootID, Nodes: []Node{
			root,
			first,
			second,
			node(documentID, thirdID, &rootID, 2, "paragraph"),
		}}
		if err := ValidateExistingStructure(before, after, nil); err != nil {
			t.Fatalf("insert with stable order: %v", err)
		}
	})

	t.Run("rejects delete without DeleteNode", func(t *testing.T) {
		after := Body{DocumentID: documentID, RootNodeID: rootID, Nodes: []Node{root, first}}
		if err := ValidateExistingStructure(before, after, nil); !errors.Is(err, ErrInvalid) {
			t.Fatalf("ValidateExistingStructure() error = %v, want %v", err, ErrInvalid)
		}
	})

	t.Run("requires authorization for reparenting", func(t *testing.T) {
		quoteID, nestedID := uuid.New(), uuid.New()
		beforeWithQuote := Body{DocumentID: documentID, RootNodeID: rootID, Nodes: []Node{
			root,
			node(documentID, quoteID, &rootID, 0, "block-quote"),
			node(documentID, nestedID, &quoteID, 0, "paragraph"),
			node(documentID, firstID, &rootID, 1, "paragraph"),
		}}
		after := Body{DocumentID: documentID, RootNodeID: rootID, Nodes: []Node{
			root,
			node(documentID, quoteID, &rootID, 0, "block-quote"),
			node(documentID, nestedID, &quoteID, 0, "paragraph"),
			node(documentID, firstID, &quoteID, 1, "paragraph"),
		}}
		if err := ValidateExistingStructure(beforeWithQuote, after, nil); !errors.Is(err, ErrInvalid) {
			t.Fatalf("unauthorized reparent error = %v, want %v", err, ErrInvalid)
		}
		if err := ValidateExistingStructure(beforeWithQuote, after, map[uuid.UUID]struct{}{firstID: {}}); err != nil {
			t.Fatalf("authorized reparent: %v", err)
		}
	})
}
