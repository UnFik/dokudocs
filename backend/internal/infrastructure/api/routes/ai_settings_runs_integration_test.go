//go:build integration

package routes

import (
	"errors"
	"net/http"
	"strings"
	"testing"
)

type platformRun struct {
	Data struct {
		ID     string `json:"id"`
		Kind   string `json:"kind"`
		Status string `json:"status"`
		Error  string `json:"error"`
		Result struct {
			Operation string `json:"operation"`
			Streaming string `json:"streaming"`
		} `json:"result"`
	} `json:"data"`
}

func (e *aiEnv) startPlatformRun(user tokenUser, purpose, operation string, extra map[string]string) (int, platformRun) {
	body := map[string]string{"operation": operation}
	for k, v := range goodAnswer {
		body[k] = v
	}
	for k, v := range extra {
		body[k] = v
	}
	res := e.as(user, http.MethodPost, "/api/v1/platform/ai/"+purpose+"/runs", body)
	var run platformRun
	res.json(&run)
	return res.Code, run
}

func (e *aiEnv) finished(user tokenUser, id string) platformRun {
	e.t.Helper()
	var run platformRun
	waitFor(e.t, "the AI job to end", func() bool {
		res := e.as(user, http.MethodGet, "/api/v1/ai/runs/"+id, nil)
		run = platformRun{}
		res.json(&run)
		return res.Code == http.StatusOK && run.Data.Status != "running"
	})
	return run
}

func TestOnlyASuperadminCanStartAnAIProviderJob(t *testing.T) {
	env := newAIEnv(t)
	for _, role := range []string{"", "admin", "member"} {
		user := env.registerWithToken(role)
		for _, operation := range []string{"test", "save"} {
			if code, _ := env.startPlatformRun(user, "answer", operation, nil); code != http.StatusForbidden {
				t.Errorf("role %q %s = %d, want 403", role, operation, code)
			}
		}
		if res := env.as(user, http.MethodGet, "/api/v1/platform/ai/answer/runs/latest", nil); res.Code != http.StatusForbidden {
			t.Errorf("role %q latest = %d, want 403", role, res.Code)
		}
	}
	var runs int
	_ = env.db.QueryRow(`SELECT COUNT(*) FROM ai_runs WHERE kind IN ('test','save')`).Scan(&runs)
	if runs != 0 {
		t.Fatalf("%d runs were recorded for people who may not change the provider", runs)
	}
}

func TestATestRunReportsStreamingChangesNothingAndCanBeOpenedAgain(t *testing.T) {
	env := newAIEnv(t)
	super := env.registerWithToken("superadmin")
	code, started := env.startPlatformRun(super, "answer", "test", nil)
	if code != http.StatusAccepted {
		t.Fatalf("start = %d", code)
	}
	run := env.finished(super, started.Data.ID)
	if run.Data.Status != "completed" || run.Data.Result.Operation != "test" || run.Data.Result.Streaming != "supported" {
		t.Fatalf("test run = %+v", run.Data)
	}
	var stored, leaked int
	_ = env.db.QueryRow(`SELECT COUNT(*) FROM ai_provider_settings`).Scan(&stored)
	_ = env.db.QueryRow(`SELECT COUNT(*) FROM ai_runs r LEFT JOIN ai_run_events e ON e.run_id = r.id
		WHERE r.owner_id IS NOT NULL AND (to_jsonb(r)::text LIKE '%sk-secret%' OR e.data::text LIKE '%sk-secret%')`).Scan(&leaked)
	if stored != 0 || leaked != 0 {
		t.Fatalf("a test changed the settings (%d rows) or kept the key (%d records)", stored, leaked)
	}
	latest := env.as(super, http.MethodGet, "/api/v1/platform/ai/answer/runs/latest", nil)
	var again platformRun
	latest.json(&again)
	if latest.Code != http.StatusOK || again.Data.ID != started.Data.ID {
		t.Fatalf("latest = %d %s", latest.Code, latest.Body.String())
	}
	other := env.registerWithToken("superadmin")
	if res := env.as(other, http.MethodGet, "/api/v1/ai/runs/"+started.Data.ID, nil); res.Code != http.StatusNotFound {
		t.Fatalf("another superadmin read the first one's run: %d", res.Code)
	}
}

func TestASaveRunKeepsTheSettingOnlyAfterTheTestPasses(t *testing.T) {
	env := newAIEnv(t)
	super := env.registerWithToken("superadmin")
	env.tester.err = errors.New("answer provider returned HTTP 401")
	_, failedStart := env.startPlatformRun(super, "answer", "save", nil)
	failed := env.finished(super, failedStart.Data.ID)
	if failed.Data.Status != "failed" || !strings.Contains(failed.Data.Error, "HTTP 401") || strings.Contains(failed.Data.Error, "sk-secret") {
		t.Fatalf("failed save run = %+v", failed.Data)
	}
	var stored int
	_ = env.db.QueryRow(`SELECT COUNT(*) FROM ai_provider_settings`).Scan(&stored)
	if stored != 0 {
		t.Fatal("a failed test left a setting behind")
	}

	env.tester.err = nil
	_, okStart := env.startPlatformRun(super, "answer", "save", nil)
	done := env.finished(super, okStart.Data.ID)
	if done.Data.Status != "completed" || done.Data.Result.Operation != "save" {
		t.Fatalf("save run = %+v", done.Data)
	}
	_ = env.db.QueryRow(`SELECT COUNT(*) FROM ai_provider_settings WHERE purpose = 'answer'`).Scan(&stored)
	if stored != 1 {
		t.Fatalf("settings stored = %d, want 1", stored)
	}
	if res := env.as(super, http.MethodGet, "/api/v1/ai/runs/"+okStart.Data.ID, nil); strings.Contains(res.Body.String(), "sk-secret") {
		t.Fatalf("the run holds the key: %s", res.Body.String())
	}
}

func TestASaveRunStopsWhenTheRoleIsRevokedWhileTheProviderIsBeingTested(t *testing.T) {
	env := newAIEnv(t)
	super := env.registerWithToken("superadmin")
	env.tester.during = func() {
		_, _ = env.db.Exec(`DELETE FROM user_roles WHERE user_id = $1`, super.id)
	}
	_, started := env.startPlatformRun(super, "answer", "save", nil)
	// The role is gone, so even reading the run is refused; look in the table.
	waitFor(t, "the job to end", func() bool {
		var status string
		_ = env.db.QueryRow(`SELECT status FROM ai_runs WHERE id = $1`, started.Data.ID).Scan(&status)
		return status != "running" && status != ""
	})
	var stored int
	_ = env.db.QueryRow(`SELECT COUNT(*) FROM ai_provider_settings`).Scan(&stored)
	if stored != 0 {
		t.Fatal("a setting was saved after the actor lost the Superadmin role")
	}
}

func TestEmbeddingProgressIsOnlyForASuperadmin(t *testing.T) {
	env := newAIEnv(t)
	user := env.registerWithToken("member")
	if res := env.as(user, http.MethodGet, "/api/v1/platform/ai/embedding/events", nil); res.Code != http.StatusForbidden {
		t.Fatalf("progress events for a member = %d, want 403", res.Code)
	}
	super := env.registerWithToken("superadmin")
	res := env.as(super, http.MethodGet, "/api/v1/platform/ai/embedding/events", nil)
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), `"pending":false`) {
		t.Fatalf("progress events = %d %s", res.Code, res.Body.String())
	}
}
