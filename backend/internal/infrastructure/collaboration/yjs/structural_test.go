package yjs

import (
	"strings"
	"testing"

	"backend/internal/domain/documentbody"

	"github.com/google/uuid"
	"github.com/reearth/ygo/crdt"
)

// Structural commands (delete, move) change the stored Yjs document in place.
// Rebuilding it from the canonical body would erase every pending suggestion, so
// everything a command does not touch, suggestions included, has to survive.

type structuralFixture struct {
	documentID, rootID uuid.UUID
	author             uuid.UUID
	ids                map[string]uuid.UUID
}

func newStructuralFixture() *structuralFixture {
	return &structuralFixture{
		documentID: uuid.New(), rootID: uuid.New(), author: uuid.New(),
		ids: map[string]uuid.UUID{},
	}
}

func (f *structuralFixture) id(name string) uuid.UUID {
	if _, ok := f.ids[name]; !ok {
		f.ids[name] = uuid.New()
	}
	return f.ids[name]
}

func (f *structuralFixture) mark(kind, suggestion string) crdt.Attributes {
	return crdt.Attributes{"suggestion_" + kind: crdt.Attributes{"id": f.id(suggestion).String(), "author": f.author.String()}}
}

func (f *structuralFixture) blockSuggestion(kind, suggestion string) string {
	return `{"suggestion":{"kind":"` + kind + `","id":"` + f.id(suggestion).String() + `","author":"` + f.author.String() + `"}}`
}

// block describes one top-level paragraph with one run per list of deltas.
type block struct {
	name       string // the paragraph is f.id(name), its runs are f.id(name+".1"), ...
	attributes string // the paragraph's bodyAttributes, "{}" when empty
	runs       [][]crdt.Delta
}

func (f *structuralFixture) state(t *testing.T, blocks ...block) []byte {
	t.Helper()
	doc := crdt.New()
	defer doc.Destroy()
	fragment := doc.GetXmlFragment("body")
	if err := doc.TransactE(func(tx *crdt.Transaction) error {
		root := xmlElement(tx, "document", f.rootID, `{}`, "")
		for index, item := range blocks {
			attributes := item.attributes
			if attributes == "" {
				attributes = `{}`
			}
			paragraph := xmlElement(tx, "paragraph", f.id(item.name), attributes, "")
			for runIndex, deltas := range item.runs {
				run := xmlElement(tx, "run", f.id(item.name+"."+string(rune('1'+runIndex))), `{}`, "")
				text := crdt.NewYXmlText()
				text.ApplyDelta(tx, deltas)
				run.InsertText(tx, 0, text)
				paragraph.InsertElement(tx, runIndex, run)
			}
			root.InsertElement(tx, index, paragraph)
		}
		fragment.InsertElement(tx, 0, root)
		return nil
	}); err != nil {
		t.Fatalf("build Yjs body: %v", err)
	}
	return crdt.EncodeStateAsUpdateV1(doc, nil)
}

func plain(text string) []crdt.Delta {
	return []crdt.Delta{{Op: crdt.DeltaOpInsert, Insert: text}}
}

func (f *structuralFixture) project(t *testing.T, state []byte) documentbody.Body {
	t.Helper()
	body, err := ProjectV1(state, f.documentID)
	if err != nil {
		t.Fatalf("ProjectV1() error = %v", err)
	}
	return body
}

func suggestionIDs(t *testing.T, state []byte) string {
	t.Helper()
	infos, err := SuggestionsV1(state)
	if err != nil {
		t.Fatalf("SuggestionsV1() error = %v", err)
	}
	ids := make([]uuid.UUID, 0, len(infos))
	for _, info := range infos {
		ids = append(ids, info.ID)
	}
	return sortedIDs(ids...)
}

func sortedIDs(ids ...uuid.UUID) string {
	texts := make([]string, len(ids))
	for index, id := range ids {
		texts[index] = id.String()
	}
	for i := range texts {
		for j := i + 1; j < len(texts); j++ {
			if texts[j] < texts[i] {
				texts[i], texts[j] = texts[j], texts[i]
			}
		}
	}
	return strings.Join(texts, ",")
}

func TestDeleteSubtreesV1KeepsTheSuggestionsOfOtherBlocks(t *testing.T) {
	f := newStructuralFixture()
	state := f.state(t,
		block{name: "keep", runs: [][]crdt.Delta{{
			{Op: crdt.DeltaOpInsert, Insert: "Hello "},
			{Op: crdt.DeltaOpInsert, Insert: "big ", Attributes: f.mark("insert", "typed")},
			{Op: crdt.DeltaOpInsert, Insert: "world", Attributes: f.mark("delete", "removed")},
		}}},
		block{name: "inserted", attributes: f.blockSuggestion("insert", "block"), runs: [][]crdt.Delta{plain("proposed block")}},
		block{name: "gone", runs: [][]crdt.Delta{plain("delete me")}},
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

	if got, want := suggestionIDs(t, next), sortedIDs(f.id("typed"), f.id("removed"), f.id("block")); got != want {
		t.Fatalf("suggestions after the delete = %s, want all three kept: %s", got, want)
	}
	if !documentbody.SameContent(after, f.project(t, next)) {
		t.Fatalf("the canonical body after the delete differs from what the command computed")
	}
}
