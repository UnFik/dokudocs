package agent

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestMarkdownTextBecomesHeadingsAndParagraphsWithIDs(t *testing.T) {
	raw := MarkdownToContentJSON("# Login\n\nUsers sign in with email.\nOr with a provider.\n\n## Errors\n\nA wrong password shows a message.")
	var doc struct {
		Type    string `json:"type"`
		Content []struct {
			Type    string `json:"type"`
			Content []struct {
				Type  string            `json:"type"`
				Attrs map[string]string `json:"attrs"`
			} `json:"content"`
		} `json:"content"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil || doc.Type != "doc" || doc.Content[0].Type != "document" {
		t.Fatalf("unexpected shape: %s", raw)
	}
	blocks := doc.Content[0].Content
	types := []string{}
	for _, b := range blocks {
		types = append(types, b.Type)
		if b.Attrs["nodeID"] == "" {
			t.Fatalf("a block has no nodeID: %s", raw)
		}
	}
	if strings.Join(types, ",") != "atx_heading,paragraph,atx_heading,paragraph" {
		t.Fatalf("blocks = %v", types)
	}
	if !strings.Contains(blocks[0].Attrs["bodyAttributes"], `"level":1`) || !strings.Contains(blocks[2].Attrs["bodyAttributes"], `"level":2`) {
		t.Fatalf("heading levels lost: %s", raw)
	}
	if !strings.Contains(string(raw), "Users sign in with email. Or with a provider.") {
		t.Fatalf("paragraph lines were not joined: %s", raw)
	}
}

func TestEmptyTextMakesAnEmptyDocument(t *testing.T) {
	if got := string(MarkdownToContentJSON("  ")); !strings.Contains(got, `"type":"document"`) || strings.Contains(got, "paragraph") {
		t.Fatalf("got %s", got)
	}
}
