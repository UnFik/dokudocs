package htmlpage

import (
	"encoding/json"
	"strings"

	"golang.org/x/net/html"
)

var (
	// skipped elements hold code or hidden content, never words a reader sees.
	skipped = map[string]bool{"script": true, "style": true, "noscript": true, "template": true, "svg": true, "iframe": true, "object": true}
	// blocks start a new line.
	blocks = map[string]bool{
		"p": true, "div": true, "br": true, "li": true, "ul": true, "ol": true, "h1": true, "h2": true, "h3": true,
		"h4": true, "h5": true, "h6": true, "tr": true, "table": true, "section": true, "article": true, "header": true,
		"footer": true, "main": true, "nav": true, "aside": true, "pre": true, "blockquote": true, "hr": true,
		"figure": true, "figcaption": true, "dt": true, "dd": true, "dl": true, "form": true, "fieldset": true,
	}
)

// ExtractText reads the words a visitor would see in a page, without running it:
// the title first, then the body, with scripts, styles and hidden content left out.
// Paragraphs are separated by a blank line. It reads tokens, not a tree, so markup
// nested thousands deep or never closed costs no more than any other.
func ExtractText(page string) string {
	z := html.NewTokenizer(strings.NewReader(page))
	var title string
	var lines []string
	var line strings.Builder
	flush := func() {
		if text := strings.Join(strings.Fields(line.String()), " "); text != "" {
			lines = append(lines, text)
		}
		line.Reset()
	}
	skipTag, skipDepth := "", 0
	inTitle := false
	var titleText strings.Builder
	for {
		switch z.Next() {
		case html.ErrorToken:
			flush()
			if title != "" {
				lines = append([]string{title}, lines...)
			}
			return strings.Join(lines, "\n\n")
		case html.StartTagToken, html.SelfClosingTagToken:
			tok := z.Token()
			if skipDepth > 0 {
				if tok.Data == skipTag && tok.Type == html.StartTagToken {
					skipDepth++
				}
				continue
			}
			switch {
			case tok.Data == "title" && tok.Type == html.StartTagToken && title == "":
				inTitle = true
				titleText.Reset()
			case skipped[tok.Data] && tok.Type == html.StartTagToken:
				skipTag, skipDepth = tok.Data, 1
			case blocks[tok.Data]:
				flush()
			}
		case html.EndTagToken:
			tok := z.Token()
			if skipDepth > 0 {
				if tok.Data == skipTag {
					skipDepth--
				}
				continue
			}
			if tok.Data == "title" && inTitle {
				inTitle = false
				title = strings.Join(strings.Fields(titleText.String()), " ")
			}
			if blocks[tok.Data] {
				flush()
			}
		case html.TextToken:
			if skipDepth > 0 {
				continue
			}
			text := z.Token().Data
			if inTitle {
				titleText.WriteString(text)
			} else {
				line.WriteString(text)
				line.WriteByte(' ')
			}
		}
	}
}

// IndexJSON is what a page keeps in content_json: the text extracted from it, which
// the RAG index reads instead of running or parsing the page again.
func IndexJSON(page string) json.RawMessage {
	raw, _ := json.Marshal(map[string]string{"text": ExtractText(page)})
	return raw
}
