//go:build integration

package document

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"testing"

	"backend/constant"
	"backend/internal/application/collaboration"
	"backend/internal/infrastructure/collaboration/yjs"

	"github.com/google/uuid"
	"github.com/reearth/ygo/crdt"
)

// The security boundary of Suggest mode (ADR 0027): a user with comment access may
// write to the shared body, but only suggestions of their own. These tests drive
// CommitUpdate the way the WebSocket does, as an editor, a commenter, and a viewer.

type suggesterWorld struct {
	t           *testing.T
	ctx         context.Context
	db          *sql.DB
	repo        *Repository
	workspaceID uuid.UUID
	documentID  uuid.UUID
	editor      uuid.UUID
	commenter   uuid.UUID
	viewer      uuid.UUID
	runID       uuid.UUID
}

func newSuggesterWorld(t *testing.T) *suggesterWorld {
	t.Helper()
	ctx := context.Background()
	db, err := sql.Open("pgx", integrationDatabaseURL(t))
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	workspaceID, documentID, editor, _, runID, repo := seedRunDocument(t, ctx, db)
	add := func(level string) uuid.UUID {
		id := insertAccessTestUser(t, ctx, db)
		t.Cleanup(func() { _, _ = db.ExecContext(ctx, `DELETE FROM users WHERE id = $1`, id) })
		if _, err := db.ExecContext(ctx, `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'member')`, workspaceID, id); err != nil {
			t.Fatalf("add member: %v", err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO document_accesses (document_id, user_id, access_level) VALUES ($1, $2, $3)`, documentID, id, level); err != nil {
			t.Fatalf("grant %s: %v", level, err)
		}
		return id
	}
	return &suggesterWorld{
		t: t, ctx: ctx, db: db, repo: repo, workspaceID: workspaceID, documentID: documentID,
		editor: editor, commenter: add("comment"), viewer: add("view"), runID: runID,
	}
}

// newElement makes a body node the way the editor does: node ID, attributes, no content.
func newElement(tx *crdt.Transaction, name string, id uuid.UUID, attributes string) *crdt.YXmlElement {
	element := crdt.NewYXmlElement(name)
	element.SetAttributeValue(tx, "nodeID", id.String())
	element.SetAttributeValue(tx, "bodyAttributes", attributes)
	element.SetAttributeValue(tx, "bodyContent", "")
	return element
}

func (w *suggesterWorld) state() []byte {
	w.t.Helper()
	state, err := readCollaborationState(w.ctx, w.db, w.documentID)
	if err != nil {
		w.t.Fatalf("read state: %v", err)
	}
	return state
}

// update turns an edit of the document root into the update a client would send.
func (w *suggesterWorld) update(edit func(tx *crdt.Transaction, root *crdt.YXmlElement)) []byte {
	w.t.Helper()
	client := crdt.New()
	defer client.Destroy()
	if err := crdt.ApplyUpdateV1(client, w.state(), nil); err != nil {
		w.t.Fatalf("load client state: %v", err)
	}
	vector, err := crdt.DecodeStateVectorV1(crdt.EncodeStateVectorV1(client))
	if err != nil {
		w.t.Fatalf("decode state vector: %v", err)
	}
	root := client.GetXmlFragment("body").Children()[0].(*crdt.YXmlElement)
	if err := client.TransactE(func(tx *crdt.Transaction) error {
		edit(tx, root)
		return nil
	}); err != nil {
		w.t.Fatalf("edit client state: %v", err)
	}
	return crdt.EncodeStateAsUpdateV1(client, vector)
}

func (w *suggesterWorld) commit(user uuid.UUID, update []byte) (collaboration.CommitReceipt, error) {
	w.t.Helper()
	return w.repo.CommitUpdate(w.ctx, collaboration.Actor{UserID: user}, collaboration.Update{
		DocumentID: w.documentID, UpdateID: uuid.New(), BodyEpoch: 1, BodySchemaVersion: 1, Bytes: update,
	})
}

func (w *suggesterWorld) mark(kind string, author, id uuid.UUID) crdt.Attributes {
	return crdt.Attributes{"suggestion_" + kind: crdt.Attributes{"id": id.String(), "author": author.String()}}
}

func (w *suggesterWorld) block(kind string, author, id uuid.UUID) string {
	return `{"suggestion":{"kind":"` + kind + `","id":"` + id.String() + `","author":"` + author.String() + `"}}`
}

func (w *suggesterWorld) text(root *crdt.YXmlElement) *crdt.YXmlText {
	return root.Children()[0].(*crdt.YXmlElement).Children()[0].(*crdt.YXmlElement).Children()[0].(*crdt.YXmlText)
}

func (w *suggesterWorld) bodyVersion() int64 {
	w.t.Helper()
	var version int64
	if err := w.db.QueryRowContext(w.ctx, `SELECT body_version FROM documents WHERE id = $1`, w.documentID).Scan(&version); err != nil {
		w.t.Fatalf("read body version: %v", err)
	}
	return version
}

func (w *suggesterWorld) runContent() string {
	w.t.Helper()
	var content string
	if err := w.db.QueryRowContext(w.ctx, `SELECT content FROM document_nodes WHERE document_id = $1 AND node_id = $2`, w.documentID, w.runID).Scan(&content); err != nil {
		w.t.Fatalf("read run: %v", err)
	}
	return content
}

func (w *suggesterWorld) suggestions() []yjs.SuggestionInfo {
	w.t.Helper()
	infos, err := yjs.SuggestionsV1(w.state())
	if err != nil {
		w.t.Fatalf("list suggestions: %v", err)
	}
	return infos
}

func TestACommenterCanSuggestAndTheEditorSeesIt(t *testing.T) {
	w := newSuggesterWorld(t)
	suggestion := uuid.New()

	insert := w.update(func(tx *crdt.Transaction, root *crdt.YXmlElement) {
		w.text(root).Insert(tx, 5, " text", w.mark("insert", w.commenter, suggestion))
	})
	receipt, err := w.commit(w.commenter, insert)
	if err != nil {
		t.Fatalf("a commenter's own insertion: %v", err)
	}
	if !receipt.Changed || receipt.BodyVersion != 1 {
		t.Fatalf("receipt = %+v, want a changed state at the unchanged body version 1", receipt)
	}
	if w.runContent() != "plain" || w.bodyVersion() != 1 {
		t.Fatalf("a suggestion moved the canonical body: run %q at version %d", w.runContent(), w.bodyVersion())
	}
	infos := w.suggestions()
	if len(infos) != 1 || infos[0].ID != suggestion || infos[0].Author != w.commenter {
		t.Fatalf("suggestions = %+v, want the commenter's insertion", infos)
	}

	// The same user may take it back.
	withdraw := w.update(func(tx *crdt.Transaction, root *crdt.YXmlElement) { w.text(root).Delete(tx, 5, 5) })
	if _, err := w.commit(w.commenter, withdraw); err != nil {
		t.Fatalf("a commenter withdrawing their own suggestion: %v", err)
	}
	if len(w.suggestions()) != 0 {
		t.Fatalf("suggestions after the withdrawal = %+v, want none", w.suggestions())
	}
}

func TestACommenterCanSuggestDeletionsFormatsAndBlocks(t *testing.T) {
	w := newSuggesterWorld(t)
	deletion, format, block := uuid.New(), uuid.New(), uuid.New()

	for name, change := range map[string]func(tx *crdt.Transaction, root *crdt.YXmlElement){
		"a deletion mark over canonical text": func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			w.text(root).Format(tx, 0, 3, w.mark("delete", w.commenter, deletion))
		},
		"a format suggestion": func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			w.text(root).Format(tx, 3, 2, crdt.Attributes{"suggestion_format": crdt.Attributes{
				"id": format.String(), "author": w.commenter.String(), "set": crdt.Attributes{"bold": true},
			}})
		},
		"a whole inserted block with children": func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			paragraph := newElement(tx, "paragraph", uuid.New(), w.block("insert", w.commenter, block))
			run := newElement(tx, "run", uuid.New(), `{}`)
			inner := crdt.NewYXmlText()
			inner.Insert(tx, 0, "a block the commenter proposes", crdt.Attributes{})
			run.InsertText(tx, 0, inner)
			paragraph.InsertElement(tx, 0, run)
			root.InsertElement(tx, 1, paragraph)
		},
	} {
		if _, err := w.commit(w.commenter, w.update(change)); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
	}
	if w.runContent() != "plain" || w.bodyVersion() != 1 {
		t.Fatalf("suggestions moved the canonical body: run %q at version %d", w.runContent(), w.bodyVersion())
	}
	if got := len(w.suggestions()); got != 3 {
		t.Fatalf("suggestions = %d, want the three the commenter made", got)
	}
}

func TestACommenterCannotChangeTheBody(t *testing.T) {
	w := newSuggesterWorld(t)
	mine := uuid.New()
	before := w.state()

	for name, change := range map[string]func(tx *crdt.Transaction, root *crdt.YXmlElement){
		"typing into canonical text": func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			w.text(root).Insert(tx, 5, "!", crdt.Attributes{})
		},
		"deleting canonical text": func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			w.text(root).Delete(tx, 0, 2)
		},
		"deleting a canonical block": func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			root.Delete(tx, 0, 1)
		},
		"reformatting canonical text": func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			w.text(root).Format(tx, 0, 5, crdt.Attributes{"strong": crdt.Attributes{}})
		},
		"turning canonical text into their own insertion": func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			w.text(root).Format(tx, 0, 5, w.mark("insert", w.commenter, mine))
		},
		"turning a canonical block into their own inserted block": func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			root.Children()[0].(*crdt.YXmlElement).SetAttributeValue(tx, "bodyAttributes", w.block("insert", w.commenter, mine))
		},
		"changing a block's attributes": func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			root.Children()[0].(*crdt.YXmlElement).SetAttributeValue(tx, "bodyAttributes", `{"level":3}`)
		},
		"a suggestion in the editor's name": func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			w.text(root).Insert(tx, 5, " forged", w.mark("insert", w.editor, mine))
		},
		"a deletion mark in the editor's name": func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			w.text(root).Format(tx, 0, 3, w.mark("delete", w.editor, mine))
		},
		"a malformed suggestion": func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			w.text(root).Insert(tx, 5, "x", crdt.Attributes{"suggestion_insert": "yes"})
		},
		"a suggestion with an extra key": func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			w.text(root).Insert(tx, 5, "x", crdt.Attributes{"suggestion_insert": crdt.Attributes{
				"id": mine.String(), "author": w.commenter.String(), "admin": true,
			}})
		},
	} {
		_, err := w.commit(w.commenter, w.update(change))
		if err == nil {
			t.Fatalf("a commenter %s was accepted", name)
		}
		if after := w.state(); string(after) != string(before) || w.bodyVersion() != 1 || w.runContent() != "plain" {
			t.Fatalf("a commenter %s was refused (%v) but changed the stored body", name, err)
		}
	}
}

func TestACommenterCannotTouchSomeoneElsesSuggestions(t *testing.T) {
	w := newSuggesterWorld(t)
	editorsInsertion, editorsDeletion, editorsBlock, mine := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	// The editor makes three suggestions of their own (an editor may).
	for _, change := range []func(tx *crdt.Transaction, root *crdt.YXmlElement){
		func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			w.text(root).Insert(tx, 5, " by editor", w.mark("insert", w.editor, editorsInsertion))
		},
		func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			w.text(root).Format(tx, 0, 2, w.mark("delete", w.editor, editorsDeletion))
		},
		func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			paragraph := newElement(tx, "paragraph", uuid.New(), w.block("insert", w.editor, editorsBlock))
			run := newElement(tx, "run", uuid.New(), `{}`)
			inner := crdt.NewYXmlText()
			inner.Insert(tx, 0, "editor's block", crdt.Attributes{})
			run.InsertText(tx, 0, inner)
			paragraph.InsertElement(tx, 0, run)
			root.InsertElement(tx, 1, paragraph)
		},
	} {
		if _, err := w.commit(w.editor, w.update(change)); err != nil {
			t.Fatalf("the editor's own suggestion: %v", err)
		}
	}
	before := w.state()
	blockText := func(root *crdt.YXmlElement) *crdt.YXmlText {
		return root.Children()[1].(*crdt.YXmlElement).Children()[0].(*crdt.YXmlElement).Children()[0].(*crdt.YXmlText)
	}

	for name, change := range map[string]func(tx *crdt.Transaction, root *crdt.YXmlElement){
		"deleting the editor's inserted text": func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			w.text(root).Delete(tx, 6, 3)
		},
		"extending the editor's insertion in the editor's name": func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			w.text(root).Insert(tx, 15, "!", w.mark("insert", w.editor, editorsInsertion))
		},
		"accepting the editor's insertion by taking the mark off": func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			w.text(root).Format(tx, 5, 10, crdt.Attributes{"suggestion_insert": nil})
		},
		"taking the editor's deletion mark off": func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			w.text(root).Format(tx, 0, 2, crdt.Attributes{"suggestion_delete": nil})
		},
		"shrinking the editor's deletion mark": func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			w.text(root).Format(tx, 1, 1, crdt.Attributes{"suggestion_delete": nil})
		},
		"overwriting the editor's deletion mark with their own": func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			w.text(root).Format(tx, 0, 2, w.mark("delete", w.commenter, mine))
		},
		"deleting the editor's inserted block": func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			root.Delete(tx, 1, 1)
		},
		"editing the text inside the editor's inserted block": func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			blockText(root).Delete(tx, 0, 3)
		},
		"making the editor's inserted block canonical": func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			root.Children()[1].(*crdt.YXmlElement).SetAttributeValue(tx, "bodyAttributes", `{}`)
		},
		"taking over the editor's inserted block": func(tx *crdt.Transaction, root *crdt.YXmlElement) {
			root.Children()[1].(*crdt.YXmlElement).SetAttributeValue(tx, "bodyAttributes", w.block("insert", w.commenter, editorsBlock))
		},
	} {
		if _, err := w.commit(w.commenter, w.update(change)); err == nil {
			t.Fatalf("a commenter %s was accepted", name)
		}
		if string(w.state()) != string(before) {
			t.Fatalf("a commenter %s was refused but changed the stored body", name)
		}
	}

	// Next to the editor's suggestions they can still make their own, even inside them.
	if _, err := w.commit(w.commenter, w.update(func(tx *crdt.Transaction, root *crdt.YXmlElement) {
		w.text(root).Insert(tx, 8, "XY", w.mark("insert", w.commenter, mine))
		blockText(root).Insert(tx, 2, "zz", w.mark("insert", w.commenter, mine))
	})); err != nil {
		t.Fatalf("a commenter's own text inside the editor's suggestions: %v", err)
	}
}

func TestAnEditorKeepsFullPowerOverTheBodyAndEverySuggestion(t *testing.T) {
	w := newSuggesterWorld(t)
	suggestion := uuid.New()
	if _, err := w.commit(w.commenter, w.update(func(tx *crdt.Transaction, root *crdt.YXmlElement) {
		w.text(root).Insert(tx, 5, " text", w.mark("insert", w.commenter, suggestion))
	})); err != nil {
		t.Fatalf("a commenter's insertion: %v", err)
	}

	// Accepting is an edit by an editor: take the mark off.
	receipt, err := w.commit(w.editor, w.update(func(tx *crdt.Transaction, root *crdt.YXmlElement) {
		w.text(root).Format(tx, 5, 5, crdt.Attributes{"suggestion_insert": nil})
	}))
	if err != nil {
		t.Fatalf("an editor accepting a commenter's insertion: %v", err)
	}
	if receipt.BodyVersion != 2 || w.runContent() != "plain text" {
		t.Fatalf("after accepting: version %d, run %q, want 2 and \"plain text\"", receipt.BodyVersion, w.runContent())
	}
	// And an editor edits real text as ever.
	if _, err := w.commit(w.editor, w.update(func(tx *crdt.Transaction, root *crdt.YXmlElement) {
		w.text(root).Insert(tx, 0, ">", crdt.Attributes{})
	})); err != nil {
		t.Fatalf("an editor editing real text: %v", err)
	}
	if w.runContent() != ">plain text" {
		t.Fatalf("run = %q, want \">plain text\"", w.runContent())
	}
}

func TestAViewerStillCannotWrite(t *testing.T) {
	w := newSuggesterWorld(t)
	_, err := w.commit(w.viewer, w.update(func(tx *crdt.Transaction, root *crdt.YXmlElement) {
		w.text(root).Insert(tx, 5, " text", w.mark("insert", w.viewer, uuid.New()))
	}))
	if !errors.Is(err, constant.ErrForbidden) {
		t.Fatalf("a viewer's suggestion = %v, want %v", err, constant.ErrForbidden)
	}
	if len(w.suggestions()) != 0 {
		t.Fatalf("a viewer's suggestion was stored")
	}
}

func TestACommenterCannotPileUpSuggestionsWithoutLimit(t *testing.T) {
	w := newSuggesterWorld(t)
	_, err := w.commit(w.commenter, w.update(func(tx *crdt.Transaction, root *crdt.YXmlElement) {
		w.text(root).Insert(tx, 5, strings.Repeat("a", yjs.MaxSuggestedTextBytesPerUser+1), w.mark("insert", w.commenter, uuid.New()))
	}))
	if !errors.Is(err, collaboration.ErrSuggestionLimit) {
		t.Fatalf("too much suggested text = %v, want %v", err, collaboration.ErrSuggestionLimit)
	}
	if len(w.suggestions()) != 0 {
		t.Fatalf("an over-limit suggestion was stored")
	}
}
