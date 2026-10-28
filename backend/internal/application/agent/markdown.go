package agent

import (
	"encoding/json"
	"regexp"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"
)

var headingLine = regexp.MustCompile(`^(#{1,6})\s+(.+)$`)

type pmNode struct {
	Type    string            `json:"type"`
	Attrs   map[string]string `json:"attrs,omitempty"`
	Content []pmNode          `json:"content,omitempty"`
	Text    string            `json:"text,omitempty"`
	Marks   []pmMark          `json:"marks,omitempty"`
}

type pmMark struct {
	Type  string            `json:"type"`
	Attrs map[string]string `json:"attrs,omitempty"`
}

func nodeAttrs(bodyAttributes string) map[string]string {
	return map[string]string{"nodeID": uuid.NewString(), "bodyAttributes": bodyAttributes, "bodyContent": ""}
}

func encode(attributes any) string {
	raw, _ := json.Marshal(attributes)
	return string(raw)
}

// container is a node that holds blocks, with the attributes the editor gives it.
func container(kind string, attributes any, children []pmNode) pmNode {
	return pmNode{Type: kind, Attrs: nodeAttrs(encode(attributes)), Content: children}
}

func block(kind, attributes string, text string) pmNode {
	return pmNode{Type: kind, Attrs: nodeAttrs(attributes), Content: inlineRuns(text)}
}

// A run holds one formatting, so each formatted stretch of a line is its own run.
type inlineSpan struct {
	text string
	// formats are the run attributes (bold, italic, strike, code, ...), href the link target.
	formats []string
	href    string
	title   string
}

func (s inlineSpan) same(o inlineSpan) bool {
	return s.href == o.href && s.title == o.title && strings.Join(s.formats, ",") == strings.Join(o.formats, ",")
}

var markOfFormat = map[string]string{"bold": "strong", "italic": "em", "strike": "strike", "code": "code", "underline": "underline", "highlight": "highlight"}

// inlineToken finds the leftmost of: `code`, \escape, [label](address "title"), <address>, a bare
// address, ***both***, **bold**, ~~strike~~, ==highlight==, <u>underline</u>, __bold__, *italic*, _italic_.
// The group numbers are the ones collab/src/agent-edit.ts uses.
var inlineToken = regexp.MustCompile(strings.Join([]string{
	"`([^`\\n]+)`",
	"\\\\([\\\\`*_{}\\[\\]()#+\\-.!|~<>=])",
	`\[([^\]\n]+)\]\(((?:[^()\s]|\([^()\s]*\))+)(?:\s+"([^"]*)")?\)`,
	`<((?:https?://|mailto:)[^>\s]+)>`,
	`(https?://[^\s<>]+)`,
	`\*\*\*([^*\s](?:[^*]*[^*\s])?)\*\*\*`,
	`\*\*([^*\s](?:[^*]*[^*\s])?)\*\*`,
	`~~([^~\s](?:[^~]*[^~\s])?)~~`,
	`==([^=\s](?:[^=]*[^=\s])?)==`,
	`<u>([^<\n]+)</u>`,
	`__([^_\s](?:[^_]*[^_\s])?)__`,
	`\*([^*\s](?:[^*]*[^*\s])?)\*`,
	`_([^_\s](?:[^_]*[^_\s])?)_`,
}, "|"))

// safeLink mirrors the editor's normalizeLinkTarget: only these addresses become links.
func safeLink(target string) bool {
	if target == "" || strings.ContainsAny(target, " \t\r\n<>\"") {
		return false
	}
	lower := strings.ToLower(target)
	for _, prefix := range []string{"http:", "https:", "mailto:", "tel:", "#", "./", "../"} {
		if strings.HasPrefix(lower, prefix) {
			return true
		}
	}
	return strings.HasPrefix(target, "/") && !strings.HasPrefix(target, "//")
}

func isWordRune(r rune, size int) bool {
	return size > 0 && (r == '_' || unicode.IsLetter(r) || unicode.IsDigit(r))
}

// bareAddress ends an address before the punctuation that follows it in a sentence, and
// before a closing bracket it did not open.
func bareAddress(value string) string {
	end := len(value)
	for end > 0 {
		last := value[end-1]
		opens := strings.Count(value[:end], "(")
		closes := strings.Count(value[:end], ")")
		if strings.IndexByte(".,;:!?'\"*_~", last) >= 0 || (last == ')' && closes > opens) {
			end--
			continue
		}
		break
	}
	return value[:end]
}

func withFormat(formats []string, extra ...string) []string {
	return append(append([]string{}, formats...), extra...)
}

func inlineSpans(text string, formats []string, href, title string) []inlineSpan {
	var spans []inlineSpan
	plain := func(t string) {
		if t != "" {
			spans = append(spans, inlineSpan{text: t, formats: formats, href: href, title: title})
		}
	}
	inner := func(t string, extra ...string) {
		spans = append(spans, inlineSpans(t, withFormat(formats, extra...), href, title)...)
	}
	for text != "" {
		m := inlineToken.FindStringSubmatchIndex(text)
		if m == nil {
			plain(text)
			break
		}
		start, end := m[0], m[1]
		group := func(n int) (string, bool) {
			if m[2*n] < 0 {
				return "", false
			}
			return text[m[2*n]:m[2*n+1]], true
		}
		before := text[:start]
		switch {
		case m[2] >= 0:
			code, _ := group(1)
			if (start > 0 && text[start-1] == '`') || (end < len(text) && text[end] == '`') {
				plain(text[:end])
			} else {
				plain(before)
				spans = append(spans, inlineSpan{text: code, formats: withFormat(formats, "code"), href: href, title: title})
			}
		case m[4] >= 0:
			literal, _ := group(2)
			plain(before)
			plain(literal)
		case m[6] >= 0:
			label, _ := group(3)
			target, _ := group(4)
			linkTitle, _ := group(5)
			// An image, or an address the editor would not link: stays as written.
			if (start > 0 && text[start-1] == '!') || !safeLink(target) {
				plain(text[:end])
			} else {
				plain(before)
				spans = append(spans, inlineSpans(label, formats, target, linkTitle)...)
			}
		case m[12] >= 0:
			target, _ := group(6)
			plain(before)
			spans = append(spans, inlineSpans(target, formats, target, title)...)
		case m[14] >= 0:
			found, _ := group(7)
			address := bareAddress(found)
			end = start + len(address)
			if href != "" || len(address) <= len("https://") {
				plain(text[:end])
			} else {
				plain(before)
				spans = append(spans, inlineSpan{text: address, formats: formats, href: address})
			}
		case m[16] >= 0:
			value, _ := group(8)
			plain(before)
			inner(value, "bold", "italic")
		case m[18] >= 0:
			value, _ := group(9)
			plain(before)
			inner(value, "bold")
		case m[20] >= 0:
			value, _ := group(10)
			plain(before)
			inner(value, "strike")
		case m[22] >= 0:
			value, _ := group(11)
			plain(before)
			inner(value, "highlight")
		case m[24] >= 0:
			value, _ := group(12)
			plain(before)
			inner(value, "underline")
		case m[26] >= 0 || m[30] >= 0:
			// An underscore inside a word (snake_case) is text.
			format, n := "bold", 13
			if m[26] < 0 {
				format, n = "italic", 15
			}
			value, _ := group(n)
			prev, prevSize := utf8.DecodeLastRuneInString(before)
			next, nextSize := utf8.DecodeRuneInString(text[end:])
			if isWordRune(prev, prevSize) || isWordRune(next, nextSize) {
				plain(text[:end])
			} else {
				plain(before)
				inner(value, format)
			}
		default:
			value, _ := group(14)
			plain(before)
			inner(value, "italic")
		}
		text = text[end:]
	}
	return spans
}

// inlineRuns turns a line of Markdown text into runs: links and bold, italic, strikethrough,
// highlight, underline and code marks are read, anything else stays as written.
func inlineRuns(text string) []pmNode {
	var merged []inlineSpan
	for _, span := range inlineSpans(text, nil, "", "") {
		if n := len(merged); n > 0 && merged[n-1].same(span) {
			merged[n-1].text += span.text
		} else {
			merged = append(merged, span)
		}
	}
	if len(merged) == 0 {
		return []pmNode{{Type: "run", Attrs: nodeAttrs("{}")}}
	}
	runs := make([]pmNode, 0, len(merged))
	for _, span := range merged {
		attributes := map[string]any{}
		var marks []pmMark
		for _, format := range span.formats {
			attributes[format] = true
			marks = append(marks, pmMark{Type: markOfFormat[format]})
		}
		if span.href != "" {
			attributes["href"] = span.href
			link := pmMark{Type: "link", Attrs: map[string]string{"href": span.href}}
			if span.title != "" {
				attributes["linkTitle"] = span.title
				link.Attrs["title"] = span.title
			}
			marks = append(marks, link)
		}
		runs = append(runs, pmNode{Type: "run", Attrs: nodeAttrs(encode(attributes)), Content: []pmNode{{Type: "text", Text: span.text, Marks: marks}}})
	}
	return runs
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

// parsedBlock is a block of the text an Agent writes, before it is made into editor nodes.
type parsedBlock struct {
	kind     string // paragraph, atx_heading, code_block, diagram, thematic_break, block_quote, notice, list, table
	text     string
	lang     string
	level    int
	variant  string
	listKind string // bullet, order, task
	start    int
	items    []listItem
	children []parsedBlock
	rows     [][]string
	aligns   []string
}

type listItem struct {
	task     bool
	checked  bool
	children []parsedBlock
}

var (
	listMarker     = regexp.MustCompile(`^( {0,3})([-*+]|\d{1,9}[.)])(?:( +)(.*))?$`)
	numberOne      = regexp.MustCompile(`^0*1[.)]$`)
	noticeLine     = regexp.MustCompile(`^:::(info|success|warning|tip)?[ \t]*$`)
	taskItem       = regexp.MustCompile(`^\[([ xX])\](?:[ \t]+(.*))?$`)
	tableDelimiter = regexp.MustCompile(`^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$`)
	quoteMarker    = regexp.MustCompile(`^ {0,3}> ?`)
)

func isQuoteLine(line string) bool {
	return leadingSpaces(line) <= 3 && strings.HasPrefix(line[leadingSpaces(line):], ">")
}

// isThematicBreak is three or more -, * or _ alone on a line, spaces between them allowed.
func isThematicBreak(line string) bool {
	indent := leadingSpaces(line)
	rest := strings.TrimRight(line[indent:], " \t")
	if indent > 3 || rest == "" || strings.IndexByte("-*_", rest[0]) < 0 {
		return false
	}
	count := 0
	for i := 0; i < len(rest); i++ {
		switch rest[i] {
		case rest[0]:
			count++
		case ' ', '\t':
		default:
			return false
		}
	}
	return count >= 3
}

// splitRow is the cells of a table row; a pipe after a backslash is text.
func splitRow(line string) []string {
	text := strings.TrimSpace(line)
	text = strings.TrimPrefix(text, "|")
	if strings.HasSuffix(text, "|") && !strings.HasSuffix(text, `\|`) {
		text = text[:len(text)-1]
	}
	var cells []string
	var cell strings.Builder
	for i := 0; i < len(text); i++ {
		switch {
		case text[i] == '\\' && i+1 < len(text) && text[i+1] == '|':
			cell.WriteByte('|')
			i++
		case text[i] == '|':
			cells = append(cells, strings.TrimSpace(cell.String()))
			cell.Reset()
		default:
			cell.WriteByte(text[i])
		}
	}
	return append(cells, strings.TrimSpace(cell.String()))
}

func alignOf(cell string) string {
	left, right := strings.HasPrefix(cell, ":"), strings.HasSuffix(cell, ":")
	switch {
	case left && right:
		return "center"
	case left:
		return "left"
	case right:
		return "right"
	}
	return "none"
}

func isDigit(c byte) bool { return c >= '0' && c <= '9' }

// interrupts reports whether a list marker line may start a list in the middle of a
// paragraph: a bullet, or a number one, with text after it.
func interrupts(marker []string) bool {
	return marker[4] != "" && (!isDigit(marker[2][0]) || numberOne.MatchString(marker[2]))
}

// parseList reads the list starting at line start. Items of one kind (bullet, number, task)
// make one list; a change of kind starts the next.
func parseList(lines []string, start int, headings bool) ([]parsedBlock, int) {
	var lists []parsedBlock
	ordered := isDigit(listMarker.FindStringSubmatch(lines[start])[2][0])
	i := start
	for i < len(lines) {
		marker := listMarker.FindStringSubmatch(lines[i])
		if marker == nil || isDigit(marker[2][0]) != ordered || isThematicBreak(lines[i]) {
			break
		}
		markerIndent := len(marker[1])
		first := marker[4]
		spaces := len(marker[3])
		offset := markerIndent + len(marker[2]) + 1
		if first != "" && spaces <= 4 {
			offset = markerIndent + len(marker[2]) + spaces
		}
		itemLines := []string{first}
		j := i + 1
		for j < len(lines) {
			line := lines[j]
			if strings.TrimSpace(line) == "" {
				k := j
				for k < len(lines) && strings.TrimSpace(lines[k]) == "" {
					k++
				}
				nested := k < len(lines) && (leadingSpaces(lines[k]) >= offset || (leadingSpaces(lines[k]) > markerIndent && listMarker.MatchString(lines[k])))
				if !nested {
					break
				}
				for ; j < k; j++ {
					itemLines = append(itemLines, "")
				}
				continue
			}
			indent := leadingSpaces(line)
			sibling := listMarker.MatchString(line)
			_, isFence := openingFence(line)
			switch {
			case indent >= offset:
				itemLines = append(itemLines, line[offset:])
			case sibling && indent > markerIndent && !isThematicBreak(line):
				itemLines = append(itemLines, line[indent:])
			case !sibling && itemLines[len(itemLines)-1] != "" && !isFence && !isQuoteLine(line) && !isThematicBreak(line) && !headingLine.MatchString(strings.TrimSpace(line)):
				itemLines = append(itemLines, strings.TrimSpace(line))
			default:
				goto itemEnd
			}
			j++
		}
	itemEnd:
		item := listItem{}
		kind := "bullet"
		if ordered {
			kind = "order"
		} else if task := taskItem.FindStringSubmatch(first); task != nil {
			kind, item.task, item.checked = "task", true, strings.EqualFold(task[1], "x")
			itemLines[0] = task[2]
		}
		item.children = parseLines(itemLines, headings)
		if n := len(lists); n > 0 && lists[n-1].listKind == kind {
			lists[n-1].items = append(lists[n-1].items, item)
		} else {
			number := 1
			if ordered {
				number, _ = strconv.Atoi(strings.TrimRight(marker[2], ".)"))
			}
			lists = append(lists, parsedBlock{kind: "list", listKind: kind, start: number, items: []listItem{item}})
		}
		// The list goes on at a sibling item, after blank lines too.
		k := j
		for k < len(lines) && strings.TrimSpace(lines[k]) == "" {
			k++
		}
		if k < len(lines) {
			if following := listMarker.FindStringSubmatch(lines[k]); following != nil && len(following[1]) <= markerIndent && isDigit(following[2][0]) == ordered {
				i = k
				continue
			}
		}
		i = j
		break
	}
	return lists, i
}

func parseLines(lines []string, headings bool) []parsedBlock {
	var blocks []parsedBlock
	var paragraph []string
	flush := func() {
		if len(paragraph) > 0 {
			blocks = append(blocks, parsedBlock{kind: "paragraph", text: strings.Join(paragraph, " ")})
			paragraph = nil
		}
	}
	for i := 0; i < len(lines); i++ {
		raw := lines[i]
		if f, ok := openingFence(raw); ok {
			flush()
			code := []string{}
			i++
			for ; i < len(lines) && !f.closes(lines[i]); i++ {
				code = append(code, f.unindent(lines[i]))
			}
			kind := "code_block"
			if f.lang == "mermaid" {
				kind = "diagram"
			}
			blocks = append(blocks, parsedBlock{kind: kind, lang: f.lang, text: strings.Join(code, "\n")})
			continue
		}
		line := strings.TrimSpace(raw)
		var heading []string
		if headings {
			heading = headingLine.FindStringSubmatch(line)
		}
		switch {
		case line == "":
			flush()
		case heading != nil:
			flush()
			blocks = append(blocks, parsedBlock{kind: "atx_heading", level: len(heading[1]), text: strings.TrimSpace(heading[2])})
		case isThematicBreak(raw):
			flush()
			blocks = append(blocks, parsedBlock{kind: "thematic_break"})
		case isQuoteLine(raw):
			flush()
			var quoted []string
			for ; i < len(lines) && isQuoteLine(lines[i]); i++ {
				quoted = append(quoted, quoteMarker.ReplaceAllString(lines[i], ""))
			}
			i--
			blocks = append(blocks, parsedBlock{kind: "block_quote", children: parseLines(quoted, headings)})
		case noticeLine.MatchString(line) && closesNotice(lines[i+1:]):
			flush()
			variant := noticeLine.FindStringSubmatch(line)[1]
			if variant == "" {
				variant = "info"
			}
			var inner []string
			for i++; strings.TrimSpace(lines[i]) != ":::"; i++ {
				inner = append(inner, lines[i])
			}
			blocks = append(blocks, parsedBlock{kind: "notice", variant: variant, children: parseLines(inner, headings)})
		case strings.Contains(raw, "|") && i+1 < len(lines) && strings.Contains(lines[i+1], "|") && tableDelimiter.MatchString(lines[i+1]) && len(splitRow(raw)) == len(splitRow(lines[i+1])):
			flush()
			head := splitRow(raw)
			rows := [][]string{head}
			aligns := []string{}
			for _, cell := range splitRow(lines[i+1]) {
				aligns = append(aligns, alignOf(cell))
			}
			for i += 2; i < len(lines) && strings.TrimSpace(lines[i]) != "" && strings.Contains(lines[i], "|"); i++ {
				cells := splitRow(lines[i])
				row := make([]string, len(head))
				copy(row, cells)
				rows = append(rows, row)
			}
			i--
			blocks = append(blocks, parsedBlock{kind: "table", rows: rows, aligns: aligns})
		default:
			if marker := listMarker.FindStringSubmatch(raw); marker != nil && (len(paragraph) == 0 || interrupts(marker)) {
				flush()
				lists, next := parseList(lines, i, headings)
				blocks = append(blocks, lists...)
				i = next - 1
			} else {
				paragraph = append(paragraph, line)
			}
		}
	}
	flush()
	return blocks
}

func closesNotice(rest []string) bool {
	for _, line := range rest {
		if strings.TrimSpace(line) == ":::" {
			return true
		}
	}
	return false
}

// buildBlocks makes editor nodes of blocks; a container always holds at least one block.
func buildBlocks(blocks []parsedBlock) []pmNode {
	if len(blocks) == 0 {
		return []pmNode{block("paragraph", "{}", "")}
	}
	nodes := make([]pmNode, 0, len(blocks))
	for _, b := range blocks {
		nodes = append(nodes, buildBlock(b))
	}
	return nodes
}

func buildBlock(b parsedBlock) pmNode {
	switch b.kind {
	case "code_block":
		return codeBlock(b.lang, b.text)
	case "diagram":
		return diagramBlock(b.text)
	case "thematic_break":
		return pmNode{Type: "thematic_break", Attrs: map[string]string{"nodeID": uuid.NewString(), "bodyAttributes": "{}", "bodyContent": "---"}}
	case "atx_heading":
		return block("atx_heading", encode(map[string]int{"level": b.level}), b.text)
	case "block_quote":
		return container("block_quote", map[string]any{}, buildBlocks(b.children))
	case "notice":
		return container("notice", map[string]string{"variant": b.variant}, buildBlocks(b.children))
	case "list":
		itemType, listType := "list_item", "bullet_list"
		attributes := map[string]any{"marker": "-", "loose": false}
		switch b.listKind {
		case "order":
			listType, attributes = "order_list", map[string]any{"start": b.start, "loose": false, "delimiter": "."}
		case "task":
			listType, itemType = "task_list", "task_list_item"
		}
		items := make([]pmNode, 0, len(b.items))
		for _, item := range b.items {
			itemAttributes := map[string]any{}
			if item.task {
				itemAttributes["checked"] = item.checked
			}
			items = append(items, container(itemType, itemAttributes, buildBlocks(item.children)))
		}
		return container(listType, attributes, items)
	case "table":
		rows := make([]pmNode, 0, len(b.rows))
		for _, cells := range b.rows {
			nodes := make([]pmNode, 0, len(cells))
			for at, cell := range cells {
				align := "none"
				if at < len(b.aligns) {
					align = b.aligns[at]
				}
				nodes = append(nodes, container("table_cell", map[string]string{"align": align}, inlineRuns(cell)))
			}
			rows = append(rows, container("table_row", map[string]any{}, nodes))
		}
		return container("table", map[string]any{}, rows)
	}
	return block("paragraph", "{}", b.text)
}

// MarkdownToContentJSON turns the text the Agent writes into the editor's document:
// headings, fenced code (``` or ~~~, kept exactly as written, ```mermaid as a diagram),
// quotes, bullet, numbered and task lists (nested too), tables, :::notices and separators
// become blocks, and other lines are paragraphs that end at a blank line. Inside a line,
// links, bold, italic, strikethrough, highlight, underline and code are read.
func MarkdownToContentJSON(text string) json.RawMessage {
	lines := strings.Split(strings.ReplaceAll(strings.ReplaceAll(text, "\r\n", "\n"), "\r", "\n"), "\n")
	blocks := []pmNode{}
	for _, b := range parseLines(lines, true) {
		blocks = append(blocks, buildBlock(b))
	}
	root := pmNode{Type: "document", Attrs: map[string]string{"nodeID": uuid.NewString(), "bodyAttributes": "{}", "bodyContent": ""}, Content: blocks}
	raw, _ := json.Marshal(pmNode{Type: "doc", Content: []pmNode{root}})
	return raw
}
