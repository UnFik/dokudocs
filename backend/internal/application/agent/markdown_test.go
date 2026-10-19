package agent

import (
	"encoding/json"
	"os"
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

type fixtureBlock struct {
	Type string `json:"type"`
	Lang string `json:"lang"`
	Text string `json:"text"`
}

// flatten reads the blocks back out of the editor's document JSON.
func flatten(t *testing.T, raw json.RawMessage) []fixtureBlock {
	t.Helper()
	var node struct {
		Content []struct {
			Content []struct {
				Type  string            `json:"type"`
				Attrs map[string]string `json:"attrs"`
				Body  []json.RawMessage `json:"content"`
			} `json:"content"`
		} `json:"content"`
	}
	if err := json.Unmarshal(raw, &node); err != nil || len(node.Content) == 0 {
		t.Fatalf("unexpected shape: %s", raw)
	}
	var text func(raw json.RawMessage) string
	text = func(raw json.RawMessage) string {
		var n struct {
			Text    string            `json:"text"`
			Content []json.RawMessage `json:"content"`
		}
		_ = json.Unmarshal(raw, &n)
		out := n.Text
		for _, child := range n.Content {
			out += text(child)
		}
		return out
	}
	out := []fixtureBlock{}
	for _, b := range node.Content[0].Content {
		block := fixtureBlock{Type: b.Type}
		for _, child := range b.Body {
			block.Text += text(child)
		}
		if b.Type == "code_block" {
			var attrs struct{ Type, Lang string }
			if err := json.Unmarshal([]byte(b.Attrs["bodyAttributes"]), &attrs); err != nil || attrs.Type != "fenced" {
				t.Fatalf("code block attributes = %q", b.Attrs["bodyAttributes"])
			}
			block.Lang = attrs.Lang
		}
		out = append(out, block)
	}
	return out
}

// The same cases run against the collaboration service (collab/test/agent-edit.test.ts),
// so a document made with create_document and one changed with edit_document_content
// read the same text the same way.
func TestMarkdownBlocksMatchTheSharedFixture(t *testing.T) {
	data, err := os.ReadFile("testdata/markdown_blocks.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Name   string         `json:"name"`
		Input  string         `json:"input"`
		Blocks []fixtureBlock `json:"blocks"`
	}
	if err := json.Unmarshal(data, &cases); err != nil || len(cases) == 0 {
		t.Fatalf("fixture: %v", err)
	}
	for _, c := range cases {
		t.Run(c.Name, func(t *testing.T) {
			got := flatten(t, MarkdownToContentJSON(c.Input))
			want, _ := json.Marshal(c.Blocks)
			have, _ := json.Marshal(got)
			if string(want) != string(have) {
				t.Fatalf("blocks\n got %s\nwant %s", have, want)
			}
		})
	}
}

func TestCodeBlocksCarryTheTextDirectlyWithNoRun(t *testing.T) {
	raw := string(MarkdownToContentJSON("```json\n{\"a\": 1}\n```"))
	if !strings.Contains(raw, `"type":"code_block"`) || strings.Contains(raw, `"type":"run"`) {
		t.Fatalf("code block shape: %s", raw)
	}
	if !strings.Contains(raw, `"bodyAttributes":"{\"type\":\"fenced\",\"lang\":\"json\"}"`) {
		t.Fatalf("code block attributes: %s", raw)
	}
}
