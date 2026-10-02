//go:build integration

package document

import (
	"bufio"
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	appauth "backend/internal/application/auth/dto"
	"backend/internal/application/collaboration"
	"backend/internal/domain/documentbody"
	"backend/internal/infrastructure/collaboration/redisfanout"
	"backend/internal/infrastructure/collaboration/websocket"
	"backend/internal/infrastructure/collaboration/yjs"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/reearth/ygo/crdt"
	ws "golang.org/x/net/websocket"
)

const integrationOrigin = "https://docs.example.test"

type integrationWebSocketVerifier map[string]uuid.UUID

func (v integrationWebSocketVerifier) VerifyToken(token string) (appauth.ResponseUser, error) {
	userID, ok := v[token]
	if !ok {
		return appauth.ResponseUser{}, errors.New("invalid test token")
	}
	return appauth.ResponseUser{ID: userID.String(), Exp: time.Now().Add(time.Hour).Unix()}, nil
}

type integrationWebSocketFrame struct {
	Type              string    `json:"type"`
	Code              string    `json:"code,omitempty"`
	UpdateID          uuid.UUID `json:"updateID,omitempty"`
	BodyVersion       int64     `json:"bodyVersion,omitempty"`
	BodyEpoch         int64     `json:"bodyEpoch,omitempty"`
	BodySchemaVersion int       `json:"bodySchemaVersion,omitempty"`
	CanEdit           *bool     `json:"canEdit,omitempty"`
	CanSuggest        *bool     `json:"canSuggest,omitempty"`
	State             []byte    `json:"state,omitempty"`
	Update            []byte    `json:"update,omitempty"`
}

func TestWebSocketUpdateCommitsAndFansOutAcrossInstancesWithRedis(t *testing.T) {
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
	if _, err := db.ExecContext(ctx, `
		INSERT INTO workspaces (id, name, slug, created_by) VALUES ($1, 'WebSocket integration', $2, $3)
	`, workspaceID, "websocket-"+workspaceID.String(), ownerID); err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	for _, membership := range []struct {
		userID uuid.UUID
		role   string
	}{{ownerID, "owner"}, {viewerID, "member"}} {
		if _, err := db.ExecContext(ctx, `
			INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)
		`, workspaceID, membership.userID, membership.role); err != nil {
			t.Fatalf("create %s membership: %v", membership.role, err)
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
		t.Fatalf("seed collaborative document: %v", err)
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO document_accesses (document_id, user_id, access_level) VALUES ($1, $2, 'view')
	`, documentID, viewerID); err != nil {
		t.Fatalf("grant viewer access: %v", err)
	}

	repository := NewRepository(database.NewSQLDB(db))
	bodyReader := collaboration.NewBodyReadUseCase(repository)
	brokerA, err := redisfanout.New(integrationRedisURL(t))
	if err != nil {
		t.Fatalf("create Redis broker A: %v", err)
	}
	brokerB, err := redisfanout.New(integrationRedisURL(t))
	if err != nil {
		t.Fatalf("create Redis broker B: %v", err)
	}
	verifier := integrationWebSocketVerifier{
		"owner-token": ownerID, "viewer-token": viewerID,
	}
	serverA := websocket.NewServer(verifier, bodyReader, repository, integrationOrigin, brokerA)
	serverB := websocket.NewServer(verifier, bodyReader, repository, integrationOrigin, brokerB)
	newHTTPServer := func(server *websocket.Server) *httptest.Server {
		mux := http.NewServeMux()
		mux.Handle("GET /api/v1/collaboration/{id}", server)
		return httptest.NewServer(mux)
	}
	httpServerA, httpServerB := newHTTPServer(serverA), newHTTPServer(serverB)
	t.Cleanup(func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		for _, server := range []*websocket.Server{serverA, serverB} {
			if err := server.Shutdown(shutdownCtx); err != nil {
				t.Errorf("shut down collaboration server: %v", err)
			}
		}
		httpServerA.Close()
		httpServerB.Close()
	})

	dial := func(httpServer *httptest.Server, token string) (*ws.Conn, integrationWebSocketFrame) {
		t.Helper()
		url := "ws" + strings.TrimPrefix(httpServer.URL, "http") + "/api/v1/collaboration/" + documentID.String()
		connection, err := ws.Dial(url, "", integrationOrigin)
		if err != nil {
			t.Fatalf("dial collaboration WebSocket: %v", err)
		}
		connection.PayloadType = ws.TextFrame
		if err := ws.JSON.Send(connection, struct {
			Type        string    `json:"type"`
			Token       string    `json:"token"`
			WorkspaceID uuid.UUID `json:"workspaceID"`
		}{Type: "auth", Token: token, WorkspaceID: workspaceID}); err != nil {
			t.Fatalf("send WebSocket auth: %v", err)
		}
		if err := connection.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
			t.Fatalf("set WebSocket deadline: %v", err)
		}
		var ready integrationWebSocketFrame
		if err := ws.JSON.Receive(connection, &ready); err != nil {
			t.Fatalf("receive WebSocket ready: %v", err)
		}
		return connection, ready
	}
	readFrame := func(connection *ws.Conn) integrationWebSocketFrame {
		t.Helper()
		if err := connection.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
			t.Fatalf("set WebSocket deadline: %v", err)
		}
		for {
			var frame integrationWebSocketFrame
			if err := ws.JSON.Receive(connection, &frame); err != nil {
				t.Fatalf("receive WebSocket frame: %v", err)
			}
			if frame.Type != "presence" {
				return frame
			}
		}
	}
	ownerSocket, ownerReady := dial(httpServerA, "owner-token")
	defer ownerSocket.Close()
	if ownerReady.Type != "ready" || ownerReady.CanEdit == nil || !*ownerReady.CanEdit {
		t.Fatalf("owner ready = %+v, want editable snapshot", ownerReady)
	}
	viewerSocket, viewerReady := dial(httpServerB, "viewer-token")
	defer viewerSocket.Close()
	if viewerReady.Type != "ready" || viewerReady.CanEdit == nil || *viewerReady.CanEdit {
		t.Fatalf("viewer ready = %+v, want read-only snapshot", viewerReady)
	}

	clientDoc := crdt.New()
	defer clientDoc.Destroy()
	if err := crdt.ApplyUpdateV1(clientDoc, state, nil); err != nil {
		t.Fatalf("load client Yjs state: %v", err)
	}
	baseVector, err := crdt.DecodeStateVectorV1(crdt.EncodeStateVectorV1(clientDoc))
	if err != nil {
		t.Fatalf("capture Yjs state vector: %v", err)
	}
	root, ok := clientDoc.GetXmlFragment("body").Children()[0].(*crdt.YXmlElement)
	if !ok {
		t.Fatal("body root is not a Y.XmlElement")
	}
	paragraph, ok := root.Children()[0].(*crdt.YXmlElement)
	if !ok {
		t.Fatal("paragraph is not a Y.XmlElement")
	}
	run, ok := paragraph.Children()[0].(*crdt.YXmlElement)
	if !ok {
		t.Fatal("run is not a Y.XmlElement")
	}
	text, ok := run.Children()[0].(*crdt.YXmlText)
	if !ok {
		t.Fatal("run content is not a Y.XmlText")
	}
	textLength := len(text.ToString())
	clientDoc.Transact(func(tx *crdt.Transaction) {
		text.Insert(tx, textLength, " beta", nil)
	})
	update := crdt.EncodeStateAsUpdateV1(clientDoc, baseVector)
	updateID := uuid.New()
	if err := ws.JSON.Send(ownerSocket, struct {
		Type              string    `json:"type"`
		UpdateID          uuid.UUID `json:"updateID"`
		BodyEpoch         int64     `json:"bodyEpoch"`
		BodySchemaVersion int       `json:"bodySchemaVersion"`
		Update            []byte    `json:"update"`
	}{Type: "update", UpdateID: updateID, BodyEpoch: 1, BodySchemaVersion: yjs.BodySchemaVersionV1, Update: update}); err != nil {
		t.Fatalf("send owner update: %v", err)
	}
	ack := readFrame(ownerSocket)
	if ack.Type != "ack" || ack.UpdateID != updateID || ack.BodyVersion != 2 || ack.BodyEpoch != 1 {
		t.Fatalf("owner ACK = %+v, want durable version 2", ack)
	}
	fanout := readFrame(viewerSocket)
	if fanout.Type != "update" || fanout.UpdateID != updateID || fanout.BodyVersion != 2 || string(fanout.Update) != string(update) {
		t.Fatalf("viewer fan-out = %+v, want committed update version 2", fanout)
	}

	// Simulate a lost Redis publish after a durable commit; the remote peer must
	// discover the version gap from PostgreSQL and receive a full-state resync.
	nextVector, err := crdt.DecodeStateVectorV1(crdt.EncodeStateVectorV1(clientDoc))
	if err != nil {
		t.Fatalf("capture post-update state vector: %v", err)
	}
	textLength = len(text.ToString())
	clientDoc.Transact(func(tx *crdt.Transaction) {
		text.Insert(tx, textLength, " gamma", nil)
	})
	missedUpdate := crdt.EncodeStateAsUpdateV1(clientDoc, nextVector)
	missedReceipt, err := repository.CommitUpdate(ctx, collaboration.Actor{UserID: ownerID}, collaboration.Update{
		DocumentID: documentID, UpdateID: uuid.New(), BodyEpoch: 1,
		BodySchemaVersion: yjs.BodySchemaVersionV1, Bytes: missedUpdate,
	})
	if err != nil || missedReceipt.BodyVersion != 3 {
		t.Fatalf("commit update without fan-out = %+v, %v; want durable version 3", missedReceipt, err)
	}
	if err := viewerSocket.SetReadDeadline(time.Now().Add(12 * time.Second)); err != nil {
		t.Fatalf("set resync deadline: %v", err)
	}
	var resync integrationWebSocketFrame
	for {
		resync = integrationWebSocketFrame{}
		if err := ws.JSON.Receive(viewerSocket, &resync); err != nil {
			t.Fatalf("receive PostgreSQL recovery resync: %v", err)
		}
		if resync.Type != "presence" {
			break
		}
	}
	if resync.Type != "resync" || resync.BodyVersion != 3 || len(resync.State) == 0 {
		t.Fatalf("missed fan-out recovery = %+v, want full-state resync at version 3", resync)
	}

	snapshot, err := repository.ReadBody(ctx, collaboration.Actor{UserID: ownerID}, workspaceID, documentID)
	if err != nil {
		t.Fatalf("read committed body: %v", err)
	}
	var runContent string
	for _, node := range snapshot.Body.Nodes {
		if node.NodeID == runID {
			runContent = node.Content
		}
	}
	if snapshot.BodyVersion != 3 || runContent != "alpha beta gamma" {
		t.Fatalf("durable body = version %d, run %q; want version 3 and recovered text", snapshot.BodyVersion, runContent)
	}

	if err := ws.JSON.Send(viewerSocket, struct {
		Type              string    `json:"type"`
		UpdateID          uuid.UUID `json:"updateID"`
		BodyEpoch         int64     `json:"bodyEpoch"`
		BodySchemaVersion int       `json:"bodySchemaVersion"`
		Update            []byte    `json:"update"`
	}{Type: "update", UpdateID: uuid.New(), BodyEpoch: 1, BodySchemaVersion: yjs.BodySchemaVersionV1, Update: update}); err != nil {
		t.Fatalf("send viewer update: %v", err)
	}
	rejected := readFrame(viewerSocket)
	if rejected.Type != "error" || rejected.Code != "update_rejected" {
		t.Fatalf("viewer update response = %+v, want edit rejection", rejected)
	}
	afterRejection, err := repository.ReadBody(ctx, collaboration.Actor{UserID: ownerID}, workspaceID, documentID)
	if err != nil || afterRejection.BodyVersion != 3 {
		t.Fatalf("body after rejected view update = version %d, err %v; want unchanged version 3", afterRejection.BodyVersion, err)
	}
}

func TestWebSocketProcessRestartRecoversCommittedUpdateAndAllowsRetry(t *testing.T) {
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
	if _, err := db.ExecContext(ctx, `
		INSERT INTO workspaces (id, name, slug, created_by) VALUES ($1, 'WebSocket restart', $2, $3)
	`, workspaceID, "websocket-restart-"+workspaceID.String(), ownerID); err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	for _, membership := range []struct {
		userID uuid.UUID
		role   string
	}{{ownerID, "owner"}, {viewerID, "member"}} {
		if _, err := db.ExecContext(ctx, `
			INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)
		`, workspaceID, membership.userID, membership.role); err != nil {
			t.Fatalf("create %s membership: %v", membership.role, err)
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
		t.Fatalf("seed collaborative document: %v", err)
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO document_accesses (document_id, user_id, access_level) VALUES ($1, $2, 'view')
	`, documentID, viewerID); err != nil {
		t.Fatalf("grant viewer access: %v", err)
	}

	instanceA := startWebSocketProcess(t, ownerID, viewerID)
	t.Cleanup(instanceA.stop)
	instanceB := startWebSocketProcess(t, ownerID, viewerID)
	t.Cleanup(instanceB.stop)
	ownerSocket, ownerReady := dialWebSocketProcess(t, instanceA.address, workspaceID, documentID, "owner-token")
	defer ownerSocket.Close()
	if ownerReady.Type != "ready" || ownerReady.BodyVersion != 1 || ownerReady.CanEdit == nil || !*ownerReady.CanEdit {
		t.Fatalf("owner ready = %+v, want editable version 1 snapshot", ownerReady)
	}
	viewerSocket, viewerReady := dialWebSocketProcess(t, instanceB.address, workspaceID, documentID, "viewer-token")
	defer viewerSocket.Close()
	if viewerReady.Type != "ready" || viewerReady.BodyVersion != 1 || viewerReady.CanEdit == nil || *viewerReady.CanEdit {
		t.Fatalf("viewer ready = %+v, want read-only version 1 snapshot", viewerReady)
	}

	clientDoc := crdt.New()
	defer clientDoc.Destroy()
	if err := crdt.ApplyUpdateV1(clientDoc, state, nil); err != nil {
		t.Fatalf("load client Yjs state: %v", err)
	}
	baseVector, err := crdt.DecodeStateVectorV1(crdt.EncodeStateVectorV1(clientDoc))
	if err != nil {
		t.Fatalf("capture Yjs state vector: %v", err)
	}
	root := clientDoc.GetXmlFragment("body").Children()[0].(*crdt.YXmlElement)
	paragraph := root.Children()[0].(*crdt.YXmlElement)
	run := paragraph.Children()[0].(*crdt.YXmlElement)
	text := run.Children()[0].(*crdt.YXmlText)
	textLength := text.Len()
	clientDoc.Transact(func(tx *crdt.Transaction) { text.Insert(tx, textLength, " beta", nil) })
	update := crdt.EncodeStateAsUpdateV1(clientDoc, baseVector)
	updateID := uuid.New()
	if err := sendWebSocketUpdate(ownerSocket, updateID, update); err != nil {
		t.Fatalf("send owner update: %v", err)
	}
	fanout := readWebSocketFrame(t, viewerSocket)
	if fanout.Type != "update" || fanout.UpdateID != updateID || fanout.BodyVersion != 2 {
		t.Fatalf("viewer fan-out = %+v, want committed update version 2", fanout)
	}

	redisOptions, err := redis.ParseURL(integrationRedisURL(t))
	if err != nil {
		t.Fatalf("parse test Redis URL: %v", err)
	}
	redisClient := redis.NewClient(redisOptions)
	t.Cleanup(func() { _ = redisClient.Close() })
	killed, err := redisClient.Do(ctx, "CLIENT", "KILL", "TYPE", "PUBSUB").Int64()
	if err != nil {
		t.Fatalf("disconnect WebSocket Redis subscribers: %v", err)
	}
	if killed < 2 {
		t.Fatalf("Redis disconnected %d Pub/Sub clients, want both Go instances", killed)
	}
	resubscribeDeadline := time.Now().Add(5 * time.Second)
	for {
		subscribers, err := redisClient.PubSubNumSub(ctx, "dokudocs:collaboration:v1").Result()
		if err != nil {
			t.Fatalf("count reconnected WebSocket Redis subscribers: %v", err)
		}
		if subscribers["dokudocs:collaboration:v1"] == 2 {
			break
		}
		if time.Now().After(resubscribeDeadline) {
			t.Fatalf("Redis subscriber count after reconnect = %v, want 2", subscribers)
		}
		time.Sleep(25 * time.Millisecond)
	}

	secondVector, err := crdt.DecodeStateVectorV1(crdt.EncodeStateVectorV1(clientDoc))
	if err != nil {
		t.Fatalf("capture Yjs state vector after first update: %v", err)
	}
	textLength = text.Len()
	clientDoc.Transact(func(tx *crdt.Transaction) { text.Insert(tx, textLength, " gamma", nil) })
	secondUpdate := crdt.EncodeStateAsUpdateV1(clientDoc, secondVector)
	secondUpdateID := uuid.New()
	if err := sendWebSocketUpdate(ownerSocket, secondUpdateID, secondUpdate); err != nil {
		t.Fatalf("send update after Redis subscriber reconnect: %v", err)
	}
	fanout = readWebSocketFrame(t, viewerSocket)
	if fanout.Type != "update" || fanout.UpdateID != secondUpdateID || fanout.BodyVersion != 3 {
		t.Fatalf("post-reconnect fan-out = %+v, want committed update version 3", fanout)
	}

	// The fan-out proves the transaction committed. Closing without reading the
	// owner ACK simulates losing it, then killing instance A forces reconnect to B.
	instanceA.stop()
	_ = ownerSocket.Close()
	reconnectedSocket, ready := dialWebSocketProcess(t, instanceB.address, workspaceID, documentID, "owner-token")
	defer reconnectedSocket.Close()
	if ready.Type != "ready" || ready.BodyVersion != 3 || ready.BodyEpoch != 1 || len(ready.State) == 0 {
		t.Fatalf("restart recovery = %+v, want durable version 3 snapshot", ready)
	}
	recoveredBody, err := yjs.ProjectV1(ready.State, documentID)
	if err != nil {
		t.Fatalf("project state recovered by replacement instance: %v", err)
	}
	if got := bodyNodeContent(recoveredBody, runID); got != "alpha beta gamma" {
		t.Fatalf("recovered run content = %q, want %q", got, "alpha beta gamma")
	}

	if err := sendWebSocketUpdate(reconnectedSocket, secondUpdateID, secondUpdate); err != nil {
		t.Fatalf("retry update after lost ACK: %v", err)
	}
	ack := readWebSocketFrame(t, reconnectedSocket)
	if ack.Type != "ack" || ack.UpdateID != secondUpdateID || ack.BodyVersion != 3 || ack.BodyEpoch != 1 {
		t.Fatalf("retry ACK = %+v, want the already durable version 3", ack)
	}
	snapshot, err := NewRepository(database.NewSQLDB(db)).ReadBody(ctx, collaboration.Actor{UserID: ownerID}, workspaceID, documentID)
	if err != nil {
		t.Fatalf("read final committed body: %v", err)
	}
	if snapshot.BodyVersion != 3 || bodyNodeContent(snapshot.Body, runID) != "alpha beta gamma" {
		t.Fatalf("retry changed canonical body: version=%d content=%q", snapshot.BodyVersion, bodyNodeContent(snapshot.Body, runID))
	}
}

func TestWebSocketProcessServerHelper(t *testing.T) {
	if os.Getenv("DOKUDOCS_WS_PROCESS_HELPER") != "1" {
		return
	}
	db, err := sql.Open("pgx", integrationDatabaseURL(t))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ownerID, err := uuid.Parse(os.Getenv("DOKUDOCS_WS_OWNER_ID"))
	if err != nil {
		t.Fatal(err)
	}
	viewerID, err := uuid.Parse(os.Getenv("DOKUDOCS_WS_VIEWER_ID"))
	if err != nil {
		t.Fatal(err)
	}
	broker, err := redisfanout.New(integrationRedisURL(t))
	if err != nil {
		t.Fatal(err)
	}
	defer broker.Close()
	repository := NewRepository(database.NewSQLDB(db))
	reader := collaboration.NewBodyReadUseCase(repository)
	verifier := integrationWebSocketVerifier{"owner-token": ownerID, "viewer-token": viewerID}
	server := websocket.NewServer(verifier, reader, repository, integrationOrigin, broker)
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		_ = server.Shutdown(ctx)
	}()
	mux := http.NewServeMux()
	mux.Handle("GET /api/v1/collaboration/{id}", server)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	fmt.Printf("READY %s\n", listener.Addr())
	if err := (&http.Server{Handler: mux}).Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
		t.Fatal(err)
	}
}

type webSocketProcess struct {
	command *exec.Cmd
	address string
	stderr  bytes.Buffer
	done    chan struct{}
	waitErr error
}

func startWebSocketProcess(t *testing.T, ownerID, viewerID uuid.UUID) *webSocketProcess {
	t.Helper()
	command := exec.Command(os.Args[0], "-test.run=^TestWebSocketProcessServerHelper$")
	command.Env = append(os.Environ(),
		"DOKUDOCS_WS_PROCESS_HELPER=1",
		"DOKUDOCS_WS_OWNER_ID="+ownerID.String(),
		"DOKUDOCS_WS_VIEWER_ID="+viewerID.String(),
	)
	stdout, err := command.StdoutPipe()
	if err != nil {
		t.Fatalf("open WebSocket process stdout: %v", err)
	}
	process := &webSocketProcess{command: command, done: make(chan struct{})}
	command.Stderr = &process.stderr
	if err := command.Start(); err != nil {
		t.Fatalf("start WebSocket process: %v", err)
	}
	go func() {
		process.waitErr = command.Wait()
		close(process.done)
	}()
	ready := make(chan string, 1)
	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			line := scanner.Text()
			if strings.HasPrefix(line, "READY ") {
				ready <- strings.TrimPrefix(line, "READY ")
				return
			}
		}
	}()
	select {
	case process.address = <-ready:
		return process
	case <-process.done:
		t.Fatalf("WebSocket process exited before ready: %v; stderr: %s", process.waitErr, process.stderr.String())
	case <-time.After(10 * time.Second):
		process.stop()
		t.Fatalf("WebSocket process did not become ready; stderr: %s", process.stderr.String())
	}
	return nil
}

func (p *webSocketProcess) stop() {
	select {
	case <-p.done:
		return
	default:
	}
	_ = p.command.Process.Kill()
	<-p.done
}

func dialWebSocketProcess(t *testing.T, address string, workspaceID, documentID uuid.UUID, token string) (*ws.Conn, integrationWebSocketFrame) {
	t.Helper()
	connection, err := ws.Dial("ws://"+address+"/api/v1/collaboration/"+documentID.String(), "", integrationOrigin)
	if err != nil {
		t.Fatalf("dial collaboration WebSocket: %v", err)
	}
	connection.PayloadType = ws.TextFrame
	if err := ws.JSON.Send(connection, struct {
		Type        string    `json:"type"`
		Token       string    `json:"token"`
		WorkspaceID uuid.UUID `json:"workspaceID"`
	}{Type: "auth", Token: token, WorkspaceID: workspaceID}); err != nil {
		t.Fatalf("send WebSocket auth: %v", err)
	}
	return connection, readWebSocketFrame(t, connection)
}

func sendWebSocketUpdate(connection *ws.Conn, updateID uuid.UUID, update []byte) error {
	return ws.JSON.Send(connection, struct {
		Type              string    `json:"type"`
		UpdateID          uuid.UUID `json:"updateID"`
		BodyEpoch         int64     `json:"bodyEpoch"`
		BodySchemaVersion int       `json:"bodySchemaVersion"`
		Update            []byte    `json:"update"`
	}{Type: "update", UpdateID: updateID, BodyEpoch: 1, BodySchemaVersion: yjs.BodySchemaVersionV1, Update: update})
}

func readWebSocketFrame(t *testing.T, connection *ws.Conn) integrationWebSocketFrame {
	t.Helper()
	if err := connection.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
		t.Fatalf("set WebSocket deadline: %v", err)
	}
	for {
		var frame integrationWebSocketFrame
		if err := ws.JSON.Receive(connection, &frame); err != nil {
			t.Fatalf("receive WebSocket frame: %v", err)
		}
		if frame.Type != "presence" {
			return frame
		}
	}
}

func bodyNodeContent(body documentbody.Body, nodeID uuid.UUID) string {
	for _, node := range body.Nodes {
		if node.NodeID == nodeID {
			return node.Content
		}
	}
	return ""
}

func integrationRedisURL(t *testing.T) string {
	t.Helper()
	redisURL := os.Getenv("TEST_REDIS_URL")
	if redisURL == "" {
		t.Fatal("TEST_REDIS_URL is required for integration tests")
	}
	return redisURL
}
