package usecase

import (
	"context"
	"regexp"
	"strings"

	"backend/internal/domain/model"

	"github.com/google/uuid"
)

// previewExcerptRunes is how much of a page a hover card shows.
const (
	previewExcerptRunes  = 300
	previewMarkdownRunes = 1500
	previewDiagramRunes  = 20000
)

// GetDocumentPreview is what a hover card shows of a page. It is readable by
// whoever may read the page, and never carries the whole body.
func (u *useCase) GetDocumentPreview(ctx context.Context, id, workspaceID, userID uuid.UUID) (data model.DocumentPreview, err error) {
	doc, err := u.GetDocument(ctx, id, workspaceID, userID)
	if err != nil {
		return data, err
	}
	data = model.DocumentPreview{
		ID:            doc.ID,
		Title:         doc.Title,
		Type:          doc.Type,
		Thumbnail:     firstNonEmpty(doc.Thumbnail, doc.ThumbnailPreview),
		ThumbnailDark: firstNonEmpty(doc.ThumbnailDark, doc.ThumbnailPreviewDark),
		Author:        doc.Author,
		UpdatedAt:     doc.UpdatedAt,
	}
	switch doc.Type {
	case "markdown":
		data.Excerpt = plainExcerpt(doc.Content, previewExcerptRunes)
		data.PreviewSource = firstRunes(doc.Content, previewMarkdownRunes)
	case "mermaid", "dbdiagram":
		// Without a stored drawing the client draws one, as the cards of the page list do.
		if data.Thumbnail == "" && len([]rune(doc.Content)) <= previewDiagramRunes {
			data.PreviewSource = doc.Content
		}
	}
	return data, nil
}

func firstRunes(text string, limit int) string {
	runes := []rune(text)
	if len(runes) <= limit {
		return text
	}
	return string(runes[:limit])
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

var (
	markdownLink  = regexp.MustCompile(`!?\[([^\]]*)\]\([^)]*\)`)
	markdownMarks = regexp.MustCompile("(?m)^\\s{0,3}(#{1,6}|>|[-*+]|\\d+\\.)\\s+|```[^\\n]*|[*_`~]+")
	htmlTag       = regexp.MustCompile(`<[^>]+>`)
)

// plainExcerpt is the start of Markdown text with its marks taken out, cut at
// limit characters.
func plainExcerpt(markdown string, limit int) string {
	text := markdownLink.ReplaceAllString(markdown, "$1")
	text = htmlTag.ReplaceAllString(text, "")
	text = markdownMarks.ReplaceAllString(text, "")
	text = strings.Join(strings.Fields(text), " ")
	runes := []rune(text)
	if len(runes) <= limit {
		return text
	}
	return strings.TrimSpace(string(runes[:limit])) + "…"
}
