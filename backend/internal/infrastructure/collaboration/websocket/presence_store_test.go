package websocket

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"backend/internal/application/collaboration"

	"github.com/google/uuid"
)

// memoryPresence is a PresenceStore shared by several Server values, standing
// in for Redis: entries live until Leave or until the test expires them.
type memoryPresence struct {
	mu      sync.Mutex
	entries map[uuid.UUID]map[uuid.UUID]collaboration.PresenceEntry
	subs    []chan uuid.UUID
}

func newMemoryPresence() *memoryPresence {
	return &memoryPresence{entries: map[uuid.UUID]map[uuid.UUID]collaboration.PresenceEntry{}}
}

func (m *memoryPresence) Heartbeat(_ context.Context, doc uuid.UUID, e collaboration.PresenceEntry) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.entries[doc] == nil {
		m.entries[doc] = map[uuid.UUID]collaboration.PresenceEntry{}
	}
	m.entries[doc][e.ConnectionID] = e
	return nil
}

func (m *memoryPresence) Leave(_ context.Context, doc, conn uuid.UUID) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.entries[doc], conn)
	return nil
}

func (m *memoryPresence) List(_ context.Context, doc uuid.UUID) ([]collaboration.PresenceEntry, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []collaboration.PresenceEntry
	for _, e := range m.entries[doc] {
		out = append(out, e)
	}
	return out, nil
}

func (m *memoryPresence) Notify(_ context.Context, doc uuid.UUID) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, sub := range m.subs {
		select {
		case sub <- doc:
		default:
		}
	}
	return nil
}

func (m *memoryPresence) Changes(ctx context.Context) (<-chan uuid.UUID, error) {
	sub := make(chan uuid.UUID, 16)
	m.mu.Lock()
	m.subs = append(m.subs, sub)
	m.mu.Unlock()
	go func() {
		<-ctx.Done()
		m.mu.Lock()
		defer m.mu.Unlock()
		for i, existing := range m.subs {
			if existing == sub {
				m.subs = append(m.subs[:i], m.subs[i+1:]...)
				break
			}
		}
		close(sub)
	}()
	return sub, nil
}

// expire removes every entry of a user without notifying anyone, like a crashed
// instance whose heartbeats stopped and whose TTL ran out.
func (m *memoryPresence) expire(user uuid.UUID) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, conns := range m.entries {
		for id, e := range conns {
			if e.UserID == user {
				delete(conns, id)
			}
		}
	}
}

// crashableStore stops writing to the shared store once crashed, the way a dead
// instance stops heartbeating, leaves nothing, and notifies no one.
type crashableStore struct {
	*memoryPresence
	crashed atomic.Bool
}

func (c *crashableStore) Heartbeat(ctx context.Context, doc uuid.UUID, e collaboration.PresenceEntry) error {
	if c.crashed.Load() {
		return nil
	}
	return c.memoryPresence.Heartbeat(ctx, doc, e)
}

func (c *crashableStore) Leave(ctx context.Context, doc, conn uuid.UUID) error {
	if c.crashed.Load() {
		return nil
	}
	return c.memoryPresence.Leave(ctx, doc, conn)
}

func (c *crashableStore) Notify(ctx context.Context, doc uuid.UUID) error {
	if c.crashed.Load() {
		return nil
	}
	return c.memoryPresence.Notify(ctx, doc)
}

// awaitPresence reads presence frames until one lists exactly the wanted users;
// several instances may send the same list more than once on their way there.
func awaitPresence(t *testing.T, client *presenceClient, want ...uuid.UUID) {
	t.Helper()
	var last []PresenceUser
	for range 20 {
		last = client.presence()
		if sameIDs(last, want...) {
			return
		}
	}
	t.Fatalf("presence never listed %v, last frame %+v", want, last)
}

func newPresenceInstance(t *testing.T, store collaboration.PresenceStore, users map[string]uuid.UUID) *Server {
	t.Helper()
	server := newPresenceServer(t, users, fixedProfiles{})
	server.WithPresenceStore(store)
	server.presenceEvery = 30 * time.Millisecond
	return server
}

func TestPresenceIsSharedAcrossServerInstances(t *testing.T) {
	a := uuid.MustParse("00000000-0000-4000-8000-00000000000a")
	b := uuid.MustParse("00000000-0000-4000-8000-00000000000b")
	store := newMemoryPresence()
	instance1 := newPresenceInstance(t, store, map[string]uuid.UUID{"token-a": a})
	instance2 := newPresenceInstance(t, store, map[string]uuid.UUID{"token-b": b})
	documentID, workspaceID := uuid.New(), uuid.New()

	clientA := dialPresence(t, instance1, documentID, workspaceID, "token-a", "presence")
	awaitPresence(t, clientA, a)
	clientB := dialPresence(t, instance2, documentID, workspaceID, "token-b", "presence")

	awaitPresence(t, clientB, a, b)
	awaitPresence(t, clientA, a, b)

	_ = clientB.conn.Close()
	awaitPresence(t, clientA, a)
}

func TestPresenceOfACrashedInstanceDisappearsOnceItsEntriesExpire(t *testing.T) {
	a := uuid.MustParse("00000000-0000-4000-8000-00000000000a")
	b := uuid.MustParse("00000000-0000-4000-8000-00000000000b")
	store := newMemoryPresence()
	crashing := &crashableStore{memoryPresence: store}
	instance1 := newPresenceInstance(t, store, map[string]uuid.UUID{"token-a": a})
	instance2 := newPresenceInstance(t, crashing, map[string]uuid.UUID{"token-b": b})
	documentID, workspaceID := uuid.New(), uuid.New()

	clientA := dialPresence(t, instance1, documentID, workspaceID, "token-a", "presence")
	awaitPresence(t, clientA, a)
	clientB := dialPresence(t, instance2, documentID, workspaceID, "token-b", "presence")
	awaitPresence(t, clientB, a, b)
	awaitPresence(t, clientA, a, b)

	crashing.crashed.Store(true)
	store.expire(b)

	awaitPresence(t, clientA, a)
}

type closableStore struct {
	*memoryPresence
	closes atomic.Int32
}

func (c *closableStore) Close() error {
	c.closes.Add(1)
	return nil
}

func TestShutdownClosesThePresenceStore(t *testing.T) {
	store := &closableStore{memoryPresence: newMemoryPresence()}
	server := NewServer(nil, nil, nil, "https://docs.example.test", nil).WithPresenceStore(store)

	if err := server.Shutdown(context.Background()); err != nil {
		t.Fatalf("shutdown: %v", err)
	}
	if err := server.Shutdown(context.Background()); err != nil {
		t.Fatalf("second shutdown: %v", err)
	}
	if got := store.closes.Load(); got != 1 {
		t.Fatalf("presence store closed %d times, want exactly 1", got)
	}
}
