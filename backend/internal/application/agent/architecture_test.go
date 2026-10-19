package agent

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"

	"backend/constant"
	"backend/internal/application/catalog"
	"backend/internal/application/collaboration"

	"github.com/google/uuid"
)

const canvasJSON = `{"version":1,"nodes":[
{"id":"vps","kind":"host","parentId":null,"x":40,"y":60,"w":400,"h":240,"name":"VPS-1","catalog":"vps","tags":[],"description":"","repoUrl":null,"links":[]},
{"id":"api","kind":"system","parentId":"vps","x":14,"y":32,"w":null,"h":null,"name":"API","catalog":"golang","tags":[],"description":"","repoUrl":null,"links":[]},
{"id":"pg","kind":"system","parentId":"vps","x":160,"y":32,"w":null,"h":null,"name":"PostgreSQL","catalog":"postgresql","tags":[],"description":"","repoUrl":null,"links":[]}],
"connections":[{"id":"c1","source":"api","target":"pg","protocol":"db-connection","label":"","port":null,"links":[]}]}`

type fakeCatalog []catalog.Entry

func (f fakeCatalog) List(context.Context) ([]catalog.Entry, error) { return f, nil }

var testCatalog = fakeCatalog{
	{Slug: "vps", Category: "host", Name: "VPS"},
	{Slug: "golang", Category: "system", Name: "Go"},
	{Slug: "redis", Category: "system", Name: "Redis"},
	{Slug: "postgresql", Category: "system", Name: "PostgreSQL"},
	{Slug: "rest", Category: "protocol", Name: "REST"},
	{Slug: "db-connection", Category: "protocol", Name: "Database connection"},
}

// linkHeads lets one test decide which other documents the User can read.
type linkHeads struct {
	own   *fakeRooms
	self  uuid.UUID
	other map[uuid.UUID]collaboration.RoomHead
}

func (h linkHeads) ReadRoomHead(ctx context.Context, ws, doc uuid.UUID, users []uuid.UUID) (collaboration.RoomHead, error) {
	if head, ok := h.other[doc]; ok {
		return head, nil
	}
	if doc == h.self {
		return h.own.ReadRoomHead(ctx, ws, doc, users)
	}
	return collaboration.RoomHead{}, collaboration.ErrCollabDocumentNotFound
}

func newCanvasEnv(access collaboration.RoomAccess) *contentEnv {
	e := newContentEnv("architecture", access)
	e.rooms.text = canvasJSON
	e.svc.WithCatalog(testCatalog)
	return e
}

func chat(e *contentEnv) Actor {
	return Actor{UserID: e.user, Channel: ChannelChat, Approved: true}
}

func edit(e *contentEnv, actor Actor, ops string) (EditResult, error) {
	return e.svc.EditArchitecture(context.Background(), actor, e.ws, e.doc, "v1", json.RawMessage(ops))
}

func refused(t *testing.T, err error) string {
	t.Helper()
	var refusal *ToolError
	if !errors.As(err, &refusal) {
		t.Fatalf("error = %v, want a ToolError", err)
	}
	return refusal.Message
}

func TestReadingACanvasGivesTheLiveJSONAndTheVersionToEditWith(t *testing.T) {
	e := newCanvasEnv(collaboration.RoomAccess{CanRead: true, CanEdit: true, CanSuggest: true})
	got, err := e.svc.Read(context.Background(), Actor{UserID: e.user}, e.ws, e.doc)
	if err != nil || got.Text != canvasJSON || got.Version != "v1" || !got.CanEdit || got.CanSuggest {
		t.Fatalf("Read() = %+v, %v", got, err)
	}
	if want := e.ws.String() + "." + e.doc.String() + " architecture"; e.rooms.reads[0] != want {
		t.Fatalf("read %q, want %q", e.rooms.reads[0], want)
	}
}

func TestAnEditorChangesTheCanvasDirectlyAfterANamedVersion(t *testing.T) {
	e := newCanvasEnv(collaboration.RoomAccess{CanRead: true, CanEdit: true})
	e.rooms.created = map[string]string{"cache": "id-9"}
	out, err := edit(e, chat(e), `[{"type":"add_node","ref":"cache","kind":"system","name":"Redis","catalog":"redis","parent":"vps"}]`)
	if err != nil || out.Mode != "direct" || out.Created["cache"] != "id-9" || out.RevisionID == uuid.Nil {
		t.Fatalf("EditArchitecture() = %+v, %v", out, err)
	}
	if got := e.rooms.edits[0]; got.Type != "architecture" || got.Mode != "direct" || got.BaseVersion != "v1" || got.UserID != e.user.String() {
		t.Fatalf("edit = %+v", got)
	}
	if len(e.revisions.titles) != 1 || e.revisions.titles[0] != "Before AI edit from chat" {
		t.Fatalf("revisions = %v", e.revisions.titles)
	}
	if len(e.marks.marked) != 0 {
		t.Fatalf("a canvas edit is no suggestion, marked %v", e.marks.marked)
	}
}

func TestAnMCPCanvasEditNamesTheKeyInTheVersion(t *testing.T) {
	e := newCanvasEnv(collaboration.RoomAccess{CanRead: true, CanEdit: true})
	if _, err := edit(e, Actor{UserID: e.user, Channel: ChannelMCP, KeyName: "Laptop"}, `[{"type":"update_node","id":"api","name":"Order API"}]`); err != nil {
		t.Fatal(err)
	}
	if len(e.revisions.titles) != 1 || !strings.Contains(e.revisions.titles[0], "Laptop") {
		t.Fatalf("revisions = %v", e.revisions.titles)
	}
}

func TestOnlyAnEditorChangesACanvas(t *testing.T) {
	for _, access := range []collaboration.RoomAccess{{CanRead: true}, {CanRead: true, CanSuggest: true}, {}} {
		e := newCanvasEnv(access)
		if _, err := edit(e, chat(e), `[{"type":"update_node","id":"api","name":"X"}]`); !errors.Is(err, constant.ErrForbidden) {
			t.Fatalf("access %+v: error = %v", access, err)
		}
		if len(e.rooms.edits)+len(e.revisions.titles) != 0 {
			t.Fatal("a refused edit reached the room")
		}
	}
}

func TestEditArchitectureRefusesOtherDocumentsAndEditDocumentContentRefusesCanvases(t *testing.T) {
	md := newContentEnv("markdown", collaboration.RoomAccess{CanRead: true, CanEdit: true})
	md.svc.WithCatalog(testCatalog)
	if msg := refused(t, func() error { _, err := edit(md, chat(md), `[]`); return err }()); !strings.Contains(msg, "edit_document_content") {
		t.Fatalf("message = %q", msg)
	}
	canvas := newCanvasEnv(collaboration.RoomAccess{CanRead: true, CanEdit: true})
	_, err := canvas.svc.Edit(context.Background(), chat(canvas), canvas.ws, canvas.doc, "v1", ops)
	if msg := refused(t, err); !strings.Contains(msg, "edit_architecture") {
		t.Fatalf("message = %q", msg)
	}
}

func TestAStaleCanvasVersionMakesNoRevision(t *testing.T) {
	e := newCanvasEnv(collaboration.RoomAccess{CanRead: true, CanEdit: true})
	_, err := e.svc.EditArchitecture(context.Background(), chat(e), e.ws, e.doc, "v0", json.RawMessage(`[{"type":"update_node","id":"api","name":"X"}]`))
	if !strings.Contains(refused(t, err), "read it again") || len(e.revisions.titles)+len(e.rooms.edits) != 0 {
		t.Fatalf("error = %v, revisions %v, edits %v", err, e.revisions.titles, e.rooms.edits)
	}
	e.rooms.err = &ConflictError{Version: "v9"}
	if _, err := edit(e, chat(e), `[{"type":"update_node","id":"api","name":"X"}]`); !strings.Contains(refused(t, err), "read it again") {
		t.Fatalf("conflict error = %v", err)
	}
}

func TestCatalogSlugsAreCheckedAndAWrongOneComesBackWithSuggestions(t *testing.T) {
	cases := map[string]string{
		`[{"type":"add_node","kind":"system","name":"X","catalog":"reddis"}]`:                                        `operation 1: there is no catalog entry "reddis"; did you mean redis?`,
		`[{"type":"add_node","kind":"system","name":"X","catalog":"vps"}]`:                                           `operation 1: "vps" is a Host kind, not a System kind; it goes on a Host node`,
		`[{"type":"add_node","kind":"host","name":"X","catalog":"redis"}]`:                                           `operation 1: "redis" is a System kind, not a Host kind; it goes on a System node`,
		`[{"type":"add_node","kind":"group","name":"X","catalog":"vps"}]`:                                            `operation 1: a Group has no catalog entry`,
		`[{"type":"add_connection","source":"api","target":"pg","protocol":"rst"}]`:                                  `operation 1: there is no protocol "rst"; did you mean rest?`,
		`[{"type":"update_connection","id":"c1","protocol":"redis"}]`:                                                `operation 1: "redis" is a System kind, not a protocol; list_architecture_catalog with category protocol shows the protocols`,
		`[{"type":"update_node","id":"vps","catalog":"golang"}]`:                                                     `operation 1: "golang" is a System kind, not a Host kind; it goes on a System node`,
		`[{"type":"add_node","ref":"a","kind":"host","name":"H"},{"type":"update_node","id":"a","catalog":"redis"}]`: `operation 2: "redis" is a System kind, not a Host kind; it goes on a System node`,
	}
	for ops, want := range cases {
		e := newCanvasEnv(collaboration.RoomAccess{CanRead: true, CanEdit: true})
		if got := refused(t, func() error { _, err := edit(e, chat(e), ops); return err }()); got != want {
			t.Errorf("%s\n got  %q\n want %q", ops, got, want)
		}
		if len(e.rooms.edits)+len(e.revisions.titles) != 0 {
			t.Errorf("%s reached the room", ops)
		}
	}
}

func TestLinkingNeedsADocumentTheUserCanReadInThisWorkspace(t *testing.T) {
	e := newCanvasEnv(collaboration.RoomAccess{CanRead: true, CanEdit: true})
	readable, hidden, elsewhere := uuid.New(), uuid.New(), uuid.New()
	e.svc.heads = linkHeads{own: e.rooms, self: e.doc, other: map[uuid.UUID]collaboration.RoomHead{
		readable: {DocumentType: "markdown", Access: map[uuid.UUID]collaboration.RoomAccess{e.user: {CanRead: true}}},
		hidden:   {DocumentType: "markdown", Access: map[uuid.UUID]collaboration.RoomAccess{e.user: {}}},
	}}
	link := func(id uuid.UUID) string {
		return `[{"type":"link_document","id":"api","document_id":"` + id.String() + `"}]`
	}
	if _, err := edit(e, chat(e), link(readable)); err != nil {
		t.Fatalf("a readable document was refused: %v", err)
	}
	for _, id := range []uuid.UUID{hidden, elsewhere} {
		e.rooms.edits = nil
		_, err := edit(e, chat(e), link(id))
		if want := `operation 1: you cannot link ` + id.String() + `; it does not exist in this workspace or you cannot read it`; refused(t, err) != want || len(e.rooms.edits) != 0 {
			t.Fatalf("link %s: error = %v", id, err)
		}
	}
	if _, err := edit(e, chat(e), `[{"type":"link_document","id":"api","document_id":"not-an-id"}]`); !strings.Contains(refused(t, err), "operation 1:") {
		t.Fatalf("bad id error = %v", err)
	}
}

func TestUnlinkingNeedsNoAccess(t *testing.T) {
	e := newCanvasEnv(collaboration.RoomAccess{CanRead: true, CanEdit: true})
	if _, err := edit(e, chat(e), `[{"type":"unlink_document","id":"api","document_id":"`+uuid.NewString()+`"}]`); err != nil {
		t.Fatalf("unlinking was refused: %v", err)
	}
}

func TestTheApprovalSummaryIsWrittenFromTheOperations(t *testing.T) {
	e := newCanvasEnv(collaboration.RoomAccess{CanRead: true, CanEdit: true})
	got, err := e.svc.ArchitectureSummary(context.Background(), chat(e), e.ws, e.doc, json.RawMessage(`[
{"type":"add_node","ref":"cache","kind":"system","name":"Redis","catalog":"redis","parent":"vps"},
{"type":"add_connection","source":"api","target":"cache","protocol":"rest"},
{"type":"update_node","id":"api","name":"Order API"},
{"type":"move_node","id":"pg","parent":null},
{"type":"remove_node","id":"vps","cascade":true},
{"type":"remove_connection","id":"c1"},
{"type":"link_document","id":"pg","document_id":"`+uuid.NewString()+`"}]`))
	if err != nil {
		t.Fatal(err)
	}
	want := `Change the Architecture diagram:
- Add System "Redis" inside Host "VPS-1"
- Connect "API" to "Redis" over rest
- Rename "API" to "Order API"
- Move "PostgreSQL" to the top level
- Remove Host "VPS-1" with 2 Systems and 1 Connection
- Remove the Connection from "API" to "PostgreSQL"
- Link a document to "PostgreSQL"`
	if got != want {
		t.Fatalf("summary:\n%s\nwant:\n%s", got, want)
	}
}

func TestALongSummaryStopsAfterEightChanges(t *testing.T) {
	e := newCanvasEnv(collaboration.RoomAccess{CanRead: true, CanEdit: true})
	one := `{"type":"update_node","id":"api","description":"x"}`
	got, err := e.svc.ArchitectureSummary(context.Background(), chat(e), e.ws, e.doc, json.RawMessage("["+strings.Repeat(one+",", 11)+one+"]"))
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(got, "\n")
	if len(lines) != 1+8+1 || lines[9] != "- and 4 more changes" {
		t.Fatalf("summary:\n%s", got)
	}
}

func TestTheSummaryNamesAnIdItDoesNotKnowInsteadOfFailing(t *testing.T) {
	e := newCanvasEnv(collaboration.RoomAccess{CanRead: true, CanEdit: true})
	got, err := e.svc.ArchitectureSummary(context.Background(), chat(e), e.ws, e.doc, json.RawMessage(`[{"type":"remove_node","id":"ghost"}]`))
	if err != nil || !strings.Contains(got, `Remove "ghost"`) {
		t.Fatalf("summary = %q, %v", got, err)
	}
}

func TestAnOperationWithoutAKnownTypeIsRefusedBeforeTheUserApprovesOrAVersionIsMade(t *testing.T) {
	ops := `[{"type":"add_node","kind":"system","name":"Redis","catalog":"redis"},{"kind":"system","name":"Cache"}]`
	e := newCanvasEnv(collaboration.RoomAccess{CanRead: true, CanEdit: true})
	_, err := e.svc.ArchitectureSummary(context.Background(), chat(e), e.ws, e.doc, json.RawMessage(ops))
	if msg := refused(t, err); !strings.Contains(msg, "operation 2: type must be one of add_node") {
		t.Fatalf("summary refusal = %q", msg)
	}
	revisionsBefore := len(e.revisions.titles)
	_, err = edit(e, chat(e), ops)
	if msg := refused(t, err); !strings.Contains(msg, "operation 2") {
		t.Fatalf("edit refusal = %q", msg)
	}
	if len(e.revisions.titles) != revisionsBefore {
		t.Fatalf("a version was made for an edit that could not run: %v", e.revisions.titles)
	}
}

func TestAComponentTheCatalogLacksIsDrawnBareAndReportedBack(t *testing.T) {
	e := newCanvasEnv(collaboration.RoomAccess{CanRead: true, CanEdit: true})
	ops := `[{"type":"add_node","ref":"t","kind":"system","name":"Traefik","catalog":"traefik-proxy-x","parent":"vps"},{"type":"update_node","id":"api","catalog":"zzzzzzzzzz"}]`
	got, err := edit(e, chat(e), ops)
	if err != nil {
		t.Fatal(err)
	}
	if len(e.rooms.edits) != 1 || strings.Contains(string(e.rooms.edits[0].Operations), "catalog") {
		t.Fatalf("operations sent = %s", e.rooms.edits[0].Operations)
	}
	want := []Uncataloged{{Name: "Traefik", Kind: "system"}, {Name: "API", Kind: "system"}}
	if !reflect.DeepEqual(got.Uncataloged, want) || !strings.Contains(got.Next, "request_catalog_entry") {
		t.Fatalf("Uncataloged = %+v, Next = %q", got.Uncataloged, got.Next)
	}
}

func TestACatalogRefusalIsRaisedBeforeTheUserApproves(t *testing.T) {
	e := newCanvasEnv(collaboration.RoomAccess{CanRead: true, CanEdit: true})
	_, err := e.svc.ArchitectureSummary(context.Background(), chat(e), e.ws, e.doc, json.RawMessage(`[{"type":"add_node","kind":"host","name":"N","catalog":"redis"}]`))
	if got := refused(t, err); !strings.Contains(got, `"redis" is a System kind, not a Host kind`) {
		t.Fatalf("error = %q", got)
	}
}
