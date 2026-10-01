//go:build integration

package document

import (
	"context"
	"database/sql"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"backend/internal/application/collaboration"
	"backend/internal/domain/documentbody"
	"backend/internal/infrastructure/collaboration/redisfanout"
	"backend/internal/infrastructure/collaboration/websocket"
	"backend/internal/infrastructure/collaboration/yjs"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
	"github.com/reearth/ygo/crdt"
	ws "golang.org/x/net/websocket"
)

// redisOutageProxy sits between the servers and Redis so a test can take Redis
// away (refuse connections, drop live ones) and bring it back on the same port.
type redisOutageProxy struct {
	target string
	addr   string
	mu     sync.Mutex
	ln     net.Listener
	conns  map[net.Conn]struct{}
}

func newRedisOutageProxy(t *testing.T, target string) *redisOutageProxy {
	t.Helper()
	p := &redisOutageProxy{target: target, conns: map[net.Conn]struct{}{}}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen for Redis proxy: %v", err)
	}
	p.addr = ln.Addr().String()
	p.serve(ln)
	t.Cleanup(p.outage)
	return p
}

func (p *redisOutageProxy) serve(ln net.Listener) {
	p.mu.Lock()
	p.ln = ln
	p.mu.Unlock()
	go func() {
		for {
			client, err := ln.Accept()
			if err != nil {
				return
			}
			upstream, err := net.Dial("tcp", p.target)
			if err != nil {
				_ = client.Close()
				continue
			}
			p.mu.Lock()
			p.conns[client], p.conns[upstream] = struct{}{}, struct{}{}
			p.mu.Unlock()
			go func() { _, _ = io.Copy(upstream, client); _ = upstream.Close() }()
			go func() { _, _ = io.Copy(client, upstream); _ = client.Close() }()
		}
	}()
}

func (p *redisOutageProxy) outage() {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.ln != nil {
		_ = p.ln.Close()
		p.ln = nil
	}
	for c := range p.conns {
		_ = c.Close()
		delete(p.conns, c)
	}
}

func (p *redisOutageProxy) restore(t *testing.T) {
	t.Helper()
	var ln net.Listener
	var err error
	for i := 0; i < 50; i++ {
		if ln, err = net.Listen("tcp", p.addr); err == nil {
			p.serve(ln)
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("restore Redis proxy on %s: %v", p.addr, err)
}

// A Redis outage must not cost an acknowledged edit: the origin ACK means
// "durable in PostgreSQL", fan-out is best effort, and a peer that missed the
// publish converges again from PostgreSQL once Redis is back.
func TestRedisOutageKeepsAcknowledgedEditsAndPeersConvergeAfterRecovery(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("pgx", integrationDatabaseURL(t))
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	ownerID, viewerID := insertAccessTestUser(t, ctx, db), insertAccessTestUser(t, ctx, db)
	workspaceID, documentID := uuid.New(), uuid.New()
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(), `DELETE FROM workspaces WHERE id = $1`, workspaceID)
		_, _ = db.ExecContext(context.Background(), `DELETE FROM users WHERE id = $1`, ownerID)
		_, _ = db.ExecContext(context.Background(), `DELETE FROM users WHERE id = $1`, viewerID)
		_ = db.Close()
	})
	if _, err := db.ExecContext(ctx, `INSERT INTO workspaces (id, name, slug, created_by) VALUES ($1, 'Redis outage', $2, $3)`,
		workspaceID, "outage-"+workspaceID.String(), ownerID); err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	for _, m := range []struct {
		id   uuid.UUID
		role string
	}{{ownerID, "owner"}, {viewerID, "member"}} {
		if _, err := db.ExecContext(ctx, `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)`,
			workspaceID, m.id, m.role); err != nil {
			t.Fatalf("create membership: %v", err)
		}
	}
	rootID, paragraphID, runID := uuid.New(), uuid.New(), uuid.New()
	body := documentbody.Body{DocumentID: documentID, RootNodeID: rootID, Nodes: []documentbody.Node{
		{DocumentID: documentID, NodeID: rootID, Type: "document", Attributes: []byte(`{}`), Version: 1},
		{DocumentID: documentID, NodeID: paragraphID, ParentID: &rootID, SiblingOrder: 1, Type: "paragraph", Attributes: []byte(`{}`), Version: 1},
		{DocumentID: documentID, NodeID: runID, ParentID: &paragraphID, SiblingOrder: 1, Type: "run", Content: "alpha", Attributes: []byte(`{}`), Version: 1},
	}}
	state, err := yjs.EncodeBodyV1(body)
	if err != nil {
		t.Fatalf("encode initial body: %v", err)
	}
	if err := seedCollaborativeDocument(ctx, db, workspaceID, documentID, ownerID, body, state); err != nil {
		t.Fatalf("seed document: %v", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO document_accesses (document_id, user_id, access_level) VALUES ($1, $2, 'view')`,
		documentID, viewerID); err != nil {
		t.Fatalf("grant viewer access: %v", err)
	}

	redisURL, err := url.Parse(integrationRedisURL(t))
	if err != nil {
		t.Fatalf("parse TEST_REDIS_URL: %v", err)
	}
	proxy := newRedisOutageProxy(t, redisURL.Host)
	repository := NewRepository(database.NewSQLDB(db))
	bodyReader := collaboration.NewBodyReadUseCase(repository)
	verifier := integrationWebSocketVerifier{"owner-token": ownerID, "viewer-token": viewerID}
	newServer := func() (*websocket.Server, *httptest.Server) {
		broker, err := redisfanout.New("redis://" + proxy.addr)
		if err != nil {
			t.Fatalf("create Redis broker: %v", err)
		}
		server := websocket.NewServer(verifier, bodyReader, repository, integrationOrigin, broker)
		mux := http.NewServeMux()
		mux.Handle("GET /api/v1/collaboration/{id}", server)
		return server, httptest.NewServer(mux)
	}
	serverA, httpA := newServer()
	serverB, httpB := newServer()
	t.Cleanup(func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = serverA.Shutdown(shutdownCtx)
		_ = serverB.Shutdown(shutdownCtx)
		httpA.Close()
		httpB.Close()
	})
	dial := func(httpServer *httptest.Server, token string) *ws.Conn {
		t.Helper()
		conn, ready := dialWebSocketProcess(t, strings.TrimPrefix(httpServer.URL, "http://"), workspaceID, documentID, token)
		if ready.Type != "ready" {
			t.Fatalf("ready = %+v", ready)
		}
		return conn
	}
	ownerSocket := dial(httpA, "owner-token")
	defer ownerSocket.Close()
	viewerSocket := dial(httpB, "viewer-token")
	defer viewerSocket.Close()

	clientDoc := crdt.New()
	defer clientDoc.Destroy()
	if err := crdt.ApplyUpdateV1(clientDoc, state, nil); err != nil {
		t.Fatalf("load client Yjs state: %v", err)
	}
	root := clientDoc.GetXmlFragment("body").Children()[0].(*crdt.YXmlElement)
	paragraph := root.Children()[0].(*crdt.YXmlElement)
	run := paragraph.Children()[0].(*crdt.YXmlElement)
	text := run.Children()[0].(*crdt.YXmlText)
	edit := func(suffix string) []byte {
		before, err := crdt.DecodeStateVectorV1(crdt.EncodeStateVectorV1(clientDoc))
		if err != nil {
			t.Fatalf("capture state vector: %v", err)
		}
		at := len(text.ToString())
		clientDoc.Transact(func(tx *crdt.Transaction) { text.Insert(tx, at, suffix, nil) })
		return crdt.EncodeStateAsUpdateV1(clientDoc, before)
	}

	proxy.outage()
	outageStart := time.Now()
	updateID := uuid.New()
	if err := sendWebSocketUpdate(ownerSocket, updateID, edit(" during-outage")); err != nil {
		t.Fatalf("send update during outage: %v", err)
	}
	ack := readWebSocketFrame(t, ownerSocket)
	if ack.Type != "ack" || ack.UpdateID != updateID || ack.BodyVersion != 2 {
		t.Fatalf("ACK during Redis outage = %+v, want durable version 2", ack)
	}
	t.Logf("ACK during outage after %s", time.Since(outageStart).Round(time.Millisecond))
	committed, err := repository.ReadBody(ctx, collaboration.Actor{UserID: ownerID}, workspaceID, documentID)
	if err != nil || committed.BodyVersion != 2 || bodyNodeContent(committed.Body, runID) != "alpha during-outage" {
		t.Fatalf("PostgreSQL during outage = version %d err %v, want the acknowledged edit", committed.BodyVersion, err)
	}

	proxy.restore(t)
	restoredAt := time.Now()
	if err := viewerSocket.SetReadDeadline(time.Now().Add(30 * time.Second)); err != nil {
		t.Fatalf("set deadline: %v", err)
	}
	for {
		var frame integrationWebSocketFrame
		if err := ws.JSON.Receive(viewerSocket, &frame); err != nil {
			t.Fatalf("viewer never converged after Redis returned: %v", err)
		}
		if (frame.Type == "resync" || frame.Type == "update") && frame.BodyVersion == 2 {
			t.Logf("viewer converged %s after Redis returned (type %s)", time.Since(restoredAt).Round(time.Millisecond), frame.Type)
			break
		}
	}

	// Fan-out works again without a manual restart once Redis is back.
	var fanned bool
	for attempt := 0; attempt < 20 && !fanned; attempt++ {
		time.Sleep(250 * time.Millisecond)
		id := uuid.New()
		version := int64(3 + attempt)
		if err := sendWebSocketUpdate(ownerSocket, id, edit(".")); err != nil {
			t.Fatalf("send update after recovery: %v", err)
		}
		ack := readWebSocketFrame(t, ownerSocket)
		for ack.Type == "resync" {
			ack = readWebSocketFrame(t, ownerSocket)
		}
		if ack.Type != "ack" || ack.BodyVersion != version {
			t.Fatalf("ACK after recovery = type %q version %d, want ack at version %d", ack.Type, ack.BodyVersion, version)
		}
		_ = viewerSocket.SetReadDeadline(time.Now().Add(1500 * time.Millisecond))
		var frame integrationWebSocketFrame
		if err := ws.JSON.Receive(viewerSocket, &frame); err == nil && frame.Type == "update" && frame.UpdateID == id {
			fanned = true
		}
	}
	if !fanned {
		t.Fatal("live fan-out did not resume after Redis returned")
	}
}
