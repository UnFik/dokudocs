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

// fence is an opening code fence: three or more backticks or tildes, up to three
// spaces in, with the language as the first word after it.
type fence struct {
	char   byte
	length int
	indent int
	lang   string
}

func leadingSpaces(line string) int {
	n := 0
	for n < len(line) && line[n] == ' ' {
		n++
	}
	return n
}

func openingFence(line string) (fence, bool) {
	indent := leadingSpaces(line)
	rest := line[indent:]
	if indent > 3 || len(rest) < 3 || (rest[0] != '`' && rest[0] != '~') {
		return fence{}, false
	}
	length := 0
	for length < len(rest) && rest[length] == rest[0] {
		length++
	}
	if length < 3 {
		return fence{}, false
	}
	info := strings.TrimSpace(rest[length:])
	// A backtick fence whose info string holds a backtick is inline code, not a fence.
	if rest[0] == '`' && strings.Contains(info, "`") {
		return fence{}, false
	}
	lang := ""
	if words := strings.Fields(info); len(words) > 0 {
		lang = words[0]
	}
	return fence{char: rest[0], length: length, indent: indent, lang: lang}, true
}

// closes reports whether line ends the fence: the same character, at least as long,
// and nothing after it.
func (f fence) closes(line string) bool {
	indent := leadingSpaces(line)
	rest := strings.TrimRight(line[indent:], " \t")
	if indent > 3 || len(rest) < f.length {
		return false
	}
	return strings.Trim(rest, string(f.char)) == "" && len(rest) >= f.length
}

func (f fence) unindent(line string) string {
	return line[min(leadingSpaces(line), f.indent):]
}

// textBlock is a block whose text sits directly in it, not in a run, as the editor keeps code and diagrams.
func textBlock(kind, attributes, text string) pmNode {
	n := block(kind, attributes, "")
	n.Content = nil
	if text != "" {
		n.Content = []pmNode{{Type: "text", Text: text}}
	}
	return n
}

func codeBlock(lang, text string) pmNode {
	attributes, _ := json.Marshal(struct {
		Type string `json:"type"`
		Lang string `json:"lang"`
	}{"fenced", lang})
	return textBlock("code_block", string(attributes), text)
}

// diagramBlock is a Mermaid diagram, the same node the editor's /mermaid command makes.
func diagramBlock(text string) pmNode {
	attributes, _ := json.Marshal(struct {
		Type string `json:"type"`
		Lang string `json:"lang"`
	}{"mermaid", "yaml"})
	return textBlock("diagram", string(attributes), text)
}

// MarkdownToContentJSON turns the text the Agent writes into the editor's
// document: lines starting with # are headings, fenced code (``` or ~~~) is a code
// block kept exactly as written, and other lines are paragraphs that end at a blank
// line. Lists and tables are kept as text.
func MarkdownToContentJSON(text string) json.RawMessage {
	blocks := []pmNode{}
	var paragraph []string
	flush := func() {
		if len(paragraph) > 0 {
			blocks = append(blocks, block("paragraph", "{}", strings.Join(paragraph, " ")))
			paragraph = nil
		}
	}
	lines := strings.Split(strings.ReplaceAll(strings.ReplaceAll(text, "\r\n", "\n"), "\r", "\n"), "\n")
	for i := 0; i < len(lines); i++ {
		if f, ok := openingFence(lines[i]); ok {
			flush()
			code := []string{}
			i++
			for ; i < len(lines) && !f.closes(lines[i]); i++ {
				code = append(code, f.unindent(lines[i]))
			}
			if f.lang == "mermaid" {
				blocks = append(blocks, diagramBlock(strings.Join(code, "\n")))
			} else {
				blocks = append(blocks, codeBlock(f.lang, strings.Join(code, "\n")))
			}
			continue
		}
		line := strings.TrimSpace(lines[i])
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
