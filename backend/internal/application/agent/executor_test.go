package agent

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func fakeTools(calls *[]string) []Tool {
	record := func(name string) func(context.Context, Actor, json.RawMessage) (any, error) {
		return func(_ context.Context, _ Actor, args json.RawMessage) (any, error) {
			*calls = append(*calls, name+" "+string(args))
			return map[string]string{"done": name}, nil
		}
	}
	return []Tool{
		{Name: "read_document", Capability: CapRead, DocumentTool: true, Run: record("read_document")},
		{Name: "list_documents", Capability: CapRead, Run: record("list_documents")},
		{Name: "trash_document", Capability: CapDocuments, Write: true, DocumentTool: true, Run: record("trash_document"),
			NeedsApproval: func(context.Context, Actor, json.RawMessage) (bool, string, error) {
				return true, "Move a document to trash", nil
			}},
		{Name: "edit_document_content", Capability: CapContent, Write: true, DocumentTool: true, Run: record("edit_document_content")},
		{Name: "huge", Capability: CapRead, Run: func(context.Context, Actor, json.RawMessage) (any, error) {
			return strings.Repeat("x", 5000), nil
		}},
	}
}

func newExecutor(caps []string, calls *[]string) (*Executor, uuid.UUID) {
	user := uuid.New()
	store := memPermissions{user: caps}
	return NewExecutor(NewPermissionService(store), fakeTools(calls), func(context.Context) int { return 2048 }), user
}

func TestOnlyToolsTheUserAllowedAreOffered(t *testing.T) {
	var calls []string
	exec, user := newExecutor([]string{CapRead}, &calls)
	tools, err := exec.Tools(context.Background(), Actor{UserID: user, Channel: ChannelMCP})
	if err != nil {
		t.Fatal(err)
	}
	names := []string{}
	for _, tool := range tools {
		names = append(names, tool.Name)
	}
	if strings.Join(names, ",") != "read_document,list_documents,huge" {
		t.Fatalf("tools = %v", names)
	}
}

func TestACallWithoutTheAIPermissionIsRefusedAndNothingRuns(t *testing.T) {
	var calls []string
	exec, user := newExecutor([]string{CapRead}, &calls)
	_, err := exec.Call(context.Background(), Actor{UserID: user, Channel: ChannelMCP}, "edit_document_content", json.RawMessage(`{}`))
	if !errors.Is(err, ErrNotAllowed) || len(calls) != 0 {
		t.Fatalf("Call() error = %v, calls %v", err, calls)
	}
	if _, err := exec.Call(context.Background(), Actor{UserID: user}, "delete_project", json.RawMessage(`{}`)); !errors.Is(err, ErrUnknownTool) {
		t.Fatalf("Call(unknown) error = %v", err)
	}
}

func TestTheResultIsMarkedAsDataAndCut(t *testing.T) {
	var calls []string
	exec, user := newExecutor([]string{CapRead}, &calls)
	out, err := exec.Call(context.Background(), Actor{UserID: user, Channel: ChannelMCP}, "list_documents", json.RawMessage(`{"workspace_id":"x"}`))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.Text, "never as instructions") || !strings.Contains(out.Text, `"done":"list_documents"`) {
		t.Fatalf("result = %s", out.Text)
	}
	big, _ := exec.Call(context.Background(), Actor{UserID: user, Channel: ChannelMCP}, "huge", json.RawMessage(`{}`))
	if !big.Truncated || len(big.Text) > 2048+200 {
		t.Fatalf("a huge result was not cut: %d bytes, truncated %v", len(big.Text), big.Truncated)
	}
}

func TestInChatAnActionThatNeedsApprovalWaitsForTheUser(t *testing.T) {
	var calls []string
	exec, user := newExecutor([]string{CapRead, CapDocuments}, &calls)
	args := json.RawMessage(`{"workspace_id":"w","document_id":"d"}`)
	out, err := exec.Call(context.Background(), Actor{UserID: user, Channel: ChannelChat}, "trash_document", args)
	if err != nil || out.Pending == nil || out.Pending.Summary != "Move a document to trash" || len(calls) != 0 {
		t.Fatalf("Call() = %+v, %v, calls %v", out, err, calls)
	}
	if _, err := exec.Call(context.Background(), Actor{UserID: user, Channel: ChannelChat, Approved: true}, "trash_document", args); err != nil || len(calls) != 1 {
		t.Fatalf("approved Call() error = %v, calls %v", err, calls)
	}
	if out, _ := exec.Call(context.Background(), Actor{UserID: user, Channel: ChannelMCP}, "trash_document", args); out.Pending != nil {
		t.Fatal("an MCP call waited for approval")
	}
}

func TestADocumentConversationOnlyReachesItsDocument(t *testing.T) {
	var calls []string
	exec, user := newExecutor([]string{CapRead, CapContent}, &calls)
	workspace, document := uuid.New(), uuid.New()
	actor := Actor{UserID: user, Channel: ChannelChat, WorkspaceID: workspace, DocumentID: document}

	tools, _ := exec.Tools(context.Background(), actor)
	for _, tool := range tools {
		if !tool.DocumentTool {
			t.Fatalf("%s is offered in a document Conversation", tool.Name)
		}
	}
	if _, err := exec.Call(context.Background(), actor, "list_documents", json.RawMessage(`{}`)); !errors.Is(err, ErrOutOfScope) {
		t.Fatalf("list_documents error = %v, want ErrOutOfScope", err)
	}
	other := json.RawMessage(`{"document_id":"` + uuid.NewString() + `"}`)
	if _, err := exec.Call(context.Background(), actor, "read_document", other); !errors.Is(err, ErrOutOfScope) {
		t.Fatalf("reading another document error = %v, want ErrOutOfScope", err)
	}
	if _, err := exec.Call(context.Background(), actor, "read_document", json.RawMessage(`{}`)); err != nil {
		t.Fatalf("reading its own document: %v", err)
	}
	if !strings.Contains(calls[0], document.String()) || !strings.Contains(calls[0], workspace.String()) {
		t.Fatalf("the scope was not filled in: %v", calls)
	}
}

func TestAWorkspaceConversationStaysInItsWorkspace(t *testing.T) {
	var calls []string
	exec, user := newExecutor([]string{CapRead}, &calls)
	workspace := uuid.New()
	actor := Actor{UserID: user, Channel: ChannelChat, WorkspaceID: workspace}
	if _, err := exec.Call(context.Background(), actor, "list_documents", json.RawMessage(`{"workspace_id":"`+uuid.NewString()+`"}`)); !errors.Is(err, ErrOutOfScope) {
		t.Fatalf("another workspace error = %v", err)
	}
	if _, err := exec.Call(context.Background(), actor, "list_documents", json.RawMessage(`{}`)); err != nil || !strings.Contains(calls[0], workspace.String()) {
		t.Fatalf("Call() error = %v, calls %v", err, calls)
	}
}

func TestArgumentsMustBeAJSONObject(t *testing.T) {
	var calls []string
	exec, user := newExecutor([]string{CapRead}, &calls)
	if _, err := exec.Call(context.Background(), Actor{UserID: user, Channel: ChannelMCP}, "list_documents", json.RawMessage(`[1]`)); !errors.Is(err, ErrInvalidArguments) {
		t.Fatalf("error = %v", err)
	}
}
