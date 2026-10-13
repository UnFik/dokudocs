package model

import (
	"encoding/json"
	"strings"
	"time"

	"github.com/google/uuid"
)

type RAGChunk struct {
	ChunkID           uuid.UUID
	DocumentID        uuid.UUID
	NodeID            uuid.UUID
	Text              string
	Title             string
	ProjectName       string
	Breadcrumb        string
	BodyVersion       int64
	SourceFingerprint string
	CoverageStatus    string
}

type RAGCitation struct {
	ChunkID           uuid.UUID `json:"chunkId,omitempty"`
	DocumentID        uuid.UUID `json:"documentId"`
	DocumentTitle     string    `json:"documentTitle"`
	ProjectName       string    `json:"projectName,omitempty"`
	NodeID            uuid.UUID `json:"nodeId"`
	BodyVersion       int64     `json:"bodyVersion"`
	SourceFingerprint string    `json:"sourceFingerprint,omitempty"`
	SourceChanged     bool      `json:"sourceChanged"`
	QuotedText        string    `json:"quotedText"`
	Breadcrumb        string    `json:"breadcrumb"`
	Ordinal           int       `json:"ordinal"`
	// Unavailable is set when the reader may no longer read the document; the
	// title, quote and place are then withheld.
	Unavailable bool `json:"unavailable,omitempty"`
}

type RAGConversation struct {
	ID          uuid.UUID `json:"id"`
	WorkspaceID uuid.UUID `json:"workspaceId"`
	CreatorID   uuid.UUID `json:"creatorId,omitempty"`
	// DocumentID is set on a Conversation opened from one document.
	DocumentID *uuid.UUID `json:"documentId,omitempty"`
	Title      string     `json:"title"`
	// PinnedAt is set while the User keeps the Conversation at the top of its list.
	PinnedAt *time.Time `json:"pinnedAt,omitempty"`
	// ArchivedAt is set while the Conversation sits in the Archived section.
	ArchivedAt *time.Time `json:"archivedAt,omitempty"`
	// Unread is true while the latest answer has not been seen by the User.
	Unread    bool      `json:"unread"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// RAGConversationPatch changes a Conversation's title, pin or archive state.
// A nil field is left as it is.
type RAGConversationPatch struct {
	Title    *string
	Pinned   *bool
	Archived *bool
}

type RAGMessage struct {
	ID                     uuid.UUID     `json:"id"`
	ConversationID         uuid.UUID     `json:"conversationId"`
	Role                   string        `json:"role"`
	Content                string        `json:"content"`
	Citations              []RAGCitation `json:"citations,omitempty"`
	CoveragePartial        bool          `json:"coveragePartial"`
	SourcesMayBeIncomplete bool          `json:"sourcesMayBeIncomplete"`
	// Meta holds what the Agent did for this answer: tools used and actions asked for.
	Meta json.RawMessage `json:"meta,omitempty"`
	// Mentions are the documents a question names. Available is false once the
	// User can no longer read the document; the title is then the one it had when asked.
	Mentions  []RAGMention `json:"mentions,omitempty"`
	CreatedAt time.Time    `json:"createdAt"`
}

type RAGMention struct {
	DocumentID uuid.UUID `json:"documentId"`
	Title      string    `json:"title"`
	Available  bool      `json:"available"`
}

type RAGConversationHistory struct {
	Conversation RAGConversation `json:"conversation"`
	Messages     []RAGMessage    `json:"messages"`
}

// RAGDocumentHit is a document a question can name: just enough to pick it.
type RAGDocumentHit struct {
	ID          uuid.UUID `json:"id"`
	Title       string    `json:"title"`
	Type        string    `json:"type"`
	ProjectName string    `json:"projectName"`
	// Categories are the document's categories in its project, in the project's order.
	Categories []string `json:"categories"`
}

// RAGCategory is a category the User may narrow a question to.
type RAGCategory struct {
	ID          uuid.UUID `json:"id"`
	Name        string    `json:"name"`
	ProjectName string    `json:"projectName"`
}

// QuestionAttachment is a text file the User attached to one question. It is
// read for that question only and never stored as a document.
type QuestionAttachment struct {
	ID   uuid.UUID `json:"id"`
	Name string    `json:"name"`
	Text string    `json:"text"`
}

// ContextMessage is one message of another chat the User brought in as context.
type ContextMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// ContextChat is another of the User's own chats, shown to the model as background.
type ContextChat struct {
	Title    string           `json:"title"`
	Messages []ContextMessage `json:"messages"`
}

// QuestionExtras is what a question carries besides its text, already checked.
type QuestionExtras struct {
	CategoryIDs  []uuid.UUID
	ContextChats []ContextChat
	Attachments  []QuestionAttachment
}

// Annotate adds the names of the attached files under a question, so the saved
// chat says what the answer was given.
func (e QuestionExtras) Annotate(question string) string {
	if len(e.Attachments) == 0 {
		return question
	}
	names := make([]string, len(e.Attachments))
	for i, file := range e.Attachments {
		names[i] = file.Name
	}
	return question + "\n\n(Attached: " + strings.Join(names, ", ") + ")"
}
