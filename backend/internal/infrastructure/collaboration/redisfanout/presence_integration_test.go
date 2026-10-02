//go:build integration

package redisfanout

import (
	"context"
	"testing"
	"time"

	"backend/internal/application/collaboration"

	"github.com/google/uuid"
)

func newTestPresence(t *testing.T, ttl time.Duration) *PresenceStore {
	t.Helper()
	store, err := NewPresenceStore(testRedisURL(t), ttl)
	if err != nil {
		t.Fatalf("NewPresenceStore(): %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store
}

func entry(user uuid.UUID, name string) collaboration.PresenceEntry {
	return collaboration.PresenceEntry{ConnectionID: uuid.New(), UserID: user, Name: name}
}

func TestPresenceStoreSharesConnectionsAcrossInstances(t *testing.T) {
	ctx := context.Background()
	instanceA, instanceB := newTestPresence(t, 30*time.Second), newTestPresence(t, 30*time.Second)
	documentID := uuid.New()
	ada, bo := entry(uuid.New(), "Ada"), entry(uuid.New(), "Bo")

	if err := instanceA.Heartbeat(ctx, documentID, ada); err != nil {
		t.Fatalf("Heartbeat(): %v", err)
	}
	if err := instanceB.Heartbeat(ctx, documentID, bo); err != nil {
		t.Fatalf("Heartbeat(): %v", err)
	}

	for name, store := range map[string]*PresenceStore{"A": instanceA, "B": instanceB} {
		got, err := store.List(ctx, documentID)
		if err != nil || len(got) != 2 {
			t.Fatalf("instance %s List() = %+v, %v; want both connections", name, got, err)
		}
	}

	if err := instanceA.Leave(ctx, documentID, ada.ConnectionID); err != nil {
		t.Fatalf("Leave(): %v", err)
	}
	got, err := instanceB.List(ctx, documentID)
	if err != nil || len(got) != 1 || got[0].UserID != bo.UserID || got[0].Name != "Bo" {
		t.Fatalf("List() after Ada left = %+v, %v; want only Bo", got, err)
	}
}

func TestPresenceEntriesExpireUnlessRefreshed(t *testing.T) {
	ctx := context.Background()
	store := newTestPresence(t, 300*time.Millisecond)
	documentID := uuid.New()
	crashed, alive := entry(uuid.New(), "Crashed"), entry(uuid.New(), "Alive")

	if err := store.Heartbeat(ctx, documentID, crashed); err != nil {
		t.Fatal(err)
	}
	if err := store.Heartbeat(ctx, documentID, alive); err != nil {
		t.Fatal(err)
	}
	for range 4 {
		time.Sleep(120 * time.Millisecond)
		if err := store.Heartbeat(ctx, documentID, alive); err != nil {
			t.Fatal(err)
		}
	}

	got, err := store.List(ctx, documentID)
	if err != nil || len(got) != 1 || got[0].UserID != alive.UserID {
		t.Fatalf("List() = %+v, %v; want only the connection that kept refreshing", got, err)
	}
}

func TestPresenceChangesReachEveryInstance(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	listener, notifier := newTestPresence(t, 30*time.Second), newTestPresence(t, 30*time.Second)
	changes, err := listener.Changes(ctx)
	if err != nil {
		t.Fatalf("Changes(): %v", err)
	}
	documentID := uuid.New()

	if err := notifier.Notify(ctx, documentID); err != nil {
		t.Fatalf("Notify(): %v", err)
	}

	select {
	case got := <-changes:
		if got != documentID {
			t.Fatalf("change for %s, want %s", got, documentID)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("no change notification received")
	}
}
