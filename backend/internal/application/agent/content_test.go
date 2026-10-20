package agent

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"backend/constant"
	"backend/internal/application/collaboration"
	"backend/internal/domain/model"

	"github.com/google/uuid"
)

type fakeRooms struct {
	head  collaboration.RoomHead
	reads []string
	edits []LiveEdit
	text  string
	err   error
	// created is what a canvas edit answers: the ids its refs became.
	created map[string]string
}

func (f *fakeRooms) ReadRoomHead(context.Context, uuid.UUID, uuid.UUID, []uuid.UUID) (collaboration.RoomHead, error) {
	return f.head, nil
}
func (f *fakeRooms) Read(_ context.Context, room, docType string) (LiveText, error) {
	f.reads = append(f.reads, room+" "+docType)
	return LiveText{Text: f.text, Version: "v1"}, nil
}
func (f *fakeRooms) Edit(_ context.Context, edit LiveEdit) (LiveEditResult, error) {
	f.edits = append(f.edits, edit)
	if f.err != nil {
		return LiveEditResult{}, f.err
	}
	ids := []string{}
	if edit.Mode == "suggest" {
		ids = []string{uuid.NewString()}
	}
	return LiveEditResult{Version: "v2", SuggestionIDs: ids, Created: f.created}, nil
}

type fakeRevisions struct{ titles []string }

func (f *fakeRevisions) CreateNamed(_ context.Context, documentID, _ uuid.UUID, _ uuid.UUID, title string) (model.DocumentRevision, error) {
	f.titles = append(f.titles, title)
	return model.DocumentRevision{ID: uuid.New(), DocumentID: documentID}, nil
}

type fakeMarks struct{ marked []string }

func (f *fakeMarks) MarkAIAssisted(_ context.Context, _ uuid.UUID, ids []uuid.UUID, _ uuid.UUID, channel string) error {
	for _, id := range ids {
		f.marked = append(f.marked, channel+":"+id.String())
	}
	return nil
}

type contentEnv struct {
	svc       *ContentService
	rooms     *fakeRooms
	revisions *fakeRevisions
	marks     *fakeMarks
	user      uuid.UUID
	ws, doc   uuid.UUID
}

func newContentEnv(docType string, access collaboration.RoomAccess) *contentEnv {
	e := &contentEnv{rooms: &fakeRooms{text: "# Title"}, revisions: &fakeRevisions{}, marks: &fakeMarks{}, user: uuid.New(), ws: uuid.New(), doc: uuid.New()}
	e.rooms.head = collaboration.RoomHead{DocumentType: docType, ReplacementID: uuid.New(), Access: map[uuid.UUID]collaboration.RoomAccess{e.user: access}}
	e.svc = NewContentService(e.rooms, e.rooms, e.revisions, e.marks)
	return e
}

var ops = json.RawMessage(`[{"type":"replace_text","find":"a","replace":"b"}]`)

func TestChatEditsToMarkdownAreAlwaysSuggestionsMarkedAIAssisted(t *testing.T) {
	e := newContentEnv("markdown", collaboration.RoomAccess{CanRead: true, CanEdit: true, CanSuggest: true})
	out, err := e.svc.Edit(context.Background(), Actor{UserID: e.user, Channel: ChannelChat}, e.ws, e.doc, "v1", ops)
	if err != nil || out.Mode != "suggest" {
		t.Fatalf("Edit() = %+v, %v; want a suggestion", out, err)
	}
	if e.rooms.edits[0].Room != e.ws.String()+"."+e.doc.String() || len(e.revisions.titles) != 0 {
		t.Fatalf("room %s, revisions %v", e.rooms.edits[0].Room, e.revisions.titles)
	}
	if len(e.marks.marked) != 1 || !strings.HasPrefix(e.marks.marked[0], "chat:") {
		t.Fatalf("marked = %v", e.marks.marked)
	}
}

func TestMCPEditsWithEditRightsGoStraightInAfterANamedVersion(t *testing.T) {
	e := newContentEnv("markdown", collaboration.RoomAccess{CanRead: true, CanEdit: true, CanSuggest: true})
	out, err := e.svc.Edit(context.Background(), Actor{UserID: e.user, Channel: ChannelMCP, KeyName: "Laptop"}, e.ws, e.doc, "v1", ops)
	if err != nil || out.Mode != "direct" || out.RevisionID == uuid.Nil {
		t.Fatalf("Edit() = %+v, %v", out, err)
	}
	if len(e.revisions.titles) != 1 || !strings.Contains(e.revisions.titles[0], "Laptop") {
		t.Fatalf("revisions = %v", e.revisions.titles)
	}
	if e.rooms.edits[0].BaseVersion != "v1" || e.rooms.edits[0].UserID != e.user.String() || len(e.marks.marked) != 0 {
		t.Fatalf("edit = %+v, marks %v", e.rooms.edits[0], e.marks.marked)
	}
}

func TestMCPEditsWithSuggestRightsBecomeAIAssistedSuggestions(t *testing.T) {
	e := newContentEnv("markdown", collaboration.RoomAccess{CanRead: true, CanSuggest: true})
	out, err := e.svc.Edit(context.Background(), Actor{UserID: e.user, Channel: ChannelMCP}, e.ws, e.doc, "v1", ops)
	if err != nil || out.Mode != "suggest" || len(e.marks.marked) != 1 || !strings.HasPrefix(e.marks.marked[0], "mcp:") {
		t.Fatalf("Edit() = %+v, %v, marks %v", out, err, e.marks.marked)
	}
}

func TestViewersAndArchitectureDocumentsAreRefused(t *testing.T) {
	viewer := newContentEnv("markdown", collaboration.RoomAccess{CanRead: true})
	if _, err := viewer.svc.Edit(context.Background(), Actor{UserID: viewer.user, Channel: ChannelMCP}, viewer.ws, viewer.doc, "v1", ops); !errors.Is(err, constant.ErrForbidden) {
		t.Fatalf("viewer error = %v", err)
	}
	canvas := newContentEnv("architecture", collaboration.RoomAccess{CanRead: true, CanEdit: true})
	var refusal *ToolError
	if _, err := canvas.svc.Edit(context.Background(), Actor{UserID: canvas.user, Channel: ChannelMCP}, canvas.ws, canvas.doc, "v1", ops); !errors.As(err, &refusal) {
		t.Fatalf("architecture error = %v", err)
	}
	if len(viewer.rooms.edits)+len(canvas.rooms.edits) != 0 {
		t.Fatal("a refused edit reached the room")
	}
}

func TestSourceDocumentsNeedEditRightsAndUseTheirRecordRoom(t *testing.T) {
	e := newContentEnv("dbdiagram", collaboration.RoomAccess{CanRead: true, CanSuggest: true})
	if _, err := e.svc.Edit(context.Background(), Actor{UserID: e.user, Channel: ChannelMCP}, e.ws, e.doc, "v1", ops); !errors.Is(err, constant.ErrForbidden) {
		t.Fatalf("a suggester edited a source: %v", err)
	}
	editor := newContentEnv("mermaid", collaboration.RoomAccess{CanRead: true, CanEdit: true})
	out, err := editor.svc.Edit(context.Background(), Actor{UserID: editor.user, Channel: ChannelChat, Approved: true}, editor.ws, editor.doc, "v1", ops)
	if err != nil || out.Mode != "direct" {
		t.Fatalf("Edit() = %+v, %v", out, err)
	}
	if want := editor.ws.String() + "." + editor.doc.String() + "." + editor.rooms.head.ReplacementID.String(); editor.rooms.edits[0].Room != want {
		t.Fatalf("room = %s, want %s", editor.rooms.edits[0].Room, want)
	}
}

func TestReadingNeedsReadAccessAndReturnsTheLiveVersion(t *testing.T) {
	e := newContentEnv("markdown", collaboration.RoomAccess{CanRead: true, CanSuggest: true})
	got, err := e.svc.Read(context.Background(), Actor{UserID: e.user}, e.ws, e.doc)
	if err != nil || got.Text != "# Title" || got.Version != "v1" || got.CanEdit || !got.CanSuggest {
		t.Fatalf("Read() = %+v, %v", got, err)
	}
	outsider := newContentEnv("markdown", collaboration.RoomAccess{})
	if _, err := outsider.svc.Read(context.Background(), Actor{UserID: outsider.user}, outsider.ws, outsider.doc); !errors.Is(err, constant.ErrForbidden) {
		t.Fatalf("an outsider read the document: %v", err)
	}
}

func TestAStaleVersionComesBackAsAToolError(t *testing.T) {
	e := newContentEnv("markdown", collaboration.RoomAccess{CanRead: true, CanEdit: true})
	e.rooms.err = &ConflictError{Version: "v9"}
	var refusal *ToolError
	if _, err := e.svc.Edit(context.Background(), Actor{UserID: e.user, Channel: ChannelMCP}, e.ws, e.doc, "v1", ops); !errors.As(err, &refusal) || !strings.Contains(refusal.Message, "read it again") {
		t.Fatalf("error = %v", err)
	}
}

func TestAStaleDirectEditMakesNoVersion(t *testing.T) {
	e := newContentEnv("markdown", collaboration.RoomAccess{CanRead: true, CanEdit: true})
	// The room reads as version v1; the Agent sends an older one.
	var refusal *ToolError
	if _, err := e.svc.Edit(context.Background(), Actor{UserID: e.user, Channel: ChannelMCP, KeyName: "k"}, e.ws, e.doc, "v0", ops); !errors.As(err, &refusal) {
		t.Fatalf("error = %v", err)
	}
	if len(e.revisions.titles) != 0 || len(e.rooms.edits) != 0 {
		t.Fatalf("revisions %v, edits %v after a stale edit", e.revisions.titles, e.rooms.edits)
	}
}

func TestAnOperationThatLacksAFieldIsRefusedWithAnExampleBeforeTheUserIsAsked(t *testing.T) {
	cases := map[string]string{
		`[{"type":"replace_section","heading":"Deploy"}]`: `"text"`,
		`[{"type":"replace_text","replace":"x"}]`:         `"find"`,
		`[{"type":"delete_section"}]`:                     `"heading"`,
		`[{"type":"append","text":"  "}]`:                 `"text"`,
	}
	for raw, field := range cases {
		err := checkContentOperations("markdown", json.RawMessage(raw))
		var refusal *ToolError
		if !errors.As(err, &refusal) || !strings.Contains(refusal.Message, field) || !strings.Contains(refusal.Message, `{"type":`) {
			t.Fatalf("%s: error = %v", raw, err)
		}
	}
	for _, raw := range []string{
		`[{"type":"replace_section","heading":"Deploy","text":"New."},{"type":"delete_section","heading":"Old"},{"type":"append","text":"End."}]`,
		`[{"type":"replace_text","find":"a","replace":""}]`,
	} {
		if err := checkContentOperations("markdown", json.RawMessage(raw)); err != nil {
			t.Fatalf("%s refused: %v", raw, err)
		}
	}
}

func TestAWronglyTypedArgumentNamesTheField(t *testing.T) {
	_, err := parse[struct {
		Version string `json:"version"`
	}](json.RawMessage(`{"version":3}`))
	var refusal *ToolError
	if !errors.As(err, &refusal) || !strings.Contains(refusal.Message, `"version"`) || !strings.Contains(refusal.Message, "a string") {
		t.Fatalf("error = %v", err)
	}
}

func sourceExecutor(e *contentEnv) *Executor {
	tools := DokudocsTools(ToolDeps{Documents: docsStub{doc: model.Document{ID: e.doc, Title: "Flow", Type: "mermaid"}}, Content: e.svc, Catalog: testCatalog})
	return NewExecutor(NewPermissionService(memPermissions{e.user: {CapRead, CapContent}}), tools, func(context.Context) int { return 1 << 20 })
}

func sourceArgs(e *contentEnv, ops string) json.RawMessage {
	return json.RawMessage(`{"workspace_id":"` + e.ws.String() + `","document_id":"` + e.doc.String() + `","version":"v1","operations":` + ops + `}`)
}

func TestAReplaceOfSourceTextThatIsNotThereIsRefusedBeforeApprovalWithTheLiveSource(t *testing.T) {
	e := newContentEnv("mermaid", collaboration.RoomAccess{CanRead: true, CanEdit: true})
	e.rooms.text = "graph TD\n  Start --> Done"
	ops := `[{"type":"replace_text","find":"graph TD\n  Begin --> Done","replace":"x"}]`
	out, err := sourceExecutor(e).Call(context.Background(), Actor{UserID: e.user, Channel: ChannelChat, WorkspaceID: e.ws}, "edit_document_content", sourceArgs(e, ops))
	got := refused(t, err)
	if out.Pending != nil || !strings.Contains(got, "not in the document") || !strings.Contains(got, "Start --> Done") {
		t.Fatalf("Call() = %+v, %q; want a refusal that quotes the live source and no card", out, got)
	}
}

func TestAReplaceOfSourceTextThatIsThereStillAsksTheUser(t *testing.T) {
	e := newContentEnv("mermaid", collaboration.RoomAccess{CanRead: true, CanEdit: true})
	e.rooms.text = "graph TD\n  Start --> Done"
	ops := `[{"type":"replace_text","find":"Start","replace":"Begin"}]`
	out, err := sourceExecutor(e).Call(context.Background(), Actor{UserID: e.user, Channel: ChannelChat, WorkspaceID: e.ws}, "edit_document_content", sourceArgs(e, ops))
	if err != nil || out.Pending == nil {
		t.Fatalf("Call() = %+v, %v; want a card", out, err)
	}
}
