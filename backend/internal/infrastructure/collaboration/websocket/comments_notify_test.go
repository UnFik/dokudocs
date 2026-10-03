package websocket

import (
	"context"
	"sync"
	"testing"
	"time"

	"backend/internal/application/collaboration"

	ws "golang.org/x/net/websocket"

	"github.com/google/uuid"
)

type recordingBroker struct {
	mu     sync.Mutex
	events []collaboration.BroadcastEvent
	feed   chan collaboration.BroadcastEvent
}

func (b *recordingBroker) PublishEvent(_ context.Context, event collaboration.BroadcastEvent) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.events = append(b.events, event)
	return nil
}

func (b *recordingBroker) Subscribe(context.Context) (<-chan collaboration.BroadcastEvent, error) {
	return b.feed, nil
}

func (b *recordingBroker) Close() error { return nil }

// expectNoCommentsFrame fails if the client gets a comments_changed frame soon.
func expectNoCommentsFrame(t *testing.T, client *presenceClient, why string) {
	t.Helper()
	_ = client.conn.SetReadDeadline(time.Now().Add(300 * time.Millisecond))
	for {
		var frame serverMessage
		if err := ws.JSON.Receive(client.conn, &frame); err != nil {
			return
		}
		if frame.Type == "comments_changed" {
			t.Fatalf("%s: got comments_changed", why)
		}
	}
}

func awaitCommentsFrame(t *testing.T, client *presenceClient) {
	t.Helper()
	for range 10 {
		if frame := client.next(2 * time.Second); frame.Type == "comments_changed" {
			return
		}
	}
	t.Fatal("no comments_changed frame received")
}

func TestNotifyCommentsReachesOnlyOptedInPeersOfThatDocument(t *testing.T) {
	a := uuid.MustParse("00000000-0000-4000-8000-00000000000a")
	b := uuid.MustParse("00000000-0000-4000-8000-00000000000b")
	c := uuid.MustParse("00000000-0000-4000-8000-00000000000c")
	server := newPresenceServer(t, map[string]uuid.UUID{"token-a": a, "token-b": b, "token-c": c}, nil)
	documentID, otherDocumentID, workspaceID := uuid.New(), uuid.New(), uuid.New()

	listening := dialPresence(t, server, documentID, workspaceID, "token-a", "comments")
	legacy := dialPresence(t, server, documentID, workspaceID, "token-b")
	elsewhere := dialPresence(t, server, otherDocumentID, workspaceID, "token-c", "comments")
	for _, client := range []*presenceClient{listening, legacy, elsewhere} {
		if ready := client.next(2 * time.Second); ready.Type != "ready" {
			t.Fatalf("first frame = %+v, want ready", ready)
		}
	}

	server.NotifyComments(documentID)

	awaitCommentsFrame(t, listening)
	expectNoCommentsFrame(t, legacy, "a client that did not ask for comments")
	expectNoCommentsFrame(t, elsewhere, "a client in another document")
}

func TestNotifyCommentsIsPublishedToOtherInstancesAndHeardFromThem(t *testing.T) {
	user := uuid.MustParse("00000000-0000-4000-8000-00000000000a")
	broker := &recordingBroker{feed: make(chan collaboration.BroadcastEvent, 2)}
	server := newPresenceServer(t, map[string]uuid.UUID{"token-a": user}, nil)
	server.broker = broker
	documentID, workspaceID := uuid.New(), uuid.New()
	client := dialPresence(t, server, documentID, workspaceID, "token-a", "comments")
	if ready := client.next(2 * time.Second); ready.Type != "ready" {
		t.Fatalf("first frame = %+v, want ready", ready)
	}

	server.NotifyComments(documentID)
	awaitCommentsFrame(t, client)
	broker.mu.Lock()
	published := append([]collaboration.BroadcastEvent(nil), broker.events...)
	broker.mu.Unlock()
	if len(published) != 1 || published[0].Kind != collaboration.BroadcastKindComments ||
		published[0].DocumentID != documentID || published[0].OriginID != server.instanceID {
		t.Fatalf("published %+v, want one comments event for the document from this instance", published)
	}

	// An event from another instance reaches the local peer; one this instance
	// sent itself does not come back as a second frame.
	broker.feed <- collaboration.BroadcastEvent{OriginID: uuid.New(), Kind: collaboration.BroadcastKindComments, DocumentID: documentID}
	awaitCommentsFrame(t, client)
	broker.feed <- collaboration.BroadcastEvent{OriginID: server.instanceID, Kind: collaboration.BroadcastKindComments, DocumentID: documentID}
	expectNoCommentsFrame(t, client, "an event this instance published itself")
}
