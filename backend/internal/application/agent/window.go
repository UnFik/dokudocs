package agent

import (
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"
)

const (
	// defaultReadWindow is how much of a document one read_document call returns.
	defaultReadWindow = 24000
	maxReadWindow     = 60000
)

var outlineHeading = regexp.MustCompile(`^(#{1,6})\s+(.+?)\s*#*\s*$`)

// OutlineEntry is one heading of a document and where it starts.
type OutlineEntry struct {
	Heading string `json:"heading"`
	Level   int    `json:"level"`
	Offset  int    `json:"offset"`
	Chars   int    `json:"chars"`
}

// readOutput is what read_document answers. Its fields are in the order a cut-off
// result must keep them in: the version and the position come before the text.
type readOutput struct {
	ID         any            `json:"id"`
	Title      string         `json:"title"`
	Type       string         `json:"type"`
	Project    any            `json:"project"`
	Tags       any            `json:"tags"`
	Categories any            `json:"categories"`
	UpdatedAt  any            `json:"updatedAt"`
	Version    string         `json:"version"`
	CanEdit    bool           `json:"canEdit"`
	CanSuggest bool           `json:"canSuggest"`
	TotalChars int            `json:"totalChars"`
	Offset     int            `json:"offset"`
	NextOffset *int           `json:"nextOffset,omitempty"`
	Truncated  bool           `json:"truncated,omitempty"`
	Hint       string         `json:"hint,omitempty"`
	Outline    []OutlineEntry `json:"outline,omitempty"`
	Content    string         `json:"content"`
}

// window puts the part of text from offset, at most limit characters, in the output.
// A part ends at a line break when it can, so a heading or sentence is not split.
func (o *readOutput) window(text string, offset, limit int, outlineOnly, markdown bool) {
	runes := []rune(text)
	total := len(runes)
	o.TotalChars = total
	if markdown {
		o.Outline = outline(runes)
	}
	if outlineOnly {
		o.Hint = fmt.Sprintf("Outline only; the document has %d characters. Read a part with offset and limit.", total)
		return
	}
	if limit <= 0 {
		limit = defaultReadWindow
	}
	limit = min(limit, maxReadWindow)
	offset = max(0, min(offset, total))
	end := min(offset+limit, total)
	if end < total {
		for cut := end; cut > offset+limit/2; cut-- {
			if runes[cut-1] == '\n' {
				end = cut
				break
			}
		}
	}
	o.Offset = offset
	o.Content = string(runes[offset:end])
	if end < total {
		next := end
		o.NextOffset, o.Truncated = &next, true
		o.Hint = fmt.Sprintf("Showing characters %d to %d of %d. If you are changing the document, make this part's changes now with one edit_document_content call, before you read on; with several parts, call plan_update first. An edit moves the offsets after it, so after one read on with start_at, set to words from the first line you have not changed. Without an edit, call read_document again with offset %d for the next part; the version stays the same.", offset, end, total, end)
	} else if offset == 0 {
		o.Outline = nil
	}
}

// startOffset is where a read begins: the line that holds the first startAt, which stays right
// while edits above it move the offsets; without startAt, the offset the call gave.
func startOffset(text, startAt string, offset int) (int, string) {
	if strings.TrimSpace(startAt) == "" {
		return offset, ""
	}
	at := strings.Index(text, startAt)
	if at < 0 {
		return offset, "start_at was not found in the document, so this part starts at offset. "
	}
	lineStart := strings.LastIndex(text[:at], "\n") + 1
	return utf8.RuneCountInString(text[:lineStart]), ""
}

// outline lists the headings of Markdown text, ignoring lines inside code fences.
func outline(runes []rune) []OutlineEntry {
	var entries []OutlineEntry
	inFence := false
	offset := 0
	for _, line := range strings.SplitAfter(string(runes), "\n") {
		length := len([]rune(line))
		trimmed := strings.TrimRight(line, "\r\n")
		switch {
		case strings.HasPrefix(strings.TrimSpace(trimmed), "```") || strings.HasPrefix(strings.TrimSpace(trimmed), "~~~"):
			inFence = !inFence
		case !inFence:
			if m := outlineHeading.FindStringSubmatch(trimmed); m != nil {
				entries = append(entries, OutlineEntry{Heading: m[2], Level: len(m[1]), Offset: offset})
			}
		}
		offset += length
	}
	for i := range entries {
		end := len(runes)
		if i+1 < len(entries) {
			end = entries[i+1].Offset
		}
		entries[i].Chars = end - entries[i].Offset
	}
	if len(entries) > 200 {
		entries = entries[:200]
	}
	return entries
}
