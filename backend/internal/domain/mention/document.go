package mention

import (
	"regexp"
	"strings"
	"unicode"

	"github.com/google/uuid"
)

// A question to the Agent names a document the same way a comment names a
// person, with the kind in place of "user": @[Title](doc:<id>) (ADR 0036). The
// frontend reads the same grammar and both are held to
// frontend/src/lib/document-mentions.fixture.json.
var documentPattern = regexp.MustCompile(
	`@\[([^\[\]()\x00-\x1f\x7f]{1,100})\]\(doc:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)`)

// DocumentMention is one document named in a question.
type DocumentMention struct {
	DocumentID uuid.UUID
	Label      string
}

// ParseDocuments lists the documents a question names, one per token in order.
func ParseDocuments(content string) []DocumentMention {
	var found []DocumentMention
	for _, match := range documentPattern.FindAllStringSubmatch(content, -1) {
		id, err := uuid.Parse(match[2])
		if err != nil {
			continue
		}
		found = append(found, DocumentMention{DocumentID: id, Label: match[1]})
	}
	return found
}

// VisibleDocuments is the question as it reads: each token shows as @Title.
func VisibleDocuments(content string) string {
	return documentPattern.ReplaceAllString(content, "@$1")
}

// RewriteDocuments gives every token the label that label returns for its document.
func RewriteDocuments(content string, label func(uuid.UUID) string) string {
	return documentPattern.ReplaceAllStringFunc(content, func(token string) string {
		match := documentPattern.FindStringSubmatch(token)
		id, err := uuid.Parse(match[2])
		if err != nil {
			return token
		}
		return "@[" + label(id) + "](doc:" + id.String() + ")"
	})
}

// DocumentLabel turns a title into a label a token can hold: no brackets,
// parentheses, "@" or control characters, single-spaced, at most 100 characters.
func DocumentLabel(title string) string {
	cleaned := strings.Map(func(r rune) rune {
		switch {
		case r == '[' || r == ']' || r == '(' || r == ')' || r == '@':
			return -1
		case unicode.IsControl(r):
			return ' '
		}
		return r
	}, title)
	cleaned = strings.Join(strings.Fields(cleaned), " ")
	if runes := []rune(cleaned); len(runes) > 100 {
		cleaned = strings.TrimSpace(string(runes[:100]))
	}
	if cleaned == "" {
		return "Untitled"
	}
	return cleaned
}
