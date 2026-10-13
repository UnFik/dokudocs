package agent

import (
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
