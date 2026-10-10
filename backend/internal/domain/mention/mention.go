// Package mention reads and writes the token a comment keeps for a person it
// names: @[Name](user:<id>). The same grammar is in the frontend, and both are
// held to fixtures/comment-mentions.json.
package mention

import (
	"regexp"

	"github.com/google/uuid"
)

// The label holds neither brackets, parentheses nor control characters, so a
// token ends where it seems to; anything else that looks like one stays text.
var tokenPattern = regexp.MustCompile(
	`@\[([^\[\]()\x00-\x1f\x7f]{1,100})\]\(user:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)`)

// Mention is one person named in a comment.
type Mention struct {
	UserID uuid.UUID
	Label  string
}

// Parse lists the mentions of a comment in order, one per token, so a person
// named twice appears twice.
func Parse(content string) []Mention {
	var found []Mention
	for _, match := range tokenPattern.FindAllStringSubmatch(content, -1) {
		id, err := uuid.Parse(match[2])
		if err != nil {
			continue
		}
		found = append(found, Mention{UserID: id, Label: match[1]})
	}
	return found
}

// Visible is the comment as it reads: each token shows as @Name.
func Visible(content string) string {
	return tokenPattern.ReplaceAllString(content, "@$1")
}

// Rewrite gives every token the label that label returns for its person.
func Rewrite(content string, label func(uuid.UUID) string) string {
	return tokenPattern.ReplaceAllStringFunc(content, func(token string) string {
		match := tokenPattern.FindStringSubmatch(token)
		id, err := uuid.Parse(match[2])
		if err != nil {
			return token
		}
		return Token(id, label(id))
	})
}

// Token is how a person is named in a comment.
func Token(id uuid.UUID, label string) string {
	return "@[" + label + "](user:" + id.String() + ")"
}
