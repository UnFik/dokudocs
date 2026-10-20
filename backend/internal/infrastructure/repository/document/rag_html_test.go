package document

import (
	"strings"
	"testing"
)

func TestRenderHTMLRAGChunksTheExtractedTextByParagraph(t *testing.T) {
	short := renderHTMLRAG([]byte(`{"text":"Title\n\nFirst paragraph.\n\nSecond paragraph."}`))
	if len(short) != 1 || !strings.Contains(short[0].text, "First paragraph.") || !strings.Contains(short[0].text, "Second paragraph.") {
		t.Fatalf("short page = %+v, want one chunk with every paragraph", short)
	}

	para := strings.Repeat("word ", 200) // 1000 characters
	long := renderHTMLRAG([]byte(`{"text":"` + para + `\n\n` + para + `\n\n` + para + `"}`))
	if len(long) < 2 {
		t.Fatalf("long page made %d chunks, want it split", len(long))
	}
	ids := map[string]bool{}
	for _, chunk := range long {
		if len(chunk.text) > ragHTMLChunkSize+50 {
			t.Errorf("chunk of %d characters, want about %d at most", len(chunk.text), ragHTMLChunkSize)
		}
		ids[chunk.nodeID.String()] = true
	}
	if len(ids) != len(long) {
		t.Errorf("chunk ids are not distinct: %d ids for %d chunks", len(ids), len(long))
	}

	huge := renderHTMLRAG([]byte(`{"text":"` + strings.Repeat("é", 4000) + `"}`))
	for _, chunk := range huge {
		if strings.ContainsRune(chunk.text, '�') {
			t.Fatal("a character was cut in half")
		}
	}
	if renderHTMLRAG([]byte(`not json`)) != nil || renderHTMLRAG([]byte(`{"text":""}`)) != nil {
		t.Error("an empty or invalid page should index nothing")
	}
}
