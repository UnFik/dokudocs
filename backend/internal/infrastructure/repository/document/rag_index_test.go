package document

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func ragBlock(nodeType, id string, attrs map[string]any, text string) map[string]any {
	all := map[string]any{"nodeID": id}
	for key, value := range attrs {
		all[key] = value
	}
	block := map[string]any{"type": nodeType, "attrs": all}
	if text != "" {
		block["content"] = []any{map[string]any{"type": "run", "content": []any{map[string]any{"type": "text", "text": text}}}}
	}
	return block
}

func TestRenderRAGJSONSplitsLongBlocksAndKeepsSectionBreadcrumbs(t *testing.T) {
	guideID, setupID, paragraphID, recoveryID, recoveryParagraphID := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	long := strings.Repeat("段落 search context ", 250)
	document := map[string]any{"type": "doc", "content": []any{map[string]any{"type": "document", "content": []any{
		ragBlock("atx_heading", guideID.String(), map[string]any{"bodyAttributes": `{"level":1}`}, "Guide"),
		ragBlock("atx_heading", setupID.String(), map[string]any{"bodyAttributes": `{"level":2}`}, "Setup"),
		ragBlock("paragraph", paragraphID.String(), nil, long),
		ragBlock("atx_heading", recoveryID.String(), map[string]any{"bodyAttributes": `{"level":1}`}, "Recovery"),
		ragBlock("paragraph", recoveryParagraphID.String(), nil, "Restart the service."),
		ragBlock("opaque", uuid.NewString(), nil, ""),
	}}}}
	encoded, err := json.Marshal(document)
	if err != nil {
		t.Fatal(err)
	}

	chunks, skipped := renderRAGJSON(encoded)
	if skipped != 1 {
		t.Fatalf("skipped node count = %d, want 1 for the opaque block", skipped)
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
	if paragraphText.String() != strings.TrimSpace(long) {
		t.Fatalf("split paragraph changed text: %q", paragraphText.String())
	}
	last := chunks[len(chunks)-1]
	if last.nodeID != recoveryParagraphID || last.breadcrumb != "Recovery" {
		t.Fatalf("recovery chunk = (%s, %q), want recovery paragraph under new H1", last.nodeID, last.breadcrumb)
	}
}

func TestRenderRAGJSONLeavesOutTextOnlySuggested(t *testing.T) {
	paragraph := map[string]any{"type": "paragraph", "attrs": map[string]any{"nodeID": uuid.NewString()}, "content": []any{map[string]any{"type": "run", "content": []any{
		map[string]any{"type": "text", "text": "kept"},
		map[string]any{"type": "text", "text": " proposed", "marks": []any{map[string]any{"type": "suggestion_insert"}}},
	}}}}
	encoded, _ := json.Marshal(map[string]any{"type": "doc", "content": []any{map[string]any{"type": "document", "content": []any{paragraph}}}})
	chunks, _ := renderRAGJSON(encoded)
	if len(chunks) != 1 || chunks[0].text != "kept" {
		t.Fatalf("chunks = %+v, want only the canonical text", chunks)
	}
}
