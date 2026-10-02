package yjs

import (
	"fmt"
	"testing"

	"backend/internal/domain/documentbody"

	"github.com/google/uuid"
)

func benchmarkBody(documentID uuid.UUID, paragraphs int) documentbody.Body {
	rootID := uuid.New()
	body := documentbody.Body{DocumentID: documentID, RootNodeID: rootID, Nodes: []documentbody.Node{
		{DocumentID: documentID, NodeID: rootID, Type: "document", Attributes: []byte(`{}`), Version: 1},
	}}
	for i := 0; i < paragraphs; i++ {
		paragraphID := uuid.New()
		body.Nodes = append(body.Nodes,
			documentbody.Node{DocumentID: documentID, NodeID: paragraphID, ParentID: &rootID, SiblingOrder: float64(i), Type: "paragraph", Attributes: []byte(`{}`), Version: 1},
			documentbody.Node{DocumentID: documentID, NodeID: uuid.New(), ParentID: &paragraphID, Type: "run", Content: fmt.Sprintf("paragraph %d", i), Attributes: []byte(`{}`), Version: 1},
		)
	}
	return body
}

// BenchmarkProjectV1 projects a 2,001-node document, the walk every commit pays.
func BenchmarkProjectV1(b *testing.B) {
	documentID := uuid.New()
	state, err := EncodeBodyV1(benchmarkBody(documentID, 1000))
	if err != nil {
		b.Fatal(err)
	}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := ProjectV1(state, documentID); err != nil {
			b.Fatal(err)
		}
	}
}
