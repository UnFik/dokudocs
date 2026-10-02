package yjs

import (
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/reearth/ygo/crdt"
)

// One user may not grow the shared state without bound, but may always take
// suggestions back.

func (f layerFixture) manySuggestions(t *testing.T, state []byte, count int) []byte {
	t.Helper()
	return edit(t, state, func(tx *crdt.Transaction, root *crdt.YXmlElement) {
		text := runText(root, 0)
		for i := 0; i < count; i++ {
			text.Insert(tx, 9, "x", f.mark("insert", f.sender, uuid.New()))
		}
	})
}

func (f layerFixture) insertedBlocks(t *testing.T, state []byte, count int) []byte {
	t.Helper()
	// One suggestion that inserts many blocks, so only the node limit applies.
	suggestion := uuid.New()
	return edit(t, state, func(tx *crdt.Transaction, root *crdt.YXmlElement) {
		for i := 0; i < count; i++ {
			paragraph := xmlElement(tx, "paragraph", uuid.New(), f.block("insert", f.sender, suggestion), "")
			run := xmlElement(tx, "run", uuid.New(), `{}`, "")
			text := crdt.NewYXmlText()
			text.Insert(tx, 0, "b", crdt.Attributes{})
			run.InsertText(tx, 0, text)
			paragraph.InsertElement(tx, 0, run)
			root.InsertElement(tx, 1, paragraph)
		}
	})
}

func TestValidateSuggesterChangeLimitsWhatOneUserCanHave(t *testing.T) {
	f := newLayerFixture()
	base := f.base(t)

	t.Run("the number of suggestions", func(t *testing.T) {
		if err := ValidateSuggesterChange(base, f.manySuggestions(t, base, MaxSuggestionsPerUser), f.sender); err != nil {
			t.Fatalf("exactly %d suggestions = %v, want it allowed", MaxSuggestionsPerUser, err)
		}
		err := ValidateSuggesterChange(base, f.manySuggestions(t, base, MaxSuggestionsPerUser+1), f.sender)
		if !errors.Is(err, ErrSuggestionLimit) {
			t.Fatalf("%d suggestions = %v, want %v", MaxSuggestionsPerUser+1, err, ErrSuggestionLimit)
		}
	})

	t.Run("the size of the text they propose", func(t *testing.T) {
		insert := func(size int) []byte {
			return edit(t, base, func(tx *crdt.Transaction, root *crdt.YXmlElement) {
				runText(root, 0).Insert(tx, 9, strings.Repeat("a", size), f.mark("insert", f.sender, uuid.New()))
			})
		}
		if err := ValidateSuggesterChange(base, insert(MaxSuggestedTextBytesPerUser), f.sender); err != nil {
			t.Fatalf("exactly %d bytes = %v, want it allowed", MaxSuggestedTextBytesPerUser, err)
		}
		if err := ValidateSuggesterChange(base, insert(MaxSuggestedTextBytesPerUser+1), f.sender); !errors.Is(err, ErrSuggestionLimit) {
			t.Fatalf("%d bytes = %v, want %v", MaxSuggestedTextBytesPerUser+1, err, ErrSuggestionLimit)
		}
	})

	t.Run("the number of nodes in blocks they insert", func(t *testing.T) {
		// A block is two nodes here, a paragraph and its run.
		within := f.insertedBlocks(t, base, MaxSuggestedNodesPerUser/2)
		if err := ValidateSuggesterChange(base, within, f.sender); err != nil {
			t.Fatalf("%d nodes = %v, want it allowed", MaxSuggestedNodesPerUser, err)
		}
		over := f.insertedBlocks(t, base, MaxSuggestedNodesPerUser/2+1)
		if err := ValidateSuggesterChange(base, over, f.sender); !errors.Is(err, ErrSuggestionLimit) {
			t.Fatalf("%d nodes = %v, want %v", MaxSuggestedNodesPerUser+2, err, ErrSuggestionLimit)
		}
	})

	t.Run("an update that does not add is allowed even over the limit", func(t *testing.T) {
		over := f.manySuggestions(t, base, MaxSuggestionsPerUser+100)
		shrunk := edit(t, over, func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			runText(root, 0).Delete(tx, 9, 10)
		})
		if err := ValidateSuggesterChange(over, shrunk, f.sender); err != nil {
			t.Fatalf("withdrawing while over the limit = %v, want it allowed", err)
		}
		if err := ValidateSuggesterChange(over, over, f.sender); err != nil {
			t.Fatalf("no change while over the limit = %v, want it allowed", err)
		}
		grown := f.manySuggestions(t, over, 1)
		if err := ValidateSuggesterChange(over, grown, f.sender); !errors.Is(err, ErrSuggestionLimit) {
			t.Fatalf("adding while over the limit = %v, want %v", err, ErrSuggestionLimit)
		}
	})

	t.Run("each user is counted on their own", func(t *testing.T) {
		others := edit(t, base, func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			text := runText(root, 0)
			for i := 0; i < MaxSuggestionsPerUser; i++ {
				text.Insert(tx, 9, "x", f.mark("insert", f.other, uuid.New()))
			}
		})
		if err := ValidateSuggesterChange(others, f.manySuggestions(t, others, 1), f.sender); err != nil {
			t.Fatalf("one suggestion beside %d from someone else = %v, want it allowed", MaxSuggestionsPerUser, err)
		}
	})
}
