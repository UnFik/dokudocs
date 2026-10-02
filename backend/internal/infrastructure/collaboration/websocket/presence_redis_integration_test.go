//go:build integration

package websocket

import (
	"context"
	"os"
	"sync/atomic"
	"testing"
	"time"

	"backend/internal/application/collaboration"
	"backend/internal/infrastructure/collaboration/redisfanout"

	"github.com/google/uuid"
)

// crashableRedis stops all writes once crashed, like a killed instance.
type crashableRedis struct {
	collaboration.PresenceStore
	crashed atomic.Bool
}

func (c *crashableRedis) Heartbeat(ctx context.Context, doc uuid.UUID, e collaboration.PresenceEntry) error {
	if c.crashed.Load() {
		return nil
	}
	return c.PresenceStore.Heartbeat(ctx, doc, e)
}

func (c *crashableRedis) Leave(ctx context.Context, doc, conn uuid.UUID) error {
	if c.crashed.Load() {
		return nil
	}
	return c.PresenceStore.Leave(ctx, doc, conn)
}

func (c *crashableRedis) Notify(ctx context.Context, doc uuid.UUID) error {
	if c.crashed.Load() {
		return nil
	}
	return c.PresenceStore.Notify(ctx, doc)
}

func redisPresence(t *testing.T, ttl time.Duration) collaboration.PresenceStore {
	t.Helper()
	url := os.Getenv("TEST_REDIS_URL")
	if url == "" {
		t.Fatal("TEST_REDIS_URL is required for integration tests")
	}
	store, err := redisfanout.NewPresenceStore(url, ttl)
	if err != nil {
		t.Fatalf("NewPresenceStore(): %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store
}

func TestPresenceAcrossTwoServersOnRealRedisAndACrashLeavesOnlyThroughExpiry(t *testing.T) {
	a := uuid.MustParse("00000000-0000-4000-8000-00000000000a")
	b := uuid.MustParse("00000000-0000-4000-8000-00000000000b")
	ttl := 600 * time.Millisecond
	crashing := &crashableRedis{PresenceStore: redisPresence(t, ttl)}
	instance1 := newPresenceInstance(t, redisPresence(t, ttl), map[string]uuid.UUID{"token-a": a})
	instance2 := newPresenceInstance(t, crashing, map[string]uuid.UUID{"token-b": b})
	instance1.presenceEvery, instance2.presenceEvery = 100*time.Millisecond, 100*time.Millisecond
	documentID, workspaceID := uuid.New(), uuid.New()

	clientA := dialPresence(t, instance1, documentID, workspaceID, "token-a", "presence")
	awaitPresence(t, clientA, a)
	clientB := dialPresence(t, instance2, documentID, workspaceID, "token-b", "presence")
	awaitPresence(t, clientB, a, b)
	awaitPresence(t, clientA, a, b)

	crashing.crashed.Store(true)

	awaitPresence(t, clientA, a)
}
