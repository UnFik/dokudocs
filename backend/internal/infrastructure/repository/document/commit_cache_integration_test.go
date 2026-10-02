//go:build integration

package document

import (
	"context"
	"testing"

	"backend/internal/application/collaboration"
	"backend/internal/infrastructure/collaboration/yjs"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
	"github.com/reearth/ygo/crdt"
)

// yjsClient is one editor with its own copy of the document.
type yjsClient struct {
	doc *crdt.Doc
}

func newYjsClient(t *testing.T, f *nodeDiffFixture) *yjsClient {
	t.Helper()
	state, err := readCollaborationState(context.Background(), f.db, f.documentID)
	if err != nil {
		t.Fatalf("read state: %v", err)
	}
	doc := crdt.New()
	t.Cleanup(doc.Destroy)
	if err := crdt.ApplyUpdateV1(doc, state, nil); err != nil {
		t.Fatalf("load state: %v", err)
	}
	return &yjsClient{doc: doc}
}

func (c *yjsClient) runText(paragraph int) *crdt.YXmlText {
	root := c.doc.GetXmlFragment("body").Children()[0].(*crdt.YXmlElement)
	return root.Children()[paragraph].(*crdt.YXmlElement).Children()[0].(*crdt.YXmlElement).Children()[0].(*crdt.YXmlText)
}

func (c *yjsClient) update(t *testing.T, edit func(*crdt.Transaction)) []byte {
	t.Helper()
	vector, err := crdt.DecodeStateVectorV1(crdt.EncodeStateVectorV1(c.doc))
	if err != nil {
		t.Fatal(err)
	}
	if err := c.doc.TransactE(func(tx *crdt.Transaction) error { edit(tx); return nil }); err != nil {
		t.Fatal(err)
	}
	return crdt.EncodeStateAsUpdateV1(c.doc, vector)
}

func commitWith(t *testing.T, repo *Repository, f *nodeDiffFixture, update []byte) error {
	t.Helper()
	_, err := repo.CommitUpdate(context.Background(), collaboration.Actor{UserID: f.authorID}, collaboration.Update{
		DocumentID: f.documentID, UpdateID: uuid.New(), BodyEpoch: 1, BodySchemaVersion: 1, Bytes: update,
	})
	return err
}

func runContent(t *testing.T, f *nodeDiffFixture, runID uuid.UUID) string {
	t.Helper()
	for _, node := range f.storedBody(t).Nodes {
		if node.NodeID == runID {
			return node.Content
		}
	}
	return ""
}

func TestCommitUpdateOnOneInstanceSeesCommitsMadeByAnother(t *testing.T) {
	f := newNodeDiffFixture(t, 3)
	instanceA := NewRepository(database.NewSQLDB(f.db))
	instanceB := NewRepository(database.NewSQLDB(f.db))
	x, y := newYjsClient(t, f), newYjsClient(t, f)

	text := x.runText(0)
	if err := commitWith(t, instanceA, f, x.update(t, func(tx *crdt.Transaction) { text.Insert(tx, text.Len(), " a1", nil) })); err != nil {
		t.Fatalf("first commit on A: %v", err)
	}
	other := y.runText(1)
	if err := commitWith(t, instanceB, f, y.update(t, func(tx *crdt.Transaction) { other.Insert(tx, other.Len(), " b1", nil) })); err != nil {
		t.Fatalf("commit on B: %v", err)
	}
	if err := commitWith(t, instanceA, f, x.update(t, func(tx *crdt.Transaction) { text.Insert(tx, text.Len(), " a2", nil) })); err != nil {
		t.Fatalf("second commit on A: %v", err)
	}

	if got := runContent(t, f, f.runs[0]); got != "paragraph 0 a1 a2" {
		t.Fatalf("run 0 = %q, want both edits from A", got)
	}
	if got := runContent(t, f, f.runs[1]); got != "paragraph 1 b1" {
		t.Fatalf("run 1 = %q, want B's edit kept after A committed again", got)
	}
	state, err := readCollaborationState(context.Background(), f.db, f.documentID)
	if err != nil {
		t.Fatal(err)
	}
	projected, err := yjs.ProjectV1(state, f.documentID)
	if err != nil {
		t.Fatal(err)
	}
	for _, node := range projected.Nodes {
		if node.NodeID == f.runs[1] && node.Content != "paragraph 1 b1" {
			t.Fatalf("stored Yjs state run 1 = %q, want B's edit kept", node.Content)
		}
	}
}

func TestCommitUpdateRejectedEditDoesNotAffectTheNextCommit(t *testing.T) {
	f := newNodeDiffFixture(t, 3)
	repo := NewRepository(database.NewSQLDB(f.db))
	good, bad := newYjsClient(t, f), newYjsClient(t, f)

	text := good.runText(0)
	if err := commitWith(t, repo, f, good.update(t, func(tx *crdt.Transaction) { text.Insert(tx, text.Len(), " ok1", nil) })); err != nil {
		t.Fatalf("first commit: %v", err)
	}
	root := bad.doc.GetXmlFragment("body").Children()[0].(*crdt.YXmlElement)
	if err := commitWith(t, repo, f, bad.update(t, func(tx *crdt.Transaction) { root.Delete(tx, 2, 1) })); err == nil {
		t.Fatal("deleting an existing paragraph through Yjs was accepted, want it rejected")
	}
	if err := commitWith(t, repo, f, good.update(t, func(tx *crdt.Transaction) { text.Insert(tx, text.Len(), " ok2", nil) })); err != nil {
		t.Fatalf("commit after a rejected edit: %v", err)
	}

	if got := runContent(t, f, f.runs[0]); got != "paragraph 0 ok1 ok2" {
		t.Fatalf("run 0 = %q, want both accepted edits", got)
	}
	if got := runContent(t, f, f.runs[2]); got != "paragraph 2" {
		t.Fatalf("run 2 = %q, want the paragraph the rejected edit deleted to still exist", got)
	}
}
