package document

import (
	"fmt"
	"runtime"
	"strings"
	"testing"

	"backend/internal/domain/documentbody"
	"backend/internal/infrastructure/collaboration/yjs"

	"github.com/google/uuid"
)

func heapInUse() uint64 {
	runtime.GC()
	runtime.GC()
	var stats runtime.MemStats
	runtime.ReadMemStats(&stats)
	return stats.HeapAlloc
}

// cacheBody builds a document of `nodes` nodes: one root, then paragraphs of a
// single 80-character run each, so two nodes per paragraph.
func cacheBody(documentID uuid.UUID, nodes int) documentbody.Body {
	rootID := uuid.New()
	body := documentbody.Body{DocumentID: documentID, RootNodeID: rootID, Nodes: []documentbody.Node{
		{DocumentID: documentID, NodeID: rootID, Type: "document", Attributes: []byte(`{}`), Version: 1},
	}}
	for i := 0; len(body.Nodes) < nodes; i++ {
		paragraphID, runID := uuid.New(), uuid.New()
		text := fmt.Sprintf("%-80s", fmt.Sprintf("paragraph %d ", i))
		body.Nodes = append(body.Nodes,
			documentbody.Node{DocumentID: documentID, NodeID: paragraphID, ParentID: &rootID, SiblingOrder: float64(i), Type: "paragraph", Attributes: []byte(`{}`), Version: 1},
			documentbody.Node{DocumentID: documentID, NodeID: runID, ParentID: &paragraphID, Type: "run", Content: strings.TrimSpace(text), Attributes: []byte(`{}`), Version: 1},
		)
	}
	return body
}

// TestCommitCacheMemoryAtTheLargestSupportedDocument fills the cache with
// documents of MaxCollaborativeNodes nodes and checks the heap it holds stays
// within the documented budget (docs/adr/0023 sizing section: 32 documents).
func TestCommitCacheMemoryAtTheLargestSupportedDocument(t *testing.T) {
	const documents = 32
	cache := newCommitCache(documents)
	before := heapInUse()
	var encodedBytes int
	for i := 0; i < documents; i++ {
		documentID := uuid.New()
		body := cacheBody(documentID, documentbody.MaxCollaborativeNodes)
		state, err := yjs.EncodeBodyV1(body)
		if err != nil {
			t.Fatalf("encode body: %v", err)
		}
		doc, err := yjs.LoadDocumentV1(state)
		if err != nil {
			t.Fatalf("load document: %v", err)
		}
		projected, err := yjs.ProjectV1(state, documentID)
		if err != nil {
			t.Fatalf("project: %v", err)
		}
		encodedBytes = len(state)
		cache.put(documentID, commitCacheEntry{state: state, body: projected, doc: doc})
	}
	held := heapInUse() - before
	t.Logf("MEMORY nodes=%d documents=%d encodedState=%dB heapHeld=%.1f MiB (%.1f MiB per document)",
		documentbody.MaxCollaborativeNodes, documents, encodedBytes, float64(held)/(1<<20), float64(held)/(1<<20)/documents)
	runtime.KeepAlive(cache)
	const budget = 1 << 30
	if held > budget {
		t.Fatalf("cache holds %d bytes, budget is %d", held, budget)
	}
}
