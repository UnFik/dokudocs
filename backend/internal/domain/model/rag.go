package model

import (
	"encoding/json"
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
}

type RAGConversation struct {
	ID          uuid.UUID `json:"id"`
	WorkspaceID uuid.UUID `json:"workspaceId"`
	CreatorID   uuid.UUID `json:"creatorId,omitempty"`
	// DocumentID is set on a Conversation opened from one document.
	DocumentID *uuid.UUID `json:"documentId,omitempty"`
	Title      string     `json:"title"`
	CreatedAt  time.Time  `json:"createdAt"`
	UpdatedAt  time.Time  `json:"updatedAt"`
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
