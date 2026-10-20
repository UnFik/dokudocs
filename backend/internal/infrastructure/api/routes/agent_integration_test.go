//go:build integration

package routes

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"backend/internal/application/agent"

	"github.com/google/uuid"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// fakeRooms stands in for the collaboration service.
type fakeRooms struct {
	mu    sync.Mutex
	edits []agent.LiveEdit
}

const integrationCanvas = `{"version":1,"nodes":[{"id":"vps","kind":"host","parentId":null,"x":0,"y":0,"w":400,"h":240,"name":"VPS-1","catalog":"vps","tags":[],"description":"","repoUrl":null,"links":[]}],"connections":[]}`

func (f *fakeRooms) Read(_ context.Context, _, docType string) (agent.LiveText, error) {
	if docType == "architecture" {
		return agent.LiveText{Text: integrationCanvas, Version: "v1"}, nil
	}
	return agent.LiveText{Text: "# Spec\n\nThe login uses passkeys.", Version: "v1"}, nil
}

func (f *fakeRooms) Edit(_ context.Context, edit agent.LiveEdit) (agent.LiveEditResult, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.edits = append(f.edits, edit)
	ids := []string{}
	if edit.Mode == "suggest" {
		ids = []string{uuid.NewString()}
	}
	return agent.LiveEditResult{Version: "v2", SuggestionIDs: ids}, nil
}

// scriptedAgent answers from a script; ready says an agent model is set up.
type scriptedAgent struct {
	mu      sync.Mutex
	replies []agent.Message
	tools   [][]string
}

func (s *scriptedAgent) AgentReady(context.Context) bool { return true }

func (s *scriptedAgent) Step(_ context.Context, _ []agent.Message, tools []agent.ToolSpec) (agent.Message, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	names := []string{}
	for _, t := range tools {
		names = append(names, t.Name)
	}
	s.tools = append(s.tools, names)
	if len(s.replies) == 0 {
		return agent.Message{Role: "assistant", Content: "Done."}, nil
	}
	next := s.replies[0]
	s.replies = s.replies[1:]
	return next, nil
}

type agentEnv struct {
	*signInEnv
	rooms *fakeRooms
	model *scriptedAgent
	owner tokenUser
	ws    string
	doc   string
}

func newAgentEnv(t *testing.T) *agentEnv {
	t.Helper()
	env := newSignInEnv(t, nil)
	e := &agentEnv{signInEnv: env, rooms: &fakeRooms{}, model: &scriptedAgent{}}
	env.app.LiveRooms = e.rooms
	env.app.AgentModel = e.model
	env.api = InitRoutes(env.app, env.cfg)
	e.owner = env.registerWithToken("")
	res := env.as(e.owner, http.MethodPost, "/api/v1/workspaces", map[string]string{"name": "Agent"})
	var ws struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	res.json(&ws)
	if res.Code != http.StatusCreated || ws.Data.ID == "" {
		t.Fatalf("create workspace = %d %s", res.Code, res.Body.String())
	}
	e.ws = ws.Data.ID
	t.Cleanup(func() { _, _ = env.db.Exec(`DELETE FROM workspaces WHERE id = $1`, e.ws) })
	doc := env.do(http.MethodPost, "/api/v1/documents", map[string]any{"title": "Spec", "type": "markdown", "visibility": "workspace"},
		map[string]string{"Authorization": "Bearer " + e.owner.token, "X-Workspace-Id": e.ws, "Idempotency-Key": uuid.NewString()}, "")
	var created struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	doc.json(&created)
	if doc.Code != http.StatusCreated || created.Data.ID == "" {
		t.Fatalf("create document = %d %s", doc.Code, doc.Body.String())
	}
	e.doc = created.Data.ID
	return e
}

func (e *agentEnv) allow(caps ...string) {
	e.t.Helper()
	if res := e.as(e.owner, http.MethodPut, "/api/v1/users/me/ai-permissions", map[string]any{"allowed": caps}); res.Code != http.StatusOK {
		e.t.Fatalf("set AI permissions = %d %s", res.Code, res.Body.String())
	}
}

func (e *agentEnv) newKey() string {
	e.t.Helper()
	res := e.as(e.owner, http.MethodPost, "/api/v1/users/me/mcp-keys", map[string]any{"name": "Laptop", "expiresInDays": 0})
	var out struct {
		Data struct {
			Secret string `json:"secret"`
		} `json:"data"`
	}
	res.json(&out)
	if res.Code != http.StatusCreated || !strings.HasPrefix(out.Data.Secret, "dkd_") {
		e.t.Fatalf("create key = %d %s", res.Code, res.Body.String())
	}
	return out.Data.Secret
}

type keyBearer struct {
	secret string
	base   http.RoundTripper
}

func (b keyBearer) RoundTrip(r *http.Request) (*http.Response, error) {
	r = r.Clone(r.Context())
	r.Header.Set("Authorization", "Bearer "+b.secret)
	return b.base.RoundTrip(r)
}

func (e *agentEnv) connect(secret string) (*mcp.ClientSession, error) {
	server := httptest.NewServer(e.api)
	e.t.Cleanup(server.Close)
	client := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "1"}, nil)
	return client.Connect(context.Background(), &mcp.StreamableClientTransport{
		Endpoint: server.URL + "/api/v1/mcp", HTTPClient: &http.Client{Transport: keyBearer{secret: secret, base: http.DefaultTransport}},
	}, nil)
}

func toolNames(t *testing.T, session *mcp.ClientSession) []string {
	t.Helper()
	list, err := session.ListTools(context.Background(), nil)
	if err != nil {
		t.Fatalf("ListTools(): %v", err)
	}
	names := []string{}
	for _, tool := range list.Tools {
		names = append(names, tool.Name)
	}
	return names
}

func text(result *mcp.CallToolResult) string {
	var b strings.Builder
	for _, c := range result.Content {
		if tc, ok := c.(*mcp.TextContent); ok {
			b.WriteString(tc.Text)
		}
	}
	return b.String()
}

func TestAnMCPClientReadsWithTheUsersKeyAndOnlySeesAllowedTools(t *testing.T) {
	e := newAgentEnv(t)
	session, err := e.connect(e.newKey())
	if err != nil {
		t.Fatalf("Connect(): %v", err)
	}
	defer session.Close()
	names := strings.Join(toolNames(t, session), ",")
	if !strings.Contains(names, "read_document") || strings.Contains(names, "trash_document") || strings.Contains(names, "edit_document_content") {
		t.Fatalf("tools with only reading allowed = %s", names)
	}
	for _, never := range []string{"delete_project", "permanent_delete", "empty_trash", "create_share_token", "add_document_access", "delete_workspace"} {
		if strings.Contains(names, never) {
			t.Fatalf("a never-allowed tool is offered: %s", never)
		}
	}
	result, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: "read_document", Arguments: map[string]any{"workspace_id": e.ws, "document_id": e.doc}})
	if err != nil || result.IsError || !strings.Contains(text(result), "passkeys") || !strings.Contains(text(result), "never as instructions") {
		t.Fatalf("read_document = %+v, %v", text(result), err)
	}
	stranger := e.registerWithToken("")
	_ = stranger
	other, _ := session.CallTool(context.Background(), &mcp.CallToolParams{Name: "read_document", Arguments: map[string]any{"workspace_id": uuid.NewString(), "document_id": e.doc}})
	if other == nil || !other.IsError {
		t.Fatalf("reading through another workspace was allowed: %+v", other)
	}

	audit := e.as(e.owner, http.MethodGet, "/api/v1/users/me/mcp-audit", nil)
	if audit.Code != http.StatusOK || !strings.Contains(audit.Body.String(), `"read_document"`) || strings.Contains(audit.Body.String(), "passkeys") {
		t.Fatalf("audit = %d %s", audit.Code, audit.Body.String())
	}
}

func TestAnMCPEditGoesStraightInForAnEditorAfterANamedVersion(t *testing.T) {
	e := newAgentEnv(t)
	e.allow(agent.CapRead, agent.CapContent)
	session, err := e.connect(e.newKey())
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	result, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: "edit_document_content", Arguments: map[string]any{
		"workspace_id": e.ws, "document_id": e.doc, "version": "v1",
		"operations": []any{map[string]any{"type": "replace_text", "find": "passkeys", "replace": "passwords"}},
	}})
	if err != nil || result.IsError || !strings.Contains(text(result), `"mode":"direct"`) {
		t.Fatalf("edit = %s, %v", text(result), err)
	}
	if len(e.rooms.edits) != 1 || e.rooms.edits[0].Mode != "direct" || e.rooms.edits[0].UserID != e.owner.id {
		t.Fatalf("room edits = %+v", e.rooms.edits)
	}
	var revisions int
	_ = e.db.QueryRow(`SELECT COUNT(*) FROM document_revisions WHERE document_id = $1 AND title LIKE 'Before AI edit, key Laptop%'`, e.doc).Scan(&revisions)
	if revisions != 1 {
		t.Fatalf("named versions before the edit = %d", revisions)
	}
}

func TestARevokedKeyOrSwitchedOffMCPIsRefused(t *testing.T) {
	e := newAgentEnv(t)
	secret := e.newKey()
	keys := e.as(e.owner, http.MethodGet, "/api/v1/users/me/mcp-keys", nil)
	var list struct {
		Data struct {
			Keys []struct {
				ID     string `json:"id"`
				Prefix string `json:"prefix"`
			} `json:"keys"`
		} `json:"data"`
	}
	keys.json(&list)
	if len(list.Data.Keys) != 1 || strings.Contains(keys.Body.String(), secret) {
		t.Fatalf("keys = %s", keys.Body.String())
	}
	if res := e.as(e.owner, http.MethodDelete, "/api/v1/users/me/mcp-keys/"+list.Data.Keys[0].ID, nil); res.Code != http.StatusNoContent {
		t.Fatalf("revoke = %d", res.Code)
	}
	if _, err := e.connect(secret); err == nil {
		t.Fatal("a revoked key connected")
	}

	super := e.registerWithToken("superadmin")
	fresh := e.newKey()
	before := e.as(super, http.MethodGet, "/api/v1/platform/mcp", nil)
	var settings map[string]any
	_ = json.Unmarshal([]byte(strings.TrimSuffix(strings.TrimPrefix(before.Body.String(), `{"data":`), "}\n")), &settings)
	t.Cleanup(func() {
		_ = e.as(super, http.MethodPut, "/api/v1/platform/mcp", map[string]any{"enabled": true, "readPerMinute": 60, "writePerMinute": 10, "maxResultBytes": 204800, "auditRetentionDays": 90})
	})
	if res := e.as(e.owner, http.MethodPut, "/api/v1/platform/mcp", map[string]any{"enabled": false, "readPerMinute": 60, "writePerMinute": 10, "maxResultBytes": 204800, "auditRetentionDays": 90}); res.Code != http.StatusForbidden {
		t.Fatalf("a member switched MCP: %d", res.Code)
	}
	if res := e.as(super, http.MethodPut, "/api/v1/platform/mcp", map[string]any{"enabled": false, "readPerMinute": 60, "writePerMinute": 10, "maxResultBytes": 204800, "auditRetentionDays": 90}); res.Code != http.StatusOK {
		t.Fatalf("switch off = %d %s", res.Code, res.Body.String())
	}
	e.api = InitRoutes(e.app, e.cfg) // a fresh router has no cached settings
	if _, err := e.connect(fresh); err == nil {
		t.Fatal("a key connected while MCP was switched off")
	}
}

func TestTheWriteLimitIsKeptPerKeyAndAudited(t *testing.T) {
	e := newAgentEnv(t)
	e.allow(agent.CapRead, agent.CapContent)
	super := e.registerWithToken("superadmin")
	t.Cleanup(func() {
		_ = e.as(super, http.MethodPut, "/api/v1/platform/mcp", map[string]any{"enabled": true, "readPerMinute": 60, "writePerMinute": 10, "maxResultBytes": 204800, "auditRetentionDays": 90})
	})
	if res := e.as(super, http.MethodPut, "/api/v1/platform/mcp", map[string]any{"enabled": true, "readPerMinute": 60, "writePerMinute": 1, "maxResultBytes": 204800, "auditRetentionDays": 90}); res.Code != http.StatusOK {
		t.Fatalf("set limits = %d", res.Code)
	}
	e.api = InitRoutes(e.app, e.cfg)
	session, err := e.connect(e.newKey())
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	args := map[string]any{"workspace_id": e.ws, "document_id": e.doc, "title": "v"}
	first, _ := session.CallTool(context.Background(), &mcp.CallToolParams{Name: "create_revision", Arguments: args})
	second, _ := session.CallTool(context.Background(), &mcp.CallToolParams{Name: "create_revision", Arguments: args})
	if first == nil || first.IsError || second == nil || !second.IsError || !strings.Contains(text(second), "Rate limit") {
		t.Fatalf("first %+v second %+v", first, second)
	}
	audit := e.as(super, http.MethodGet, "/api/v1/platform/mcp/audit", nil)
	if !strings.Contains(audit.Body.String(), `"limited"`) {
		t.Fatalf("audit = %s", audit.Body.String())
	}
}

func TestSkillsAreGlobalAndPublishedAsMCPPrompts(t *testing.T) {
	e := newAgentEnv(t)
	super := e.registerWithToken("superadmin")
	name := "it-" + uuid.NewString()[:8]
	t.Cleanup(func() { _, _ = e.db.Exec(`DELETE FROM skills WHERE name = $1`, name) })
	body := map[string]string{"name": name, "description": "Draft an ADR", "instructions": "Write one paragraph."}
	if res := e.as(e.owner, http.MethodPost, "/api/v1/platform/skills", body); res.Code != http.StatusForbidden {
		t.Fatalf("a member created a skill: %d", res.Code)
	}
	if res := e.as(super, http.MethodPost, "/api/v1/platform/skills", body); res.Code != http.StatusCreated {
		t.Fatalf("create skill = %d %s", res.Code, res.Body.String())
	}
	if res := e.as(e.owner, http.MethodGet, "/api/v1/skills", nil); !strings.Contains(res.Body.String(), name) {
		t.Fatalf("a member cannot see the skill: %s", res.Body.String())
	}
	session, err := e.connect(e.newKey())
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	got, err := session.GetPrompt(context.Background(), &mcp.GetPromptParams{Name: name, Arguments: map[string]string{"request": "for the login change"}})
	if err != nil || len(got.Messages) != 1 || !strings.Contains(got.Messages[0].Content.(*mcp.TextContent).Text, "Write one paragraph.") {
		t.Fatalf("GetPrompt() = %+v, %v", got, err)
	}
}

func TestChatInAgentModeAsksBeforeTrashingAndRunsOnApproval(t *testing.T) {
	e := newAgentEnv(t)
	e.model.replies = []agent.Message{
		{Role: "assistant", ToolCalls: []agent.ToolCall{{ID: "c1", Name: "trash_document", Arguments: json.RawMessage(`{"document_id":"` + e.doc + `"}`)}}},
		{Role: "assistant", Content: "Approve the card to move it to the trash."},
	}
	headers := map[string]string{"Authorization": "Bearer " + e.owner.token, "X-Workspace-Id": e.ws}
	created := e.do(http.MethodPost, "/api/v1/rag/conversations", map[string]any{"documentId": e.doc}, headers, "")
	var conv struct {
		Data struct {
			ID         string `json:"id"`
			DocumentID string `json:"documentId"`
		} `json:"data"`
	}
	created.json(&conv)
	if created.Code != http.StatusCreated || conv.Data.DocumentID != e.doc {
		t.Fatalf("create document conversation = %d %s", created.Code, created.Body.String())
	}

	// Without the Documents AI permission the Agent is not even offered the tool.
	e.model.replies = append([]agent.Message{{Role: "assistant", Content: "I cannot do that."}}, e.model.replies...)
	ask := func() reply {
		return e.do(http.MethodPost, "/api/v1/rag/conversations/"+conv.Data.ID+"/messages", map[string]any{"question": "trash this", "language": "en"}, headers, "")
	}
	if res := ask(); res.Code != http.StatusOK || strings.Contains(strings.Join(e.model.tools[0], ","), "trash_document") {
		t.Fatalf("first ask = %d, tools %v", res.Code, e.model.tools[0])
	}

	e.allow(agent.CapRead, agent.CapDocuments)
	res := ask()
	var answer struct {
		Data struct {
			Agent   bool `json:"agent"`
			Actions []struct {
				ID      string `json:"id"`
				Summary string `json:"summary"`
				Status  string `json:"status"`
			} `json:"actions"`
		} `json:"data"`
	}
	res.json(&answer)
	if res.Code != http.StatusOK || !answer.Data.Agent || len(answer.Data.Actions) != 1 || answer.Data.Actions[0].Status != "pending" {
		t.Fatalf("ask = %d %s", res.Code, res.Body.String())
	}
	var deleted bool
	_ = e.db.QueryRow(`SELECT deleted_at IS NOT NULL FROM documents WHERE id = $1`, e.doc).Scan(&deleted)
	if deleted {
		t.Fatal("the document was trashed before approval")
	}
	approve := e.as(e.owner, http.MethodPost, "/api/v1/rag/conversations/"+conv.Data.ID+"/actions/"+answer.Data.Actions[0].ID, map[string]bool{"approve": true})
	if approve.Code != http.StatusOK || !strings.Contains(approve.Body.String(), `"approved"`) {
		t.Fatalf("approve = %d %s", approve.Code, approve.Body.String())
	}
	_ = e.db.QueryRow(`SELECT deleted_at IS NOT NULL FROM documents WHERE id = $1`, e.doc).Scan(&deleted)
	if !deleted {
		t.Fatal("the approved action did not run")
	}
	again := e.as(e.owner, http.MethodPost, "/api/v1/rag/conversations/"+conv.Data.ID+"/actions/"+answer.Data.Actions[0].ID, map[string]bool{"approve": true})
	if again.Code != http.StatusConflict {
		t.Fatalf("a second approval = %d", again.Code)
	}
	history := e.as(e.owner, http.MethodGet, "/api/v1/rag/conversations/"+conv.Data.ID, nil)
	if !strings.Contains(history.Body.String(), `"actions":[{`) {
		t.Fatalf("history = %s", history.Body.String())
	}
	onDoc := e.as(e.owner, http.MethodGet, "/api/v1/rag/documents/"+e.doc+"/conversations", nil)
	if !strings.Contains(onDoc.Body.String(), conv.Data.ID) {
		t.Fatalf("document conversations = %s", onDoc.Body.String())
	}
	workspaceList := e.as(e.owner, http.MethodGet, "/api/v1/rag/conversations", nil)
	if strings.Contains(workspaceList.Body.String(), conv.Data.ID) {
		t.Fatal("a document conversation is listed with the workspace ones")
	}
}

func TestChatMarkdownEditsBecomeAIAssistedSuggestions(t *testing.T) {
	e := newAgentEnv(t)
	e.allow(agent.CapRead, agent.CapContent)
	e.model.replies = []agent.Message{
		{Role: "assistant", ToolCalls: []agent.ToolCall{{ID: "c1", Name: "edit_document_content", Arguments: json.RawMessage(`{"version":"v1","operations":[{"type":"replace_text","find":"passkeys","replace":"passwords"}]}`)}}},
		{Role: "assistant", Content: "I suggested the change."},
	}
	headers := map[string]string{"Authorization": "Bearer " + e.owner.token, "X-Workspace-Id": e.ws}
	created := e.do(http.MethodPost, "/api/v1/rag/conversations", map[string]any{"documentId": e.doc}, headers, "")
	var conv struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	created.json(&conv)
	res := e.do(http.MethodPost, "/api/v1/rag/conversations/"+conv.Data.ID+"/messages", map[string]any{"question": "fix it", "language": "en"}, headers, "")
	if res.Code != http.StatusOK || len(e.rooms.edits) != 1 || e.rooms.edits[0].Mode != "suggest" {
		t.Fatalf("ask = %d %s, edits %+v", res.Code, res.Body.String(), e.rooms.edits)
	}
	var marked int
	_ = e.db.QueryRow(`SELECT COUNT(*) FROM ai_assisted_suggestions WHERE document_id = $1 AND channel = 'chat'`, e.doc).Scan(&marked)
	if marked != 1 {
		t.Fatalf("AI assisted marks = %d", marked)
	}
}

func TestUsageIsForSuperadminsOnly(t *testing.T) {
	e := newAgentEnv(t)
	super := e.registerWithToken("superadmin")
	if res := e.as(e.owner, http.MethodGet, "/api/v1/platform/usage", nil); res.Code != http.StatusForbidden {
		t.Fatalf("member usage = %d", res.Code)
	}
	if res := e.as(super, http.MethodGet, "/api/v1/platform/usage?days=7", nil); res.Code != http.StatusOK || !strings.Contains(res.Body.String(), `"overall"`) {
		t.Fatalf("usage = %d %s", res.Code, res.Body.String())
	}
}

func TestAnMCPCallGetsProgressOnlyWhenItAsksForIt(t *testing.T) {
	e := newAgentEnv(t)
	server := httptest.NewServer(e.api)
	t.Cleanup(server.Close)
	var mu sync.Mutex
	var seen []*mcp.ProgressNotificationParams
	client := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "1"}, &mcp.ClientOptions{
		ProgressNotificationHandler: func(_ context.Context, req *mcp.ProgressNotificationClientRequest) {
			mu.Lock()
			defer mu.Unlock()
			seen = append(seen, req.Params)
		},
	})
	session, err := client.Connect(context.Background(), &mcp.StreamableClientTransport{
		Endpoint: server.URL + "/api/v1/mcp", HTTPClient: &http.Client{Transport: keyBearer{secret: e.newKey(), base: http.DefaultTransport}},
	}, nil)
	if err != nil {
		t.Fatalf("Connect(): %v", err)
	}
	defer session.Close()
	args := map[string]any{"workspace_id": e.ws, "document_id": e.doc}

	plain, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: "read_document", Arguments: args})
	if err != nil || plain.IsError || !strings.Contains(text(plain), "passkeys") {
		t.Fatalf("call without a token = %+v, %v", text(plain), err)
	}
	mu.Lock()
	if len(seen) != 0 {
		t.Fatalf("progress was sent to a call that did not ask: %+v", seen)
	}
	mu.Unlock()

	params := &mcp.CallToolParams{Name: "read_document", Arguments: args}
	params.SetProgressToken("read-1")
	withToken, err := session.CallTool(context.Background(), params)
	if err != nil || withToken.IsError || text(withToken) != text(plain) {
		t.Fatalf("call with a token = %+v, %v; want the same result", text(withToken), err)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(seen) < 2 {
		t.Fatalf("progress notifications = %d, want at least a start and a finish", len(seen))
	}
	for i, n := range seen {
		if n.ProgressToken != "read-1" || n.Total != 2 || (i > 0 && n.Progress <= seen[i-1].Progress) {
			t.Fatalf("notification %d = %+v; the token must match and progress must rise", i, n)
		}
	}
	// Each real call is audited once, with or without progress.
	var audited int
	_ = e.db.QueryRow(`SELECT COUNT(*) FROM mcp_audit WHERE tool = 'read_document' AND user_id = $1`, e.owner.id).Scan(&audited)
	if audited != 2 {
		t.Fatalf("audit rows for two calls = %d", audited)
	}
}

func TestAnMCPCallWhoseClientLeavesDoesNotHangTheServer(t *testing.T) {
	e := newAgentEnv(t)
	session, err := e.connect(e.newKey())
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	params := &mcp.CallToolParams{Name: "read_document", Arguments: map[string]any{"workspace_id": e.ws, "document_id": e.doc}}
	params.SetProgressToken("gone")
	if _, err := session.CallTool(ctx, params); err == nil {
		t.Fatal("a cancelled call returned a result")
	}
	// The session still works for the next call.
	again, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: "read_document", Arguments: map[string]any{"workspace_id": e.ws, "document_id": e.doc}})
	if err != nil || again.IsError {
		t.Fatalf("call after a cancelled one = %v, %v", again, err)
	}
}

// newCanvas makes an Architecture document in the environment's workspace.
func (e *agentEnv) newCanvas() string {
	e.t.Helper()
	res := e.do(http.MethodPost, "/api/v1/documents", map[string]any{"title": "Prod", "type": "architecture", "visibility": "workspace"},
		map[string]string{"Authorization": "Bearer " + e.owner.token, "X-Workspace-Id": e.ws, "Idempotency-Key": uuid.NewString()}, "")
	var created struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	res.json(&created)
	if res.Code != http.StatusCreated || created.Data.ID == "" {
		e.t.Fatalf("create canvas = %d %s", res.Code, res.Body.String())
	}
	return created.Data.ID
}

func TestAnMCPClientListsTheCatalogAndEditsACanvasWithSlugsChecked(t *testing.T) {
	e := newAgentEnv(t)
	canvas := e.newCanvas()
	e.allow(agent.CapRead, agent.CapContent)
	session, err := e.connect(e.newKey())
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	names := strings.Join(toolNames(t, session), ",")
	if !strings.Contains(names, "edit_architecture") || !strings.Contains(names, "list_architecture_catalog") {
		t.Fatalf("tools = %s", names)
	}
	listed, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: "list_architecture_catalog", Arguments: map[string]any{"category": "protocol", "query": "grpc"}})
	if err != nil || listed.IsError || !strings.Contains(text(listed), `"grpc"`) || strings.Contains(text(listed), `"redis"`) {
		t.Fatalf("catalog = %s, %v", text(listed), err)
	}

	args := func(catalog string) map[string]any {
		return map[string]any{"workspace_id": e.ws, "document_id": canvas, "version": "v1", "operations": []any{
			map[string]any{"type": "add_node", "ref": "cache", "kind": "system", "name": "Redis", "catalog": catalog, "parent": "vps"},
		}}
	}
	wrong, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: "edit_architecture", Arguments: args("reddis")})
	if err != nil || !wrong.IsError || !strings.Contains(text(wrong), "did you mean redis") || len(e.rooms.edits) != 0 {
		t.Fatalf("a wrong slug = %s, %v, edits %d", text(wrong), err, len(e.rooms.edits))
	}
	right, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: "edit_architecture", Arguments: args("redis")})
	if err != nil || right.IsError || !strings.Contains(text(right), `"mode":"direct"`) {
		t.Fatalf("edit = %s, %v", text(right), err)
	}
	if len(e.rooms.edits) != 1 || e.rooms.edits[0].Type != "architecture" || e.rooms.edits[0].UserID != e.owner.id {
		t.Fatalf("room edits = %+v", e.rooms.edits)
	}
	var revisions int
	_ = e.db.QueryRow(`SELECT COUNT(*) FROM document_revisions WHERE document_id = $1 AND title LIKE 'Before AI edit, key Laptop%'`, canvas).Scan(&revisions)
	if revisions != 1 {
		t.Fatalf("named versions before the edit = %d", revisions)
	}
}

func TestInChatACanvasEditWaitsForApprovalAndThenLands(t *testing.T) {
	e := newAgentEnv(t)
	canvas := e.newCanvas()
	e.allow(agent.CapRead, agent.CapContent)
	e.model.replies = []agent.Message{
		{Role: "assistant", ToolCalls: []agent.ToolCall{{ID: "c1", Name: "edit_architecture", Arguments: json.RawMessage(`{"version":"v1","operations":[{"type":"add_node","kind":"system","name":"Redis","catalog":"redis","parent":"vps"}]}`)}}},
		{Role: "assistant", Content: "I asked to add Redis."},
	}
	headers := map[string]string{"Authorization": "Bearer " + e.owner.token, "X-Workspace-Id": e.ws}
	created := e.do(http.MethodPost, "/api/v1/rag/conversations", map[string]any{"documentId": canvas}, headers, "")
	var conv struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	created.json(&conv)
	res := e.do(http.MethodPost, "/api/v1/rag/conversations/"+conv.Data.ID+"/messages", map[string]any{"question": "add redis", "language": "en"}, headers, "")
	var answer struct {
		Data struct {
			Actions []struct {
				ID      string `json:"id"`
				Summary string `json:"summary"`
				Status  string `json:"status"`
			} `json:"actions"`
		} `json:"data"`
	}
	res.json(&answer)
	if res.Code != http.StatusOK || len(answer.Data.Actions) != 1 || answer.Data.Actions[0].Status != "pending" ||
		answer.Data.Actions[0].Summary != "Change the Architecture diagram:\n- Add System \"Redis\" inside Host \"VPS-1\"" || len(e.rooms.edits) != 0 {
		t.Fatalf("ask = %d %s, edits %d", res.Code, res.Body.String(), len(e.rooms.edits))
	}
	approve := e.as(e.owner, http.MethodPost, "/api/v1/rag/conversations/"+conv.Data.ID+"/actions/"+answer.Data.Actions[0].ID, map[string]bool{"approve": true})
	if approve.Code != http.StatusOK || len(e.rooms.edits) != 1 || e.rooms.edits[0].Mode != "direct" || e.rooms.edits[0].Type != "architecture" {
		t.Fatalf("approve = %d %s, edits %+v", approve.Code, approve.Body.String(), e.rooms.edits)
	}
}

func TestAToolThatTouchesADocumentHandsBackItsAddressInTheApp(t *testing.T) {
	e := newAgentEnv(t)
	e.allow(agent.CapRead, agent.CapDocuments, agent.CapContent)
	session, err := e.connect(e.newKey())
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	want := appURL + "/docs/" + e.doc

	read, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: "read_document", Arguments: map[string]any{"workspace_id": e.ws, "document_id": e.doc}})
	if err != nil || read.IsError || !strings.Contains(text(read), want) {
		t.Fatalf("read_document = %s, %v; want the address %s", text(read), err, want)
	}
	created, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: "create_document", Arguments: map[string]any{"workspace_id": e.ws, "title": "Notes", "type": "markdown"}})
	if err != nil || created.IsError || !strings.Contains(text(created), appURL+"/docs/") {
		t.Fatalf("create_document = %s, %v; want an address for the new document", text(created), err)
	}
	listed, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: "list_workspaces", Arguments: map[string]any{}})
	if err != nil || listed.IsError || strings.Contains(text(listed), appURL+"/docs/") {
		t.Fatalf("list_workspaces = %s, %v; it touches no document and must carry no address", text(listed), err)
	}
}

func TestWithoutAnAppAddressNoToolResultCarriesOne(t *testing.T) {
	e := newAgentEnv(t)
	e.cfg.PublicAppURL = ""
	e.api = InitRoutes(e.app, e.cfg)
	session, err := e.connect(e.newKey())
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	read, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: "read_document", Arguments: map[string]any{"workspace_id": e.ws, "document_id": e.doc}})
	if err != nil || read.IsError || strings.Contains(text(read), "/docs/") || strings.Contains(text(read), "Open in Dokudocs") {
		t.Fatalf("read_document = %s, %v; there is no address to give", text(read), err)
	}
}

func TestTheServerTellsAnAgentWithABrowserToOpenWhatItChanged(t *testing.T) {
	e := newAgentEnv(t)
	session, err := e.connect(e.newKey())
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	got := session.InitializeResult().Instructions
	if !strings.Contains(got, "browser") || !strings.Contains(got, "Open in Dokudocs") || !strings.Contains(got, "show") {
		t.Fatalf("instructions = %q; want a conditional hint to open the address or show it to the User", got)
	}
}
