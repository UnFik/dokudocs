//go:build integration

package routes

import (
	"fmt"
	"net/http"
	"strings"
	"testing"
)

func TestASuperadminSeesEachUsersSpendAndResetsIt(t *testing.T) {
	e := newAgentEnv(t)
	super := e.registerWithToken("superadmin")
	if _, err := e.db.Exec(`INSERT INTO ai_model_usage (provider, model, purpose, feature, input_tokens, output_tokens, user_id, workspace_id, ok)
		VALUES ('openai', 'm', 'answer', 'chat_workspace', 1200, 300, $1, $2, true)`, e.owner.id, e.ws); err != nil {
		t.Fatal(err)
	}

	if res := e.as(e.owner, http.MethodGet, "/api/v1/platform/ai/quotas", nil); res.Code != http.StatusForbidden {
		t.Fatalf("member lists quotas = %d, want 403", res.Code)
	}
	reset := fmt.Sprintf("/api/v1/platform/ai/quotas/%s/%s/reset", e.ws, e.owner.id)
	if res := e.as(e.owner, http.MethodPost, reset, nil); res.Code != http.StatusForbidden {
		t.Fatalf("member resets = %d, want 403", res.Code)
	}

	res := e.as(super, http.MethodGet, "/api/v1/platform/ai/quotas", nil)
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), e.owner.id) || !strings.Contains(res.Body.String(), `"used":1500`) {
		t.Fatalf("list quotas = %d %s", res.Code, res.Body.String())
	}

	if res := e.as(super, http.MethodPost, reset, nil); res.Code != http.StatusNoContent {
		t.Fatalf("reset = %d %s", res.Code, res.Body.String())
	}
	if body := e.as(super, http.MethodGet, "/api/v1/platform/ai/quotas", nil).Body.String(); strings.Contains(body, e.owner.id) {
		t.Fatalf("quotas after reset = %s, want the User gone", body)
	}
	res = e.do(http.MethodGet, "/api/v1/rag/usage", nil,
		map[string]string{"Authorization": "Bearer " + e.owner.token, "X-Workspace-Id": e.ws}, "")
	if !strings.Contains(res.Body.String(), `"used":0`) {
		t.Fatalf("usage after reset = %s, want 0 used", res.Body.String())
	}
}
