package yjs

import (
	"encoding/base64"
	"os"
	"strings"
	"testing"

	"backend/internal/domain/documentbody"

	"github.com/google/uuid"
	"github.com/reearth/ygo/crdt"
)

// A suggestion is content of the Yjs body, but it is not part of the canonical
// body: the projection that feeds document_nodes, search, RAG, revisions, and the
// public link must show the body as if every suggestion were rejected.

type suggestionFixture struct {
	documentID, rootID, paragraphID, runID uuid.UUID
	author, suggestionID                   uuid.UUID
}

func newSuggestionFixture() suggestionFixture {
	return suggestionFixture{
		documentID: uuid.New(), rootID: uuid.New(), paragraphID: uuid.New(), runID: uuid.New(),
		author: uuid.New(), suggestionID: uuid.New(),
	}
}

func (f suggestionFixture) mark(kind string) crdt.Attributes {
	return crdt.Attributes{"suggestion_" + kind: crdt.Attributes{"id": f.suggestionID.String(), "author": f.author.String()}}
}

// bodyWithRun builds document > paragraph > run whose text is the given deltas.
func (f suggestionFixture) bodyWithRun(t *testing.T, runAttributes string, deltas []crdt.Delta) []byte {
	t.Helper()
	doc := crdt.New()
	defer doc.Destroy()
	fragment := doc.GetXmlFragment("body")
	if err := doc.TransactE(func(tx *crdt.Transaction) error {
		root := xmlElement(tx, "document", f.rootID, `{}`, "")
		paragraph := xmlElement(tx, "paragraph", f.paragraphID, `{}`, "")
		run := xmlElement(tx, "run", f.runID, runAttributes, "")
		text := crdt.NewYXmlText()
		text.ApplyDelta(tx, deltas)
		run.InsertText(tx, 0, text)
		paragraph.InsertElement(tx, 0, run)
		root.InsertElement(tx, 0, paragraph)
		fragment.InsertElement(tx, 0, root)
		return nil
	}); err != nil {
		t.Fatalf("build Yjs body: %v", err)
	}
	return crdt.EncodeStateAsUpdateV1(doc, nil)
}

func projectNodes(t *testing.T, state []byte, documentID uuid.UUID) []documentbody.Node {
	t.Helper()
	body, err := ProjectV1(state, documentID)
	if err != nil {
		t.Fatalf("ProjectV1() error = %v", err)
	}
	return body.Nodes
}

func TestProjectV1DropsInsertedTextAndKeepsTheRun(t *testing.T) {
	f := newSuggestionFixture()
	state := f.bodyWithRun(t, `{}`, []crdt.Delta{
		{Op: crdt.DeltaOpInsert, Insert: "Hello "},
		{Op: crdt.DeltaOpInsert, Insert: "big ", Attributes: f.mark("insert")},
		{Op: crdt.DeltaOpInsert, Insert: "world"},
	})

	nodes := projectNodes(t, state, f.documentID)
	if len(nodes) != 3 {
		t.Fatalf("projected %d nodes, want document, paragraph, run", len(nodes))
	}
	if run := nodes[2]; run.NodeID != f.runID || run.Content != "Hello world" || strings.Contains(string(run.Attributes), "suggestion") {
		t.Fatalf("run = %+v (attributes %s), want the original run with the inserted text removed", run, run.Attributes)
	}
}

func TestProjectV1KeepsTextUnderDeleteAndFormatSuggestions(t *testing.T) {
	f := newSuggestionFixture()
	format := crdt.Attributes{"suggestion_format": crdt.Attributes{
		"id": f.suggestionID.String(), "author": f.author.String(),
		"set": crdt.Attributes{"bold": true},
	}}
	state := f.bodyWithRun(t, `{}`, []crdt.Delta{
		{Op: crdt.DeltaOpInsert, Insert: "Keep "},
		{Op: crdt.DeltaOpInsert, Insert: "drop", Attributes: f.mark("delete")},
		{Op: crdt.DeltaOpInsert, Insert: " and "},
		{Op: crdt.DeltaOpInsert, Insert: "restyle", Attributes: format},
	})

	run := projectNodes(t, state, f.documentID)[2]
	if run.Content != "Keep drop and restyle" {
		t.Fatalf("run content = %q, want the text unchanged by delete and format suggestions", run.Content)
	}
	if strings.Contains(string(run.Attributes), "bold") || strings.Contains(string(run.Attributes), "suggestion") {
		t.Fatalf("run attributes = %s, want the current formatting, not the proposed one", run.Attributes)
	}
}

func TestProjectV1DropsARunThatIsOnlyInsertedText(t *testing.T) {
	f := newSuggestionFixture()
	insertedRunID := uuid.New()
	doc := crdt.New()
	defer doc.Destroy()
	fragment := doc.GetXmlFragment("body")
	if err := doc.TransactE(func(tx *crdt.Transaction) error {
		root := xmlElement(tx, "document", f.rootID, `{}`, "")
		paragraph := xmlElement(tx, "paragraph", f.paragraphID, `{}`, "")
		for index, item := range []struct {
			id    uuid.UUID
			text  string
			marks crdt.Attributes
		}{
			{f.runID, "before", nil},
			{insertedRunID, " typed", f.mark("insert")},
			{uuid.New(), " after", nil},
		} {
			run := xmlElement(tx, "run", item.id, `{}`, "")
			text := crdt.NewYXmlText()
			text.Insert(tx, 0, item.text, item.marks)
			run.InsertText(tx, 0, text)
			paragraph.InsertElement(tx, index, run)
		}
		root.InsertElement(tx, 0, paragraph)
		fragment.InsertElement(tx, 0, root)
		return nil
	}); err != nil {
		t.Fatalf("build Yjs body: %v", err)
	}

	nodes := projectNodes(t, crdt.EncodeStateAsUpdateV1(doc, nil), f.documentID)
	var runs []documentbody.Node
	for _, node := range nodes {
		if node.Type == "run" {
			runs = append(runs, node)
		}
	}
	if len(runs) != 2 || runs[0].Content != "before" || runs[1].Content != " after" {
		t.Fatalf("runs = %+v, want the two canonical runs", runs)
	}
	if runs[0].SiblingOrder != 0 || runs[1].SiblingOrder != 1 {
		t.Fatalf("sibling orders = %v, %v, want 0 and 1 with no gap where the inserted run was", runs[0].SiblingOrder, runs[1].SiblingOrder)
	}
	for _, node := range nodes {
		if node.NodeID == insertedRunID {
			t.Fatalf("the inserted run %s is in the projection", insertedRunID)
		}
	}
}

func (f suggestionFixture) blockSuggestion(kind string) string {
	proposal := ""
	if kind == "format" {
		proposal = `,"toType":"atx-heading"`
	}
	return `{"suggestion":{"kind":"` + kind + `","id":"` + f.suggestionID.String() + `","author":"` + f.author.String() + `"` + proposal + `}}`
}

// twoParagraphs builds document > [first, second] where each paragraph holds one
// run, and the second paragraph carries the given block attributes.
func (f suggestionFixture) twoParagraphs(t *testing.T, firstAttributes, secondAttributes string) (state []byte, ids [4]uuid.UUID) {
	t.Helper()
	ids = [4]uuid.UUID{uuid.New(), uuid.New(), uuid.New(), uuid.New()}
	doc := crdt.New()
	defer doc.Destroy()
	fragment := doc.GetXmlFragment("body")
	if err := doc.TransactE(func(tx *crdt.Transaction) error {
		root := xmlElement(tx, "document", f.rootID, `{}`, "")
		for index, item := range []struct {
			paragraph, run uuid.UUID
			attributes     string
			text           string
		}{
			{ids[0], ids[1], firstAttributes, "canonical"},
			{ids[2], ids[3], secondAttributes, "block text"},
		} {
			paragraph := xmlElement(tx, "paragraph", item.paragraph, item.attributes, "")
			run := xmlElement(tx, "run", item.run, `{}`, "")
			text := crdt.NewYXmlText()
			text.Insert(tx, 0, item.text, crdt.Attributes{})
			run.InsertText(tx, 0, text)
			paragraph.InsertElement(tx, 0, run)
			root.InsertElement(tx, index, paragraph)
		}
		fragment.InsertElement(tx, 0, root)
		return nil
	}); err != nil {
		t.Fatalf("build Yjs body: %v", err)
	}
	return crdt.EncodeStateAsUpdateV1(doc, nil), ids
}

func TestProjectV1DropsAnInsertedBlockWithItsChildren(t *testing.T) {
	f := newSuggestionFixture()
	state, ids := f.twoParagraphs(t, `{}`, f.blockSuggestion("insert"))

	nodes := projectNodes(t, state, f.documentID)
	if len(nodes) != 3 {
		t.Fatalf("projected %d nodes, want document, the first paragraph, and its run", len(nodes))
	}
	for _, node := range nodes {
		if node.NodeID == ids[2] || node.NodeID == ids[3] {
			t.Fatalf("node %s of the inserted block is in the projection", node.NodeID)
		}
	}
}

func TestProjectV1KeepsABlockUnderDeleteAndFormatSuggestionsWithoutTheSuggestion(t *testing.T) {
	f := newSuggestionFixture()
	state, ids := f.twoParagraphs(t, f.blockSuggestion("delete"), f.blockSuggestion("format"))

	nodes := projectNodes(t, state, f.documentID)
	if len(nodes) != 5 {
		t.Fatalf("projected %d nodes, want the whole body", len(nodes))
	}
	for _, node := range nodes {
		if (node.NodeID == ids[0] || node.NodeID == ids[2]) && string(node.Attributes) != `{}` {
			t.Fatalf("block %s attributes = %s, want the suggestion kept out of the canonical body", node.NodeID, node.Attributes)
		}
	}
}

func TestProjectV1RejectsMalformedSuggestions(t *testing.T) {
	f := newSuggestionFixture()
	valid := func() crdt.Attributes {
		return crdt.Attributes{"id": f.suggestionID.String(), "author": f.author.String()}
	}
	with := func(key string, value any) crdt.Attributes {
		attributes := valid()
		attributes[key] = value
		return attributes
	}
	without := func(key string) crdt.Attributes {
		attributes := valid()
		delete(attributes, key)
		return attributes
	}

	for name, mark := range map[string]crdt.Attributes{
		"suggestion_insert without id":        {"suggestion_insert": without("id")},
		"suggestion_insert without author":    {"suggestion_insert": without("author")},
		"suggestion_insert with a bad id":     {"suggestion_insert": with("id", "not-a-uuid")},
		"suggestion_insert with a nil author": {"suggestion_insert": with("author", uuid.Nil.String())},
		"suggestion_insert with an extra key": {"suggestion_insert": with("kind", "delete")},
		"suggestion_delete with an extra key": {"suggestion_delete": with("set", crdt.Attributes{})},
		"suggestion_format without set":       {"suggestion_format": valid()},
		"suggestion_format with a bad key":    {"suggestion_format": with("set", crdt.Attributes{"fontSize": true})},
		"suggestion_format with a bad value":  {"suggestion_format": with("set", crdt.Attributes{"bold": "yes"})},
		"suggestion_insert that is a string":  {"suggestion_insert": "oops"},
	} {
		t.Run(name, func(t *testing.T) {
			state := f.bodyWithRun(t, `{}`, []crdt.Delta{{Op: crdt.DeltaOpInsert, Insert: "text", Attributes: mark}})
			if _, err := ProjectV1(state, f.documentID); err == nil {
				t.Fatalf("ProjectV1() accepted %s", name)
			}
		})
	}

	for name, attributes := range map[string]string{
		"block suggestion with an unknown kind":  `{"suggestion":{"kind":"explode","id":"` + f.suggestionID.String() + `","author":"` + f.author.String() + `"}}`,
		"block suggestion without a kind":        `{"suggestion":{"id":"` + f.suggestionID.String() + `","author":"` + f.author.String() + `"}}`,
		"block suggestion without an id":         `{"suggestion":{"kind":"insert","author":"` + f.author.String() + `"}}`,
		"block suggestion with a bad author":     `{"suggestion":{"kind":"insert","id":"` + f.suggestionID.String() + `","author":"nobody"}}`,
		"block suggestion with an extra key":     `{"suggestion":{"kind":"insert","id":"` + f.suggestionID.String() + `","author":"` + f.author.String() + `","admin":true}}`,
		"block suggestion that is not an object": `{"suggestion":"insert"}`,
	} {
		t.Run(name, func(t *testing.T) {
			state, _ := f.twoParagraphs(t, `{}`, attributes)
			if _, err := ProjectV1(state, f.documentID); err == nil {
				t.Fatalf("ProjectV1() accepted %s", name)
			}
		})
	}
}

func TestSuggestionsV1ListsEachSuggestionOnceWithItsKinds(t *testing.T) {
	f := newSuggestionFixture()
	other := uuid.New()
	otherSuggestion := uuid.New()
	doc := crdt.New()
	defer doc.Destroy()
	fragment := doc.GetXmlFragment("body")
	blockSuggestion := `{"suggestion":{"kind":"insert","id":"` + otherSuggestion.String() + `","author":"` + other.String() + `"}}`
	if err := doc.TransactE(func(tx *crdt.Transaction) error {
		root := xmlElement(tx, "document", f.rootID, `{}`, "")
		paragraph := xmlElement(tx, "paragraph", f.paragraphID, `{}`, "")
		run := xmlElement(tx, "run", f.runID, `{}`, "")
		text := crdt.NewYXmlText()
		// One suggestion, a Replace: deleted text and the text typed in its place.
		text.ApplyDelta(tx, []crdt.Delta{
			{Op: crdt.DeltaOpInsert, Insert: "old", Attributes: f.mark("delete")},
			{Op: crdt.DeltaOpInsert, Insert: "new", Attributes: f.mark("insert")},
			{Op: crdt.DeltaOpInsert, Insert: " plain"},
		})
		run.InsertText(tx, 0, text)
		paragraph.InsertElement(tx, 0, run)
		inserted := xmlElement(tx, "paragraph", uuid.New(), blockSuggestion, "")
		root.InsertElement(tx, 0, paragraph)
		root.InsertElement(tx, 1, inserted)
		fragment.InsertElement(tx, 0, root)
		return nil
	}); err != nil {
		t.Fatalf("build Yjs body: %v", err)
	}

	got, err := SuggestionsV1(crdt.EncodeStateAsUpdateV1(doc, nil))
	if err != nil {
		t.Fatalf("SuggestionsV1() error = %v", err)
	}
	byID := map[uuid.UUID]SuggestionInfo{}
	for _, info := range got {
		byID[info.ID] = info
	}
	if len(got) != 2 {
		t.Fatalf("SuggestionsV1() = %+v, want two suggestions", got)
	}
	if replace := byID[f.suggestionID]; replace.Author != f.author || strings.Join(replace.Kinds, ",") != "delete,insert" {
		t.Fatalf("replace = %+v, want author %s with kinds delete,insert", replace, f.author)
	}
	if block := byID[otherSuggestion]; block.Author != other || strings.Join(block.Kinds, ",") != "insert" {
		t.Fatalf("block insert = %+v, want author %s with kind insert", block, other)
	}
}

func TestSuggestionsV1RejectsOneIDWithTwoAuthors(t *testing.T) {
	f := newSuggestionFixture()
	forged := crdt.Attributes{"suggestion_delete": crdt.Attributes{"id": f.suggestionID.String(), "author": uuid.New().String()}}
	state := f.bodyWithRun(t, `{}`, []crdt.Delta{
		{Op: crdt.DeltaOpInsert, Insert: "mine", Attributes: f.mark("insert")},
		{Op: crdt.DeltaOpInsert, Insert: "theirs", Attributes: forged},
	})
	if _, err := SuggestionsV1(state); err == nil {
		t.Fatalf("SuggestionsV1() accepted one suggestion id claimed by two authors")
	}
	if _, err := ProjectV1(state, f.documentID); err == nil {
		t.Fatalf("ProjectV1() accepted one suggestion id claimed by two authors")
	}
}

func TestSuggestionsV1IsEmptyForAPlainBody(t *testing.T) {
	f := newSuggestionFixture()
	state := f.bodyWithRun(t, `{}`, []crdt.Delta{{Op: crdt.DeltaOpInsert, Insert: "plain"}})
	got, err := SuggestionsV1(state)
	if err != nil || len(got) != 0 {
		t.Fatalf("SuggestionsV1() = (%+v, %v), want none", got, err)
	}
}

// testdata/suggestions_v1.b64 is a Yjs state the frontend encoded from its own
// suggestion fixture (frontend/scripts/generate-suggestions-fixture.ts). The
// frontend and the backend must project it to the same canonical body.
func TestProjectV1AgreesWithTheFrontendOnASuggestionFixture(t *testing.T) {
	encoded, err := os.ReadFile("testdata/suggestions_v1.b64")
	if err != nil {
		t.Fatalf("read frontend Yjs fixture: %v", err)
	}
	state, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(encoded)))
	if err != nil {
		t.Fatalf("decode frontend Yjs fixture: %v", err)
	}

	nodes := projectNodes(t, state, uuid.New())

	want := []struct{ id, nodeType, content string }{
		{"10000000-0000-4000-8000-000000000001", "document", ""},
		{"10000000-0000-4000-8000-000000000011", "paragraph", ""},
		{"10000000-0000-4000-8000-000000000012", "run", "Hello world"},
		{"10000000-0000-4000-8000-000000000021", "paragraph", ""},
		{"10000000-0000-4000-8000-000000000022", "run", "Keep drop and restyle"},
		{"10000000-0000-4000-8000-000000000041", "paragraph", ""},
		{"10000000-0000-4000-8000-000000000042", "run", "block to delete"},
	}
	if len(nodes) != len(want) {
		t.Fatalf("projected %d nodes, want %d: %+v", len(nodes), len(want), nodes)
	}
	for index, node := range nodes {
		if node.NodeID.String() != want[index].id || node.Type != want[index].nodeType || node.Content != want[index].content {
			t.Fatalf("node %d = %s %s %q, want %s %s %q", index, node.NodeID, node.Type, node.Content, want[index].id, want[index].nodeType, want[index].content)
		}
		if strings.Contains(string(node.Attributes), "suggestion") {
			t.Fatalf("node %s attributes = %s, want no suggestion", node.NodeID, node.Attributes)
		}
	}

	suggestions, err := SuggestionsV1(state)
	if err != nil || len(suggestions) != 5 {
		t.Fatalf("SuggestionsV1() = (%+v, %v), want the five suggestions in the fixture", suggestions, err)
	}
}
