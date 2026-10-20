package agent

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"backend/constant"
	"backend/internal/application/collaboration"
	"backend/internal/application/document/dto"
	usecasecontract "backend/internal/domain/contract/usecase"
	"backend/internal/domain/model"

	"github.com/google/uuid"
)

type fakePages struct {
	updates []dto.UpdateDocumentInput
	err     error
}

func (f *fakePages) UpdateDocument(_ context.Context, input dto.UpdateDocumentInput) (model.Document, error) {
	f.updates = append(f.updates, input)
	return model.Document{}, f.err
}

type fakePageAccess struct{ access collaboration.RoomAccess }

func (f fakePageAccess) ReadPageAccess(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) (collaboration.RoomAccess, error) {
	return f.access, nil
}

const pageHTML = "<!doctype html><p>old</p>"

type pageEnv struct {
	svc       *ContentService
	pages     *fakePages
	revisions *fakeRevisions
	doc       model.Document
	user      uuid.UUID
}

func newPageEnv(access collaboration.RoomAccess) *pageEnv {
	e := &pageEnv{pages: &fakePages{}, revisions: &fakeRevisions{}, user: uuid.New()}
	e.doc = model.Document{ID: uuid.New(), WorkspaceID: uuid.New(), Type: "html", Content: pageHTML}
	e.svc = NewContentService(&fakeRooms{}, &fakeRooms{}, e.revisions, &fakeMarks{}).WithPages(e.pages, fakePageAccess{access})
	return e
}

func (e *pageEnv) actor(channel Channel) Actor {
	return Actor{UserID: e.user, Channel: channel, KeyName: "laptop"}
}

func TestMCPRewritesAnHTMLPageAfterANamedVersion(t *testing.T) {
	e := newPageEnv(collaboration.RoomAccess{CanRead: true, CanEdit: true})
	read, err := e.svc.ReadPage(context.Background(), e.actor(ChannelMCP), e.doc)
	if err != nil || read.Text != pageHTML || !read.CanEdit || read.Version == "" {
		t.Fatalf("ReadPage = (%+v, %v), want the page, its version and edit rights", read, err)
	}

	ops := json.RawMessage(`[{"type":"replace_all","text":"<!doctype html><p>new</p>"}]`)
	result, err := e.svc.EditPage(context.Background(), e.actor(ChannelMCP), e.doc, read.Version, ops)
	if err != nil {
		t.Fatalf("EditPage: %v", err)
	}
	if result.Mode != "direct" || result.RevisionID == uuid.Nil || result.Version != model.PageVersion("<!doctype html><p>new</p>") {
		t.Fatalf("result = %+v, want a direct edit with a named revision and the new version", result)
	}
	if len(e.revisions.titles) != 1 || !strings.Contains(e.revisions.titles[0], "laptop") {
		t.Fatalf("named revisions = %v, want one that names the key", e.revisions.titles)
	}
	if len(e.pages.updates) != 1 {
		t.Fatalf("writes = %d, want 1", len(e.pages.updates))
	}
	w := e.pages.updates[0]
	if !w.FromMCP || w.Content != "<!doctype html><p>new</p>" || w.ExpectedPageVersion != read.Version {
		t.Fatalf("write = %+v, want MCP, the new page, and the version it was read at", w)
	}
}

func TestReplaceTextWorksOnAPageAndRefusesAmbiguousText(t *testing.T) {
	e := newPageEnv(collaboration.RoomAccess{CanRead: true, CanEdit: true})
	version := model.PageVersion(pageHTML)
	ok := json.RawMessage(`[{"type":"replace_text","find":"old","replace":"fresh"}]`)
	if _, err := e.svc.EditPage(context.Background(), e.actor(ChannelMCP), e.doc, version, ok); err != nil {
		t.Fatalf("replace_text: %v", err)
	}
	if got := e.pages.updates[0].Content; got != "<!doctype html><p>fresh</p>" {
		t.Fatalf("page = %q", got)
	}
	missing := json.RawMessage(`[{"type":"replace_text","find":"nowhere","replace":"x"}]`)
	var tool *ToolError
	if _, err := e.svc.EditPage(context.Background(), e.actor(ChannelMCP), e.doc, version, missing); !errors.As(err, &tool) {
		t.Fatalf("missing text = %v, want a ToolError", err)
	}
}

func TestChatNeverWritesAnHTMLPage(t *testing.T) {
	e := newPageEnv(collaboration.RoomAccess{CanRead: true, CanEdit: true})
	ops := json.RawMessage(`[{"type":"replace_all","text":"<p>x</p>"}]`)
	if _, err := e.svc.EditPage(context.Background(), e.actor(ChannelChat), e.doc, model.PageVersion(pageHTML), ops); !errors.Is(err, errPageNotForChat) {
		t.Fatalf("chat edit = %v, want errPageNotForChat", err)
	}
	if len(e.pages.updates) != 0 || len(e.revisions.titles) != 0 {
		t.Fatal("chat changed the page or made a revision")
	}
	// Reading is open to chat.
	if _, err := e.svc.ReadPage(context.Background(), e.actor(ChannelChat), e.doc); err != nil {
		t.Fatalf("chat read: %v", err)
	}
}

func TestAnHTMLPageIsRefusedWithoutEditRightsAStaleVersionOrAnEmptyPage(t *testing.T) {
	ops := json.RawMessage(`[{"type":"replace_all","text":"<p>x</p>"}]`)
	version := model.PageVersion(pageHTML)

	viewer := newPageEnv(collaboration.RoomAccess{CanRead: true})
	if _, err := viewer.svc.EditPage(context.Background(), viewer.actor(ChannelMCP), viewer.doc, version, ops); !errors.Is(err, constant.ErrForbidden) {
		t.Fatalf("viewer edit = %v, want ErrForbidden", err)
	}

	editor := newPageEnv(collaboration.RoomAccess{CanRead: true, CanEdit: true})
	if _, err := editor.svc.EditPage(context.Background(), editor.actor(ChannelMCP), editor.doc, "stale", ops); !errors.Is(err, errStale) {
		t.Fatalf("stale version = %v, want errStale", err)
	}
	empty := json.RawMessage(`[{"type":"replace_all","text":"  "}]`)
	var tool *ToolError
	if _, err := editor.svc.EditPage(context.Background(), editor.actor(ChannelMCP), editor.doc, version, empty); !errors.As(err, &tool) {
		t.Fatalf("empty page = %v, want a ToolError", err)
	}
	if len(editor.revisions.titles) != 0 || len(editor.pages.updates) != 0 {
		t.Fatal("a refused edit made a revision or a write")
	}

	// A conflict found at the write is reported as stale, after the revision.
	editor.pages.err = constant.ErrDocumentConflict
	if _, err := editor.svc.EditPage(context.Background(), editor.actor(ChannelMCP), editor.doc, version, ops); !errors.Is(err, errStale) {
		t.Fatalf("conflict at write = %v, want errStale", err)
	}

	reader := newPageEnv(collaboration.RoomAccess{})
	if _, err := reader.svc.ReadPage(context.Background(), reader.actor(ChannelMCP), reader.doc); !errors.Is(err, constant.ErrForbidden) {
		t.Fatalf("read without access = %v, want ErrForbidden", err)
	}
}

type htmlDocs struct {
	usecasecontract.DocumentUseCase
	doc     model.Document
	created []dto.CreateDocumentInput
}

func (d *htmlDocs) GetDocument(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) (model.Document, error) {
	return d.doc, nil
}

func (d *htmlDocs) CreateDocument(_ context.Context, input dto.CreateDocumentInput) (model.Document, error) {
	d.created = append(d.created, input)
	return model.Document{ID: uuid.New(), Title: input.Title, Type: input.Type}, nil
}

func pageExecutor(e *pageEnv, docs *htmlDocs) *Executor {
	tools := DokudocsTools(ToolDeps{Documents: docs, Content: e.svc})
	return NewExecutor(NewPermissionService(memPermissions{e.user: {CapRead, CapDocuments, CapContent}}), tools, func(context.Context) int { return 1 << 20 })
}

func TestCreateDocumentMakesAnHTMLPageFromMCPAndRefusesChat(t *testing.T) {
	e := newPageEnv(collaboration.RoomAccess{CanRead: true, CanEdit: true})
	docs := &htmlDocs{doc: e.doc}
	exec := pageExecutor(e, docs)
	args := json.RawMessage(`{"workspace_id":"` + e.doc.WorkspaceID.String() + `","title":"Report","type":"html","text":"<p>hi</p>"}`)

	if _, err := exec.Call(context.Background(), Actor{UserID: e.user, Channel: ChannelMCP}, "create_document", args); err != nil {
		t.Fatalf("MCP create: %v", err)
	}
	if len(docs.created) != 1 || !docs.created[0].FromMCP || docs.created[0].Content != "<p>hi</p>" || docs.created[0].Type != "html" {
		t.Fatalf("created = %+v, want an html page marked as from MCP", docs.created)
	}

	out, err := exec.Call(context.Background(), Actor{UserID: e.user, Channel: ChannelChat, WorkspaceID: e.doc.WorkspaceID}, "create_document", args)
	if out.Pending != nil || len(docs.created) != 1 {
		t.Fatalf("chat create = (%+v, %v) with %d created, want a refusal and nothing made", out, err, len(docs.created))
	}
	if err == nil && !strings.Contains(out.Text, "MCP") {
		t.Fatalf("chat create answered %q, want a refusal that names MCP", out.Text)
	}
}

func TestReadAndEditToolsHandleHTMLPages(t *testing.T) {
	e := newPageEnv(collaboration.RoomAccess{CanRead: true, CanEdit: true})
	docs := &htmlDocs{doc: e.doc}
	exec := pageExecutor(e, docs)
	ids := `"workspace_id":"` + e.doc.WorkspaceID.String() + `","document_id":"` + e.doc.ID.String() + `"`

	out, err := exec.Call(context.Background(), Actor{UserID: e.user, Channel: ChannelMCP}, "read_document", json.RawMessage(`{`+ids+`}`))
	if err != nil || !strings.Contains(out.Text, `"type":"html"`) || !strings.Contains(out.Text, model.PageVersion(pageHTML)) {
		t.Fatalf("read_document = (%q, %v), want the html page and its version", out.Text, err)
	}

	edit := json.RawMessage(`{` + ids + `,"version":"` + model.PageVersion(pageHTML) + `","operations":[{"type":"replace_all","text":"<p>new</p>"}]}`)
	if _, err := exec.Call(context.Background(), Actor{UserID: e.user, Channel: ChannelMCP}, "edit_document_content", edit); err != nil {
		t.Fatalf("MCP edit: %v", err)
	}
	if len(e.pages.updates) != 1 {
		t.Fatalf("writes = %d, want 1", len(e.pages.updates))
	}

	out, err = exec.Call(context.Background(), Actor{UserID: e.user, Channel: ChannelChat, WorkspaceID: e.doc.WorkspaceID}, "edit_document_content", edit)
	if out.Pending != nil || len(e.pages.updates) != 1 {
		t.Fatalf("chat edit = (%+v, %v) with %d writes, want a refusal and no new write", out, err, len(e.pages.updates))
	}
}
