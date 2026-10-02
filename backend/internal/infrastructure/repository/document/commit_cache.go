package document

import (
	"container/list"
	"sync"

	"backend/internal/domain/documentbody"
	"backend/internal/infrastructure/collaboration/yjs"

	"github.com/google/uuid"
)

// commitCacheKey identifies one exact state of a document. The state revision
// is bumped by a database trigger on every write to the Yjs state, so a write
// made by another server instance or by another writer (DeleteNode, MoveNode,
// restore, suggestion acceptance) always produces a different key.
type commitCacheKey struct {
	rootID        uuid.UUID
	bodyVersion   int64
	bodyEpoch     int64
	schemaVersion int
	stateRevision int64
}

// commitCacheEntry is the Yjs state and the stored body that matches it, both
// produced by a commit this instance completed. state and body are never
// mutated. doc is the decoded state; a commit borrows it exclusively (take) and
// hands it back only if the commit succeeds, because applying an update changes
// it in place.
type commitCacheEntry struct {
	key   commitCacheKey
	state []byte
	body  documentbody.Body
	doc   *yjs.Document
}

type commitCacheItem struct {
	documentID uuid.UUID
	entry      commitCacheEntry
}

// commitCache keeps the most recently committed documents so a commit can skip
// reading and re-projecting the stored state. It is a small LRU; a miss only
// costs the full read path.
type commitCache struct {
	mu       sync.Mutex
	capacity int
	order    *list.List
	entries  map[uuid.UUID]*list.Element
}

func newCommitCache(capacity int) *commitCache {
	return &commitCache{capacity: capacity, order: list.New(), entries: make(map[uuid.UUID]*list.Element)}
}

// take returns the entry for key and removes its decoded document from the
// cache, so no other commit can use it until put hands one back.
func (c *commitCache) take(documentID uuid.UUID, key commitCacheKey) (commitCacheEntry, bool) {
	if c == nil {
		return commitCacheEntry{}, false
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	element, ok := c.entries[documentID]
	if !ok {
		return commitCacheEntry{}, false
	}
	item := element.Value.(commitCacheItem)
	if item.entry.key != key {
		return commitCacheEntry{}, false
	}
	taken := item.entry
	item.entry.doc = nil
	element.Value = item
	c.order.MoveToFront(element)
	return taken, true
}

func (c *commitCache) put(documentID uuid.UUID, entry commitCacheEntry) {
	if c == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if element, ok := c.entries[documentID]; ok {
		previous := element.Value.(commitCacheItem).entry.doc
		if previous != entry.doc {
			previous.Close()
		}
		element.Value = commitCacheItem{documentID: documentID, entry: entry}
		c.order.MoveToFront(element)
		return
	}
	c.entries[documentID] = c.order.PushFront(commitCacheItem{documentID: documentID, entry: entry})
	for c.order.Len() > c.capacity {
		oldest := c.order.Back()
		c.order.Remove(oldest)
		item := oldest.Value.(commitCacheItem)
		item.entry.doc.Close()
		delete(c.entries, item.documentID)
	}
}
