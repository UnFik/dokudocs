package agent

import (
	"encoding/json"
	"regexp"
	"strings"

	"github.com/google/uuid"
)

var headingLine = regexp.MustCompile(`^(#{1,6})\s+(.+)$`)

type pmNode struct {
	Type    string            `json:"type"`
	Attrs   map[string]string `json:"attrs,omitempty"`
	Content []pmNode          `json:"content,omitempty"`
	Text    string            `json:"text,omitempty"`
}

func block(kind, attributes string, text string) pmNode {
	attrs := func(a string) map[string]string {
		return map[string]string{"nodeID": uuid.NewString(), "bodyAttributes": a, "bodyContent": ""}
	}
	run := pmNode{Type: "run", Attrs: attrs("{}")}
	if text != "" {
		run.Content = []pmNode{{Type: "text", Text: text}}
	}
	return pmNode{Type: kind, Attrs: attrs(attributes), Content: []pmNode{run}}
}

// MarkdownToContentJSON turns the plain text the Agent writes into the editor's
// document: lines starting with # are headings, other lines are paragraphs that
// end at a blank line. Richer Markdown is kept as text.
func MarkdownToContentJSON(text string) json.RawMessage {
	blocks := []pmNode{}
	var paragraph []string
	flush := func() {
		if len(paragraph) > 0 {
			blocks = append(blocks, block("paragraph", "{}", strings.Join(paragraph, " ")))
			paragraph = nil
		}
	}
	for _, line := range strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n") {
		line = strings.TrimSpace(line)
		switch m := headingLine.FindStringSubmatch(line); {
		case line == "":
			flush()
		case m != nil:
			flush()
			level, _ := json.Marshal(map[string]int{"level": len(m[1])})
			blocks = append(blocks, block("atx_heading", string(level), strings.TrimSpace(m[2])))
		default:
			paragraph = append(paragraph, line)
		}
	}
	flush()
	root := pmNode{Type: "document", Attrs: map[string]string{"nodeID": uuid.NewString(), "bodyAttributes": "{}", "bodyContent": ""}, Content: blocks}
	raw, _ := json.Marshal(pmNode{Type: "doc", Content: []pmNode{root}})
	return raw
}
