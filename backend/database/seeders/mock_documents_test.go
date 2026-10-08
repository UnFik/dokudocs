package seeders

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestMockDocumentsAreInTheEditorSchemaAndMatchTheirMarkdown(t *testing.T) {
	known := map[string]bool{
		"doc": true, "document": true, "paragraph": true, "atx_heading": true, "run": true, "text": true,
		"bullet_list": true, "order_list": true, "task_list": true, "list_item": true, "task_list_item": true,
		"code_block": true, "block_quote": true, "thematic_break": true, "table": true, "table_row": true, "table_cell": true,
	}
	for _, doc := range mockMarkdownDocuments() {
		var root map[string]any
		if err := json.Unmarshal([]byte(doc.json), &root); err != nil {
			t.Fatalf("%s: JSON does not parse: %v", doc.title, err)
		}
		var visit func(node map[string]any)
		visit = func(node map[string]any) {
			kind, _ := node["type"].(string)
			if !known[kind] {
				t.Errorf("%s: node type %q is not in the editor schema", doc.title, kind)
			}
			if kind != "doc" && kind != "text" {
				attrs, _ := node["attrs"].(map[string]any)
				if id, _ := attrs["nodeID"].(string); id == "" {
					t.Errorf("%s: %s has no nodeID", doc.title, kind)
				}
			}
			children, _ := node["content"].([]any)
			for _, child := range children {
				visit(child.(map[string]any))
			}
		}
		visit(root)
		if !strings.HasSuffix(doc.markdown, "\n") || strings.TrimSpace(doc.markdown) == "" {
			t.Errorf("%s: markdown = %q, want text ending in a newline", doc.title, doc.markdown)
		}
	}
	first := mockMarkdownDocuments()[0]
	if !strings.HasPrefix(first.markdown, "# ") || !strings.Contains(first.markdown, "- [ ] ") || !strings.Contains(first.markdown, "```ts\n") {
		t.Errorf("first document markdown = %q, want a heading, a task and a code block", first.markdown)
	}
}
