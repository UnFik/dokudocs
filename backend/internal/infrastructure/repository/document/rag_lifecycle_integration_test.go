//go:build integration

package document

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"strconv"
	"testing"
	"time"

	"backend/internal/domain/documentbody"
	"backend/internal/infrastructure/collaboration/yjs"
	"backend/internal/infrastructure/database"
	workspacerepo "backend/internal/infrastructure/repository/workspace"

	"github.com/google/uuid"
)

const lifecycleProvider, lifecycleModel = "fake", "lifecycle-v1"

type ragLifecycleFixture struct {
	t           *testing.T
	ctx         context.Context
	db          *sql.DB
	repo        *Repository
	owner       uuid.UUID
	reader      uuid.UUID
	workspaceID uuid.UUID
}

func newRAGLifecycleFixture(t *testing.T) *ragLifecycleFixture {
	t.Helper()
	ctx := context.Background()
	db, err := sql.Open("pgx", integrationDatabaseURL(t))
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	f := &ragLifecycleFixture{t: t, ctx: ctx, db: db, repo: NewRepository(database.NewSQLDB(db)),
		owner: insertAccessTestUser(t, ctx, db), reader: insertAccessTestUser(t, ctx, db), workspaceID: uuid.New()}
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(), `DELETE FROM workspaces WHERE id = $1`, f.workspaceID)
		_, _ = db.ExecContext(context.Background(), `DELETE FROM users WHERE id = ANY($1)`, fmt.Sprintf("{%s,%s}", f.owner, f.reader))
		_ = db.Close()
	})
	f.exec(`INSERT INTO workspaces (id, name, slug, created_by) VALUES ($1, 'RAG lifecycle', $2, $3)`, f.workspaceID, "rag-life-"+f.workspaceID.String(), f.owner)
	f.exec(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner'), ($1, $3, 'member')`, f.workspaceID, f.owner, f.reader)
	return f
}

func (f *ragLifecycleFixture) exec(query string, args ...any) {
	f.t.Helper()
	if _, err := f.db.ExecContext(f.ctx, query, args...); err != nil {
		f.t.Fatalf("%s: %v", query, err)
	}
}

func (f *ragLifecycleFixture) count(query string, args ...any) int {
	f.t.Helper()
	var n int
	if err := f.db.QueryRowContext(f.ctx, query, args...).Scan(&n); err != nil {
		f.t.Fatalf("%s: %v", query, err)
	}
	return n
}

// newDocument seeds one Markdown document whose single paragraph contains text.
func (f *ragLifecycleFixture) newDocument(title, visibility, text string) uuid.UUID {
	f.t.Helper()
	documentID, rootID, paragraphID, runID := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	body := documentbody.Body{DocumentID: documentID, RootNodeID: rootID, Nodes: []documentbody.Node{
		{DocumentID: documentID, NodeID: rootID, Type: "document", Attributes: []byte(`{}`), Version: 1},
		{DocumentID: documentID, NodeID: paragraphID, ParentID: &rootID, Type: "paragraph", Attributes: []byte(`{}`), Version: 1},
		{DocumentID: documentID, NodeID: runID, ParentID: &paragraphID, Type: "run", Content: text, Attributes: []byte(`{}`), Version: 1},
	}}
	state, err := yjs.EncodeBodyV1(body)
	if err != nil {
		f.t.Fatalf("encode body: %v", err)
	}
	if err := seedCollaborativeDocument(f.ctx, f.db, f.workspaceID, documentID, f.owner, body, state); err != nil {
		f.t.Fatalf("seed document: %v", err)
	}
	f.exec(`UPDATE documents SET title = $2, visibility = $3::document_visibility WHERE id = $1`, documentID, title, visibility)
	return documentID
}

// indexWithEmbeddings is one complete worker pass: rebuild, then embed every pending chunk.
func (f *ragLifecycleFixture) indexWithEmbeddings() {
	f.t.Helper()
	for {
		rebuilt, err := f.repo.RebuildStaleRAGIndexes(f.ctx, 100)
		if err != nil {
			f.t.Fatalf("rebuild stale indexes: %v", err)
		}
		if rebuilt == 0 {
			break
		}
	}
	for {
		pending, err := f.repo.ListRAGChunksMissingEmbeddings(f.ctx, lifecycleProvider, lifecycleModel, 32)
		if err != nil {
			f.t.Fatalf("list missing embeddings: %v", err)
		}
		if len(pending) == 0 {
			return
		}
		embeddings := make([]RAGChunkEmbedding, len(pending))
		for i, chunk := range pending {
			vector := make([]float32, 1536)
			vector[0] = 1
			embeddings[i] = RAGChunkEmbedding{ChunkID: chunk.ChunkID, DocumentID: chunk.DocumentID, BodyVersion: chunk.BodyVersion, SourceFingerprint: chunk.SourceFingerprint, Vector: vector}
		}
		if err := f.repo.StoreRAGChunkEmbeddings(f.ctx, lifecycleProvider, lifecycleModel, embeddings); err != nil {
			f.t.Fatalf("store embeddings: %v", err)
		}
	}
}

func (f *ragLifecycleFixture) canRetrieve(actor, documentID uuid.UUID, query string) bool {
	f.t.Helper()
	vector := make([]float32, 1536)
	vector[0] = 1
	chunks, err := f.repo.SearchRAGChunksWithEmbedding(f.ctx, f.workspaceID, actor, query, vector, lifecycleProvider, lifecycleModel, 20, nil)
	if err != nil {
		f.t.Fatalf("search: %v", err)
	}
	for _, chunk := range chunks {
		if chunk.DocumentID == documentID {
			return true
		}
	}
	return false
}

func (f *ragLifecycleFixture) derivedRows(documentID uuid.UUID) (indexes, chunks, embeddings int) {
	return f.count(`SELECT COUNT(*) FROM rag_document_indexes WHERE document_id = $1`, documentID),
		f.count(`SELECT COUNT(*) FROM rag_chunks WHERE document_id = $1`, documentID),
		f.count(`SELECT COUNT(*) FROM rag_embeddings e JOIN rag_chunks c ON c.chunk_id = e.chunk_id WHERE c.document_id = $1`, documentID)
}

// ACL and lifecycle changes do not bump body_version, so retrieval must react
// immediately while the derived rows follow the document's own lifetime.
func TestRAGLifecycleMatrixOrdersRetrievalAgainstIndexRows(t *testing.T) {
	f := newRAGLifecycleFixture(t)
	const query = "quartz vault"
	const text = "The quartz vault opens at dawn."

	t.Run("revoking a direct grant hides the source at once and keeps the index", func(t *testing.T) {
		id := f.newDocument("Revoke", "private", text)
		f.exec(`INSERT INTO document_accesses (document_id, user_id, access_level) VALUES ($1, $2, 'view')`, id, f.reader)
		f.indexWithEmbeddings()
		if !f.canRetrieve(f.reader, id, query) {
			t.Fatal("granted reader cannot retrieve the source before revocation")
		}
		if err := f.repo.RemoveAccess(f.ctx, id, f.workspaceID, f.owner, f.reader); err != nil {
			t.Fatalf("revoke access: %v", err)
		}
		if f.canRetrieve(f.reader, id, query) {
			t.Fatal("revoked reader still retrieves the source without any reindex")
		}
		if !f.canRetrieve(f.owner, id, query) {
			t.Fatal("owner lost retrieval after revoking another user")
		}
		if i, c, e := f.derivedRows(id); i != 1 || c == 0 || e == 0 {
			t.Fatalf("derived rows after revoke = %d/%d/%d, want the index kept", i, c, e)
		}
	})

	t.Run("trash hides, restore returns the source, hard delete removes derived rows", func(t *testing.T) {
		id := f.newDocument("Trash", "workspace", text)
		f.indexWithEmbeddings()
		if !f.canRetrieve(f.reader, id, query) {
			t.Fatal("reader cannot retrieve a workspace document before trash")
		}
		if err := f.repo.SoftDelete(f.ctx, id, f.workspaceID, f.owner); err != nil {
			t.Fatalf("trash: %v", err)
		}
		if f.canRetrieve(f.reader, id, query) || f.canRetrieve(f.owner, id, query) {
			t.Fatal("trashed document is still retrievable before the index is cleaned")
		}
		if i, c, _ := f.derivedRows(id); i != 1 || c == 0 {
			t.Fatalf("derived rows while trashed = %d/%d, want kept for restore", i, c)
		}
		if err := f.repo.Restore(f.ctx, id, f.workspaceID, f.owner); err != nil {
			t.Fatalf("restore: %v", err)
		}
		if !f.canRetrieve(f.reader, id, query) {
			t.Fatal("restored document is not retrievable again")
		}
		if err := f.repo.SoftDelete(f.ctx, id, f.workspaceID, f.owner); err != nil {
			t.Fatalf("trash again: %v", err)
		}
		if err := f.repo.PermanentDelete(f.ctx, id, f.workspaceID, f.owner); err != nil {
			t.Fatalf("hard delete: %v", err)
		}
		if i, c, e := f.derivedRows(id); i != 0 || c != 0 || e != 0 {
			t.Fatalf("derived rows after hard delete = %d/%d/%d, want none", i, c, e)
		}
	})

	t.Run("leaving the workspace hides every source from that member", func(t *testing.T) {
		id := f.newDocument("Member", "workspace", text)
		f.indexWithEmbeddings()
		f.exec(`DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`, f.workspaceID, f.reader)
		defer f.exec(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'member')`, f.workspaceID, f.reader)
		if f.canRetrieve(f.reader, id, query) {
			t.Fatal("removed member still retrieves a workspace source")
		}
	})

	t.Run("renaming makes the source unretrievable until reindexed", func(t *testing.T) {
		id := f.newDocument("Before", "workspace", text)
		f.indexWithEmbeddings()
		f.exec(`UPDATE documents SET title = 'After' WHERE id = $1`, id)
		if f.canRetrieve(f.reader, id, query) {
			t.Fatal("source with a stale title fingerprint is retrievable")
		}
		f.indexWithEmbeddings()
		if !f.canRetrieve(f.reader, id, query) {
			t.Fatal("source is not retrievable after the rename was reindexed")
		}
	})

	t.Run("workspace deletion removes documents, chunks and embeddings", func(t *testing.T) {
		other := newRAGLifecycleFixture(t)
		id := other.newDocument("Doomed", "workspace", text)
		other.indexWithEmbeddings()
		if err := workspacerepo.NewRepository(database.NewSQLDB(other.db)).Delete(other.ctx, other.workspaceID, other.owner); err != nil {
			t.Fatalf("delete workspace: %v", err)
		}
		if i, c, e := other.derivedRows(id); i != 0 || c != 0 || e != 0 {
			t.Fatalf("derived rows after workspace delete = %d/%d/%d, want none", i, c, e)
		}
	})
}

// TestRAGIndexRecoveryTime measures the DB-side time for the worker to bring a
// workspace back to fully retrievable after every document changed. It uses a
// deterministic embedder, so provider latency and rate limits are NOT included.
func TestRAGIndexRecoveryTime(t *testing.T) {
	docs := 200
	if v, err := strconv.Atoi(os.Getenv("RAG_RECOVERY_DOCS")); err == nil && v > 0 {
		docs = v
	}
	f := newRAGLifecycleFixture(t)
	ids := make([]uuid.UUID, docs)
	for i := range ids {
		ids[i] = f.newDocument(fmt.Sprintf("Doc %d", i), "workspace", fmt.Sprintf("Paragraph %d about the quartz vault.", i))
	}
	f.indexWithEmbeddings()
	f.exec(`UPDATE documents SET title = title || ' renamed' WHERE workspace_id = $1`, f.workspaceID)

	start := time.Now()
	f.indexWithEmbeddings()
	elapsed := time.Since(start)
	t.Logf("recovered %d documents in %s (DB-side, fake embedder)", docs, elapsed)

	stale, err := f.repo.HasStaleReadableRAGIndex(f.ctx, f.workspaceID, f.reader, nil, lifecycleProvider, lifecycleModel)
	if err != nil || stale {
		t.Fatalf("stale index after recovery = %v, error = %v, want fully recovered", stale, err)
	}
	if elapsed > time.Minute {
		t.Fatalf("recovery took %s, want at most one minute", elapsed)
	}
}
