package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"

	"backend/constant"
	"backend/internal/application/collaboration"
	"backend/internal/application/document/dto"
	appdoc "backend/internal/application/document/usecase"
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
	// A canvas edit also says which ids its refs became and how much it removed.
	Created            map[string]string
	RemovedNodes       int
	RemovedConnections int
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

// HTMLPages rewrites the body of an HTML document, which has no room: it is plain
// text in the document, written by the document use case under the User's edit rights.
type HTMLPages interface {
	UpdateDocument(ctx context.Context, input dto.UpdateDocumentInput) (model.Document, error)
}

// PageAccess says what a User may do with an HTML document.
type PageAccess interface {
	ReadPageAccess(ctx context.Context, workspaceID, documentID, userID uuid.UUID) (collaboration.RoomAccess, error)
}

// ContentService reads and edits what a document says for the Agent, under the
// User's own rights (ADR 0043).
type ContentService struct {
	heads     RoomHeads
	rooms     LiveRooms
	revisions RevisionMaker
	marks     AIAssistedMarker
	catalog   ArchitectureCatalog
	pages     HTMLPages
	access    PageAccess
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
	// A canvas edit answers with the ids its refs became and what it removed.
	Created            map[string]string `json:"created,omitempty"`
	RemovedNodes       int               `json:"removedNodes,omitempty"`
	RemovedConnections int               `json:"removedConnections,omitempty"`
	// Uncataloged lists nodes drawn without a catalog entry; Next says what to do about them.
	Uncataloged []Uncataloged `json:"uncataloged,omitempty"`
	// Resolved lists names the call gave where an id belongs, with the element they became.
	Resolved []Resolved `json:"resolved,omitempty"`
	Next     string     `json:"next,omitempty"`
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
	live, err := s.rooms.Read(ctx, roomName(workspaceID, documentID, head), head.DocumentType)
	if err != nil {
		return ReadResult{}, err
	}
	result.Text, result.Version = live.Text, live.Version
	return result, nil
}

// DocumentType says what kind of document it is, for deciding whether chat asks first.
var (
	markdownOperations = []string{"replace_text", "insert_after_heading", "insert_before_heading", "append_section", "append", "replace_section", "replace_range", "delete_section"}
	sourceOperations   = []string{"replace_text", "replace_all", "append"}

	// operationFields are what each operation needs, so a call that lacks one is refused
	// with a message that shows the right shape before anything is shown to the User.
	operationFields = map[string][]string{
		"replace_text":          {"find"},
		"insert_after_heading":  {"heading", "text"},
		"insert_before_heading": {"heading", "text"},
		"append_section":        {"heading"},
		"append":                {"text"},
		"replace_section":       {"heading", "text"},
		"replace_range":         {"from", "text"},
		"delete_section":        {"heading"},
		"replace_all":           {"text"},
	}
	operationExamples = map[string]string{
		"replace_text":          `{"type":"replace_text","find":"old words","replace":"new words"}`,
		"insert_after_heading":  `{"type":"insert_after_heading","heading":"Deploy","text":"One paragraph.\n\nAnother."}`,
		"insert_before_heading": `{"type":"insert_before_heading","heading":"Rollback","text":"A paragraph."}`,
		"append_section":        `{"type":"append_section","heading":"Rollback","level":2,"text":"Restore the backup."}`,
		"append":                `{"type":"append","text":"More text at the end."}`,
		"replace_section":       `{"type":"replace_section","heading":"Deploy","text":"The new body of the section."}`,
		"replace_range":         `{"type":"replace_range","from":"first words of the first line","to":"last words of the last line","text":"## A heading\n\nA paragraph."}`,
		"delete_section":        `{"type":"delete_section","heading":"Rollback"}`,
		"replace_all":           `{"type":"replace_all","text":"the whole source"}`,
	}
)

// checkContentOperations refuses an operation the document's type does not have, so a
// change that cannot run is not put in front of the User to approve.
func checkContentOperations(docType string, raw json.RawMessage) error {
	var ops []operation
	if err := json.Unmarshal(raw, &ops); err != nil || len(ops) == 0 {
		return &ToolError{Message: "operations must be a non-empty list of objects"}
	}
	allowed := markdownOperations
	if isSource(docType) || docType == "html" {
		allowed = sourceOperations
	}
	for i, op := range ops {
		if !slices.Contains(allowed, op.text("type")) {
			return &ToolError{Message: fmt.Sprintf("operation %d: type must be one of %s", i+1, strings.Join(allowed, ", "))}
		}
		for _, field := range operationFields[op.text("type")] {
			if strings.TrimSpace(op.text(field)) == "" {
				return &ToolError{Message: fmt.Sprintf("operation %d (%s) needs %q, for example %s", i+1, op.text("type"), field, operationExamples[op.text("type")])}
			}
		}
	}
	return nil
}

// CheckVersion refuses a version the document does not have now, so the User is
// not asked to approve a change that cannot run.
func (s *ContentService) CheckVersion(ctx context.Context, actor Actor, workspaceID, documentID uuid.UUID, version string) error {
	if version == "" {
		return nil
	}
	head, _, err := s.head(ctx, actor, workspaceID, documentID)
	if err != nil {
		return err
	}
	live, err := s.rooms.Read(ctx, roomName(workspaceID, documentID, head), head.DocumentType)
	if err != nil {
		return err
	}
	if live.Version != version {
		return errStale
	}
	return nil
}

// CheckSourceEdit refuses, before the User is asked, a DBML or Mermaid edit that cannot
// run: a stale version, or text to replace that the source does not have exactly once.
// The refusal carries the live source, so the Agent can copy from it and try again.
func (s *ContentService) CheckSourceEdit(ctx context.Context, actor Actor, workspaceID, documentID uuid.UUID, version string, raw json.RawMessage) error {
	head, _, err := s.head(ctx, actor, workspaceID, documentID)
	if err != nil {
		return err
	}
	live, err := s.rooms.Read(ctx, roomName(workspaceID, documentID, head), head.DocumentType)
	if err != nil {
		return err
	}
	if version != "" && live.Version != version {
		return errStale
	}
	var ops []operation
	if err := json.Unmarshal(raw, &ops); err != nil {
		return nil
	}
	text := live.Text
	for i, op := range ops {
		switch op.text("type") {
		case "replace_all":
			text = op.text("text")
		case "append":
			text += op.text("text")
		case "replace_text":
			find := op.text("find")
			switch n := strings.Count(text, find); {
			case n == 0:
				return &ToolError{Message: fmt.Sprintf("operation %d: %q is not in the document. Copy the text exactly from the document as it is now, or use replace_all to write the whole source. The document now reads:\n%s", i+1, find, text)}
			case n > 1:
				return &ToolError{Message: fmt.Sprintf("operation %d: %q appears %d times; include more surrounding text so it appears once", i+1, find, n)}
			}
			text = strings.Replace(text, find, op.text("replace"), 1)
		}
	}
	return nil
}

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
		return EditResult{}, &ToolError{Message: "An Architecture document is changed with edit_architecture, not edit_document_content"}
	}
	if err := checkContentOperations(head.DocumentType, operations); err != nil {
		return EditResult{}, err
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
			return EditResult{}, errStale
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
			return EditResult{}, errStale
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

// WithPages lets the Agent read and rewrite HTML documents (ADR 0052).
func (s *ContentService) WithPages(pages HTMLPages, access PageAccess) *ContentService {
	s.pages, s.access = pages, access
	return s
}

var errPageNotForChat = &ToolError{Message: "an html document is written through MCP only; ask the User to do it from their MCP client"}

// ReadPage returns the text of an HTML document the caller has already loaded, and
// the version to edit it with. Reading is open to chat and MCP alike.
func (s *ContentService) ReadPage(ctx context.Context, actor Actor, doc model.Document) (ReadResult, error) {
	if s.access == nil {
		return ReadResult{}, &ToolError{Message: "html documents are not available here"}
	}
	access, err := s.access.ReadPageAccess(ctx, doc.WorkspaceID, doc.ID, actor.UserID)
	if err != nil {
		return ReadResult{}, err
	}
	if !access.CanRead {
		return ReadResult{}, constant.ErrForbidden
	}
	return ReadResult{Type: "html", Text: doc.Content, Version: model.PageVersion(doc.Content), CanEdit: access.CanEdit}, nil
}

// applyTextOperations runs replace_text, replace_all and append over a text, and
// says which operation could not run.
func applyTextOperations(text string, ops []operation) (string, error) {
	for i, op := range ops {
		switch op.text("type") {
		case "replace_all":
			text = op.text("text")
		case "append":
			text += op.text("text")
		case "replace_text":
			find := op.text("find")
			switch n := strings.Count(text, find); {
			case n == 0:
				return "", &ToolError{Message: fmt.Sprintf("operation %d: %q is not in the page. Copy the text exactly from the page as it is now, or use replace_all to write the whole page", i+1, find)}
			case n > 1:
				return "", &ToolError{Message: fmt.Sprintf("operation %d: %q appears %d times; include more surrounding text so it appears once", i+1, find, n)}
			}
			text = strings.Replace(text, find, op.text("replace"), 1)
		}
	}
	return text, nil
}

// EditPage rewrites an HTML document from an MCP client. Chat does not write HTML.
// A named revision is made first, so one restore undoes the change; the write is
// refused when the page is no longer the version the client read.
func (s *ContentService) EditPage(ctx context.Context, actor Actor, doc model.Document, version string, operations json.RawMessage) (EditResult, error) {
	if actor.Channel != ChannelMCP {
		return EditResult{}, errPageNotForChat
	}
	if s.pages == nil || s.access == nil {
		return EditResult{}, &ToolError{Message: "html documents are not available here"}
	}
	if err := checkContentOperations("html", operations); err != nil {
		return EditResult{}, err
	}
	access, err := s.access.ReadPageAccess(ctx, doc.WorkspaceID, doc.ID, actor.UserID)
	if err != nil {
		return EditResult{}, err
	}
	if !access.CanEdit {
		return EditResult{}, constant.ErrForbidden
	}
	if version == "" || model.PageVersion(doc.Content) != version {
		return EditResult{}, errStale
	}
	var ops []operation
	if err := json.Unmarshal(operations, &ops); err != nil {
		return EditResult{}, &ToolError{Message: "operations must be a non-empty list of objects"}
	}
	updated, err := applyTextOperations(doc.Content, ops)
	if err != nil {
		return EditResult{}, err
	}
	if strings.TrimSpace(updated) == "" {
		return EditResult{}, &ToolError{Message: "the page would be empty; write the whole page with replace_all"}
	}
	revision, err := s.revisions.CreateNamed(ctx, doc.ID, doc.WorkspaceID, actor.UserID, truncate(fmt.Sprintf("Before AI edit, key %s", actor.KeyName), 120))
	if err != nil {
		return EditResult{}, err
	}
	if _, err := s.pages.UpdateDocument(ctx, dto.UpdateDocumentInput{
		ID: doc.ID, WorkspaceID: doc.WorkspaceID, UserID: actor.UserID,
		Content: updated, FromMCP: true, ExpectedPageVersion: version,
	}); err != nil {
		if errors.Is(err, constant.ErrDocumentConflict) {
			return EditResult{}, errStale
		}
		if errors.Is(err, appdoc.ErrHTMLTooLarge) {
			return EditResult{}, &ToolError{Message: "the page is over 1 MiB"}
		}
		return EditResult{}, err
	}
	return EditResult{Mode: "direct", Version: model.PageVersion(updated), RevisionID: revision.ID}, nil
}
