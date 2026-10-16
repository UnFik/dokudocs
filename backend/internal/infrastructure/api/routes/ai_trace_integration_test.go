//go:build integration

package routes

import (
	"net/http"
	"strings"
	"testing"

	"backend/internal/application/agent"
)

// ask sends one chat question on a document Conversation and returns the answer's status.
func (e *agentEnv) ask(question string) int {
	e.t.Helper()
	headers := map[string]string{"Authorization": "Bearer " + e.owner.token, "X-Workspace-Id": e.ws}
	created := e.do(http.MethodPost, "/api/v1/rag/conversations", map[string]any{"documentId": e.doc}, headers, "")
	var conv struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	created.json(&conv)
	if created.Code != http.StatusCreated || conv.Data.ID == "" {
		e.t.Fatalf("create conversation = %d %s", created.Code, created.Body.String())
	}
	return e.do(http.MethodPost, "/api/v1/rag/conversations/"+conv.Data.ID+"/messages", map[string]any{"question": question, "language": "en"}, headers, "").Code
}

type traceList struct {
	Data struct {
		Runs []struct {
			RunID   string `json:"runId"`
			Outcome string `json:"outcome"`
			Steps   int    `json:"steps"`
			Failed  bool   `json:"failed"`
		} `json:"runs"`
		Total int `json:"total"`
	} `json:"data"`
}

func TestASuperadminFollowsARequestThroughTheGraphWithoutReadingIt(t *testing.T) {
	e := newAgentEnv(t)
	e.allow("read", "content")
	super := e.registerWithToken("superadmin")
	e.model.replies = []agent.Message{{Role: "assistant", Content: "The vault code is 4417."}}
	if code := e.ask("Tulis catatan rahasia: the vault code is 4417"); code != http.StatusOK && code != http.StatusCreated {
		t.Fatalf("ask = %d", code)
	}

	res := e.as(super, http.MethodGet, "/api/v1/platform/ai/runs?userId="+e.owner.id, nil)
	var list traceList
	res.json(&list)
	if res.Code != http.StatusOK || list.Data.Total != 1 || list.Data.Runs[0].Outcome != "respond" || list.Data.Runs[0].Steps < 6 {
		t.Fatalf("list = %d %s", res.Code, res.Body.String())
	}
	for _, secret := range []string{"vault", "4417", "rahasia"} {
		if strings.Contains(res.Body.String(), secret) {
			t.Fatalf("the list carries what the User wrote: %s", res.Body.String())
		}
	}

	detail := e.as(super, http.MethodGet, "/api/v1/platform/ai/runs/"+list.Data.Runs[0].RunID, nil)
	body := detail.Body.String()
	if detail.Code != http.StatusOK || !strings.Contains(body, `"node":"gate"`) || !strings.Contains(body, `"node":"model_large"`) || !strings.Contains(body, `"graph"`) || !strings.Contains(body, `"nodes"`) {
		t.Fatalf("detail = %d %s", detail.Code, body)
	}
	for _, secret := range []string{"vault", "4417", "rahasia"} {
		if strings.Contains(body, secret) {
			t.Fatalf("the trace carries what the User wrote: %s", body)
		}
	}
}

func TestTheTraceListFiltersAndIsForSuperadminsOnly(t *testing.T) {
	e := newAgentEnv(t)
	e.allow("read")
	super := e.registerWithToken("superadmin")
	e.ask("Berapa dokumen saya?")

	if res := e.as(e.owner, http.MethodGet, "/api/v1/platform/ai/runs", nil); res.Code != http.StatusForbidden {
		t.Fatalf("a member lists traces = %d", res.Code)
	}
	if res := e.as(e.owner, http.MethodGet, "/api/v1/platform/ai/runs/"+e.ws, nil); res.Code != http.StatusForbidden {
		t.Fatalf("a member reads a trace = %d", res.Code)
	}
	for query, want := range map[string]int{
		"?userId=" + e.owner.id + "&node=reject":             0,
		"?userId=" + e.owner.id + "&failed=true":             0,
		"?userId=" + e.owner.id + "&node=gate":               1,
		"?userId=" + e.owner.id + "&outcome=respond&limit=1": 1,
	} {
		res := e.as(super, http.MethodGet, "/api/v1/platform/ai/runs"+query, nil)
		var list traceList
		res.json(&list)
		if res.Code != http.StatusOK || len(list.Data.Runs) != want {
			t.Fatalf("%s -> %d, %d runs (%s)", query, res.Code, len(list.Data.Runs), res.Body.String())
		}
	}
	for _, bad := range []string{"?userId=nope", "?since=yesterday", "?minDurationMs=-3"} {
		if res := e.as(super, http.MethodGet, "/api/v1/platform/ai/runs"+bad, nil); res.Code != http.StatusBadRequest {
			t.Fatalf("%s = %d, want 400", bad, res.Code)
		}
	}
	if res := e.as(super, http.MethodGet, "/api/v1/platform/ai/runs/00000000-0000-0000-0000-000000000000", nil); res.Code != http.StatusNotFound {
		t.Fatalf("an unknown trace = %d", res.Code)
	}
}

func TestSwitchingTheGateOffTakesEffectAndIsRecordedInTheTrace(t *testing.T) {
	e := newAgentEnv(t)
	e.allow("read")
	super := e.registerWithToken("superadmin")
	t.Cleanup(func() {
		_, _ = e.db.Exec(`UPDATE ai_harness_settings SET gate_enabled = TRUE, router_enabled = TRUE, trace_retention_days = 30`)
	})

	if res := e.as(e.owner, http.MethodGet, "/api/v1/platform/ai/harness", nil); res.Code != http.StatusForbidden {
		t.Fatalf("a member reads the settings = %d", res.Code)
	}
	if res := e.as(super, http.MethodPut, "/api/v1/platform/ai/harness", map[string]any{"gateEnabled": true, "routerEnabled": true, "traceRetentionDays": 0}); res.Code != http.StatusBadRequest {
		t.Fatalf("retention 0 = %d", res.Code)
	}
	res := e.as(super, http.MethodPut, "/api/v1/platform/ai/harness", map[string]any{"gateEnabled": false, "routerEnabled": true, "traceRetentionDays": 14})
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), `"gateEnabled":false`) || !strings.Contains(res.Body.String(), `"traceRetentionDays":14`) {
		t.Fatalf("save = %d %s", res.Code, res.Body.String())
	}
	e.ask("Berapa dokumen saya?")
	list := e.as(super, http.MethodGet, "/api/v1/platform/ai/runs?userId="+e.owner.id, nil)
	var runs traceList
	list.json(&runs)
	if len(runs.Data.Runs) != 1 {
		t.Fatalf("list = %s", list.Body.String())
	}
	detail := e.as(super, http.MethodGet, "/api/v1/platform/ai/runs/"+runs.Data.Runs[0].RunID, nil)
	if !strings.Contains(detail.Body.String(), `"reason":"gate_off"`) {
		t.Fatalf("the switched off gate was not recorded: %s", detail.Body.String())
	}
}
