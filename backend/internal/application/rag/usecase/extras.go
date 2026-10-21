package usecase

import (
	"context"
	"errors"
	"path"
	"strings"
	"unicode/utf8"

	"backend/constant"
	"backend/internal/domain/model"

	"github.com/google/uuid"
)

// Limits on what one question may carry besides its text.
const (
	MaxCategories     = 5
	MaxContextChats   = 2
	MaxAttachments    = 5
	maxAttachmentName = 120
	// MaxAttachmentRunes is the text of all attachments of one question together.
	MaxAttachmentRunes = 200_000
	// Limits on the editor state of a question.
	MaxEditorDiagnostics  = 20
	MaxEditorMessageRunes = 500
	MaxEditorExcerptRunes = 8000
	// contextMessageRunes cuts each message of a chat brought in as context.
	contextMessageRunes = 1500
)

// attachmentTypes are the text file types a question may carry; the browser
// reads them as text, so nothing else (a PDF, an executable) is accepted.
var attachmentTypes = map[string]bool{
	".txt": true, ".md": true, ".markdown": true, ".csv": true, ".tsv": true, ".json": true, ".log": true,
}

// AttachmentInput is a file as the browser read it.
type AttachmentInput struct {
	Name string
	Text string
}

// EditorInput is what a DBML or Mermaid editor showed when the question was sent.
type EditorInput struct {
	DocumentID  uuid.UUID
	Kind        string
	Cursor      model.EditorPosition
	Diagnostics []model.EditorDiagnostic
	Excerpt     model.EditorExcerpt
}

// ExtrasInput is what a question names besides its text, before it is checked.
type ExtrasInput struct {
	CategoryIDs    []uuid.UUID
	ContextChatIDs []uuid.UUID
	Attachments    []AttachmentInput
	Editor         *EditorInput
}

// Categories lists the categories the User may narrow a question to.
func (u *ChatUseCase) Categories(ctx context.Context, workspaceID, actorID uuid.UUID) ([]model.RAGCategory, error) {
	if workspaceID == uuid.Nil || actorID == uuid.Nil {
		return nil, ErrInvalidChatRequest
	}
	return u.repository.RAGCategories(ctx, workspaceID, actorID)
}

// PrepareExtras checks the categories, chats and files a question carries and
// returns them ready to use. A category the User cannot see, a chat that is not
// theirs (or is the one being asked in), or a file of the wrong kind or size
// makes the whole question invalid.
func (u *ChatUseCase) PrepareExtras(ctx context.Context, workspaceID, actorID, conversationID uuid.UUID, in ExtrasInput) (model.QuestionExtras, error) {
	var extras model.QuestionExtras
	categories := unique(in.CategoryIDs)
	chats := unique(in.ContextChatIDs)
	if len(categories) > MaxCategories || len(chats) > MaxContextChats || len(in.Attachments) > MaxAttachments || len(in.ContextChatIDs) > MaxContextChats {
		return extras, ErrInvalidChatRequest
	}
	if len(categories) > 0 {
		visible, err := u.repository.CountVisibleRAGCategories(ctx, workspaceID, actorID, categories)
		if err != nil {
			return extras, err
		}
		if visible != len(categories) {
			return extras, ErrInvalidChatRequest
		}
		extras.CategoryIDs = categories
	}
	for _, id := range chats {
		if id == conversationID {
			return extras, ErrInvalidChatRequest
		}
	}
	if len(chats) > 0 {
		found, err := u.repository.RAGContextChats(ctx, workspaceID, actorID, chats)
		if errors.Is(err, constant.ErrDocumentNotFound) {
			return extras, ErrInvalidChatRequest
		}
		if err != nil {
			return extras, err
		}
		for i := range found {
			for j := range found[i].Messages {
				found[i].Messages[j].Content = clip(found[i].Messages[j].Content, contextMessageRunes)
			}
		}
		extras.ContextChats = found
	}
	if in.Editor != nil {
		editor, err := u.prepareEditor(ctx, actorID, conversationID, *in.Editor)
		if err != nil {
			return extras, err
		}
		extras.Editor = &editor
	}
	total := 0
	for _, file := range in.Attachments {
		name := strings.TrimSpace(file.Name)
		total += utf8.RuneCountInString(file.Text)
		if name == "" || utf8.RuneCountInString(name) > maxAttachmentName || strings.ContainsAny(name, `/\`) ||
			!attachmentTypes[strings.ToLower(path.Ext(name))] || strings.TrimSpace(file.Text) == "" || total > MaxAttachmentRunes {
			return extras, ErrInvalidChatRequest
		}
		extras.Attachments = append(extras.Attachments, model.QuestionAttachment{ID: uuid.New(), Name: name, Text: file.Text})
	}
	return extras, nil
}

// prepareEditor accepts the editor state only for the document the chat is
// about, and only within the limits; the text is the browser's, so it stays data.
func (u *ChatUseCase) prepareEditor(ctx context.Context, actorID, conversationID uuid.UUID, in EditorInput) (model.EditorContext, error) {
	if (in.Kind != "dbml" && in.Kind != "mermaid") || len(in.Diagnostics) > MaxEditorDiagnostics ||
		utf8.RuneCountInString(in.Excerpt.Text) > MaxEditorExcerptRunes || in.Cursor.Line < 1 || in.Cursor.Column < 1 {
		return model.EditorContext{}, ErrInvalidChatRequest
	}
	for _, d := range in.Diagnostics {
		if (d.Severity != "error" && d.Severity != "warning") || utf8.RuneCountInString(d.Message) > MaxEditorMessageRunes ||
			d.Line < 1 || d.Column < 1 || d.EndLine < d.Line {
			return model.EditorContext{}, ErrInvalidChatRequest
		}
	}
	history, err := u.repository.GetRAGConversation(ctx, conversationID, actorID)
	if err != nil {
		return model.EditorContext{}, err
	}
	if history.Conversation.DocumentID == nil || *history.Conversation.DocumentID != in.DocumentID {
		return model.EditorContext{}, ErrInvalidChatRequest
	}
	return model.EditorContext{DocumentID: in.DocumentID, Kind: in.Kind, Cursor: in.Cursor, Diagnostics: in.Diagnostics, Excerpt: in.Excerpt}, nil
}

func unique(ids []uuid.UUID) []uuid.UUID {
	seen := make(map[uuid.UUID]bool, len(ids))
	out := make([]uuid.UUID, 0, len(ids))
	for _, id := range ids {
		if !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	return out
}
