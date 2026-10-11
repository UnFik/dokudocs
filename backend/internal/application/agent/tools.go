package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"backend/internal/application/document/dto"
	appdoc "backend/internal/application/document/usecase"
	projectdto "backend/internal/application/project/dto"
	"backend/internal/domain/contract/repository"
	usecasecontract "backend/internal/domain/contract/usecase"
	"backend/internal/domain/model"

	"github.com/google/uuid"
)

// Dependencies of the Dokudocs tools. Each use case checks the User's own access
// to what it touches (ADR 0005); the tools never widen it.
type ToolDeps struct {
	Workspaces interface {
		ListWorkspaces(ctx context.Context, userID uuid.UUID) ([]model.Workspace, error)
	}
	Documents usecasecontract.DocumentUseCase
	Projects  usecasecontract.ProjectUseCase
	Comments  interface {
		List(ctx context.Context, workspaceID, documentID, actorID uuid.UUID) ([]model.CommentThread, error)
		Create(ctx context.Context, input appdoc.CommentInput) error
		Reply(ctx context.Context, input appdoc.CommentReplyInput) error
		Resolve(ctx context.Context, workspaceID, documentID, threadID, actorID uuid.UUID, resolved bool) error
	}
	Suggestions interface {
		List(ctx context.Context, workspaceID, documentID, actorID uuid.UUID) ([]model.DocumentSuggestion, error)
	}
	Revisions interface {
		List(ctx context.Context, documentID, workspaceID, actorID uuid.UUID) ([]model.DocumentRevision, error)
		CreateNamed(ctx context.Context, documentID, workspaceID, actorID uuid.UUID, title string) (model.DocumentRevision, error)
	}
	Search interface {
		SearchRAGChunksWithPublicLinkTokens(ctx context.Context, workspaceID, actorID uuid.UUID, query string, limit int, tokens []string) ([]model.RAGChunk, error)
	}
	Content *ContentService
}

// schema helpers
func object(required []string, props map[string]any) map[string]any {
	if required == nil {
		required = []string{}
	}
	return map[string]any{"type": "object", "properties": props, "required": required, "additionalProperties": false}
}

var (
	pWorkspace = map[string]any{"type": "string", "description": "Workspace id (from list_workspaces)."}
	pDocument  = map[string]any{"type": "string", "description": "Document id."}
	pProject   = map[string]any{"type": "string", "description": "Project id (from list_projects)."}
	pText      = func(d string) map[string]any { return map[string]any{"type": "string", "description": d} }
)

func parse[T any](args json.RawMessage) (T, error) {
	var v T
	if err := json.Unmarshal(args, &v); err != nil {
		return v, ErrInvalidArguments
	}
	return v, nil
}

func id(raw string) (uuid.UUID, error) {
	parsed, err := uuid.Parse(strings.TrimSpace(raw))
	if err != nil {
		return uuid.Nil, &ToolError{Message: fmt.Sprintf("%q is not a valid id", raw)}
	}
	return parsed, nil
}

type wsDoc struct {
	WorkspaceID string `json:"workspace_id"`
	DocumentID  string `json:"document_id"`
}

func (a wsDoc) ids() (uuid.UUID, uuid.UUID, error) {
	ws, err := id(a.WorkspaceID)
	if err != nil {
		return uuid.Nil, uuid.Nil, err
	}
	doc, err := id(a.DocumentID)
	return ws, doc, err
}

func always(summary func(json.RawMessage) string) func(context.Context, Actor, json.RawMessage) (bool, string, error) {
	return func(_ context.Context, _ Actor, args json.RawMessage) (bool, string, error) {
		return true, summary(args), nil
	}
}

func field(args json.RawMessage, key string) string {
	var m map[string]any
	_ = json.Unmarshal(args, &m)
	s, _ := m[key].(string)
	return s
}

type documentSummary struct {
	ID          uuid.UUID `json:"id"`
	Title       string    `json:"title"`
	Type        string    `json:"type"`
	ProjectName string    `json:"project,omitempty"`
	Tags        []string  `json:"tags,omitempty"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

func summarize(doc model.Document) documentSummary {
	return documentSummary{ID: doc.ID, Title: doc.Title, Type: doc.Type, ProjectName: doc.ProjectName, Tags: doc.Tags, UpdatedAt: doc.UpdatedAt}
}

// DokudocsTools are the tools the Agent has, grouped by AI permission (ADR 0044).
// Deleting a project, permanent deletion, emptying the trash, public links, grants,
// workspace actions, the account and Platform settings have no tool on purpose.
func DokudocsTools(d ToolDeps) []Tool {
	docTypes := map[string]any{"type": "string", "enum": []string{"markdown", "dbdiagram", "mermaid", "architecture"}}
	return []Tool{
		// Read
		{
			Name: "list_workspaces", Capability: CapRead, Description: "List the workspaces the User belongs to.",
			Parameters: object(nil, map[string]any{}),
			Run: func(ctx context.Context, actor Actor, _ json.RawMessage) (any, error) {
				list, err := d.Workspaces.ListWorkspaces(ctx, actor.UserID)
				out := make([]map[string]any, 0, len(list))
				for _, w := range list {
					if actor.WorkspaceID != uuid.Nil && w.ID != actor.WorkspaceID {
						continue
					}
					out = append(out, map[string]any{"id": w.ID, "name": w.Name, "role": w.Role})
				}
				return out, err
			},
		},
		{
			Name: "list_projects", Capability: CapRead, Description: "List the projects in a workspace that the User can see.",
			Parameters: object([]string{"workspace_id"}, map[string]any{"workspace_id": pWorkspace}),
			Run: func(ctx context.Context, actor Actor, args json.RawMessage) (any, error) {
				a, err := parse[struct {
					WorkspaceID string `json:"workspace_id"`
				}](args)
				if err != nil {
					return nil, err
				}
				ws, err := id(a.WorkspaceID)
				if err != nil {
					return nil, err
				}
				list, err := d.Projects.ListProjects(ctx, ws, actor.UserID)
				out := make([]map[string]any, 0, len(list))
				for _, p := range list {
					out = append(out, map[string]any{"id": p.ID, "name": p.Name, "description": p.Description, "visibility": p.Visibility})
				}
				return out, err
			},
		},
		{
			Name: "list_documents", Capability: CapRead, Description: "List documents in a workspace, optionally in one project or matching a title search.",
			Parameters: object([]string{"workspace_id"}, map[string]any{"workspace_id": pWorkspace, "project_id": pProject, "query": pText("Words in the title.")}),
			Run: func(ctx context.Context, actor Actor, args json.RawMessage) (any, error) {
				a, err := parse[struct {
					WorkspaceID string `json:"workspace_id"`
					ProjectID   string `json:"project_id"`
					Query       string `json:"query"`
				}](args)
				if err != nil {
					return nil, err
				}
				ws, err := id(a.WorkspaceID)
				if err != nil {
					return nil, err
				}
				filter := repository.DocumentFilter{FilterTab: "all", Search: a.Query, SortField: "updatedAt", SortOrder: "desc"}
				if a.ProjectID != "" {
					project, err := id(a.ProjectID)
					if err != nil {
						return nil, err
					}
					filter.ProjectID = &project
				}
				list, err := d.Documents.ListDocuments(ctx, ws, actor.UserID, filter)
				out := make([]documentSummary, 0, len(list))
				for i, doc := range list {
					if i == 100 {
						break
					}
					out = append(out, summarize(doc))
				}
				return out, err
			},
		},
		{
			Name: "search_documents", Capability: CapRead, Description: "Search what documents in a workspace say. Returns matching passages with their document.",
			Parameters: object([]string{"workspace_id", "query"}, map[string]any{"workspace_id": pWorkspace, "query": pText("What to look for.")}),
			Run: func(ctx context.Context, actor Actor, args json.RawMessage) (any, error) {
				a, err := parse[struct {
					WorkspaceID string `json:"workspace_id"`
					Query       string `json:"query"`
				}](args)
				if err != nil {
					return nil, err
				}
				ws, err := id(a.WorkspaceID)
				if err != nil {
					return nil, err
				}
				if strings.TrimSpace(a.Query) == "" {
					return nil, &ToolError{Message: "query is empty"}
				}
				chunks, err := d.Search.SearchRAGChunksWithPublicLinkTokens(ctx, ws, actor.UserID, a.Query, 10, nil)
				out := make([]map[string]any, 0, len(chunks))
				for _, c := range chunks {
					out = append(out, map[string]any{"document_id": c.DocumentID, "title": c.Title, "where": c.Breadcrumb, "text": c.Text})
				}
				return out, err
			},
		},
		{
			Name: "read_document", Capability: CapRead, DocumentTool: true,
			Description: "Read a document: its title, type and full text, and the version to pass to edit_document_content.",
			Parameters:  object([]string{"workspace_id", "document_id"}, map[string]any{"workspace_id": pWorkspace, "document_id": pDocument}),
			Run: func(ctx context.Context, actor Actor, args json.RawMessage) (any, error) {
				a, err := parse[wsDoc](args)
				if err != nil {
					return nil, err
				}
				ws, doc, err := a.ids()
				if err != nil {
					return nil, err
				}
				meta, err := d.Documents.GetDocument(ctx, doc, ws, actor.UserID)
				if err != nil {
					return nil, err
				}
				live, err := d.Content.Read(ctx, actor, ws, doc)
				if err != nil {
					return nil, err
				}
				text := live.Text
				if meta.Type == "architecture" {
					text = meta.Content
				}
				return map[string]any{
					"id": meta.ID, "title": meta.Title, "type": meta.Type, "project": meta.ProjectName, "tags": meta.Tags,
					"categories": meta.Categories, "updatedAt": meta.UpdatedAt, "content": text, "version": live.Version,
					"canEdit": live.CanEdit, "canSuggest": live.CanSuggest,
				}, nil
			},
		},
		{
			Name: "list_comments", Capability: CapRead, DocumentTool: true, Description: "List the comment threads on a document with their replies.",
			Parameters: object([]string{"workspace_id", "document_id"}, map[string]any{"workspace_id": pWorkspace, "document_id": pDocument}),
			Run: func(ctx context.Context, actor Actor, args json.RawMessage) (any, error) {
				a, err := parse[wsDoc](args)
				if err != nil {
					return nil, err
				}
				ws, doc, err := a.ids()
				if err != nil {
					return nil, err
				}
				return d.Comments.List(ctx, ws, doc, actor.UserID)
			},
		},
		{
			Name: "list_suggestions", Capability: CapRead, DocumentTool: true, Description: "List the suggestions on a document and who proposed them.",
			Parameters: object([]string{"workspace_id", "document_id"}, map[string]any{"workspace_id": pWorkspace, "document_id": pDocument}),
			Run: func(ctx context.Context, actor Actor, args json.RawMessage) (any, error) {
				a, err := parse[wsDoc](args)
				if err != nil {
					return nil, err
				}
				ws, doc, err := a.ids()
				if err != nil {
					return nil, err
				}
				return d.Suggestions.List(ctx, ws, doc, actor.UserID)
			},
		},
		{
			Name: "list_revisions", Capability: CapRead, DocumentTool: true, Description: "List the saved versions of a document.",
			Parameters: object([]string{"workspace_id", "document_id"}, map[string]any{"workspace_id": pWorkspace, "document_id": pDocument}),
			Run: func(ctx context.Context, actor Actor, args json.RawMessage) (any, error) {
				a, err := parse[wsDoc](args)
				if err != nil {
					return nil, err
				}
				ws, doc, err := a.ids()
				if err != nil {
					return nil, err
				}
				list, err := d.Revisions.List(ctx, doc, ws, actor.UserID)
				out := make([]map[string]any, 0, len(list))
				for _, r := range list {
					out = append(out, map[string]any{"id": r.ID, "title": r.Title, "createdAt": r.CreatedAt})
				}
				return out, err
			},
		},
		{
			Name: "list_trash", Capability: CapRead, Description: "List the documents in a workspace's trash.",
			Parameters: object([]string{"workspace_id"}, map[string]any{"workspace_id": pWorkspace}),
			Run: func(ctx context.Context, actor Actor, args json.RawMessage) (any, error) {
				ws, err := id(field(args, "workspace_id"))
				if err != nil {
					return nil, err
				}
				return d.Documents.ListTrash(ctx, ws, actor.UserID)
			},
		},

		// Documents
		{
			Name: "create_document", Capability: CapDocuments, Write: true,
			Description: "Create a document. For Markdown, text may hold headings (lines starting with #) and paragraphs separated by blank lines; for DBML or Mermaid it is the source.",
			Parameters: object([]string{"workspace_id", "title", "type"}, map[string]any{
				"workspace_id": pWorkspace, "title": pText("Title."), "type": docTypes, "project_id": pProject, "text": pText("Initial content."),
			}),
			NeedsApproval: always(func(args json.RawMessage) string {
				return fmt.Sprintf("Create the %s document “%s”", field(args, "type"), field(args, "title"))
			}),
			Run: func(ctx context.Context, actor Actor, args json.RawMessage) (any, error) {
				a, err := parse[struct {
					WorkspaceID string `json:"workspace_id"`
					Title       string `json:"title"`
					Type        string `json:"type"`
					ProjectID   string `json:"project_id"`
					Text        string `json:"text"`
				}](args)
				if err != nil {
					return nil, err
				}
				ws, err := id(a.WorkspaceID)
				if err != nil {
					return nil, err
				}
				input := dto.CreateDocumentInput{WorkspaceID: ws, UserID: actor.UserID, RequestID: uuid.New(), Title: a.Title, Type: a.Type, Visibility: "inherit"}
				if a.ProjectID != "" {
					project, err := id(a.ProjectID)
					if err != nil {
						return nil, err
					}
					input.ProjectID = &project
				}
				switch a.Type {
				case "markdown":
					input.ContentJSON = MarkdownToContentJSON(a.Text)
					input.Content = a.Text
				case "dbdiagram", "mermaid":
					input.Content = a.Text
				}
				doc, err := d.Documents.CreateDocument(ctx, input)
				if err != nil {
					return nil, err
				}
				return summarize(doc), nil
			},
		},
		{
			Name: "update_document", Capability: CapDocuments, Write: true, DocumentTool: true,
			Description: "Change a document's title, tags or categories. Fields left out stay as they are.",
			Parameters: object([]string{"workspace_id", "document_id"}, map[string]any{
				"workspace_id": pWorkspace, "document_id": pDocument, "title": pText("New title."),
				"tags":       map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
				"categories": map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
			}),
			NeedsApproval: always(func(args json.RawMessage) string {
				if t := field(args, "title"); t != "" {
					return fmt.Sprintf("Rename the document to “%s”", t)
				}
				return "Change the document's tags or categories"
			}),
			Run: func(ctx context.Context, actor Actor, args json.RawMessage) (any, error) {
				a, err := parse[struct {
					wsDoc
					Title      string    `json:"title"`
					Tags       *[]string `json:"tags"`
					Categories *[]string `json:"categories"`
				}](args)
				if err != nil {
					return nil, err
				}
				ws, doc, err := a.ids()
				if err != nil {
					return nil, err
				}
				current, err := d.Documents.GetDocument(ctx, doc, ws, actor.UserID)
				if err != nil {
					return nil, err
				}
				input := dto.UpdateDocumentInput{ID: doc, WorkspaceID: ws, UserID: actor.UserID, Title: a.Title, Categories: current.Categories}
				if a.Tags != nil {
					input.Tags = *a.Tags
				}
				if a.Categories != nil {
					input.Categories = *a.Categories
				}
				updated, err := d.Documents.UpdateDocument(ctx, input)
				if err != nil {
					return nil, err
				}
				return summarize(updated), nil
			},
		},
		{
			Name: "move_document", Capability: CapDocuments, Write: true, DocumentTool: true,
			Description:   "Move a document into a project, or out of every project with an empty project_id.",
			Parameters:    object([]string{"workspace_id", "document_id", "project_id"}, map[string]any{"workspace_id": pWorkspace, "document_id": pDocument, "project_id": pProject}),
			NeedsApproval: always(func(json.RawMessage) string { return "Move the document to another project" }),
			Run: func(ctx context.Context, actor Actor, args json.RawMessage) (any, error) {
				a, err := parse[struct {
					wsDoc
					ProjectID string `json:"project_id"`
				}](args)
				if err != nil {
					return nil, err
				}
				ws, doc, err := a.ids()
				if err != nil {
					return nil, err
				}
				var target *uuid.UUID
				if a.ProjectID != "" {
					project, err := id(a.ProjectID)
					if err != nil {
						return nil, err
					}
					target = &project
				}
				return map[string]bool{"moved": true}, d.Documents.MoveDocument(ctx, doc, ws, actor.UserID, target)
			},
		},
		{
			Name: "duplicate_document", Capability: CapDocuments, Write: true, DocumentTool: true, Description: "Make a copy of a document.",
			Parameters:    object([]string{"workspace_id", "document_id"}, map[string]any{"workspace_id": pWorkspace, "document_id": pDocument}),
			NeedsApproval: always(func(json.RawMessage) string { return "Make a copy of the document" }),
			Run: func(ctx context.Context, actor Actor, args json.RawMessage) (any, error) {
				a, err := parse[wsDoc](args)
				if err != nil {
					return nil, err
				}
				ws, doc, err := a.ids()
				if err != nil {
					return nil, err
				}
				copyDoc, err := d.Documents.DuplicateDocument(ctx, doc, ws, actor.UserID, uuid.New())
				if err != nil {
					return nil, err
				}
				return summarize(copyDoc), nil
			},
		},
		{
			Name: "trash_document", Capability: CapDocuments, Write: true, DocumentTool: true, Description: "Move a document to the trash. It can be restored.",
			Parameters:    object([]string{"workspace_id", "document_id"}, map[string]any{"workspace_id": pWorkspace, "document_id": pDocument}),
			NeedsApproval: always(func(json.RawMessage) string { return "Move the document to the trash" }),
			Run: func(ctx context.Context, actor Actor, args json.RawMessage) (any, error) {
				a, err := parse[wsDoc](args)
				if err != nil {
					return nil, err
				}
				ws, doc, err := a.ids()
				if err != nil {
					return nil, err
				}
				return map[string]bool{"trashed": true}, d.Documents.MoveToTrash(ctx, doc, ws, actor.UserID)
			},
		},
		{
			Name: "restore_document", Capability: CapDocuments, Write: true, Description: "Bring a document back from the trash.",
			Parameters:    object([]string{"workspace_id", "document_id"}, map[string]any{"workspace_id": pWorkspace, "document_id": pDocument}),
			NeedsApproval: always(func(json.RawMessage) string { return "Restore the document from the trash" }),
			Run: func(ctx context.Context, actor Actor, args json.RawMessage) (any, error) {
				a, err := parse[wsDoc](args)
				if err != nil {
					return nil, err
				}
				ws, doc, err := a.ids()
				if err != nil {
					return nil, err
				}
				return map[string]bool{"restored": true}, d.Documents.RestoreDocument(ctx, doc, ws, actor.UserID)
			},
		},

		// Document content
		{
			Name: "edit_document_content", Capability: CapContent, Write: true, DocumentTool: true,
			Description: "Change what a Markdown, DBML or Mermaid document says with targeted operations, using the version from read_document. " +
				"Markdown operations: replace_text {find, replace} (find must appear once), insert_after_heading {heading, text}, append_section {heading, level, text}. " +
				"DBML and Mermaid operations: replace_text {find, replace}, replace_all {text}, append {text}. " +
				"From a Dokudocs chat, Markdown changes become suggestions for the User to review.",
			Parameters: object([]string{"workspace_id", "document_id", "version", "operations"}, map[string]any{
				"workspace_id": pWorkspace, "document_id": pDocument, "version": pText("The version read_document returned."),
				"operations": map[string]any{"type": "array", "items": map[string]any{
					"type": "object",
					"properties": map[string]any{
						"type":    map[string]any{"type": "string", "enum": []string{"replace_text", "insert_after_heading", "append_section", "replace_all", "append"}},
						"find":    map[string]any{"type": "string"},
						"replace": map[string]any{"type": "string"},
						"heading": map[string]any{"type": "string"},
						"level":   map[string]any{"type": "integer"},
						"text":    map[string]any{"type": "string"},
					},
					"required": []string{"type"},
				}},
			}),
			// Chat writes Markdown as suggestions; a source has none, so the User approves first.
			NeedsApproval: func(ctx context.Context, actor Actor, args json.RawMessage) (bool, string, error) {
				a, err := parse[wsDoc](args)
				if err != nil {
					return false, "", err
				}
				ws, doc, err := a.ids()
				if err != nil {
					return false, "", err
				}
				docType, err := d.Content.DocumentType(ctx, actor, ws, doc)
				if err != nil {
					return false, "", err
				}
				return isSource(docType), "Change the diagram source", nil
			},
			Run: func(ctx context.Context, actor Actor, args json.RawMessage) (any, error) {
				a, err := parse[struct {
					wsDoc
					Version    string          `json:"version"`
					Operations json.RawMessage `json:"operations"`
				}](args)
				if err != nil {
					return nil, err
				}
				ws, doc, err := a.ids()
				if err != nil {
					return nil, err
				}
				return d.Content.Edit(ctx, actor, ws, doc, a.Version, a.Operations)
			},
		},
		{
			Name: "create_revision", Capability: CapContent, Write: true, DocumentTool: true, Description: "Save a named version of a document.",
			Parameters: object([]string{"workspace_id", "document_id", "title"}, map[string]any{"workspace_id": pWorkspace, "document_id": pDocument, "title": pText("Version name.")}),
			Run: func(ctx context.Context, actor Actor, args json.RawMessage) (any, error) {
				a, err := parse[struct {
					wsDoc
					Title string `json:"title"`
				}](args)
				if err != nil {
					return nil, err
				}
				ws, doc, err := a.ids()
				if err != nil {
					return nil, err
				}
				r, err := d.Revisions.CreateNamed(ctx, doc, ws, actor.UserID, a.Title)
				if err != nil {
					return nil, err
				}
				return map[string]any{"id": r.ID, "title": r.Title}, nil
			},
		},

		// Comments
		{
			Name: "add_comment", Capability: CapComments, Write: true, DocumentTool: true,
			Description: "Write a comment on a Markdown document as a whole. quote names the text it is about.",
			Parameters:  object([]string{"workspace_id", "document_id", "text"}, map[string]any{"workspace_id": pWorkspace, "document_id": pDocument, "text": pText("The comment."), "quote": pText("The text it is about.")}),
			NeedsApproval: always(func(args json.RawMessage) string {
				return fmt.Sprintf("Comment: “%s”", truncate(field(args, "text"), 120))
			}),
			Run: func(ctx context.Context, actor Actor, args json.RawMessage) (any, error) {
				a, err := parse[struct {
					wsDoc
					Text  string `json:"text"`
					Quote string `json:"quote"`
				}](args)
				if err != nil {
					return nil, err
				}
				ws, doc, err := a.ids()
				if err != nil {
					return nil, err
				}
				thread := uuid.New()
				err = d.Comments.Create(ctx, appdoc.CommentInput{WorkspaceID: ws, DocumentID: doc, ThreadID: thread, AuthorID: actor.UserID, SelectedText: a.Quote, Content: a.Text})
				if err != nil {
					return nil, err
				}
				return map[string]any{"thread_id": thread}, nil
			},
		},
		{
			Name: "reply_comment", Capability: CapComments, Write: true, DocumentTool: true, Description: "Reply to a comment thread.",
			Parameters: object([]string{"workspace_id", "document_id", "thread_id", "text"}, map[string]any{"workspace_id": pWorkspace, "document_id": pDocument, "thread_id": pText("Thread id."), "text": pText("The reply.")}),
			NeedsApproval: always(func(args json.RawMessage) string {
				return fmt.Sprintf("Reply: “%s”", truncate(field(args, "text"), 120))
			}),
			Run: func(ctx context.Context, actor Actor, args json.RawMessage) (any, error) {
				a, err := parse[struct {
					wsDoc
					ThreadID string `json:"thread_id"`
					Text     string `json:"text"`
				}](args)
				if err != nil {
					return nil, err
				}
				ws, doc, err := a.ids()
				if err != nil {
					return nil, err
				}
				thread, err := id(a.ThreadID)
				if err != nil {
					return nil, err
				}
				reply := uuid.New()
				return map[string]any{"reply_id": reply}, d.Comments.Reply(ctx, appdoc.CommentReplyInput{WorkspaceID: ws, DocumentID: doc, ThreadID: thread, ReplyID: reply, AuthorID: actor.UserID, Content: a.Text})
			},
		},
		{
			Name: "resolve_comment", Capability: CapComments, Write: true, DocumentTool: true, Description: "Resolve a comment thread, or reopen it with resolved false.",
			Parameters:    object([]string{"workspace_id", "document_id", "thread_id", "resolved"}, map[string]any{"workspace_id": pWorkspace, "document_id": pDocument, "thread_id": pText("Thread id."), "resolved": map[string]any{"type": "boolean"}}),
			NeedsApproval: always(func(json.RawMessage) string { return "Resolve or reopen a comment thread" }),
			Run: func(ctx context.Context, actor Actor, args json.RawMessage) (any, error) {
				a, err := parse[struct {
					wsDoc
					ThreadID string `json:"thread_id"`
					Resolved bool   `json:"resolved"`
				}](args)
				if err != nil {
					return nil, err
				}
				ws, doc, err := a.ids()
				if err != nil {
					return nil, err
				}
				thread, err := id(a.ThreadID)
				if err != nil {
					return nil, err
				}
				return map[string]bool{"resolved": a.Resolved}, d.Comments.Resolve(ctx, ws, doc, thread, actor.UserID, a.Resolved)
			},
		},

		// Projects
		{
			Name: "create_project", Capability: CapProjects, Write: true, Description: "Create a project in a workspace.",
			Parameters: object([]string{"workspace_id", "name"}, map[string]any{
				"workspace_id": pWorkspace, "name": pText("Project name."), "description": pText("What it is for."),
				"visibility": map[string]any{"type": "string", "enum": []string{"workspace", "private"}},
			}),
			NeedsApproval: always(func(args json.RawMessage) string {
				return fmt.Sprintf("Create the project “%s”", field(args, "name"))
			}),
			Run: func(ctx context.Context, actor Actor, args json.RawMessage) (any, error) {
				a, err := parse[struct {
					WorkspaceID string `json:"workspace_id"`
					Name        string `json:"name"`
					Description string `json:"description"`
					Visibility  string `json:"visibility"`
				}](args)
				if err != nil {
					return nil, err
				}
				ws, err := id(a.WorkspaceID)
				if err != nil {
					return nil, err
				}
				if a.Visibility == "" {
					a.Visibility = "workspace"
				}
				p, err := d.Projects.CreateProject(ctx, projectdto.CreateProjectInput{WorkspaceID: ws, UserID: actor.UserID, Name: a.Name, Description: a.Description, Visibility: a.Visibility})
				if err != nil {
					return nil, err
				}
				return map[string]any{"id": p.ID, "name": p.Name}, nil
			},
		},
		{
			Name: "update_project", Capability: CapProjects, Write: true, Description: "Change a project's name, description or visibility. Fields left out stay as they are.",
			Parameters: object([]string{"workspace_id", "project_id"}, map[string]any{
				"workspace_id": pWorkspace, "project_id": pProject, "name": pText("New name."), "description": pText("New description."),
				"visibility": map[string]any{"type": "string", "enum": []string{"workspace", "private"}},
			}),
			NeedsApproval: always(func(json.RawMessage) string { return "Change a project's details" }),
			Run: func(ctx context.Context, actor Actor, args json.RawMessage) (any, error) {
				a, err := parse[struct {
					WorkspaceID string  `json:"workspace_id"`
					ProjectID   string  `json:"project_id"`
					Name        string  `json:"name"`
					Description *string `json:"description"`
					Visibility  string  `json:"visibility"`
				}](args)
				if err != nil {
					return nil, err
				}
				ws, err := id(a.WorkspaceID)
				if err != nil {
					return nil, err
				}
				project, err := id(a.ProjectID)
				if err != nil {
					return nil, err
				}
				p, err := d.Projects.UpdateProject(ctx, projectdto.UpdateProjectInput{ID: project, WorkspaceID: ws, UserID: actor.UserID, Name: a.Name, Description: a.Description, Visibility: a.Visibility})
				if err != nil {
					return nil, err
				}
				return map[string]any{"id": p.ID, "name": p.Name, "visibility": p.Visibility}, nil
			},
		},
		{
			Name: "list_project_categories", Capability: CapRead, Description: "List a project's categories.",
			Parameters: object([]string{"workspace_id", "project_id"}, map[string]any{"workspace_id": pWorkspace, "project_id": pProject}),
			Run: func(ctx context.Context, actor Actor, args json.RawMessage) (any, error) {
				ws, err := id(field(args, "workspace_id"))
				if err != nil {
					return nil, err
				}
				project, err := id(field(args, "project_id"))
				if err != nil {
					return nil, err
				}
				return d.Projects.ListCategories(ctx, project, ws, actor.UserID)
			},
		},
		{
			Name: "add_project_category", Capability: CapProjects, Write: true, Description: "Add a category to a project.",
			Parameters: object([]string{"workspace_id", "project_id", "name"}, map[string]any{"workspace_id": pWorkspace, "project_id": pProject, "name": pText("Category name.")}),
			NeedsApproval: always(func(args json.RawMessage) string {
				return fmt.Sprintf("Add the category “%s”", field(args, "name"))
			}),
			Run: func(ctx context.Context, actor Actor, args json.RawMessage) (any, error) {
				ws, err := id(field(args, "workspace_id"))
				if err != nil {
					return nil, err
				}
				project, err := id(field(args, "project_id"))
				if err != nil {
					return nil, err
				}
				c, err := d.Projects.AddCategory(ctx, project, ws, actor.UserID, field(args, "name"), "")
				if err != nil {
					return nil, err
				}
				return map[string]any{"id": c.ID, "name": c.Name}, nil
			},
		},
		{
			Name: "rename_project_category", Capability: CapProjects, Write: true, Description: "Rename a project category.",
			Parameters: object([]string{"workspace_id", "project_id", "category_id", "name"}, map[string]any{"workspace_id": pWorkspace, "project_id": pProject, "category_id": pText("Category id."), "name": pText("New name.")}),
			NeedsApproval: always(func(args json.RawMessage) string {
				return fmt.Sprintf("Rename a category to “%s”", field(args, "name"))
			}),
			Run: func(ctx context.Context, actor Actor, args json.RawMessage) (any, error) {
				ws, err := id(field(args, "workspace_id"))
				if err != nil {
					return nil, err
				}
				project, err := id(field(args, "project_id"))
				if err != nil {
					return nil, err
				}
				category, err := id(field(args, "category_id"))
				if err != nil {
					return nil, err
				}
				return map[string]bool{"renamed": true}, d.Projects.UpdateCategory(ctx, project, category, ws, actor.UserID, field(args, "name"), "")
			},
		},
		{
			Name: "list_project_members", Capability: CapRead, Description: "List a project's members and their roles.",
			Parameters: object([]string{"workspace_id", "project_id"}, map[string]any{"workspace_id": pWorkspace, "project_id": pProject}),
			Run: func(ctx context.Context, actor Actor, args json.RawMessage) (any, error) {
				ws, err := id(field(args, "workspace_id"))
				if err != nil {
					return nil, err
				}
				project, err := id(field(args, "project_id"))
				if err != nil {
					return nil, err
				}
				return d.Projects.ListMembers(ctx, project, ws, actor.UserID)
			},
		},
		{
			Name: "add_project_member", Capability: CapProjects, Write: true, Description: "Add a workspace member to a project, or change their role.",
			Parameters: object([]string{"workspace_id", "project_id", "email", "role"}, map[string]any{
				"workspace_id": pWorkspace, "project_id": pProject, "email": pText("The member's email."),
				"role": map[string]any{"type": "string", "enum": []string{"manager", "editor", "viewer"}},
			}),
			NeedsApproval: always(func(args json.RawMessage) string {
				return fmt.Sprintf("Give %s the %s role in the project", field(args, "email"), field(args, "role"))
			}),
			Run: func(ctx context.Context, actor Actor, args json.RawMessage) (any, error) {
				ws, err := id(field(args, "workspace_id"))
				if err != nil {
					return nil, err
				}
				project, err := id(field(args, "project_id"))
				if err != nil {
					return nil, err
				}
				return map[string]bool{"added": true}, d.Projects.AddOrUpdateMember(ctx, project, ws, actor.UserID, field(args, "email"), field(args, "role"))
			},
		},
		{
			Name: "remove_project_member", Capability: CapProjects, Write: true, Description: "Remove a member from a project.",
			Parameters:    object([]string{"workspace_id", "project_id", "user_id"}, map[string]any{"workspace_id": pWorkspace, "project_id": pProject, "user_id": pText("The member's user id.")}),
			NeedsApproval: always(func(json.RawMessage) string { return "Remove a member from the project" }),
			Run: func(ctx context.Context, actor Actor, args json.RawMessage) (any, error) {
				ws, err := id(field(args, "workspace_id"))
				if err != nil {
					return nil, err
				}
				project, err := id(field(args, "project_id"))
				if err != nil {
					return nil, err
				}
				member, err := id(field(args, "user_id"))
				if err != nil {
					return nil, err
				}
				return map[string]bool{"removed": true}, d.Projects.RemoveMember(ctx, project, ws, member, actor.UserID)
			},
		},
	}
}
