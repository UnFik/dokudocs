package policy

import (
	"strings"
	"unicode"
	"unicode/utf8"
)

const (
	minDisplayName = 2
	maxDisplayName = 100
)

// A mention is stored as @[Name](user:id), so a name that holds the characters
// of that syntax, or a line break, could end the token early or start another.
func forbiddenInDisplayName(r rune) bool {
	switch r {
	case '[', ']', '(', ')', '@':
		return true
	}
	return unicode.IsControl(r) || (unicode.IsSpace(r) && r != ' ')
}

// ValidDisplayName says whether a person's name is safe to put in a mention.
func ValidDisplayName(name string) bool {
	name = strings.TrimSpace(name)
	if n := utf8.RuneCountInString(name); n < minDisplayName || n > maxDisplayName {
		return false
	}
	return strings.IndexFunc(name, forbiddenInDisplayName) < 0
}

// CleanDisplayName fits a name that was not typed here, such as one a sign-in
// provider sent, to what ValidDisplayName allows. It swaps what is forbidden for
// a space and falls back to the email when too little is left.
func CleanDisplayName(name, email string) string {
	if cleaned := cleanName(name); utf8.RuneCountInString(cleaned) >= minDisplayName {
		return cleaned
	}
	if cleaned := cleanName(email); utf8.RuneCountInString(cleaned) >= minDisplayName {
		return cleaned
	}
	return "User"
}

func cleanName(name string) string {
	spaced := strings.Map(func(r rune) rune {
		if forbiddenInDisplayName(r) {
			return ' '
		}
		return r
	}, name)
	cleaned := strings.Join(strings.Fields(spaced), " ")
	if utf8.RuneCountInString(cleaned) > maxDisplayName {
		cleaned = strings.TrimSpace(string([]rune(cleaned)[:maxDisplayName]))
	}
	return cleaned
}
