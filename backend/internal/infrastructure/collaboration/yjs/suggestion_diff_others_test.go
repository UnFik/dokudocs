package yjs

import (
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/reearth/ygo/crdt"
)

// What a sender may and may not do next to other users' suggestions.

// otherUsersLayer adds suggestions by f.other to the base body: an insertion in
// the first run, a deletion over the start of the second, and a whole inserted
// block (with a plain run) after the first paragraph.
func (f layerFixture) otherUsersLayer(t *testing.T, insert, deletion, block uuid.UUID) []byte {
	t.Helper()
	return edit(t, f.base(t), func(tx *crdt.Transaction, root *crdt.YXmlElement) {
		runText(root, 0).Insert(tx, 9, " by A", f.mark("insert", f.other, insert))
		runText(root, 1).Format(tx, 0, 3, f.mark("delete", f.other, deletion))
		paragraph := xmlElement(tx, "paragraph", uuid.New(), f.block("insert", f.other, block), "")
		run := xmlElement(tx, "run", uuid.New(), `{}`, "")
		text := crdt.NewYXmlText()
		text.Insert(tx, 0, "A's block", crdt.Attributes{})
		run.InsertText(tx, 0, text)
		paragraph.InsertElement(tx, 0, run)
		root.InsertElement(tx, 1, paragraph)
	})
}

type layerCase struct {
	change func(tx *crdt.Transaction, root *crdt.YXmlElement)
	ok     bool
}

func runLayerCases(t *testing.T, f layerFixture, before []byte, cases map[string]layerCase) {
	t.Helper()
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			err := ValidateSuggesterChange(before, edit(t, before, tc.change), f.sender)
			if tc.ok && err != nil {
				t.Fatalf("ValidateSuggesterChange() = %v, want it allowed", err)
			}
			if !tc.ok && !errors.Is(err, ErrSuggesterChange) {
				t.Fatalf("ValidateSuggesterChange() = %v, want %v", err, ErrSuggesterChange)
			}
		})
	}
}

func TestValidateSuggesterChangeProtectsOtherUsersSuggestions(t *testing.T) {
	f := newLayerFixture()
	insertA, deleteA, blockA, mine := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	before := f.otherUsersLayer(t, insertA, deleteA, blockA)
	// Root children: [p1 "canonical text" + A's " by A"] [A's block] [p2 "second", "sec" marked deleted by A].
	blockText := func(root *crdt.YXmlElement) *crdt.YXmlText {
		return root.Children()[1].(*crdt.YXmlElement).Children()[0].(*crdt.YXmlElement).Children()[0].(*crdt.YXmlText)
	}
	secondRun := func(root *crdt.YXmlElement) *crdt.YXmlText { return runText(root, 2) }

	runLayerCases(t, f, before, map[string]layerCase{
		// What the sender may do next to other users' suggestions.
		"own text typed in the middle of someone else's insertion": {func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			runText(root, 0).Insert(tx, 11, "XY", f.mark("insert", f.sender, mine))
		}, true},
		"own deletion over someone else's inserted text": {func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			runText(root, 0).Format(tx, 10, 3, f.mark("delete", f.sender, mine))
		}, true},
		// A text attribute holds one value per character, so a second delete mark
		// over text already marked deleted would replace the first user's mark. The
		// editor treats such text as already deleted and adds nothing.
		"own deletion mark over text someone else already marked deleted": {func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			secondRun(root).Format(tx, 1, 4, f.mark("delete", f.sender, mine))
		}, false},
		"own text inside someone else's inserted block": {func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			blockText(root).Insert(tx, 3, "xx", f.mark("insert", f.sender, mine))
		}, true},

		// Someone else's insertion.
		"someone else's inserted text changed": {func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			runText(root, 0).Delete(tx, 10, 2)
		}, false},
		"someone else's insertion extended in their name": {func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			runText(root, 0).Insert(tx, 14, "!", f.mark("insert", f.other, insertA))
		}, false},
		"someone else's insertion made canonical by taking the mark off": {func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			runText(root, 0).Format(tx, 9, 5, crdt.Attributes{"suggestion_insert": nil})
		}, false},
		"someone else's insertion reformatted": {func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			runText(root, 0).Format(tx, 9, 5, crdt.Attributes{"strong": crdt.Attributes{}})
		}, false},
		"someone else's insertion re-marked as the sender's own": {func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			runText(root, 0).Format(tx, 9, 5, f.mark("insert", f.sender, mine))
		}, false},
		"someone else's insertion shrunk by taking the mark off its end": {func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			runText(root, 0).Format(tx, 12, 2, crdt.Attributes{"suggestion_insert": nil})
		}, false},

		// Someone else's deletion.
		"someone else's deletion mark taken off": {func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			secondRun(root).Format(tx, 0, 3, crdt.Attributes{"suggestion_delete": nil})
		}, false},
		"someone else's deletion mark shortened": {func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			secondRun(root).Format(tx, 2, 1, crdt.Attributes{"suggestion_delete": nil})
		}, false},
		"someone else's deletion mark stretched in their name": {func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			secondRun(root).Format(tx, 3, 2, f.mark("delete", f.other, deleteA))
		}, false},

		// Someone else's inserted block.
		"someone else's inserted block deleted": {func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			root.Delete(tx, 1, 1)
		}, false},
		"someone else's inserted block edited": {func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			blockText(root).Delete(tx, 0, 2)
		}, false},
		"someone else's inserted block taken as the sender's": {func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			root.Children()[1].(*crdt.YXmlElement).SetAttributeValue(tx, "bodyAttributes", f.block("insert", f.sender, mine))
		}, false},
		"someone else's inserted block made canonical": {func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			root.Children()[1].(*crdt.YXmlElement).SetAttributeValue(tx, "bodyAttributes", `{}`)
		}, false},

		// Forged authorship on the sender's own content.
		"own insertion that also carries someone else's deletion mark": {func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			both := f.mark("insert", f.sender, mine)
			both["suggestion_delete"] = f.mark("delete", f.other, deleteA)["suggestion_delete"]
			runText(root, 0).Insert(tx, 0, "mine", both)
		}, false},
	})
}

func TestValidateSuggesterChangeLetsASenderWithdrawOnlyTheirOwnSuggestions(t *testing.T) {
	f := newLayerFixture()
	mine, blockMine, theirs := uuid.New(), uuid.New(), uuid.New()
	before := edit(t, f.base(t), func(tx *crdt.Transaction, root *crdt.YXmlElement) {
		text := runText(root, 0)
		text.Insert(tx, 9, " typed", f.mark("insert", f.sender, mine))
		text.Format(tx, 0, 4, f.mark("delete", f.sender, mine))
		paragraph := xmlElement(tx, "paragraph", uuid.New(), f.block("insert", f.sender, blockMine), "")
		run := xmlElement(tx, "run", uuid.New(), `{}`, "")
		inner := crdt.NewYXmlText()
		inner.Insert(tx, 0, "my block", crdt.Attributes{})
		run.InsertText(tx, 0, inner)
		paragraph.InsertElement(tx, 0, run)
		root.InsertElement(tx, 1, paragraph)
	})

	runLayerCases(t, f, before, map[string]layerCase{
		"own insertion removed": {func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			runText(root, 0).Delete(tx, 9, 6)
		}, true},
		"own deletion mark taken off": {func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			runText(root, 0).Format(tx, 0, 4, crdt.Attributes{"suggestion_delete": nil})
		}, true},
		"own inserted block removed": {func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			root.Delete(tx, 1, 1)
		}, true},
	})

	// Someone else's text inside the sender's block is not the sender's to remove.
	withForeign := edit(t, before, func(tx *crdt.Transaction, root *crdt.YXmlElement) {
		root.Children()[1].(*crdt.YXmlElement).Children()[0].(*crdt.YXmlElement).Children()[0].(*crdt.YXmlText).Insert(tx, 0, "A", f.mark("insert", f.other, theirs))
	})
	removed := edit(t, withForeign, func(tx *crdt.Transaction, root *crdt.YXmlElement) { root.Delete(tx, 1, 1) })
	if err := ValidateSuggesterChange(withForeign, removed, f.sender); !errors.Is(err, ErrSuggesterChange) {
		t.Fatalf("deleting a block that holds someone else's suggestion = %v, want %v", err, ErrSuggesterChange)
	}
	if err := ValidateSuggesterChange(withForeign, withForeign, f.sender); err != nil {
		t.Fatalf("an unchanged body with someone else's text inside the sender's block = %v, want it allowed", err)
	}
}
