package websocket

import (
	"bufio"
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	appauth "backend/internal/application/auth/dto"
	"backend/internal/application/collaboration"

	"github.com/google/uuid"
	ws "golang.org/x/net/websocket"
)

type testGatewayVerifier struct{ user appauth.ResponseUser }

func (v testGatewayVerifier) VerifyToken(token string) (appauth.ResponseUser, error) {
	if token != "valid-token" {
		return appauth.ResponseUser{}, errors.New("invalid token")
	}
	return v.user, nil
}

type testGatewayReader struct{ snapshot collaboration.BodySnapshot }

func (r testGatewayReader) Read(context.Context, collaboration.Actor, uuid.UUID, uuid.UUID) (collaboration.BodySnapshot, error) {
	return r.snapshot, nil
}

type testGatewayWriter struct {
	mu        sync.Mutex
	committed bool
	actor     collaboration.Actor
	update    collaboration.Update
}

func (w *testGatewayWriter) CommitUpdate(_ context.Context, actor collaboration.Actor, update collaboration.Update) (collaboration.CommitReceipt, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.actor = actor
	w.update = update
	w.committed = true
	return collaboration.CommitReceipt{
		DocumentID: update.DocumentID, UpdateID: update.UpdateID,
		BodyEpoch: update.BodyEpoch, BodyVersion: 2, Changed: true,
	}, nil
}

type testHijackWriter struct {
	header http.Header
	conn   net.Conn
	rw     *bufio.ReadWriter
}

func (w *testHijackWriter) Header() http.Header { return w.header }
func (w *testHijackWriter) WriteHeader(int)     {}
func (w *testHijackWriter) Write(body []byte) (int, error) {
	return w.rw.Write(body)
}
func (w *testHijackWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	return w.conn, w.rw, nil
}

func TestCheckOrigin(t *testing.T) {
	server := &Server{allowedOrigin: "https://docs.example.test"}
	for _, test := range []struct {
		name   string
		origin string
		valid  bool
	}{
		{name: "configured origin", origin: "https://docs.example.test", valid: true},
		{name: "different origin", origin: "https://other.example.test"},
		{name: "origin with path", origin: "https://docs.example.test/elsewhere"},
		{name: "missing origin"},
	} {
		t.Run(test.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", "/", nil)
			if test.origin != "" {
				req.Header.Set("Origin", test.origin)
			}
			_, err := server.checkOrigin(req)
			if (err == nil) != test.valid {
				t.Fatalf("checkOrigin(%q) error = %v, valid = %v", test.origin, err, test.valid)
			}
		})
	}
}

func TestWebSocketAuthSnapshotPingPongAndWriterBeforeAck(t *testing.T) {
	userID, workspaceID, documentID := uuid.New(), uuid.New(), uuid.New()
	writer := &testGatewayWriter{}
	server := NewServer(
		testGatewayVerifier{user: appauth.ResponseUser{ID: userID.String(), Exp: time.Now().Add(time.Hour).Unix()}},
		testGatewayReader{snapshot: collaboration.BodySnapshot{
			BodyVersion: 1, BodyEpoch: 1, BodySchemaVersion: 1, CanEdit: true, EncodedState: []byte("encoded-yjs-state"),
		}},
		writer,
		"https://docs.example.test",
		nil,
	)
	server.heartbeatEvery = 20 * time.Millisecond
	server.heartbeatWait = 250 * time.Millisecond

	clientSide, serverSide := net.Pipe()
	t.Cleanup(func() {
		_ = clientSide.Close()
		_ = serverSide.Close()
	})
	serverRW := bufio.NewReadWriter(bufio.NewReader(serverSide), bufio.NewWriter(serverSide))
	hijack := &testHijackWriter{
		header: make(http.Header), conn: serverSide, rw: serverRW,
	}
	serveDone := make(chan struct{})
	go func() {
		defer close(serveDone)
		request, err := http.ReadRequest(serverRW.Reader)
		if err != nil {
			return
		}
		request = request.WithContext(context.Background())
		request.SetPathValue("id", documentID.String())
		server.ServeHTTP(hijack, request)
	}()

	config, err := ws.NewConfig("ws://example.test/api/v1/collaboration/"+documentID.String(), "https://docs.example.test")
	if err != nil {
		t.Fatalf("NewConfig(): %v", err)
	}
	client, err := ws.NewClient(config, clientSide)
	if err != nil {
		t.Fatalf("WebSocket handshake: %v", err)
	}
	client.PayloadType = ws.TextFrame
	if err := client.SetReadDeadline(time.Now().Add(2 * time.Second)); err != nil {
		t.Fatalf("set client read deadline: %v", err)
	}
	defer func() {
		_ = client.Close()
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		if err := server.Shutdown(ctx); err != nil {
			t.Errorf("Shutdown(): %v", err)
		}
		select {
		case <-serveDone:
		case <-ctx.Done():
			t.Errorf("WebSocket handler did not exit: %v", ctx.Err())
		}
	}()

	if err := ws.JSON.Send(client, clientMessage{Type: "auth", Token: "valid-token", WorkspaceID: workspaceID}); err != nil {
		t.Fatalf("send auth: %v", err)
	}
	var ready serverMessage
	if err := ws.JSON.Receive(client, &ready); err != nil {
		t.Fatalf("receive ready: %v", err)
	}
	if ready.Type != "ready" || ready.BodyVersion != 1 || ready.BodyEpoch != 1 ||
		ready.BodySchemaVersion != 1 || ready.CanEdit == nil || !*ready.CanEdit || string(ready.State) != "encoded-yjs-state" {
		t.Fatalf("ready = %+v, want initial snapshot", ready)
	}
	for range 2 {
		var ping serverMessage
		for {
			if err := ws.JSON.Receive(client, &ping); err != nil {
				t.Fatalf("receive heartbeat ping: %v", err)
			}
			if ping.Type != "presence" {
				break
			}
			ping = serverMessage{}
		}
		if ping.Type != "ping" || ping.PingID == uuid.Nil {
			t.Fatalf("heartbeat = %+v, want ping with ID", ping)
		}
		if err := ws.JSON.Send(client, clientMessage{Type: "pong", PingID: ping.PingID}); err != nil {
			t.Fatalf("send heartbeat pong: %v", err)
		}
	}

	updateID := uuid.New()
	updateBytes := []byte("yjs-update")
	if err := ws.JSON.Send(client, clientMessage{
		Type: "update", UpdateID: updateID, BodyEpoch: 1,
		BodySchemaVersion: 1, Update: updateBytes,
	}); err != nil {
		t.Fatalf("send update: %v", err)
	}
	var ack serverMessage
	if err := ws.JSON.Receive(client, &ack); err != nil {
		t.Fatalf("receive ACK: %v", err)
	}
	if ack.Type != "ack" || ack.UpdateID != updateID || ack.BodyVersion != 2 || ack.BodyEpoch != 1 {
		t.Fatalf("ACK = %+v, want committed update receipt", ack)
	}
	writer.mu.Lock()
	defer writer.mu.Unlock()
	if !writer.committed || writer.actor.UserID != userID || writer.update.UpdateID != updateID || writer.update.DocumentID != documentID ||
		string(writer.update.Bytes) != string(updateBytes) {
		t.Fatalf("writer state = committed:%v actor:%+v update:%+v, want authenticated update passed to writer before ACK", writer.committed, writer.actor, writer.update)
	}
}

func TestEnqueueUpdateAndResyncAfterGap(t *testing.T) {
	peer := &peer{out: make(chan outbound, 2), done: make(chan struct{}), bodyVersion: 1, bodyEpoch: 1}
	snapshot := collaboration.BodySnapshot{BodyVersion: 2, BodyEpoch: 1, BodySchemaVersion: 1, EncodedState: []byte("state-2")}
	first := collaboration.CommitReceipt{DocumentID: uuid.New(), UpdateID: uuid.New(), BodyVersion: 2, BodyEpoch: 1, Changed: true}
	if err := peer.enqueueUpdate(first, 1, []byte("update-2"), snapshot); err != nil {
		t.Fatalf("enqueue contiguous update: %v", err)
	}
	if got := <-peer.out; got.message.Type != "update" || got.message.BodyVersion != 2 {
		t.Fatalf("contiguous message = %+v, want update version 2", got.message)
	}

	gap := collaboration.CommitReceipt{DocumentID: first.DocumentID, UpdateID: uuid.New(), BodyVersion: 4, BodyEpoch: 1, Changed: true}
	snapshot.BodyVersion = 4
	snapshot.EncodedState = []byte("state-4")
	if err := peer.enqueueUpdate(gap, 1, []byte("update-4"), snapshot); err != nil {
		t.Fatalf("enqueue gap recovery: %v", err)
	}
	if got := <-peer.out; got.message.Type != "resync" || got.message.BodyVersion != 4 || string(got.message.State) != "state-4" {
		t.Fatalf("gap message = %+v, want resync at version 4", got.message)
	}
}

func TestEnqueueUpdateResyncsAcrossEpoch(t *testing.T) {
	peer := &peer{out: make(chan outbound, 1), done: make(chan struct{}), bodyVersion: 8, bodyEpoch: 2}
	snapshot := collaboration.BodySnapshot{BodyVersion: 1, BodyEpoch: 3, BodySchemaVersion: 1, EncodedState: []byte("new-epoch")}
	receipt := collaboration.CommitReceipt{DocumentID: uuid.New(), UpdateID: uuid.New(), BodyVersion: 9, BodyEpoch: 2, Changed: true}
	if err := peer.enqueueUpdate(receipt, 1, []byte("old-epoch-update"), snapshot); err != nil {
		t.Fatalf("enqueue old-epoch update: %v", err)
	}
	if got := <-peer.out; got.message.Type != "resync" || got.message.BodyEpoch != 3 {
		t.Fatalf("epoch transition message = %+v, want resync at epoch 3", got.message)
	}
}

func TestEnqueueResyncsWhenEditAccessChangesWithoutBodyChange(t *testing.T) {
	peer := &peer{out: make(chan outbound, 1), done: make(chan struct{}), bodyVersion: 4, bodyEpoch: 2, level: fullEdit}
	snapshot := collaboration.BodySnapshot{
		BodyVersion: 4, BodyEpoch: 2, BodySchemaVersion: 1, CanEdit: false,
		EncodedState: []byte("state-4"),
	}

	peer.enqueueResyncIfAhead(snapshot)
	message := <-peer.out
	if message.message.Type != "resync" || message.message.BodyVersion != 4 || message.message.CanEdit == nil || *message.message.CanEdit {
		t.Fatalf("ACL resync = %+v, want same-version read-only snapshot", message.message)
	}
	if peer.level != readOnly {
		t.Fatal("peer kept its write level after a read-only resync")
	}
}

func TestEnqueueUpdateResyncsSameVersionStateChange(t *testing.T) {
	peer := &peer{out: make(chan outbound, 1), done: make(chan struct{}), bodyVersion: 4, bodyEpoch: 2}
	snapshot := collaboration.BodySnapshot{
		BodyVersion: 4, BodyEpoch: 2, BodySchemaVersion: 1,
		EncodedState: []byte("state-with-new-causal-metadata"),
	}
	receipt := collaboration.CommitReceipt{
		DocumentID: uuid.New(), UpdateID: uuid.New(), BodyVersion: 4, BodyEpoch: 2, Changed: true,
	}

	if err := peer.enqueueUpdate(receipt, 1, []byte("causal-only-update"), snapshot); err != nil {
		t.Fatalf("enqueue same-version state update: %v", err)
	}
	message := <-peer.out
	if message.message.Type != "resync" || string(message.message.State) != string(snapshot.EncodedState) {
		t.Fatalf("same-version state message = %+v, want resync with latest state", message.message)
	}
}

func TestHeartbeatClosesPeerWhenPongIsMissing(t *testing.T) {
	server := &Server{heartbeatEvery: time.Millisecond, heartbeatWait: 10 * time.Millisecond}
	peer := &peer{
		server: server, out: make(chan outbound, 1), done: make(chan struct{}),
		pong: make(chan uuid.UUID, 1),
	}
	go peer.heartbeat(context.Background())

	ping := <-peer.out
	if ping.message.Type != "ping" || ping.message.PingID == uuid.Nil {
		t.Fatalf("heartbeat message = %+v, want ping with ID", ping.message)
	}
	ping.written <- nil
	select {
	case <-peer.done:
	case <-time.After(time.Second):
		t.Fatal("heartbeat left an unresponsive peer connected")
	}
}

func TestPrepareReadyDropsCoveredUpdatesAndKeepsNewerOnes(t *testing.T) {
	peer := &peer{out: make(chan outbound, 2), done: make(chan struct{}), bodyVersion: 1, bodyEpoch: 1}
	for version := int64(2); version <= 3; version++ {
		snapshot := collaboration.BodySnapshot{
			BodyVersion: version, BodyEpoch: 1, BodySchemaVersion: 1,
			EncodedState: []byte{byte(version)},
		}
		receipt := collaboration.CommitReceipt{
			DocumentID: uuid.New(), UpdateID: uuid.New(), BodyVersion: version, BodyEpoch: 1, Changed: true,
		}
		if err := peer.enqueueUpdate(receipt, 1, []byte{byte(version)}, snapshot); err != nil {
			t.Fatalf("enqueue update %d: %v", version, err)
		}
	}

	peer.prepareReady(collaboration.BodySnapshot{BodyVersion: 2, BodyEpoch: 1})
	if len(peer.out) != 1 {
		t.Fatalf("queued messages = %d, want only update beyond snapshot", len(peer.out))
	}
	if got := <-peer.out; got.message.Type != "update" || got.message.BodyVersion != 3 {
		t.Fatalf("queued update after ready = %+v, want update version 3", got.message)
	}
	if peer.bodyVersion != 3 || peer.bodyEpoch != 1 {
		t.Fatalf("cursor after ready = %d/%d, want 3/1", peer.bodyVersion, peer.bodyEpoch)
	}
}

func TestShutdownClosesPeersAndRejectsNewConnections(t *testing.T) {
	server := NewServer(nil, nil, nil, "https://docs.example.test", nil)
	active := &peer{server: server, documentID: uuid.New(), done: make(chan struct{}), out: make(chan outbound, 1)}
	if !server.addPeer(active) {
		t.Fatal("addPeer() rejected connection before shutdown")
	}
	go func() {
		<-active.done
		server.removePeer(active)
	}()

	if err := server.Shutdown(context.Background()); err != nil {
		t.Fatalf("Shutdown(): %v", err)
	}
	if _, open := <-active.done; open {
		t.Fatal("Shutdown() left the peer open")
	}
	if server.addPeer(&peer{documentID: uuid.New()}) {
		t.Fatal("addPeer() accepted a connection after shutdown began")
	}
}
