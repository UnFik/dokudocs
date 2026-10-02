//go:build integration

package redisfanout

import (
	"context"
	"os"
	"testing"
	"time"

	"backend/internal/application/collaboration"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

func testRedisURL(t *testing.T) string {
	t.Helper()
	url := os.Getenv("TEST_REDIS_URL")
	if url == "" {
		t.Fatal("TEST_REDIS_URL is required for integration tests")
	}
	return url
}

func newTestBroker(t *testing.T) *Broker {
	t.Helper()
	broker, err := New(testRedisURL(t))
	if err != nil {
		t.Fatalf("New(): %v", err)
	}
	t.Cleanup(func() { _ = broker.Close() })
	return broker
}

func rawClient(t *testing.T) *redis.Client {
	t.Helper()
	options, err := redis.ParseURL(testRedisURL(t))
	if err != nil {
		t.Fatalf("ParseURL(): %v", err)
	}
	client := redis.NewClient(options)
	t.Cleanup(func() { _ = client.Close() })
	return client
}

func testEvent() collaboration.BroadcastEvent {
	documentID, updateID := uuid.New(), uuid.New()
	return collaboration.BroadcastEvent{
		OriginID: uuid.New(),
		Receipt:  collaboration.CommitReceipt{DocumentID: documentID, UpdateID: updateID, BodyEpoch: 1, BodyVersion: 2, Changed: true},
		Update:   collaboration.Update{DocumentID: documentID, UpdateID: updateID, BodyEpoch: 1, BodySchemaVersion: 1, Bytes: []byte("yjs-update")},
	}
}

func receive(t *testing.T, events <-chan collaboration.BroadcastEvent, within time.Duration) (collaboration.BroadcastEvent, bool) {
	t.Helper()
	select {
	case event, ok := <-events:
		return event, ok
	case <-time.After(within):
		t.Fatalf("no event within %v", within)
		return collaboration.BroadcastEvent{}, false
	}
}

func TestBrokerDeliversAnEventToEverySubscriber(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	subscriberA, subscriberB, publisher := newTestBroker(t), newTestBroker(t), newTestBroker(t)
	eventsA, err := subscriberA.Subscribe(ctx)
	if err != nil {
		t.Fatalf("Subscribe(): %v", err)
	}
	eventsB, err := subscriberB.Subscribe(ctx)
	if err != nil {
		t.Fatalf("Subscribe(): %v", err)
	}

	want := testEvent()
	if err := publisher.PublishEvent(ctx, want); err != nil {
		t.Fatalf("PublishEvent(): %v", err)
	}

	for name, events := range map[string]<-chan collaboration.BroadcastEvent{"A": eventsA, "B": eventsB} {
		got, ok := receive(t, events, 3*time.Second)
		if !ok || got.Receipt != want.Receipt || got.OriginID != want.OriginID || string(got.Update.Bytes) != "yjs-update" {
			t.Fatalf("subscriber %s got %+v ok=%v, want %+v", name, got, ok, want)
		}
	}
}

func TestBrokerSkipsMalformedPayloadsWithoutClosingTheStream(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	subscriber, publisher := newTestBroker(t), newTestBroker(t)
	events, err := subscriber.Subscribe(ctx)
	if err != nil {
		t.Fatalf("Subscribe(): %v", err)
	}

	if err := rawClient(t).Publish(ctx, channel, "{not json").Err(); err != nil {
		t.Fatalf("publish garbage: %v", err)
	}
	want := testEvent()
	if err := publisher.PublishEvent(ctx, want); err != nil {
		t.Fatalf("PublishEvent(): %v", err)
	}

	got, ok := receive(t, events, 3*time.Second)
	if !ok || got.Receipt != want.Receipt {
		t.Fatalf("got %+v ok=%v, want the valid event after the malformed payload", got, ok)
	}
}

func TestBrokerClosesTheEventChannelWhenTheContextIsCancelled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	events, err := newTestBroker(t).Subscribe(ctx)
	if err != nil {
		t.Fatalf("Subscribe(): %v", err)
	}

	cancel()

	select {
	case _, ok := <-events:
		if ok {
			t.Fatal("received an event after cancellation")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("event channel still open after the context was cancelled")
	}
}

func TestBrokerStreamEndsWhenItsConnectionIsKilledAndANewSubscriptionRecovers(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	subscriber, publisher := newTestBroker(t), newTestBroker(t)
	events, err := subscriber.Subscribe(ctx)
	if err != nil {
		t.Fatalf("Subscribe(): %v", err)
	}

	if err := rawClient(t).ClientKillByFilter(ctx, "TYPE", "pubsub").Err(); err != nil {
		t.Fatalf("kill pubsub connections: %v", err)
	}
	select {
	case _, ok := <-events:
		if ok {
			t.Fatal("received an event instead of the stream ending")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("event channel still open after its connection was killed")
	}

	// The server resubscribes when the stream ends; events published while the
	// stream was down are not replayed (Pub/Sub has none).
	recovered, err := subscriber.Subscribe(ctx)
	if err != nil {
		t.Fatalf("Subscribe() after the kill: %v", err)
	}
	want := testEvent()
	if err := publisher.PublishEvent(ctx, want); err != nil {
		t.Fatalf("PublishEvent(): %v", err)
	}
	got, ok := receive(t, recovered, 3*time.Second)
	if !ok || got.Receipt != want.Receipt {
		t.Fatalf("got %+v ok=%v, want the event published after recovery", got, ok)
	}
}
