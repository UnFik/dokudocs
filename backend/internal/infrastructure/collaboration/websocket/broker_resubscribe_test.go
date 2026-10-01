package websocket

import (
	"context"
	"sync"
	"testing"
	"time"

	"backend/internal/application/collaboration"

	"github.com/google/uuid"
)

// flakyBroker ends its first stream immediately, like a dropped Redis
// connection, and serves the next subscription from a channel the test feeds.
type flakyBroker struct {
	mu          sync.Mutex
	subscribes  int
	recovered   chan collaboration.BroadcastEvent
	resubscribe chan struct{}
}

func (b *flakyBroker) PublishEvent(context.Context, collaboration.BroadcastEvent) error { return nil }
func (b *flakyBroker) Close() error                                                     { return nil }

func (b *flakyBroker) Subscribe(context.Context) (<-chan collaboration.BroadcastEvent, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.subscribes++
	if b.subscribes == 1 {
		ended := make(chan collaboration.BroadcastEvent)
		close(ended)
		return ended, nil
	}
	close(b.resubscribe)
	return b.recovered, nil
}

func TestServerResubscribesWhenTheBrokerStreamEndsAndFansOutAgain(t *testing.T) {
	user := uuid.MustParse("00000000-0000-4000-8000-00000000000a")
	broker := &flakyBroker{recovered: make(chan collaboration.BroadcastEvent, 1), resubscribe: make(chan struct{})}
	server := newPresenceServer(t, map[string]uuid.UUID{"token-a": user}, nil)
	server.broker = broker

	documentID, workspaceID := uuid.New(), uuid.New()
	client := dialPresence(t, server, documentID, workspaceID, "token-a")
	if ready := client.next(2 * time.Second); ready.Type != "ready" {
		t.Fatalf("first frame = %+v, want ready", ready)
	}
	select {
	case <-broker.resubscribe:
	case <-time.After(3 * time.Second):
		t.Fatal("server did not resubscribe after the broker stream ended")
	}

	updateID := uuid.New()
	broker.recovered <- collaboration.BroadcastEvent{
		OriginID: uuid.New(),
		Receipt:  collaboration.CommitReceipt{DocumentID: documentID, UpdateID: updateID, BodyEpoch: 1, BodyVersion: 2, Changed: true},
		Update:   collaboration.Update{DocumentID: documentID, UpdateID: updateID, BodyEpoch: 1, BodySchemaVersion: 1, Bytes: []byte("remote-update")},
	}

	update := client.next(3 * time.Second)
	if update.Type != "update" || update.UpdateID != updateID || string(update.Update) != "remote-update" {
		t.Fatalf("after recovery got %+v, want the fanned-out update", update)
	}
}
