package yjs

import (
	"testing"

	"backend/internal/domain/documentbody"

	"github.com/google/uuid"
	"github.com/reearth/ygo/crdt"
)

func TestDeleteSubtreesV1DeletesSeveralBlocksAtOnceEvenWhenOneIsInsideAnother(t *testing.T) {
	f := newStructuralFixture()
	state := f.state(t,
		block{name: "first", runs: [][]crdt.Delta{plain("one")}},
		block{name: "keep", runs: [][]crdt.Delta{{
			{Op: crdt.DeltaOpInsert, Insert: "kept ", Attributes: f.mark("insert", "typed")},
			{Op: crdt.DeltaOpInsert, Insert: "text"},
		}}},
		block{name: "third", runs: [][]crdt.Delta{plain("three")}},
	)
	targets := []uuid.UUID{f.id("first"), f.id("third.1"), f.id("third")}
	before := f.project(t, state)
	after, err := documentbody.DeleteNodes(before, targets)
	if err != nil {
		t.Fatalf("DeleteNodes(): %v", err)
	}

	next, err := DeleteSubtreesV1(state, targets, after)
	if err != nil {
		t.Fatalf("DeleteSubtreesV1() error = %v", err)
	}

	if got, want := suggestionIDs(t, next), sortedIDs(f.id("typed")); got != want {
		t.Fatalf("suggestions = %s, want the one in the kept block: %s", got, want)
	}
	if kept := f.project(t, next); len(kept.Nodes) != 3 {
		t.Fatalf("projected %d nodes, want document, the kept paragraph, and its run", len(kept.Nodes))
	}
}

func TestDeleteSubtreesV1RemovesTheSuggestionsOfADeletedBlock(t *testing.T) {
	f := newStructuralFixture()
	state := f.state(t,
		block{name: "keep", runs: [][]crdt.Delta{{
			{Op: crdt.DeltaOpInsert, Insert: "stays"},
			{Op: crdt.DeltaOpInsert, Insert: "!", Attributes: f.mark("insert", "kept")},
		}}},
		// A block with its own suggestion inside its run.
		block{name: "gone", runs: [][]crdt.Delta{{
			{Op: crdt.DeltaOpInsert, Insert: "old"},
			{Op: crdt.DeltaOpInsert, Insert: " new", Attributes: f.mark("insert", "inside")},
		}}},
		block{name: "proposed", attributes: f.blockSuggestion("insert", "block"), runs: [][]crdt.Delta{plain("proposed")}},
	)
	before := f.project(t, state)
	after, err := documentbody.DeleteNodes(before, []uuid.UUID{f.id("gone")})
	if err != nil {
		t.Fatalf("DeleteNodes(): %v", err)
	}

	next, err := DeleteSubtreesV1(state, []uuid.UUID{f.id("gone")}, after)
	if err != nil {
		t.Fatalf("DeleteSubtreesV1() error = %v", err)
	}

	if got, want := suggestionIDs(t, next), sortedIDs(f.id("kept"), f.id("block")); got != want {
		t.Fatalf("suggestions = %s, want the deleted block's suggestion gone and the others kept: %s", got, want)
	}
}

func TestDeleteSubtreesV1DeletesAWholeRunThatHasADeleteSuggestion(t *testing.T) {
	f := newStructuralFixture()
	// Accepting a deletion that covers a whole run: the run goes, and the
	// suggestions in its sibling run and in other blocks stay.
	state := f.state(t,
		block{name: "mixed", runs: [][]crdt.Delta{
			{{Op: crdt.DeltaOpInsert, Insert: "remove", Attributes: f.mark("delete", "accepted")}},
			{{Op: crdt.DeltaOpInsert, Insert: " stay"}, {Op: crdt.DeltaOpInsert, Insert: "?", Attributes: f.mark("insert", "sibling")}},
		}},
		block{name: "other", runs: [][]crdt.Delta{{{Op: crdt.DeltaOpInsert, Insert: "x", Attributes: f.mark("delete", "elsewhere")}}}},
	)
	before := f.project(t, state)
	after, err := documentbody.DeleteNodes(before, []uuid.UUID{f.id("mixed.1")})
	if err != nil {
		t.Fatalf("DeleteNodes(): %v", err)
	}

	next, err := DeleteSubtreesV1(state, []uuid.UUID{f.id("mixed.1")}, after)
	if err != nil {
		t.Fatalf("DeleteSubtreesV1() error = %v", err)
	}

	if got, want := suggestionIDs(t, next), sortedIDs(f.id("sibling"), f.id("elsewhere")); got != want {
		t.Fatalf("suggestions = %s, want the accepted one gone and the others kept: %s", got, want)
	}
	if !documentbody.SameContent(after, f.project(t, next)) {
		t.Fatalf("the canonical body differs from what the command computed")
	}
}

func TestDeleteSubtreesV1RefusesANodeThatIsNotInTheStoredState(t *testing.T) {
	f := newStructuralFixture()
	state := f.state(t, block{name: "only", runs: [][]crdt.Delta{plain("text")}})
	before := f.project(t, state)

	if _, err := DeleteSubtreesV1(state, []uuid.UUID{uuid.New()}, before); err == nil {
		t.Fatalf("DeleteSubtreesV1() accepted a node the stored state does not have")
	}
}
