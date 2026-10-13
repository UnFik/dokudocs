//go:build integration

package routes

import (
	"net/http"
	"strings"
	"testing"
)

func TestOnlyASuperadminReadsAndChangesTheUsageLimits(t *testing.T) {
	e := newAgentEnv(t)
	super := e.registerWithToken("superadmin")

	if res := e.as(e.owner, http.MethodGet, "/api/v1/platform/ai/limits", nil); res.Code != http.StatusForbidden {
		t.Fatalf("member reads limits = %d, want 403", res.Code)
	}
	if res := e.as(e.owner, http.MethodPut, "/api/v1/platform/ai/limits/Pro", map[string]any{"monthlyTokens": 1}); res.Code != http.StatusForbidden {
		t.Fatalf("member sets a limit = %d, want 403", res.Code)
	}

	res := e.as(super, http.MethodGet, "/api/v1/platform/ai/limits", nil)
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), `"plan":"Free"`) || !strings.Contains(res.Body.String(), `"monthlyTokens":300000`) {
		t.Fatalf("list limits = %d %s", res.Code, res.Body.String())
	}
}

func TestAChangedLimitAppliesToTheWorkspaceOnThatPlan(t *testing.T) {
	e := newAgentEnv(t)
	super := e.registerWithToken("superadmin")
	if _, err := e.db.Exec(`UPDATE workspaces SET plan = 'Team' WHERE id = $1`, e.ws); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = e.db.Exec(`DELETE FROM ai_plan_limits WHERE plan = 'Team'`) })

	usage := func() string {
		res := e.do(http.MethodGet, "/api/v1/rag/usage", nil,
			map[string]string{"Authorization": "Bearer " + e.owner.token, "X-Workspace-Id": e.ws}, "")
		if res.Code != http.StatusOK {
			t.Fatalf("usage = %d %s", res.Code, res.Body.String())
		}
		return res.Body.String()
	}
	// A Plan without a row of its own gets the Free limit.
	if body := usage(); !strings.Contains(body, `"limit":300000`) {
		t.Fatalf("unlisted plan usage = %s, want the Free limit", body)
	}
	set := e.as(super, http.MethodPut, "/api/v1/platform/ai/limits/Team", map[string]any{"monthlyTokens": 7_500_000})
	if set.Code != http.StatusOK {
		t.Fatalf("set limit = %d %s", set.Code, set.Body.String())
	}
	if body := usage(); !strings.Contains(body, `"limit":7500000`) {
		t.Fatalf("usage after change = %s, want 7500000", body)
	}
}

func TestAUsageLimitMustBeAWholePositiveNumberOfTokens(t *testing.T) {
	e := newAgentEnv(t)
	super := e.registerWithToken("superadmin")
	for _, bad := range []any{0, -5, 1.5, "lots", 10_000_000_000_000} {
		res := e.as(super, http.MethodPut, "/api/v1/platform/ai/limits/Pro", map[string]any{"monthlyTokens": bad})
		if res.Code != http.StatusBadRequest {
			t.Fatalf("limit %v = %d, want 400 (%s)", bad, res.Code, res.Body.String())
		}
	}
	long := strings.Repeat("p", 51)
	if res := e.as(super, http.MethodPut, "/api/v1/platform/ai/limits/"+long, map[string]any{"monthlyTokens": 10}); res.Code != http.StatusBadRequest {
		t.Fatalf("51 character plan name = %d, want 400", res.Code)
	}
}
