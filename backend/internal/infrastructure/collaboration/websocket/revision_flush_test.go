package websocket

import (
	"context"
	"sync"
	"testing"
	"time"

	"backend/internal/domain/documentbody"

	"github.com/google/uuid"
)

type flusherFake struct {
	mu    sync.Mutex
	calls []uuid.UUID
}

func (f *flusherFake) FlushAutoRevision(_ context.Context, documentID uuid.UUID) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, documentID)
	return nil
}

func (f *flusherFake) count() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.calls)
}

func waitForFlushes(t *testing.T, f *flusherFake, want int) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if f.count() >= want {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("auto revision flushed %d times, want %d", f.count(), want)
}

func TestLastPeerLeavingFlushesTheAutoRevision(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	server := newRoomServer(t, map[string]uuid.UUID{"ta": a, "tb": b}, &roomReaderFake{version: 1})
	flusher := &flusherFake{}
	server.WithRevisionFlusher(flusher)
	documentID, workspaceID := uuid.New(), uuid.New()
	clients := connectUsers(t, server, documentID, workspaceID, "ta", "tb")

	_ = clients[0].conn.Close()
	time.Sleep(100 * time.Millisecond)
	if got := flusher.count(); got != 0 {
		t.Fatalf("flushed %d times while a peer was still in the room, want 0", got)
	}
	_ = clients[1].conn.Close()
	waitForFlushes(t, flusher, 1)
	if flusher.calls[0] != documentID {
		t.Fatalf("flushed document %s, want %s", flusher.calls[0], documentID)
	}
}

func TestIdleRoomFlushesTheAutoRevisionOncePerBodyVersion(t *testing.T) {
	user := uuid.New()
	reader := &roomReaderFake{version: 1}
	server := newRoomServer(t, map[string]uuid.UUID{"ta": user}, reader)
	flusher := &flusherFake{}
	server.WithRevisionFlusher(flusher)
	server.resyncEvery = 10 * time.Millisecond
	server.idleFlushAfter = 40 * time.Millisecond
	documentID, workspaceID := uuid.New(), uuid.New()
	connectUsers(t, server, documentID, workspaceID, "ta")

	waitForFlushes(t, flusher, 1)
	time.Sleep(150 * time.Millisecond)
	if got := flusher.count(); got != 1 {
		t.Fatalf("idle room flushed %d times for one body version, want 1", got)
	}

	reader.mu.Lock()
	reader.version = 2
	reader.mu.Unlock()
	waitForFlushes(t, flusher, 2)
}

func TestUpdateErrorCodeNamesAnOversizedDocument(t *testing.T) {
	if got := updateErrorCode(documentbody.ErrTooLarge); got != "document_too_large" {
		t.Fatalf("updateErrorCode(ErrTooLarge) = %q, want document_too_large", got)
	}
}
