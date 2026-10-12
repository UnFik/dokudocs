//go:build integration

package routes

import (
	"net/http"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func (r *runEnv) newDocument(workspaceID, title string) string {
	r.t.Helper()
	res := r.do(http.MethodPost, "/api/v1/documents", map[string]any{"title": title, "type": "markdown", "visibility": "workspace"},
		map[string]string{"Authorization": "Bearer " + r.owner.token, "X-Workspace-Id": workspaceID, "Idempotency-Key": uuid.NewString()}, "")
	var out struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	res.json(&out)
	if res.Code != http.StatusCreated {
		r.t.Fatalf("create document = %d %s", res.Code, res.Body.String())
	}
	return out.Data.ID
}

func mentionOf(label, id string) string { return "@[" + label + "](doc:" + id + ")" }

// finish lets the held answer complete and waits until it is stored.
func (r *runEnv) finish() {
	r.t.Helper()
	<-r.gate.firstSent
	close(r.gate.release)
	waitFor(r.t, "the answer to be stored", func() bool { return r.messages() == 2 })
}

type mentionedMessages struct {
	Data struct {
		Messages []struct {
			Role     string `json:"role"`
			Content  string `json:"content"`
			Mentions []struct {
				DocumentID string `json:"documentId"`
				Title      string `json:"title"`
				Available  bool   `json:"available"`
			} `json:"mentions"`
		} `json:"messages"`
	} `json:"data"`
}

func (r *runEnv) history() mentionedMessages {
	r.t.Helper()
	res := r.do(http.MethodGet, "/api/v1/rag/conversations/"+r.conv, nil, r.headers(r.owner, ""), "")
	var out mentionedMessages
	res.json(&out)
	return out
}

func TestAQuestionCannotMentionADocumentTheUserCannotRead(t *testing.T) {
	r := newRunEnv(t)
	otherWorkspace := r.do(http.MethodPost, "/api/v1/workspaces", map[string]string{"name": "Elsewhere"}, map[string]string{"Authorization": "Bearer " + r.owner.token}, "")
	var ws struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	otherWorkspace.json(&ws)
	t.Cleanup(func() { _, _ = r.db.Exec(`DELETE FROM workspaces WHERE id = $1`, ws.Data.ID) })
	elsewhere := r.newDocument(ws.Data.ID, "Not here")

	for name, id := range map[string]string{"unknown id": uuid.NewString(), "another workspace's document": elsewhere} {
		code, _ := r.start(uuid.NewString(), "see "+mentionOf("x", id))
		if code != http.StatusBadRequest {
			t.Errorf("%s: start = %d, want 400", name, code)
		}
	}
	if n := r.messages(); n != 0 {
		t.Errorf("a refused question left %d messages", n)
	}
}

func TestAQuestionMentionsAtMostFiveDocuments(t *testing.T) {
	r := newRunEnv(t)
	ids := make([]string, 6)
	var question strings.Builder
	for i := range ids {
		ids[i] = r.newDocument(r.ws, "Doc "+string(rune('A'+i)))
		question.WriteString(mentionOf("Doc", ids[i]) + " ")
	}
	if code, _ := r.start(uuid.NewString(), question.String()); code != http.StatusBadRequest {
		t.Fatalf("six documents = %d, want 400", code)
	}

	// The same document named again is still one document.
	repeated := strings.Repeat(mentionOf("Doc", ids[0])+" ", 6)
	code, _ := r.start(uuid.NewString(), repeated)
	if code != http.StatusAccepted {
		t.Fatalf("one document named six times = %d, want 202", code)
	}
	r.finish()
}

func TestAMentionIsStoredWithTheDocumentsOwnTitleAndTheAgentIsToldWhichDocument(t *testing.T) {
	r := newRunEnv(t)
	doc := r.newDocument(r.ws, "Recovery [v2] runbook")
	code, _ := r.start(uuid.NewString(), "what does "+mentionOf("a stale name", doc)+" say?")
	if code != http.StatusAccepted {
		t.Fatalf("start = %d", code)
	}
	r.finish()

	user := r.history().Data.Messages[0]
	want := "what does " + mentionOf("Recovery v2 runbook", doc) + " say?"
	if user.Content != want {
		t.Errorf("stored question = %q, want %q", user.Content, want)
	}
	if len(user.Mentions) != 1 || user.Mentions[0].DocumentID != doc || user.Mentions[0].Title != "Recovery [v2] runbook" || !user.Mentions[0].Available {
		t.Errorf("mentions = %+v", user.Mentions)
	}

	r.gate.mu.Lock()
	defer r.gate.mu.Unlock()
	sent := r.gate.seen[0]
	if last := sent[len(sent)-1].Content; !strings.Contains(last, "(doc:"+doc+")") {
		t.Errorf("the Agent was not given the document's id: %q", last)
	}
	if system := sent[0].Content; !strings.Contains(system, "doc:id") {
		t.Errorf("the Agent was not told to read the named documents: %q", system)
	}
}

func TestAChipForADeletedDocumentIsMarkedUnavailable(t *testing.T) {
	r := newRunEnv(t)
	doc := r.newDocument(r.ws, "Short lived")
	if code, _ := r.start(uuid.NewString(), "read "+mentionOf("Short lived", doc)); code != http.StatusAccepted {
		t.Fatalf("start = %d", code)
	}
	r.finish()

	if res := r.do(http.MethodDelete, "/api/v1/documents/"+doc, nil, r.headers(r.owner, ""), ""); res.Code != http.StatusNoContent && res.Code != http.StatusOK {
		t.Fatalf("delete document = %d %s", res.Code, res.Body.String())
	}
	got := r.history().Data.Messages[0].Mentions
	if len(got) != 1 || got[0].Available || got[0].Title != "Short lived" {
		t.Errorf("mentions after the document was deleted = %+v, want one unavailable chip keeping its title", got)
	}
}

type documentHits struct {
	Data []struct {
		ID          string  `json:"id"`
		Title       string  `json:"title"`
		Type        string  `json:"type"`
		ProjectName string  `json:"projectName"`
		Content     *string `json:"content"`
	} `json:"data"`
}

func (r *runEnv) searchDocuments(u tokenUser, query string) (int, documentHits) {
	r.t.Helper()
	res := r.do(http.MethodGet, "/api/v1/rag/document-search?"+query, nil, r.headers(u, ""), "")
	var out documentHits
	res.json(&out)
	return res.Code, out
}

func TestTheMentionPickerFindsReadableDocumentsByTitle(t *testing.T) {
	r := newRunEnv(t)
	runbook := r.newDocument(r.ws, "Recovery runbook")
	r.newDocument(r.ws, "Hiring plan")
	trashed := r.newDocument(r.ws, "Recovery notes (old)")
	if res := r.do(http.MethodDelete, "/api/v1/documents/"+trashed, nil, r.headers(r.owner, ""), ""); res.Code >= 300 {
		t.Fatalf("trash = %d", res.Code)
	}

	code, hits := r.searchDocuments(r.owner, "search=recov")
	if code != http.StatusOK || len(hits.Data) != 1 || hits.Data[0].ID != runbook || hits.Data[0].Title != "Recovery runbook" {
		t.Fatalf("search=recov = %d %+v, want only the live runbook", code, hits.Data)
	}
	if hits.Data[0].Content != nil {
		t.Error("a picker row carries the document body")
	}

	// An empty search lists the most recently changed documents, within the limit.
	_, recent := r.searchDocuments(r.owner, "limit=2")
	if len(recent.Data) != 2 {
		t.Errorf("limit=2 returned %d rows", len(recent.Data))
	}
	// The text of a document is not searched, only its title.
	if _, body := r.searchDocuments(r.owner, "search=zzz-not-a-title"); len(body.Data) != 0 {
		t.Errorf("a title that matches nothing returned %d rows", len(body.Data))
	}
}

func TestTheMentionPickerNeverListsADocumentTheUserCannotRead(t *testing.T) {
	r := newRunEnv(t)
	r.newDocument(r.ws, "Shared plan")
	outsider := r.registerWithToken("")
	if code, hits := r.searchDocuments(outsider, "search=plan"); code == http.StatusOK && len(hits.Data) != 0 {
		t.Fatalf("a non-member found %+v", hits.Data)
	}
}
