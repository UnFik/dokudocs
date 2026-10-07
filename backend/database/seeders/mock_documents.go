package seeders

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/google/uuid"
)

// A mock document is written once as blocks and rendered twice: as the
// ProseMirror JSON the editor loads (documents.content_json) and as the Markdown
// the API serves for previews and search (documents.content).
type mockBlock struct {
	json     map[string]any
	markdown string
}

type mockDocument struct {
	title    string
	json     string
	markdown string
}

func mockAttrs(attributes map[string]any) map[string]any {
	encoded, _ := json.Marshal(attributes)
	return map[string]any{"nodeID": uuid.NewString(), "bodyAttributes": string(encoded), "bodyContent": ""}
}

func mockRun(text string, marks ...string) map[string]any {
	node := map[string]any{"type": "text", "text": text}
	if len(marks) > 0 {
		list := make([]map[string]any, len(marks))
		for i, mark := range marks {
			list[i] = map[string]any{"type": mark}
		}
		node["marks"] = list
	}
	return map[string]any{"type": "run", "attrs": mockAttrs(nil), "content": []any{node}}
}

func mockInline(text string) []any {
	return []any{mockRun(text)}
}

func mockParagraph(text string) mockBlock {
	return mockBlock{map[string]any{"type": "paragraph", "attrs": mockAttrs(nil), "content": mockInline(text)}, text}
}

func mockBoldParagraph(lead, text string) mockBlock {
	return mockBlock{
		map[string]any{"type": "paragraph", "attrs": mockAttrs(nil), "content": []any{mockRun(lead, "strong"), mockRun(text)}},
		"**" + lead + "**" + text,
	}
}

func mockHeading(level int, text string) mockBlock {
	return mockBlock{
		map[string]any{"type": "atx_heading", "attrs": mockAttrs(map[string]any{"level": level}), "content": mockInline(text)},
		strings.Repeat("#", level) + " " + text,
	}
}

func mockList(kind string, items ...string) mockBlock {
	content := make([]any, len(items))
	lines := make([]string, len(items))
	for i, item := range items {
		itemType, attributes, marker := "list_item", map[string]any(nil), "- "
		switch kind {
		case "order_list":
			marker = fmt.Sprintf("%d. ", i+1)
		case "task_list":
			itemType, attributes, marker = "task_list_item", map[string]any{"checked": false}, "- [ ] "
		}
		content[i] = map[string]any{"type": itemType, "attrs": mockAttrs(attributes), "content": []any{mockParagraph(item).json}}
		lines[i] = marker + item
	}
	attributes := map[string]any(nil)
	if kind == "order_list" {
		attributes = map[string]any{"start": 1}
	}
	return mockBlock{map[string]any{"type": kind, "attrs": mockAttrs(attributes), "content": content}, strings.Join(lines, "\n")}
}

func mockCode(lang, source string) mockBlock {
	return mockBlock{
		map[string]any{"type": "code_block", "attrs": mockAttrs(map[string]any{"lang": lang}), "content": []any{map[string]any{"type": "text", "text": source}}},
		"```" + lang + "\n" + source + "\n```",
	}
}

func mockQuote(text string) mockBlock {
	return mockBlock{
		map[string]any{"type": "block_quote", "attrs": mockAttrs(nil), "content": []any{mockParagraph(text).json}},
		"> " + text,
	}
}

func mockRule() mockBlock {
	return mockBlock{map[string]any{"type": "thematic_break", "attrs": mockAttrs(nil)}, "---"}
}

func mockTable(rows ...[]string) mockBlock {
	tableRows := make([]any, len(rows))
	lines := make([]string, 0, len(rows)+1)
	for i, row := range rows {
		cells := make([]any, len(row))
		for j, cell := range row {
			cells[j] = map[string]any{"type": "table_cell", "attrs": mockAttrs(nil), "content": mockInline(cell)}
		}
		tableRows[i] = map[string]any{"type": "table_row", "attrs": mockAttrs(nil), "content": cells}
		lines = append(lines, "| "+strings.Join(row, " | ")+" |")
		if i == 0 {
			separators := make([]string, len(row))
			for j := range separators {
				separators[j] = "---"
			}
			lines = append(lines, "| "+strings.Join(separators, " | ")+" |")
		}
	}
	return mockBlock{map[string]any{"type": "table", "attrs": mockAttrs(nil), "content": tableRows}, strings.Join(lines, "\n")}
}

func newMockDocument(title string, blocks ...mockBlock) mockDocument {
	content := make([]any, len(blocks))
	parts := make([]string, len(blocks))
	for i, block := range blocks {
		content[i] = block.json
		parts[i] = block.markdown
	}
	root := map[string]any{"type": "doc", "content": []any{
		map[string]any{"type": "document", "attrs": mockAttrs(nil), "content": content},
	}}
	encoded, _ := json.Marshal(root)
	return mockDocument{title: title, json: string(encoded), markdown: strings.Join(parts, "\n\n") + "\n"}
}

// mockMarkdownDocuments are the sample documents of the demo workspace.
func mockMarkdownDocuments() []mockDocument {
	return []mockDocument{
		newMockDocument("Order Processing FSD",
			mockHeading(1, "Functional Specification: Order Processing Service"),
			mockParagraph("The Order Processing Service manages cart validation, inventory reservation, payment authorization, and fulfillment dispatch."),
			mockHeading(2, "Order states"),
			mockList("bullet_list",
				"PENDING: order placed, waiting for payment confirmation.",
				"PAID: payment verified by the gateway.",
				"PROCESSING: warehouse allocation underway.",
				"SHIPPED: courier tracking active.",
				"COMPLETED: received by the customer."),
			mockHeading(2, "Open work"),
			mockList("task_list", "Confirm the reservation timeout with payments", "Write the refund state diagram", "Review webhook retries"),
			mockHeading(2, "Event shape"),
			mockCode("ts", "type OrderPaid = { orderId: string; amount: number; paidAt: string }"),
			mockQuote("Reservations expire after fifteen minutes."),
		),
		newMockDocument("Release checklist",
			mockHeading(1, "Release checklist"),
			mockBoldParagraph("Before you ship: ", "run through the steps in order."),
			mockList("order_list", "Freeze the release branch", "Run the full test suite", "Tag the release", "Announce it in the team channel"),
			mockRule(),
			mockHeading(2, "Owners"),
			mockTable([]string{"Area", "Owner"}, []string{"API", "Backend team"}, []string{"Editor", "Frontend team"}),
		),
		newMockDocument("Meeting notes",
			mockHeading(1, "Weekly sync"),
			mockParagraph("Start typing here, or paste a Markdown document."),
		),
	}
}
