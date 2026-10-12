//go:build integration

package routes

import (
	"context"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	appchat "backend/internal/application/rag/usecase"
	"backend/internal/infrastructure/runtime/container"
)

// titleModel answers a request for a title with a fixed one, and records the
// question and answer it was shown.
type titleModel struct {
	mu    sync.Mutex
	shown []string
}

func (m *titleModel) Answer(_ context.Context, input appchat.ModelInput) (appchat.ModelOutput, error) {
	if !strings.HasPrefix(input.Question, appchat.TitleRequest) {
		return appchat.ModelOutput{}, nil
	}
	m.mu.Lock()
	for _, source := range input.Sources {
		m.shown = append(m.shown, source.Text)
	}
	m.mu.Unlock()
	return appchat.ModelOutput{Text: `  "Deploy checklist"  `}, nil
}

func (c *conversationClient) waitForTitle(id string, want string) string {
	c.t.Helper()
	var title string
	for deadline := time.Now().Add(3 * time.Second); time.Now().Before(deadline); time.Sleep(50 * time.Millisecond) {
		for _, conversation := range c.list() {
			if conversation.ID.String() == id {
				title = conversation.Title
			}
		}
		if title == want {
			return title
		}
	}
	return title
}

func TestConversationGetsAModelTitleAfterItsFirstAnswer(t *testing.T) {
	model := &titleModel{}
	client := newConversationClient(t, func(c *container.Container) { c.RAGAnswerModel = model })
	conversation := client.create()
	id := conversation.ID.String()

	ask := func(question string) {
		t.Helper()
		res := client.do(http.MethodPost, "/api/v1/rag/conversations/"+id+"/messages", `{"question":"`+question+`","language":"en"}`)
		if res.Code != http.StatusOK {
			t.Fatalf("ask = %d, body = %s", res.Code, res.Body.String())
		}
	}

	ask("How do I ship a release?")
	if got := client.waitForTitle(id, "Deploy checklist"); got != "Deploy checklist" {
		t.Fatalf("title = %q, want the model's title with quotes and spaces removed", got)
	}
	model.mu.Lock()
	shown := strings.Join(model.shown, " ")
	model.mu.Unlock()
	if !strings.Contains(shown, "How do I ship a release?") {
		t.Fatalf("the title model saw %q, want the first question", shown)
	}

	// A title the User chose is never replaced.
	if res := client.do(http.MethodPatch, "/api/v1/rag/conversations/"+id, `{"title":"Mine"}`); res.Code != http.StatusOK {
		t.Fatalf("rename = %d", res.Code)
	}
	ask("And then?")
	time.Sleep(400 * time.Millisecond)
	if got := client.waitForTitle(id, "Mine"); got != "Mine" {
		t.Fatalf("title after another answer = %q, want the User's own title", got)
	}
}
