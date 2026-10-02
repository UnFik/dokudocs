package model

import (
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
	Title       string    `json:"title"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type RAGMessage struct {
	ID                     uuid.UUID     `json:"id"`
	ConversationID         uuid.UUID     `json:"conversationId"`
	Role                   string        `json:"role"`
	Content                string        `json:"content"`
	Citations              []RAGCitation `json:"citations,omitempty"`
	CoveragePartial        bool          `json:"coveragePartial"`
	SourcesMayBeIncomplete bool          `json:"sourcesMayBeIncomplete"`
	CreatedAt              time.Time     `json:"createdAt"`
}

type RAGConversationHistory struct {
	Conversation RAGConversation `json:"conversation"`
	Messages     []RAGMessage    `json:"messages"`
}
