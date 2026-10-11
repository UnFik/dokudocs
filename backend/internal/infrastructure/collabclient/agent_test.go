package collabclient

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"backend/internal/application/agent"
)

func TestAgentReadAsksTheRoomWithTheSecret(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/internal/agent-read" || r.Header.Get("X-Collab-Secret") != "s" || r.URL.Query().Get("room") != "w.d" || r.URL.Query().Get("type") != "markdown" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"text": "# Hi", "version": "abc"})
	}))
	defer server.Close()
	got, err := New(server.URL, "s").Read(context.Background(), "w.d", "markdown")
	if err != nil || got.Text != "# Hi" || got.Version != "abc" {
		t.Fatalf("Read() = %+v, %v", got, err)
	}
}

func TestAgentEditMapsConflictsAndRefusals(t *testing.T) {
	status, body := http.StatusOK, `{"version":"v2","suggestionIDs":["x"]}`
	var sent map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&sent)
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	defer server.Close()
	client := New(server.URL, "s")
	edit := agent.LiveEdit{Room: "w.d", Type: "markdown", UserID: "u", Mode: "suggest", BaseVersion: "v1", Operations: json.RawMessage(`[{"type":"append","text":"x"}]`)}

	got, err := client.Edit(context.Background(), edit)
	if err != nil || got.Version != "v2" || len(got.SuggestionIDs) != 1 || sent["mode"] != "suggest" || sent["userID"] != "u" {
		t.Fatalf("Edit() = %+v, %v, sent %v", got, err, sent)
	}

	status, body = http.StatusConflict, `{"error":"changed","version":"v9"}`
	var conflict *agent.ConflictError
	if _, err := client.Edit(context.Background(), edit); !errors.As(err, &conflict) || conflict.Version != "v9" {
		t.Fatalf("conflict error = %v", err)
	}

	status, body = http.StatusUnprocessableEntity, `{"error":"\"absent\" was not found; read the document again"}`
	var refusal *agent.ToolError
	if _, err := client.Edit(context.Background(), edit); !errors.As(err, &refusal) || refusal.Message == "" {
		t.Fatalf("refusal error = %v", err)
	}

	status = http.StatusInternalServerError
	if _, err := client.Edit(context.Background(), edit); err == nil || errors.As(err, &refusal) {
		t.Fatalf("server error = %v", err)
	}
}

func TestWithoutAServiceTheAgentCannotReachDocuments(t *testing.T) {
	if _, err := New("", "").Read(context.Background(), "w.d", "markdown"); err == nil {
		t.Fatal("a client without a URL pretended to read")
	}
}
