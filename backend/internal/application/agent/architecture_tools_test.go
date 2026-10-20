package agent

import (
	appcatalog "backend/internal/application/catalog"
	appdoc "backend/internal/application/document/usecase"
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"backend/internal/application/collaboration"
	usecasecontract "backend/internal/domain/contract/usecase"
	"backend/internal/domain/model"

	"github.com/google/uuid"
)

type docsStub struct {
	usecasecontract.DocumentUseCase
	doc model.Document
}

func (d docsStub) GetDocument(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) (model.Document, error) {
	return d.doc, nil
}

func canvasExecutor(e *contentEnv, caps ...string) *Executor {
	tools := DokudocsTools(ToolDeps{
		Documents: docsStub{doc: model.Document{ID: e.doc, Title: "Prod", Type: "architecture", Content: "System \"API\"."}},
		Content:   e.svc,
		Catalog:   testCatalog,
	})
	return NewExecutor(NewPermissionService(memPermissions{e.user: caps}), tools, func(context.Context) int { return 1 << 20 })
}

func canvasArgs(e *contentEnv, ops string) json.RawMessage {
	return json.RawMessage(`{"workspace_id":"` + e.ws.String() + `","document_id":"` + e.doc.String() + `","version":"v1","operations":` + ops + `}`)
}

const renameOps = `[{"type":"update_node","id":"api","name":"Order API"}]`

func TestInChatACanvasEditWaitsForApprovalWithASummaryTheServerWrote(t *testing.T) {
	e := newCanvasEnv(collaboration.RoomAccess{CanRead: true, CanEdit: true})
	exec := canvasExecutor(e, CapRead, CapContent)
	out, err := exec.Call(context.Background(), Actor{UserID: e.user, Channel: ChannelChat, WorkspaceID: e.ws}, "edit_architecture", canvasArgs(e, renameOps))
	if err != nil || out.Pending == nil {
		t.Fatalf("Call() = %+v, %v; want a pending action", out, err)
	}
	if want := "Change the Architecture diagram:\n- Rename \"API\" to \"Order API\""; out.Pending.Summary != want {
		t.Fatalf("summary = %q, want %q", out.Pending.Summary, want)
	}
	if len(e.rooms.edits) != 0 || len(e.revisions.titles) != 0 {
		t.Fatal("the change ran before the User approved it")
	}
}

func TestAnApprovedCanvasEditRunsAndAnswersWithTheIdsItMade(t *testing.T) {
	e := newCanvasEnv(collaboration.RoomAccess{CanRead: true, CanEdit: true})
	e.rooms.created = map[string]string{"cache": "id-9"}
	exec := canvasExecutor(e, CapRead, CapContent)
	ops := `[{"type":"add_node","ref":"cache","kind":"system","name":"Redis","catalog":"redis","parent":"vps"}]`
	out, err := exec.Call(context.Background(), Actor{UserID: e.user, Channel: ChannelChat, WorkspaceID: e.ws, Approved: true}, "edit_architecture", canvasArgs(e, ops))
	if err != nil || !strings.Contains(out.Text, `"id-9"`) || !strings.Contains(out.Text, `"mode":"direct"`) || len(e.rooms.edits) != 1 {
		t.Fatalf("Call() = %+v, %v, edits %d", out, err, len(e.rooms.edits))
	}
}

func TestAddingANodeTheCanvasAlreadyHasIsRefusedBeforeApprovalNamingTheExistingOne(t *testing.T) {
	e := newCanvasEnv(collaboration.RoomAccess{CanRead: true, CanEdit: true})
	exec := canvasExecutor(e, CapRead, CapContent)
	ops := `[{"type":"add_node","kind":"system","name":"API","catalog":"golang","parent":"vps"}]`
	out, err := exec.Call(context.Background(), Actor{UserID: e.user, Channel: ChannelChat, WorkspaceID: e.ws}, "edit_architecture", canvasArgs(e, ops))
	if out.Pending != nil || !strings.Contains(refused(t, err), `operation 1: "API" is already on the canvas as api`) {
		t.Fatalf("Call() = %+v, %v; want a refusal that names the node api", out, err)
	}
}

func TestAnApprovedCanvasEditStillRunsWhenAnEarlierApprovalChangedTheVersion(t *testing.T) {
	e := newCanvasEnv(collaboration.RoomAccess{CanRead: true, CanEdit: true})
	exec := canvasExecutor(e, CapRead, CapContent)
	args := json.RawMessage(`{"workspace_id":"` + e.ws.String() + `","document_id":"` + e.doc.String() + `","version":"v0","operations":` + renameOps + `}`)
	out, err := exec.Call(context.Background(), Actor{UserID: e.user, Channel: ChannelChat, WorkspaceID: e.ws, Approved: true}, "edit_architecture", args)
	if err != nil || len(e.rooms.edits) != 1 || e.rooms.edits[0].BaseVersion != "v1" {
		t.Fatalf("Call() = %+v, %v, edits %+v; want one edit on the live version v1", out, err, e.rooms.edits)
	}
}

func TestOverMCPACanvasEditGoesStraightInForAnEditor(t *testing.T) {
	e := newCanvasEnv(collaboration.RoomAccess{CanRead: true, CanEdit: true})
	exec := canvasExecutor(e, CapRead, CapContent)
	out, err := exec.Call(context.Background(), Actor{UserID: e.user, Channel: ChannelMCP, KeyName: "Laptop"}, "edit_architecture", canvasArgs(e, renameOps))
	if err != nil || out.Pending != nil || len(e.rooms.edits) != 1 || !strings.Contains(e.revisions.titles[0], "Laptop") {
		t.Fatalf("Call() = %+v, %v, edits %d", out, err, len(e.rooms.edits))
	}
}

func TestTheCanvasToolsFollowTheAIPermissions(t *testing.T) {
	e := newCanvasEnv(collaboration.RoomAccess{CanRead: true, CanEdit: true})
	names := func(caps ...string) string {
		tools, err := canvasExecutor(e, caps...).Tools(context.Background(), Actor{UserID: e.user, Channel: ChannelMCP})
		if err != nil {
			t.Fatal(err)
		}
		var out []string
		for _, tool := range tools {
			if strings.HasSuffix(tool.Name, "architecture") || tool.Name == "list_architecture_catalog" {
				out = append(out, tool.Name)
			}
		}
		return strings.Join(out, ",")
	}
	if got := names(CapRead); got != "list_architecture_catalog" {
		t.Fatalf("read only: %q", got)
	}
	if got := names(CapRead, CapContent); got != "list_architecture_catalog,edit_architecture" {
		t.Fatalf("with content: %q", got)
	}
	_, err := canvasExecutor(e, CapRead).Call(context.Background(), Actor{UserID: e.user, Channel: ChannelMCP}, "edit_architecture", canvasArgs(e, renameOps))
	if !errors.Is(err, ErrNotAllowed) {
		t.Fatalf("error = %v", err)
	}
}

func TestTheCatalogToolListsKindsAndCanBeNarrowed(t *testing.T) {
	e := newCanvasEnv(collaboration.RoomAccess{CanRead: true})
	exec := canvasExecutor(e, CapRead)
	call := func(args string) string {
		out, err := exec.Call(context.Background(), Actor{UserID: e.user, Channel: ChannelMCP}, "list_architecture_catalog", json.RawMessage(args))
		if err != nil {
			t.Fatal(err)
		}
		return out.Text
	}
	if all := call(`{}`); !strings.Contains(all, `"redis"`) || !strings.Contains(all, `"rest"`) || !strings.Contains(all, `"vps"`) {
		t.Fatalf("all = %s", all)
	}
	protocols := call(`{"category":"protocol"}`)
	if !strings.Contains(protocols, `"rest"`) || strings.Contains(protocols, `"redis"`) {
		t.Fatalf("protocols = %s", protocols)
	}
	if found := call(`{"query":"post"}`); !strings.Contains(found, `"postgresql"`) || strings.Contains(found, `"golang"`) {
		t.Fatalf("query = %s", found)
	}
}

func TestReadingACanvasGivesTheAgentTheJSONItEditsNotTheSearchSummary(t *testing.T) {
	e := newCanvasEnv(collaboration.RoomAccess{CanRead: true, CanEdit: true})
	out, err := canvasExecutor(e, CapRead).Call(context.Background(), Actor{UserID: e.user, Channel: ChannelMCP}, "read_document",
		json.RawMessage(`{"workspace_id":"`+e.ws.String()+`","document_id":"`+e.doc.String()+`"}`))
	if err != nil || !strings.Contains(out.Text, `\"parentId\":\"vps\"`) || !strings.Contains(out.Text, `"version":"v1"`) || strings.Contains(out.Text, `System \"API\".`) {
		t.Fatalf("Call() = %+v, %v", out, err)
	}
}

func TestAMadeUpVersionIsRefusedBeforeTheUserIsAskedToApprove(t *testing.T) {
	chatActor := func(e *contentEnv) Actor { return Actor{UserID: e.user, Channel: ChannelChat, WorkspaceID: e.ws} }
	args := func(e *contentEnv, tool string) json.RawMessage {
		ops := renameOps
		if tool == "edit_document_content" {
			ops = `[{"type":"append","text":"Table t {}"}]`
		}
		return json.RawMessage(`{"workspace_id":"` + e.ws.String() + `","document_id":"` + e.doc.String() + `","version":"1.0","operations":` + ops + `}`)
	}

	canvas := newCanvasEnv(collaboration.RoomAccess{CanRead: true, CanEdit: true})
	out, err := canvasExecutor(canvas, CapRead, CapContent).Call(context.Background(), chatActor(canvas), "edit_architecture", args(canvas, "edit_architecture"))
	if out.Pending != nil || !strings.Contains(refused(t, err), "exact version read_document returned") {
		t.Fatalf("canvas: Call() = %+v, %v; want a refusal and no approval card", out, err)
	}

	source := newContentEnv("dbdiagram", collaboration.RoomAccess{CanRead: true, CanEdit: true})
	source.rooms.text = "Table a {}"
	tools := DokudocsTools(ToolDeps{Documents: docsStub{doc: model.Document{ID: source.doc, Type: "dbdiagram"}}, Content: source.svc, Catalog: testCatalog})
	exec := NewExecutor(NewPermissionService(memPermissions{source.user: {CapRead, CapContent}}), tools, func(context.Context) int { return 1 << 20 })
	out, err = exec.Call(context.Background(), chatActor(source), "edit_document_content", args(source, "edit_document_content"))
	if out.Pending != nil || !strings.Contains(refused(t, err), "exact version read_document returned") {
		t.Fatalf("source: Call() = %+v, %v; want a refusal and no approval card", out, err)
	}
}

func TestAnEditOperationWithoutATypeIsRefusedBeforeApprovalAndBeforeAVersion(t *testing.T) {
	source := newContentEnv("dbdiagram", collaboration.RoomAccess{CanRead: true, CanEdit: true})
	source.rooms.text = "Table a {}"
	tools := DokudocsTools(ToolDeps{Documents: docsStub{doc: model.Document{ID: source.doc, Type: "dbdiagram"}}, Content: source.svc, Catalog: testCatalog})
	exec := NewExecutor(NewPermissionService(memPermissions{source.user: {CapRead, CapContent}}), tools, func(context.Context) int { return 1 << 20 })
	args := json.RawMessage(`{"workspace_id":"` + source.ws.String() + `","document_id":"` + source.doc.String() + `","version":"v1","operations":[{"find":"a","replace":"b"}]}`)
	out, err := exec.Call(context.Background(), Actor{UserID: source.user, Channel: ChannelChat, WorkspaceID: source.ws}, "edit_document_content", args)
	if out.Pending != nil || !strings.Contains(refused(t, err), "operation 1: type must be one of replace_text, replace_all, append") {
		t.Fatalf("Call() = %+v, %v; want a refusal and no approval card", out, err)
	}
	if _, err := source.svc.Edit(context.Background(), Actor{UserID: source.user, Channel: ChannelMCP, KeyName: "k"}, source.ws, source.doc, "v1", json.RawMessage(`[{"find":"a"}]`)); err == nil {
		t.Fatal("Edit() ran an operation with no type")
	}
	if len(source.revisions.titles) != 0 || len(source.rooms.edits) != 0 {
		t.Fatalf("revisions %v, edits %v", source.revisions.titles, source.rooms.edits)
	}
}

type fakeRequests struct {
	got appcatalog.RequestInput
	err error
}

func (f *fakeRequests) Request(_ context.Context, in appcatalog.RequestInput) (appcatalog.RequestResult, error) {
	f.got = in
	return appcatalog.RequestResult{Name: in.Name, Votes: 1}, f.err
}

func requestExecutor(e *contentEnv, requests *fakeRequests) *Executor {
	tools := DokudocsTools(ToolDeps{Content: e.svc, Catalog: testCatalog, CatalogRequests: requests})
	return NewExecutor(NewPermissionService(memPermissions{e.user: {CapRead, CapContent}}), tools, func(context.Context) int { return 1 << 20 })
}

func TestRequestingACatalogEntryWaitsForApprovalThenFilesTheRequest(t *testing.T) {
	e := newCanvasEnv(collaboration.RoomAccess{CanRead: true, CanEdit: true})
	requests := &fakeRequests{}
	exec := requestExecutor(e, requests)
	args := json.RawMessage(`{"workspace_id":"` + e.ws.String() + `","name":"Traefik","category":"system"}`)
	actor := Actor{UserID: e.user, Channel: ChannelChat, WorkspaceID: e.ws, DocumentID: e.doc}
	out, err := exec.Call(context.Background(), actor, "request_catalog_entry", args)
	if err != nil || out.Pending == nil || out.Pending.Summary != "Ask for a catalog entry: Traefik (System)" || requests.got.Name != "" {
		t.Fatalf("Call() = %+v, %v, filed %+v", out, err, requests.got)
	}
	actor.Approved = true
	out, err = exec.Call(context.Background(), actor, "request_catalog_entry", args)
	if err != nil || !strings.Contains(out.Text, `"requested"`) || requests.got.UserID != e.user || requests.got.WorkspaceID != e.ws || requests.got.Category != "system" {
		t.Fatalf("Call() = %+v, %v, filed %+v", out, err, requests.got)
	}
}

func TestARequestForWhatTheCatalogHasAnswersWithItsSlug(t *testing.T) {
	e := newCanvasEnv(collaboration.RoomAccess{CanRead: true, CanEdit: true})
	exec := requestExecutor(e, &fakeRequests{err: appcatalog.InCatalogError{Slug: "redis"}})
	args := json.RawMessage(`{"workspace_id":"` + e.ws.String() + `","name":"Redis","category":"system"}`)
	out, err := exec.Call(context.Background(), Actor{UserID: e.user, Channel: ChannelChat, WorkspaceID: e.ws, DocumentID: e.doc, Approved: true}, "request_catalog_entry", args)
	if err != nil || !strings.Contains(out.Text, `"in_catalog"`) || !strings.Contains(out.Text, `"redis"`) {
		t.Fatalf("Call() = %+v, %v", out, err)
	}
}

func TestARequestForWhatTheCatalogHasNeedsNoApprovalAndAnswersWithItsSlug(t *testing.T) {
	e := newCanvasEnv(collaboration.RoomAccess{CanRead: true, CanEdit: true})
	requests := &fakeRequests{}
	exec := requestExecutor(e, requests)
	args := json.RawMessage(`{"workspace_id":"` + e.ws.String() + `","name":"redis","category":"system"}`)
	actor := Actor{UserID: e.user, Channel: ChannelChat, WorkspaceID: e.ws, DocumentID: e.doc}
	out, err := exec.Call(context.Background(), actor, "request_catalog_entry", args)
	if err != nil || out.Pending != nil || !strings.Contains(out.Text, `"in_catalog"`) || !strings.Contains(out.Text, `"redis"`) || requests.got.Name != "" {
		t.Fatalf("Call() = %+v, %v, filed %+v", out, err, requests.got)
	}
}

type fakeComments struct {
	got appdoc.CommentInput
	err error
}

func (f *fakeComments) List(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) ([]model.CommentThread, error) {
	return nil, nil
}
func (f *fakeComments) Create(_ context.Context, in appdoc.CommentInput) error {
	f.got = in
	return f.err
}
func (f *fakeComments) Reply(context.Context, appdoc.CommentReplyInput) error { return nil }
func (f *fakeComments) Resolve(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID, bool) error {
	return nil
}

func commentExecutor(e *contentEnv, comments *fakeComments) *Executor {
	tools := DokudocsTools(ToolDeps{Content: e.svc, Comments: comments})
	return NewExecutor(NewPermissionService(memPermissions{e.user: {CapRead, CapComments}}), tools, func(context.Context) int { return 1 << 20 })
}

func commentCall(e *contentEnv, exec *Executor, extra string) (Outcome, error) {
	args := json.RawMessage(`{"workspace_id":"` + e.ws.String() + `","text":"Use Postgres here"` + extra + `}`)
	return exec.Call(context.Background(), Actor{UserID: e.user, Channel: ChannelChat, WorkspaceID: e.ws, DocumentID: e.doc, Approved: true}, "add_comment", args)
}

func TestACommentOnACanvasElementCarriesAnElementAnchor(t *testing.T) {
	e := newCanvasEnv(collaboration.RoomAccess{CanRead: true, CanEdit: true})
	comments := &fakeComments{}
	if _, err := commentCall(e, commentExecutor(e, comments), `,"element_id":"pg"`); err != nil {
		t.Fatal(err)
	}
	if string(comments.got.Anchor) != `{"elementId":"pg","kind":"element"}` {
		t.Fatalf("anchor = %s", comments.got.Anchor)
	}
}

func TestACommentOnAMissingElementListsTheIdsThatExist(t *testing.T) {
	e := newCanvasEnv(collaboration.RoomAccess{CanRead: true, CanEdit: true})
	comments := &fakeComments{}
	_, err := commentCall(e, commentExecutor(e, comments), `,"element_id":"ghost"`)
	if err == nil || !strings.Contains(errorText(err), `there is no element "ghost"; the ids are vps (VPS-1)`) || comments.got.Content != "" {
		t.Fatalf("error = %v, comment %+v", err, comments.got)
	}
	_, err = commentCall(e, commentExecutor(e, comments), `,"element_id":"PostgreSQL"`)
	if err == nil || !strings.Contains(errorText(err), `use pg for "PostgreSQL"`) {
		t.Fatalf("error = %v", err)
	}
}

func TestACommentTheDocumentRefusesSaysHowToWriteOne(t *testing.T) {
	e := newCanvasEnv(collaboration.RoomAccess{CanRead: true, CanEdit: true})
	_, err := commentCall(e, commentExecutor(e, &fakeComments{err: appdoc.ErrInvalidComment}), ``)
	if err == nil || !strings.Contains(errorText(err), "an Architecture document needs element_id") {
		t.Fatalf("error = %v", err)
	}
}
