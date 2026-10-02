package yjs

import (
	"testing"

	"backend/internal/domain/documentbody"

	"github.com/google/uuid"
	"github.com/reearth/ygo/crdt"
)

func (f *structuralFixture) moved(t *testing.T, state []byte, nodeID, parentID uuid.UUID, before *uuid.UUID) (documentbody.Body, []byte) {
	t.Helper()
	after, err := documentbody.MoveNode(f.project(t, state), documentbody.MoveNodeCommand{NodeID: nodeID, TargetParentID: parentID, BeforeNodeID: before})
	if err != nil {
		t.Fatalf("MoveNode(): %v", err)
	}
	next, err := MoveSubtreeV1(state, nodeID, parentID, before, after)
	if err != nil {
		t.Fatalf("MoveSubtreeV1() error = %v", err)
	}
	return after, next
}

func topLevel(body documentbody.Body, rootID uuid.UUID) []uuid.UUID {
	var ids []uuid.UUID
	for _, node := range body.Nodes {
		if node.ParentID != nil && *node.ParentID == rootID {
			ids = append(ids, node.NodeID)
		}
	}
	return ids
}

func TestMoveSubtreeV1KeepsEverySuggestionAndPutsTheBlockWhereTheCommandSaid(t *testing.T) {
	f := newStructuralFixture()
	state := f.state(t,
		block{name: "a", runs: [][]crdt.Delta{{
			{Op: crdt.DeltaOpInsert, Insert: "a text"},
			{Op: crdt.DeltaOpInsert, Insert: "!", Attributes: f.mark("insert", "in-a")},
		}}},
		block{name: "proposed", attributes: f.blockSuggestion("insert", "block"), runs: [][]crdt.Delta{plain("proposed")}},
		block{name: "b", runs: [][]crdt.Delta{plain("b text")}},
		block{name: "c", runs: [][]crdt.Delta{{{Op: crdt.DeltaOpInsert, Insert: "c text", Attributes: f.mark("delete", "in-c")}}}},
	)
	first := f.id("a")

	after, next := f.moved(t, state, f.id("c"), f.rootID, &first)

	if got, want := suggestionIDs(t, next), sortedIDs(f.id("in-a"), f.id("block"), f.id("in-c")); got != want {
		t.Fatalf("suggestions after the move = %s, want all three, including the one inside the moved block: %s", got, want)
	}
	order := topLevel(f.project(t, next), f.rootID)
	if len(order) != 3 || order[0] != f.id("c") || order[1] != f.id("a") || order[2] != f.id("b") {
		t.Fatalf("canonical order = %v, want c, a, b", order)
	}
	if !documentbody.SameContent(after, f.project(t, next)) {
		t.Fatalf("the canonical body differs from what the command computed")
	}
}

func TestMoveSubtreeV1AppendsWhenNoBeforeNodeIsGiven(t *testing.T) {
	f := newStructuralFixture()
	state := f.state(t,
		block{name: "a", runs: [][]crdt.Delta{plain("a")}},
		block{name: "b", runs: [][]crdt.Delta{plain("b")}},
		block{name: "c", runs: [][]crdt.Delta{{{Op: crdt.DeltaOpInsert, Insert: "c", Attributes: f.mark("insert", "in-c")}, {Op: crdt.DeltaOpInsert, Insert: " kept"}}}},
	)

	_, next := f.moved(t, state, f.id("a"), f.rootID, nil)

	order := topLevel(f.project(t, next), f.rootID)
	if len(order) != 3 || order[0] != f.id("b") || order[1] != f.id("c") || order[2] != f.id("a") {
		t.Fatalf("canonical order = %v, want b, c, a", order)
	}
	if got, want := suggestionIDs(t, next), sortedIDs(f.id("in-c")); got != want {
		t.Fatalf("suggestions = %s, want %s", got, want)
	}
}

func TestMoveSubtreeV1MovesABlockIntoAnotherParent(t *testing.T) {
	f := newStructuralFixture()
	doc := crdt.New()
	defer doc.Destroy()
	fragment := doc.GetXmlFragment("body")
	quoteID, innerID, innerRunID, topID, topRunID := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	if err := doc.TransactE(func(tx *crdt.Transaction) error {
		root := xmlElement(tx, "document", f.rootID, `{}`, "")
		quote := xmlElement(tx, "block_quote", quoteID, `{}`, "")
		inner := xmlElement(tx, "paragraph", innerID, `{}`, "")
		innerRun := xmlElement(tx, "run", innerRunID, `{}`, "")
		innerText := crdt.NewYXmlText()
		innerText.Insert(tx, 0, "inside", crdt.Attributes{})
		innerRun.InsertText(tx, 0, innerText)
		inner.InsertElement(tx, 0, innerRun)
		quote.InsertElement(tx, 0, inner)
		top := xmlElement(tx, "paragraph", topID, `{}`, "")
		topRun := xmlElement(tx, "run", topRunID, `{}`, "")
		topText := crdt.NewYXmlText()
		topText.ApplyDelta(tx, []crdt.Delta{
			{Op: crdt.DeltaOpInsert, Insert: "moving "},
			{Op: crdt.DeltaOpInsert, Insert: "text", Attributes: f.mark("insert", "moved-with-it")},
		})
		topRun.InsertText(tx, 0, topText)
		top.InsertElement(tx, 0, topRun)
		root.InsertElement(tx, 0, quote)
		root.InsertElement(tx, 1, top)
		fragment.InsertElement(tx, 0, root)
		return nil
	}); err != nil {
		t.Fatalf("build Yjs body: %v", err)
	}
	state := crdt.EncodeStateAsUpdateV1(doc, nil)

	after, next := f.moved(t, state, topID, quoteID, &innerID)

	if !documentbody.SameContent(after, f.project(t, next)) {
		t.Fatalf("the canonical body differs from what the command computed")
	}
	if got, want := suggestionIDs(t, next), sortedIDs(f.id("moved-with-it")); got != want {
		t.Fatalf("suggestions = %s, want the one that was inside the moved block: %s", got, want)
	}
}

func TestMoveSubtreeV1RefusesANodeThatIsNotInTheStoredState(t *testing.T) {
	f := newStructuralFixture()
	state := f.state(t, block{name: "only", runs: [][]crdt.Delta{plain("text")}})
	before := f.project(t, state)

	if _, err := MoveSubtreeV1(state, uuid.New(), f.rootID, nil, before); err == nil {
		t.Fatalf("MoveSubtreeV1() accepted a node the stored state does not have")
	}
}
