package yjs

import "github.com/reearth/ygo/crdt"

// MergeV1 builds a candidate Yjs state without mutating the committed bytes.
// Callers can persist the returned state and discard it if their transaction
// fails.
func MergeV1(persisted, incoming []byte) ([]byte, error) {
	// ponytail: rebuild the full document per update; add checkpoints only if hot-document latency tests miss target.
	doc := crdt.New()
	if len(persisted) > 0 {
		if err := crdt.ApplyUpdateV1(doc, persisted, nil); err != nil {
			return nil, err
		}
	}
	if err := crdt.ApplyUpdateV1(doc, incoming, nil); err != nil {
		return nil, err
	}
	return crdt.EncodeStateAsUpdateV1(doc, nil), nil
}
