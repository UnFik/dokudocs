package yjs

import (
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/reearth/ygo/crdt"
)

// A user with comment access may write to the shared body, but only suggestions
// of their own. ValidateSuggesterChange is the server's rule for that: with every
// contribution of the sender taken away, the body before and after an update must
// be identical. What is left is the canonical body and everyone else's
// suggestions, so a change to either shows up as a difference.

type layerFixture struct {
	sender, other uuid.UUID
	rootID        uuid.UUID
	p1, r1        uuid.UUID
	p2, r2        uuid.UUID
}

func newLayerFixture() layerFixture {
	return layerFixture{
		sender: uuid.New(), other: uuid.New(), rootID: uuid.New(),
		p1: uuid.New(), r1: uuid.New(), p2: uuid.New(), r2: uuid.New(),
	}
}

func (f layerFixture) mark(kind string, author uuid.UUID, id uuid.UUID) crdt.Attributes {
	return crdt.Attributes{"suggestion_" + kind: crdt.Attributes{"id": id.String(), "author": author.String()}}
}

func (f layerFixture) block(kind string, author uuid.UUID, id uuid.UUID) string {
	return `{"suggestion":{"kind":"` + kind + `","id":"` + id.String() + `","author":"` + author.String() + `"}}`
}

// base builds document > [paragraph > run "canonical text", paragraph > run "second"].
func (f layerFixture) base(t *testing.T) []byte {
	t.Helper()
	return f.build(t, nil)
}

// build is base with a hook that can add to the fixture before it is encoded.
func (f layerFixture) build(t *testing.T, extra func(tx *crdt.Transaction, root *crdt.YXmlElement)) []byte {
	t.Helper()
	doc := crdt.New()
	defer doc.Destroy()
	fragment := doc.GetXmlFragment("body")
	if err := doc.TransactE(func(tx *crdt.Transaction) error {
		root := xmlElement(tx, "document", f.rootID, `{}`, "")
		for index, item := range []struct {
			paragraph, run uuid.UUID
			text           string
		}{{f.p1, f.r1, "canonical text"}, {f.p2, f.r2, "second"}} {
			paragraph := xmlElement(tx, "paragraph", item.paragraph, `{}`, "")
			run := xmlElement(tx, "run", item.run, `{}`, "")
			text := crdt.NewYXmlText()
			text.Insert(tx, 0, item.text, crdt.Attributes{})
			run.InsertText(tx, 0, text)
			paragraph.InsertElement(tx, 0, run)
			root.InsertElement(tx, index, paragraph)
		}
		if extra != nil {
			extra(tx, root)
		}
		fragment.InsertElement(tx, 0, root)
		return nil
	}); err != nil {
		t.Fatalf("build Yjs body: %v", err)
	}
	return crdt.EncodeStateAsUpdateV1(doc, nil)
}

// edit loads state, runs fn on its root, and returns the new state.
func edit(t *testing.T, state []byte, fn func(tx *crdt.Transaction, root *crdt.YXmlElement)) []byte {
	t.Helper()
	doc := crdt.New()
	defer doc.Destroy()
	if err := crdt.ApplyUpdateV1(doc, state, nil); err != nil {
		t.Fatalf("load state: %v", err)
	}
	root := doc.GetXmlFragment("body").Children()[0].(*crdt.YXmlElement)
	if err := doc.TransactE(func(tx *crdt.Transaction) error {
		fn(tx, root)
		return nil
	}); err != nil {
		t.Fatalf("edit state: %v", err)
	}
	return crdt.EncodeStateAsUpdateV1(doc, nil)
}

// runText returns the YXmlText of the nth paragraph's only run.
func runText(root *crdt.YXmlElement, paragraph int) *crdt.YXmlText {
	return root.Children()[paragraph].(*crdt.YXmlElement).Children()[0].(*crdt.YXmlElement).Children()[0].(*crdt.YXmlText)
}

func TestValidateSuggesterChangeAllowsOwnSuggestionsAndRejectsEditsToTheBody(t *testing.T) {
	f := newLayerFixture()
	mine, theirs := uuid.New(), uuid.New()
	base := f.base(t)

	for name, tc := range map[string]struct {
		change func(tx *crdt.Transaction, root *crdt.YXmlElement)
		ok     bool
	}{
		"no change": {func(*crdt.Transaction, *crdt.YXmlElement) {}, true},
		"own insertion in the middle of a run": {func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			runText(root, 0).Insert(tx, 9, " new", f.mark("insert", f.sender, mine))
		}, true},
		"own deletion mark over canonical text": {func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			runText(root, 0).Format(tx, 0, 9, f.mark("delete", f.sender, mine))
		}, true},
		"own format suggestion": {func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			attrs := crdt.Attributes{"suggestion_format": crdt.Attributes{"id": mine.String(), "author": f.sender.String(), "set": crdt.Attributes{"bold": true}}}
			runText(root, 1).Format(tx, 0, 6, attrs)
		}, true},
		"a Replace: own deletion with own insertion beside it": {func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			text := runText(root, 0)
			text.Format(tx, 0, 9, f.mark("delete", f.sender, mine))
			text.Insert(tx, 9, "replacement", f.mark("insert", f.sender, mine))
		}, true},
		"own inserted block with a run": {func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			paragraph := xmlElement(tx, "paragraph", uuid.New(), f.block("insert", f.sender, mine), "")
			run := xmlElement(tx, "run", uuid.New(), `{}`, "")
			text := crdt.NewYXmlText()
			text.Insert(tx, 0, "a whole new paragraph", crdt.Attributes{})
			run.InsertText(tx, 0, text)
			paragraph.InsertElement(tx, 0, run)
			root.InsertElement(tx, 1, paragraph)
		}, true},
		"own deletion suggestion on a canonical block": {func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			root.Children()[0].(*crdt.YXmlElement).SetAttributeValue(tx, "bodyAttributes", f.block("delete", f.sender, mine))
		}, true},

		"a plain character typed into canonical text": {func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			runText(root, 0).Insert(tx, 9, "!", crdt.Attributes{})
		}, false},
		"canonical text deleted": {func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			runText(root, 0).Delete(tx, 0, 4)
		}, false},
		"a canonical block deleted": {func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			root.Delete(tx, 1, 1)
		}, false},
		"canonical formatting changed": {func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			runText(root, 0).Format(tx, 0, 9, crdt.Attributes{"strong": crdt.Attributes{}})
		}, false},
		"a canonical block's attributes changed": {func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			root.Children()[0].(*crdt.YXmlElement).SetAttributeValue(tx, "bodyAttributes", `{"level":2}`)
		}, false},
		"canonical text turned into the sender's own insertion": {func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			runText(root, 0).Format(tx, 0, 9, f.mark("insert", f.sender, mine))
		}, false},
		"a canonical block turned into the sender's own inserted block": {func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			root.Children()[1].(*crdt.YXmlElement).SetAttributeValue(tx, "bodyAttributes", f.block("insert", f.sender, mine))
		}, false},
		"a suggestion forged in someone else's name": {func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			runText(root, 0).Insert(tx, 9, " forged", f.mark("insert", f.other, theirs))
		}, false},
		"a deletion mark forged in someone else's name": {func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			runText(root, 0).Format(tx, 0, 9, f.mark("delete", f.other, theirs))
		}, false},
		"a block suggestion forged in someone else's name": {func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			root.Children()[0].(*crdt.YXmlElement).SetAttributeValue(tx, "bodyAttributes", f.block("delete", f.other, theirs))
		}, false},
	} {
		t.Run(name, func(t *testing.T) {
			err := ValidateSuggesterChange(base, edit(t, base, tc.change), f.sender)
			if tc.ok && err != nil {
				t.Fatalf("ValidateSuggesterChange() = %v, want it allowed", err)
			}
			if !tc.ok && !errors.Is(err, ErrSuggesterChange) {
				t.Fatalf("ValidateSuggesterChange() = %v, want %v", err, ErrSuggesterChange)
			}
		})
	}
}
