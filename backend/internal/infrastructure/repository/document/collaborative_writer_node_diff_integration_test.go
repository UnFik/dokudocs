//go:build integration

package document

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"sort"
	"strconv"
	"sync"
	"testing"
	"time"

	"backend/internal/application/collaboration"
	"backend/internal/domain/documentbody"
	"backend/internal/infrastructure/collaboration/yjs"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
	"github.com/reearth/ygo/crdt"
)

type nodeDiffFixture struct {
	db          *sql.DB
	writer      *Repository
	authorID    uuid.UUID
	documentID  uuid.UUID
	body        documentbody.Body
	paragraphs  []uuid.UUID
	runs        []uuid.UUID
	client      *crdt.Doc
	clientState []byte
}

// newNodeDiffFixture seeds a Markdown document with `paragraphCount`
// paragraphs of one run each, plus a Yjs client that has loaded its state.
func newNodeDiffFixture(t *testing.T, paragraphCount int) *nodeDiffFixture {
	t.Helper()
	ctx := context.Background()
	db, err := sql.Open("pgx", integrationDatabaseURL(t))
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	authorID := insertAccessTestUser(t, ctx, db)
	workspaceID, documentID := uuid.New(), uuid.New()
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(), `DELETE FROM workspaces WHERE id = $1`, workspaceID)
		_, _ = db.ExecContext(context.Background(), `DELETE FROM users WHERE id = $1`, authorID)
		_ = db.Close()
	})
	if _, err := db.ExecContext(ctx, `INSERT INTO workspaces (id, name, slug, created_by) VALUES ($1, 'Node diff test', $2, $3)`,
		workspaceID, "node-diff-"+workspaceID.String(), authorID); err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`, workspaceID, authorID); err != nil {
		t.Fatalf("add workspace owner: %v", err)
	}

	rootID := uuid.New()
	body := documentbody.Body{DocumentID: documentID, RootNodeID: rootID}
	body.Nodes = append(body.Nodes, documentbody.Node{
		DocumentID: documentID, NodeID: rootID, Type: "document", Attributes: []byte(`{}`), Version: 1,
	})
	f := &nodeDiffFixture{db: db, authorID: authorID, documentID: documentID}
	for i := 0; i < paragraphCount; i++ {
		paragraphID, runID := uuid.New(), uuid.New()
		f.paragraphs, f.runs = append(f.paragraphs, paragraphID), append(f.runs, runID)
		body.Nodes = append(body.Nodes,
			documentbody.Node{DocumentID: documentID, NodeID: paragraphID, ParentID: &rootID, SiblingOrder: float64(i), Type: "paragraph", Attributes: []byte(`{}`), Version: 1},
			documentbody.Node{DocumentID: documentID, NodeID: runID, ParentID: &paragraphID, SiblingOrder: 0, Type: "run", Content: fmt.Sprintf("paragraph %d", i), Attributes: []byte(`{}`), Version: 1},
		)
	}
	f.body = body
	state, err := yjs.EncodeBodyV1(body)
	if err != nil {
		t.Fatalf("encode body: %v", err)
	}
	if err := seedCollaborativeDocument(ctx, db, workspaceID, documentID, authorID, body, state); err != nil {
		t.Fatalf("seed document: %v", err)
	}
	f.client = crdt.New()
	t.Cleanup(f.client.Destroy)
	if err := crdt.ApplyUpdateV1(f.client, state, nil); err != nil {
		t.Fatalf("load client state: %v", err)
	}
	f.writer = NewRepository(database.NewSQLDB(db))
	return f
}

func (f *nodeDiffFixture) root() *crdt.YXmlElement {
	return f.client.GetXmlFragment("body").Children()[0].(*crdt.YXmlElement)
}

// commit sends everything the client changed inside edit as one update.
func (f *nodeDiffFixture) commit(t *testing.T, edit func(*crdt.Transaction)) collaboration.CommitReceipt {
	t.Helper()
	vector, err := crdt.DecodeStateVectorV1(crdt.EncodeStateVectorV1(f.client))
	if err != nil {
		t.Fatalf("decode state vector: %v", err)
	}
	if err := f.client.TransactE(func(tx *crdt.Transaction) error { edit(tx); return nil }); err != nil {
		t.Fatalf("edit client: %v", err)
	}
	receipt, err := f.writer.CommitUpdate(context.Background(), collaboration.Actor{UserID: f.authorID}, collaboration.Update{
		DocumentID: f.documentID, UpdateID: uuid.New(), BodyEpoch: 1, BodySchemaVersion: 1,
		Bytes: crdt.EncodeStateAsUpdateV1(f.client, vector),
	})
	if err != nil {
		t.Fatalf("CommitUpdate(): %v", err)
	}
	return receipt
}

func (f *nodeDiffFixture) rowVersions(t *testing.T) map[uuid.UUID]string {
	t.Helper()
	rows, err := f.db.QueryContext(context.Background(), `SELECT node_id, xmin::text FROM document_nodes WHERE document_id = $1`, f.documentID)
	if err != nil {
		t.Fatalf("read row versions: %v", err)
	}
	defer rows.Close()
	versions := map[uuid.UUID]string{}
	for rows.Next() {
		var id uuid.UUID
		var xmin string
		if err := rows.Scan(&id, &xmin); err != nil {
			t.Fatal(err)
		}
		versions[id] = xmin
	}
	return versions
}

func (f *nodeDiffFixture) storedBody(t *testing.T) documentbody.Body {
	t.Helper()
	tx := database.NewSQLDB(f.db)
	body, err := loadDocumentBody(context.Background(), tx, f.documentID, f.body.RootNodeID)
	if err != nil {
		t.Fatalf("load stored body: %v", err)
	}
	return body
}

func TestCommitUpdateRewritesOnlyTheNodeRowsThatChanged(t *testing.T) {
	f := newNodeDiffFixture(t, 60)
	before := f.rowVersions(t)

	paragraph := f.root().Children()[30].(*crdt.YXmlElement)
	text := paragraph.Children()[0].(*crdt.YXmlElement).Children()[0].(*crdt.YXmlText)
	receipt := f.commit(t, func(tx *crdt.Transaction) {
		text.Insert(tx, text.Len(), "!", nil)
	})
	if !receipt.Changed || receipt.BodyVersion != 2 {
		t.Fatalf("receipt = %+v, want changed at version 2", receipt)
	}

	after := f.rowVersions(t)
	if len(after) != len(before) {
		t.Fatalf("node count %d -> %d, want unchanged", len(before), len(after))
	}
	var rewritten []uuid.UUID
	for id, xmin := range after {
		if before[id] != xmin {
			rewritten = append(rewritten, id)
		}
	}
	if len(rewritten) != 1 || rewritten[0] != f.runs[30] {
		t.Fatalf("%d rows rewritten (%v), want only the edited run %s", len(rewritten), rewritten[:min(len(rewritten), 3)], f.runs[30])
	}
	stored := f.storedBody(t)
	for _, node := range stored.Nodes {
		if node.NodeID == f.runs[30] && (node.Content != "paragraph 30!" || node.Version != 2) {
			t.Fatalf("edited run = %+v, want content %q at node version 2", node, "paragraph 30!")
		}
	}
}

func TestCommitUpdateInsertsAParagraphInTheMiddleAndShiftsLaterSiblings(t *testing.T) {
	f := newNodeDiffFixture(t, 5)
	newParagraph, newRun := uuid.New(), uuid.New()
	root := f.root()

	f.commit(t, func(tx *crdt.Transaction) {
		paragraph := crdt.NewYXmlElement("paragraph")
		paragraph.SetAttribute(tx, "nodeID", newParagraph.String())
		paragraph.SetAttribute(tx, "bodyAttributes", "{}")
		paragraph.SetAttribute(tx, "bodyContent", "")
		run := crdt.NewYXmlElement("run")
		run.SetAttribute(tx, "nodeID", newRun.String())
		run.SetAttribute(tx, "bodyAttributes", "{}")
		run.SetAttribute(tx, "bodyContent", "")
		text := crdt.NewYXmlText()
		text.Insert(tx, 0, "inserted", nil)
		run.InsertText(tx, 0, text)
		paragraph.InsertElement(tx, 0, run)
		root.InsertElement(tx, 2, paragraph)
	})

	stored := f.storedBody(t)
	var order []uuid.UUID
	siblings := map[uuid.UUID]float64{}
	for _, node := range stored.Nodes {
		if node.ParentID != nil && *node.ParentID == f.body.RootNodeID {
			siblings[node.NodeID] = node.SiblingOrder
		}
	}
	for id := range siblings {
		order = append(order, id)
	}
	// Sort by stored order.
	for i := range order {
		for j := i + 1; j < len(order); j++ {
			if siblings[order[j]] < siblings[order[i]] {
				order[i], order[j] = order[j], order[i]
			}
		}
	}
	want := []uuid.UUID{f.paragraphs[0], f.paragraphs[1], newParagraph, f.paragraphs[2], f.paragraphs[3], f.paragraphs[4]}
	if fmt.Sprint(order) != fmt.Sprint(want) {
		t.Fatalf("root children = %v, want %v", order, want)
	}
	var found bool
	for _, node := range stored.Nodes {
		if node.NodeID == newRun {
			found = node.Content == "inserted"
		}
	}
	if !found {
		t.Fatal("inserted run was not stored with its text")
	}
}

// TestCommitUpdateLatencyReport prints p50/p95 commit latency for a one-character
// edit at several document sizes. Run it with COMMIT_LATENCY=1; the G6 baseline
// and every later measurement come from this test.
func TestCommitUpdateLatencyReport(t *testing.T) {
	if os.Getenv("COMMIT_LATENCY") == "" {
		t.Skip("set COMMIT_LATENCY=1 to print commit latency")
	}
	for _, paragraphs := range []int{100, 1000, 2500, 5000} {
		f := newNodeDiffFixture(t, paragraphs)
		texts := make([]*crdt.YXmlText, paragraphs)
		for i := range texts {
			paragraph := f.root().Children()[i].(*crdt.YXmlElement)
			texts[i] = paragraph.Children()[0].(*crdt.YXmlElement).Children()[0].(*crdt.YXmlText)
		}
		durations := make([]time.Duration, 0, 100)
		for i := 0; i < 100; i++ {
			text := texts[(i*37)%paragraphs]
			start := time.Now()
			f.commit(t, func(tx *crdt.Transaction) { text.Insert(tx, text.Len(), "x", nil) })
			durations = append(durations, time.Since(start))
		}
		sort.Slice(durations, func(i, j int) bool { return durations[i] < durations[j] })
		t.Logf("LATENCY nodes=%d p50=%v p95=%v max=%v", paragraphs*2+1, durations[len(durations)/2], durations[len(durations)*95/100], durations[len(durations)-1])
	}
}

// TestCommitUpdateUnderConcurrentWritersKeepsEveryEditAndEveryVersion is the G6
// load gate. Each writer is a separate Yjs client editing its own paragraph.
// By default it is a small smoke run; COMMIT_LOAD=1 runs the gate itself:
// 2,000 nodes, 10 writers, 2 commits per second each, p95 <= 200 ms.
func TestCommitUpdateUnderConcurrentWritersKeepsEveryEditAndEveryVersion(t *testing.T) {
	writers, commitsPerWriter, paragraphs, interval := 4, 5, 100, 20*time.Millisecond
	gate := os.Getenv("COMMIT_LOAD") != ""
	if gate {
		writers, commitsPerWriter, paragraphs, interval = 10, 20, 1000, 500*time.Millisecond
		// COMMIT_LOAD_PARAGRAPHS sizes the document for the sizing runs in ADR 0023.
		if raw := os.Getenv("COMMIT_LOAD_PARAGRAPHS"); raw != "" {
			if n, err := strconv.Atoi(raw); err == nil && n >= writers {
				paragraphs = n - n%writers
			}
		}
	}
	f := newNodeDiffFixture(t, paragraphs)
	ctx := context.Background()
	initial, err := readCollaborationState(ctx, f.db, f.documentID)
	if err != nil {
		t.Fatalf("read initial state: %v", err)
	}

	type writer struct {
		doc    *crdt.Doc
		text   *crdt.YXmlText
		runID  uuid.UUID
		edited int
	}
	clients := make([]*writer, writers)
	for i := range clients {
		doc := crdt.New()
		t.Cleanup(doc.Destroy)
		if err := crdt.ApplyUpdateV1(doc, initial, nil); err != nil {
			t.Fatalf("load writer %d state: %v", i, err)
		}
		index := i * (paragraphs / writers)
		root := doc.GetXmlFragment("body").Children()[0].(*crdt.YXmlElement)
		paragraph := root.Children()[index].(*crdt.YXmlElement)
		clients[i] = &writer{
			doc:   doc,
			text:  paragraph.Children()[0].(*crdt.YXmlElement).Children()[0].(*crdt.YXmlText),
			runID: f.runs[index],
		}
	}

	var mu sync.Mutex
	var durations []time.Duration
	var failures []error
	var wg sync.WaitGroup
	started := time.Now()
	for i, w := range clients {
		wg.Add(1)
		go func(i int, w *writer) {
			defer wg.Done()
			// Editors do not type in lockstep: spread their first commit across
			// one interval so the run measures steady load, not a synchronized
			// burst of every writer at t=0.
			time.Sleep(time.Duration(i) * interval / time.Duration(writers))
			for n := 0; n < commitsPerWriter; n++ {
				vector, err := crdt.DecodeStateVectorV1(crdt.EncodeStateVectorV1(w.doc))
				if err == nil {
					err = w.doc.TransactE(func(tx *crdt.Transaction) error { w.text.Insert(tx, w.text.Len(), "x", nil); return nil })
				}
				var update []byte
				if err == nil {
					update = crdt.EncodeStateAsUpdateV1(w.doc, vector)
				}
				begin := time.Now()
				if err == nil {
					_, err = f.writer.CommitUpdate(ctx, collaboration.Actor{UserID: f.authorID}, collaboration.Update{
						DocumentID: f.documentID, UpdateID: uuid.New(), BodyEpoch: 1, BodySchemaVersion: 1, Bytes: update,
					})
				}
				mu.Lock()
				if err != nil {
					failures = append(failures, err)
				} else {
					durations = append(durations, time.Since(begin))
					w.edited++
				}
				mu.Unlock()
				time.Sleep(interval)
			}
		}(i, w)
	}
	wg.Wait()
	elapsed := time.Since(started)
	if len(failures) > 0 {
		t.Fatalf("%d commits failed, first: %v", len(failures), failures[0])
	}

	total := writers * commitsPerWriter
	var bodyVersion int64
	if err := f.db.QueryRowContext(ctx, `SELECT body_version FROM documents WHERE id = $1`, f.documentID).Scan(&bodyVersion); err != nil {
		t.Fatalf("read body version: %v", err)
	}
	if bodyVersion != int64(1+total) {
		t.Fatalf("body_version = %d after %d commits, want %d (a version was skipped or an edit lost)", bodyVersion, total, 1+total)
	}
	stored := f.storedBody(t)
	for _, w := range clients {
		for _, node := range stored.Nodes {
			if node.NodeID == w.runID && len(node.Content)-len(fmt.Sprintf("paragraph %d", 0)) < commitsPerWriter-1 {
				t.Fatalf("run %s content %q is missing some of its %d edits", w.runID, node.Content, commitsPerWriter)
			}
		}
	}

	sort.Slice(durations, func(i, j int) bool { return durations[i] < durations[j] })
	p50, p95 := durations[len(durations)/2], durations[len(durations)*95/100]
	t.Logf("LOAD nodes=%d writers=%d commits=%d in %v (%.1f/s) p50=%v p95=%v max=%v",
		paragraphs*2+1, writers, total, elapsed.Round(time.Millisecond), float64(total)/elapsed.Seconds(), p50, p95, durations[len(durations)-1])
	if gate && p95 > 200*time.Millisecond {
		t.Fatalf("p95 commit latency %v exceeds the 200 ms G6 gate", p95)
	}
}

// TestCommitUpdateProfileRun commits many one-character edits to a 2,001-node
// document so a CPU profile (-cpuprofile) shows where commit time goes.
// Run with COMMIT_PROFILE=1.
func TestCommitUpdateProfileRun(t *testing.T) {
	if os.Getenv("COMMIT_PROFILE") == "" {
		t.Skip("set COMMIT_PROFILE=1 to run the profiling loop")
	}
	const paragraphs = 1000
	f := newNodeDiffFixture(t, paragraphs)
	texts := make([]*crdt.YXmlText, paragraphs)
	for i := range texts {
		paragraph := f.root().Children()[i].(*crdt.YXmlElement)
		texts[i] = paragraph.Children()[0].(*crdt.YXmlElement).Children()[0].(*crdt.YXmlText)
	}
	durations := make([]time.Duration, 0, 400)
	for i := 0; i < 400; i++ {
		text := texts[(i*37)%paragraphs]
		start := time.Now()
		f.commit(t, func(tx *crdt.Transaction) { text.Insert(tx, text.Len(), "x", nil) })
		durations = append(durations, time.Since(start))
	}
	sort.Slice(durations, func(i, j int) bool { return durations[i] < durations[j] })
	t.Logf("PROFILE nodes=%d p50=%v p95=%v", paragraphs*2+1, durations[len(durations)/2], durations[len(durations)*95/100])
}
