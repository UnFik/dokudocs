package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"backend/constant"
	"backend/internal/application/collaboration"
	"backend/internal/domain/model"

	"github.com/google/uuid"
)

// ToolError is a refusal whose message the Agent can act on.
type ToolError struct{ Message string }

func (e *ToolError) Error() string { return e.Message }

// ConflictError means the document changed since the Agent read it.
type ConflictError struct{ Version string }

func (e *ConflictError) Error() string { return "the document changed since it was read" }

type RoomHeads interface {
	ReadRoomHead(ctx context.Context, workspaceID, documentID uuid.UUID, userIDs []uuid.UUID) (collaboration.RoomHead, error)
}

// LiveText is a document's text as the collaboration room holds it now.
type LiveText struct {
	Text    string
	Version string
}

type LiveEdit struct {
	Room        string
	Type        string
	UserID      string
	Mode        string
	BaseVersion string
	Operations  json.RawMessage
}

type LiveEditResult struct {
	Version       string
	SuggestionIDs []string
}

// LiveRooms reads and edits the room through the collaboration service, the only
// writer of a document's body (ADR 0029).
type LiveRooms interface {
	Read(ctx context.Context, room, docType string) (LiveText, error)
	Edit(ctx context.Context, edit LiveEdit) (LiveEditResult, error)
}

type RevisionMaker interface {
	CreateNamed(ctx context.Context, documentID, workspaceID, actorID uuid.UUID, title string) (model.DocumentRevision, error)
}

type AIAssistedMarker interface {
	MarkAIAssisted(ctx context.Context, documentID uuid.UUID, suggestionIDs []uuid.UUID, userID uuid.UUID, channel string) error
}

// ContentService reads and edits what a document says for the Agent, under the
// User's own rights (ADR 0043).
type ContentService struct {
	heads     RoomHeads
	rooms     LiveRooms
	revisions RevisionMaker
	marks     AIAssistedMarker
}

func NewContentService(heads RoomHeads, rooms LiveRooms, revisions RevisionMaker, marks AIAssistedMarker) *ContentService {
	return &ContentService{heads: heads, rooms: rooms, revisions: revisions, marks: marks}
}

type ReadResult struct {
	Type       string
	Text       string
	Version    string
	CanEdit    bool
	CanSuggest bool
}

type EditResult struct {
	Mode          string      `json:"mode"`
	Version       string      `json:"version"`
	SuggestionIDs []uuid.UUID `json:"suggestionIds,omitempty"`
	RevisionID    uuid.UUID   `json:"revisionId,omitempty"`
}

func isSource(docType string) bool { return docType == "dbdiagram" || docType == "mermaid" }

func roomName(workspaceID, documentID uuid.UUID, head collaboration.RoomHead) string {
	name := workspaceID.String() + "." + documentID.String()
	if isSource(head.DocumentType) {
		name += "." + head.ReplacementID.String()
	}
	return name
}

func (s *ContentService) head(ctx context.Context, actor Actor, workspaceID, documentID uuid.UUID) (collaboration.RoomHead, collaboration.RoomAccess, error) {
	head, err := s.heads.ReadRoomHead(ctx, workspaceID, documentID, []uuid.UUID{actor.UserID})
	if err != nil {
		if errors.Is(err, collaboration.ErrCollabDocumentNotFound) {
			return head, collaboration.RoomAccess{}, constant.ErrDocumentNotFound
		}
		return head, collaboration.RoomAccess{}, err
	}
	access := head.Access[actor.UserID]
	if !access.CanRead {
		return head, access, constant.ErrForbidden
	}
	return head, access, nil
}

// Read returns the live text of a Markdown, DBML or Mermaid document and the version to edit it with.
func (s *ContentService) Read(ctx context.Context, actor Actor, workspaceID, documentID uuid.UUID) (ReadResult, error) {
	head, access, err := s.head(ctx, actor, workspaceID, documentID)
	if err != nil {
		return ReadResult{}, err
	}
	result := ReadResult{Type: head.DocumentType, CanEdit: access.CanEdit, CanSuggest: access.CanSuggest && head.DocumentType == "markdown"}
	if head.DocumentType == "architecture" {
		return result, nil
	}
	live, err := s.rooms.Read(ctx, roomName(workspaceID, documentID, head), head.DocumentType)
	if err != nil {
		return ReadResult{}, err
	}
	result.Text, result.Version = live.Text, live.Version
	return result, nil
}

// DocumentType says what kind of document it is, for deciding whether chat asks first.
func (s *ContentService) DocumentType(ctx context.Context, actor Actor, workspaceID, documentID uuid.UUID) (string, error) {
	head, _, err := s.head(ctx, actor, workspaceID, documentID)
	return head.DocumentType, err
}

// Edit applies targeted operations. From chat, Markdown changes are suggestions; from
// MCP an editor's change goes straight in after a named version, and a suggester's
// becomes a suggestion. DBML and Mermaid have no suggestions: only an editor changes them.
func (s *ContentService) Edit(ctx context.Context, actor Actor, workspaceID, documentID uuid.UUID, version string, operations json.RawMessage) (EditResult, error) {
	head, access, err := s.head(ctx, actor, workspaceID, documentID)
	if err != nil {
		return EditResult{}, err
	}
	if head.DocumentType == "architecture" {
		return EditResult{}, &ToolError{Message: "Architecture documents are read-only for the Agent"}
	}
	mode := ""
	switch {
	case isSource(head.DocumentType):
		if access.CanEdit {
			mode = "direct"
		}
	case actor.Channel == ChannelChat:
		if access.CanEdit || access.CanSuggest {
			mode = "suggest"
		}
	case access.CanEdit:
		mode = "direct"
	case access.CanSuggest:
		mode = "suggest"
	}
	if mode == "" {
		return EditResult{}, constant.ErrForbidden
	}
	result := EditResult{Mode: mode}
	if mode == "direct" && version != "" {
		// Refuse a stale edit before saving a version for it.
		live, err := s.rooms.Read(ctx, roomName(workspaceID, documentID, head), head.DocumentType)
		if err != nil {
			return EditResult{}, err
		}
		if live.Version != version {
			return EditResult{}, &ToolError{Message: "the document changed since you read it; read it again and retry with the new version"}
		}
	}
	if mode == "direct" {
		title := "Before AI edit from chat"
		if actor.Channel == ChannelMCP {
			title = fmt.Sprintf("Before AI edit, key %s", actor.KeyName)
		}
		revision, err := s.revisions.CreateNamed(ctx, documentID, workspaceID, actor.UserID, truncate(title, 120))
		if err != nil {
			return EditResult{}, err
		}
		result.RevisionID = revision.ID
	}
	edited, err := s.rooms.Edit(ctx, LiveEdit{
		Room: roomName(workspaceID, documentID, head), Type: head.DocumentType, UserID: actor.UserID.String(),
		Mode: mode, BaseVersion: version, Operations: operations,
	})
	if err != nil {
		var conflict *ConflictError
		if errors.As(err, &conflict) {
			return EditResult{}, &ToolError{Message: "the document changed since you read it; read it again and retry with the new version"}
		}
		return EditResult{}, err
	}
	result.Version = edited.Version
	for _, raw := range edited.SuggestionIDs {
		if id, err := uuid.Parse(raw); err == nil {
			result.SuggestionIDs = append(result.SuggestionIDs, id)
		}
	}
	if len(result.SuggestionIDs) > 0 {
		if err := s.marks.MarkAIAssisted(ctx, documentID, result.SuggestionIDs, actor.UserID, string(actor.Channel)); err != nil {
			return EditResult{}, err
		}
	}
	return result, nil
}

func truncate(s string, max int) string {
	if r := []rune(s); len(r) > max {
		return string(r[:max])
	}
	return s
}
