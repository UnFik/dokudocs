package document

import (
	"strings"
	"testing"

	"backend/internal/domain/documentbody"

	"github.com/google/uuid"
)

func TestRenderRAGBodySplitsLongBlocksAndKeepsSectionBreadcrumbs(t *testing.T) {
	documentID := uuid.New()
	rootID, guideID, setupID, paragraphID, recoveryID, recoveryParagraphID := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	body := documentbody.Body{
		DocumentID: documentID,
		RootNodeID: rootID,
		Nodes: []documentbody.Node{
			{DocumentID: documentID, NodeID: rootID, Type: "document", Attributes: []byte(`{}`)},
			{DocumentID: documentID, NodeID: guideID, ParentID: &rootID, SiblingOrder: 0, Type: "atx-heading", Content: "Guide", Attributes: []byte(`{"level":1}`)},
			{DocumentID: documentID, NodeID: setupID, ParentID: &rootID, SiblingOrder: 1, Type: "atx-heading", Content: "Setup", Attributes: []byte(`{"level":2}`)},
			{DocumentID: documentID, NodeID: paragraphID, ParentID: &rootID, SiblingOrder: 2, Type: "paragraph", Content: strings.Repeat("段落 search context ", 250)},
			{DocumentID: documentID, NodeID: recoveryID, ParentID: &rootID, SiblingOrder: 3, Type: "atx-heading", Content: "Recovery", Attributes: []byte(`{"level":1}`)},
			{DocumentID: documentID, NodeID: recoveryParagraphID, ParentID: &rootID, SiblingOrder: 4, Type: "paragraph", Content: "Restart the service."},
		},
	}

	chunks, skipped := renderRAGBody(body)
	if skipped != 0 {
		t.Fatalf("skipped node count = %d, want 0", skipped)
	}
	if len(chunks) < 5 {
		t.Fatalf("rendered %d chunks, want headings, split paragraph, and recovery section", len(chunks))
	}
	if chunks[0].breadcrumb != "Guide" || chunks[1].breadcrumb != "Guide > Setup" {
		t.Fatalf("heading breadcrumbs = %q, %q; want Guide and Guide > Setup", chunks[0].breadcrumb, chunks[1].breadcrumb)
	}
	paragraphChunks := 0
	var paragraphText strings.Builder
	for _, chunk := range chunks {
		if chunk.nodeID == paragraphID {
			if paragraphChunks > 0 {
				paragraphText.WriteByte(' ')
			}
			paragraphText.WriteString(chunk.text)
			paragraphChunks++
			if chunk.breadcrumb != "Guide > Setup" || len([]rune(chunk.text)) > maxRAGChunkRunes {
				t.Fatalf("long block chunk = (%d runes, %q), want bounded text under Guide > Setup", len([]rune(chunk.text)), chunk.breadcrumb)
			}
		}
	}
	if paragraphChunks < 2 {
		t.Fatalf("long paragraph produced %d chunks, want at least 2", paragraphChunks)
	}
	if paragraphText.String() != strings.TrimSpace(body.Nodes[3].Content) {
		t.Fatalf("split paragraph changed text: %q", paragraphText.String())
	}
	last := chunks[len(chunks)-1]
	if last.nodeID != recoveryParagraphID || last.breadcrumb != "Recovery" {
		t.Fatalf("recovery chunk = (%s, %q), want recovery paragraph under new H1", last.nodeID, last.breadcrumb)
	}
}
