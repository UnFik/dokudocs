package websocket

import (
	"context"
	"sync"
	"testing"
	"time"

	appauth "backend/internal/application/auth/dto"
	"backend/internal/application/collaboration"

	"github.com/google/uuid"
	ws "golang.org/x/net/websocket"
)

// roomReaderFake counts how the server reads: ReadRoomHead is the cheap
// per-room check, Read is the expensive per-peer full snapshot.
type roomReaderFake struct {
	mu        sync.Mutex
	fullReads int
	roomReads int
	version   int64
	denied    map[uuid.UUID]bool
	readDelay time.Duration
}

func (r *roomReaderFake) Read(_ context.Context, actor collaboration.Actor, _, _ uuid.UUID) (collaboration.BodySnapshot, error) {
	time.Sleep(r.readDelay)
	r.mu.Lock()
	defer r.mu.Unlock()
	r.fullReads++
	return collaboration.BodySnapshot{
		BodyVersion: r.version, BodyEpoch: 1, BodySchemaVersion: 1, CanEdit: true, EncodedState: []byte("state"),
	}, nil
}

func (r *roomReaderFake) ReadRoomHead(_ context.Context, _, _ uuid.UUID, users []uuid.UUID) (collaboration.RoomHead, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.roomReads++
	head := collaboration.RoomHead{BodyVersion: r.version, BodyEpoch: 1, BodySchemaVersion: 1, Access: map[uuid.UUID]collaboration.RoomAccess{}}
	for _, user := range users {
		head.Access[user] = collaboration.RoomAccess{CanRead: !r.denied[user], CanEdit: true}
	}
	return head, nil
}

func (r *roomReaderFake) counts() (full, room int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.fullReads, r.roomReads
}

func newRoomServer(t *testing.T, users map[string]uuid.UUID, reader *roomReaderFake) *Server {
	t.Helper()
	verifier := tokenVerifier{}
	for token, id := range users {
		verifier[token] = appauth.ResponseUser{ID: id.String(), Exp: time.Now().Add(time.Hour).Unix()}
	}
	server := NewServer(verifier, reader, &testGatewayWriter{}, "https://docs.example.test", nil)
	server.heartbeatEvery = time.Hour
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = server.Shutdown(ctx)
	})
	return server
}

func connectUsers(t *testing.T, server *Server, documentID, workspaceID uuid.UUID, tokens ...string) []*presenceClient {
	t.Helper()
	clients := make([]*presenceClient, len(tokens))
	for i, token := range tokens {
		clients[i] = dialPresence(t, server, documentID, workspaceID, token)
		if ready := clients[i].next(2 * time.Second); ready.Type != "ready" {
			t.Fatalf("%s first frame = %+v, want ready", token, ready)
		}
	}
	return clients
}

func publishVersion(t *testing.T, server *Server, documentID uuid.UUID, version int64) uuid.UUID {
	t.Helper()
	updateID := uuid.New()
	err := server.Publish(context.Background(),
		collaboration.CommitReceipt{DocumentID: documentID, UpdateID: updateID, BodyEpoch: 1, BodyVersion: version, Changed: true},
		collaboration.Update{DocumentID: documentID, UpdateID: updateID, BodyEpoch: 1, BodySchemaVersion: 1, Bytes: []byte("update")},
	)
	if err != nil {
		t.Fatalf("Publish(): %v", err)
	}
	return updateID
}

func TestFanOutChecksAccessOncePerRoomInsteadOfReadingTheBodyPerPeer(t *testing.T) {
	users := map[string]uuid.UUID{}
	tokens := []string{"t1", "t2", "t3", "t4", "t5"}
	for _, token := range tokens {
		users[token] = uuid.New()
	}
	reader := &roomReaderFake{version: 1}
	server := newRoomServer(t, users, reader)
	documentID, workspaceID := uuid.New(), uuid.New()
	clients := connectUsers(t, server, documentID, workspaceID, tokens...)
	fullBefore, roomBefore := reader.counts()

	reader.mu.Lock()
	reader.version = 2
	reader.mu.Unlock()
	updateID := publishVersion(t, server, documentID, 2)

	for i, client := range clients {
		if frame := client.next(2 * time.Second); frame.Type != "update" || frame.UpdateID != updateID {
			t.Fatalf("client %d got %+v, want the update", i, frame)
		}
	}
	full, room := reader.counts()
	if full != fullBefore {
		t.Fatalf("fan-out read the full body %d times, want 0", full-fullBefore)
	}
	if room-roomBefore != 1 {
		t.Fatalf("fan-out read the room head %d times, want 1", room-roomBefore)
	}
}

func TestFanOutDropsAPeerWhoseAccessWasRevokedAndStillServesTheRest(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	reader := &roomReaderFake{version: 1, denied: map[uuid.UUID]bool{}}
	server := newRoomServer(t, map[string]uuid.UUID{"ta": a, "tb": b}, reader)
	documentID, workspaceID := uuid.New(), uuid.New()
	clients := connectUsers(t, server, documentID, workspaceID, "ta", "tb")

	reader.mu.Lock()
	reader.version = 2
	reader.denied[b] = true
	reader.mu.Unlock()
	updateID := publishVersion(t, server, documentID, 2)

	if frame := clients[0].next(2 * time.Second); frame.Type != "update" || frame.UpdateID != updateID {
		t.Fatalf("remaining user got %+v, want the update", frame)
	}
	_ = clients[1].conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	var frame serverMessage
	if err := ws.JSON.Receive(clients[1].conn, &frame); err == nil {
		t.Fatalf("revoked user received %+v, want the connection closed without the update", frame)
	}
}

func TestIdlePollingReadsTheRoomOncePerTickNotOncePerPeer(t *testing.T) {
	users := map[string]uuid.UUID{}
	tokens := []string{"t1", "t2", "t3", "t4", "t5"}
	for _, token := range tokens {
		users[token] = uuid.New()
	}
	reader := &roomReaderFake{version: 1}
	server := newRoomServer(t, users, reader)
	server.resyncEvery = 40 * time.Millisecond
	documentID, workspaceID := uuid.New(), uuid.New()
	connectUsers(t, server, documentID, workspaceID, tokens...)
	fullBefore, roomBefore := reader.counts()

	time.Sleep(400 * time.Millisecond)

	full, room := reader.counts()
	if full != fullBefore {
		t.Fatalf("idle polling read the full body %d times, want 0", full-fullBefore)
	}
	// ~10 ticks fit in 400 ms; per-peer polling would make it ~50.
	if ticks := room - roomBefore; ticks < 3 || ticks > 15 {
		t.Fatalf("room head reads = %d in 400 ms with 5 peers, want about one per 40 ms tick", ticks)
	}
}

func TestFanOutReadsTheBodyOncePerRoomWhenManyPeersMustResync(t *testing.T) {
	users := map[string]uuid.UUID{}
	tokens := []string{"t1", "t2", "t3", "t4", "t5"}
	for _, token := range tokens {
		users[token] = uuid.New()
	}
	reader := &roomReaderFake{version: 1}
	server := newRoomServer(t, users, reader)
	documentID, workspaceID := uuid.New(), uuid.New()
	clients := connectUsers(t, server, documentID, workspaceID, tokens...)
	fullBefore, _ := reader.counts()

	// Version 3 arrives while every peer is still at 1: each one has a gap and
	// must resync, but they all resync to the same head.
	reader.mu.Lock()
	reader.version = 3
	reader.mu.Unlock()
	publishVersion(t, server, documentID, 3)

	for i, client := range clients {
		if frame := client.next(2 * time.Second); frame.Type != "resync" || frame.BodyVersion != 3 {
			t.Fatalf("client %d got %+v, want a resync at version 3", i, frame)
		}
	}
	if full, _ := reader.counts(); full-fullBefore != 1 {
		t.Fatalf("fan-out read the full body %d times for 5 resyncing peers, want 1", full-fullBefore)
	}
}

func TestConcurrentFanOutsShareBodyReads(t *testing.T) {
	users := map[string]uuid.UUID{}
	tokens := []string{"t1", "t2", "t3"}
	for _, token := range tokens {
		users[token] = uuid.New()
	}
	reader := &roomReaderFake{version: 1}
	server := newRoomServer(t, users, reader)
	documentID, workspaceID := uuid.New(), uuid.New()
	clients := connectUsers(t, server, documentID, workspaceID, tokens...)
	fullBefore, _ := reader.counts()

	// Four commits land back to back, so every fan-out see every peer behind by
	// more than one version and both want the same head snapshot.
	reader.mu.Lock()
	reader.version = 6
	reader.readDelay = 150 * time.Millisecond
	reader.mu.Unlock()
	var wg sync.WaitGroup
	for _, version := range []int64{3, 4, 5, 6} {
		wg.Add(1)
		go func(version int64) {
			defer wg.Done()
			publishVersion(t, server, documentID, version)
		}(version)
	}
	wg.Wait()

	for i, client := range clients {
		if frame := client.next(2 * time.Second); frame.Type != "resync" || frame.BodyVersion != 6 {
			t.Fatalf("client %d got %+v, want a resync at version 6", i, frame)
		}
	}
	// A read that began before a fan-out looked at the head cannot be reused by
	// it, so up to two reads are expected, but not one per fan-out.
	if full, _ := reader.counts(); full-fullBefore > 2 {
		t.Fatalf("four concurrent fan-outs read the full body %d times, want at most 2", full-fullBefore)
	}
}

func TestFanOutDeliversCommitsInVersionOrderWhenTheyFinishOutOfOrder(t *testing.T) {
	users := map[string]uuid.UUID{}
	tokens := []string{"t1", "t2", "t3"}
	for _, token := range tokens {
		users[token] = uuid.New()
	}
	reader := &roomReaderFake{version: 1}
	server := newRoomServer(t, users, reader)
	documentID, workspaceID := uuid.New(), uuid.New()
	clients := connectUsers(t, server, documentID, workspaceID, tokens...)
	fullBefore, _ := reader.counts()

	reader.mu.Lock()
	reader.version = 3
	reader.mu.Unlock()
	// The writer of version 3 reaches fan-out before the writer of version 2.
	done := make(chan uuid.UUID, 2)
	go func() { done <- publishVersion(t, server, documentID, 3) }()
	time.Sleep(60 * time.Millisecond)
	second := publishVersion(t, server, documentID, 2)
	third := <-done
	_ = second

	for i, client := range clients {
		first := client.next(2 * time.Second)
		next := client.next(2 * time.Second)
		if first.Type != "update" || first.BodyVersion != 2 || next.Type != "update" || next.BodyVersion != 3 || next.UpdateID != third {
			t.Fatalf("client %d got %+v then %+v, want update 2 then update 3", i, first, next)
		}
	}
	if full, _ := reader.counts(); full != fullBefore {
		t.Fatalf("in-order delivery still read the full body %d times, want 0", full-fullBefore)
	}
}

func TestAuthorIsNotSentItsOwnCommitBackAsAFullResync(t *testing.T) {
	users := map[string]uuid.UUID{"author": uuid.New(), "peer": uuid.New()}
	reader := &roomReaderFake{version: 1}
	server := newRoomServer(t, users, reader)
	documentID, workspaceID := uuid.New(), uuid.New()
	clients := connectUsers(t, server, documentID, workspaceID, "author", "peer")
	author, peer := clients[0], clients[1]
	fullBefore, _ := reader.counts()

	reader.mu.Lock()
	reader.version = 2 // the fake writer commits version 2
	reader.mu.Unlock()
	updateID := uuid.New()
	if err := ws.JSON.Send(author.conn, map[string]any{
		"type": "update", "updateID": updateID, "bodyEpoch": 1, "bodySchemaVersion": 1, "update": []byte("u"),
	}); err != nil {
		t.Fatalf("send update: %v", err)
	}

	if ack := author.next(2 * time.Second); ack.Type != "ack" || ack.UpdateID != updateID {
		t.Fatalf("author got %+v, want its ack", ack)
	}
	if frame := peer.next(2 * time.Second); frame.Type != "update" || frame.UpdateID != updateID {
		t.Fatalf("peer got %+v, want the update", frame)
	}
	_ = author.conn.SetReadDeadline(time.Now().Add(300 * time.Millisecond))
	var extra serverMessage
	if err := ws.JSON.Receive(author.conn, &extra); err == nil && extra.Type != "presence" &&
		(extra.Type != "update" || extra.UpdateID != updateID) {
		t.Fatalf("author received %+v after its ack, want nothing or its own update", extra)
	}
	if full, _ := reader.counts(); full != fullBefore {
		t.Fatalf("fan-out read the full body %d times for a plain commit, want 0", full-fullBefore)
	}
}
