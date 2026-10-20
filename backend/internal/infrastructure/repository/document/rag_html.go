package document

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/google/uuid"
)

// ragHTMLChunkSize is about how many characters one chunk of a page's text holds.
const ragHTMLChunkSize = 1500

// renderHTMLRAG indexes the text extracted from a page (content_json is {"text": ...},
// written when the page was), in chunks of whole paragraphs. The page is never run
// or parsed here.
func renderHTMLRAG(contentJSON []byte) []renderedRAGChunk {
	var body struct {
		Text string `json:"text"`
	}
	if json.Unmarshal(contentJSON, &body) != nil {
		return nil
	}
	var chunks []renderedRAGChunk
	var current strings.Builder
	emit := func() {
		if text := strings.TrimSpace(current.String()); text != "" {
			id := uuid.NewSHA1(ragNodeNamespace, []byte(fmt.Sprintf("html:%d", len(chunks))))
			chunks = append(chunks, renderedRAGChunk{nodeID: id, text: text})
		}
		current.Reset()
	}
	for _, paragraph := range strings.Split(body.Text, "\n\n") {
		if current.Len() > 0 && current.Len()+len(paragraph) > ragHTMLChunkSize {
			emit()
		}
		// One paragraph longer than a chunk is cut at the size.
		for len(paragraph) > ragHTMLChunkSize {
			cut := ragHTMLChunkSize
			for cut > 0 && paragraph[cut]&0xC0 == 0x80 { // do not split a character
				cut--
			}
			current.WriteString(paragraph[:cut])
			emit()
			paragraph = paragraph[cut:]
		}
		if paragraph != "" {
			if current.Len() > 0 {
				current.WriteString("\n\n")
			}
			current.WriteString(paragraph)
		}
	}
	emit()
	return chunks
}
