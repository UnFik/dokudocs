//go:build integration

package document

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"backend/internal/application/collaboration"
	"backend/internal/infrastructure/collaboration/redisfanout"
	"backend/internal/infrastructure/collaboration/websocket"
	"backend/internal/infrastructure/collaboration/yjs"

	"github.com/google/uuid"
	"github.com/reearth/ygo/crdt"
	ws "golang.org/x/net/websocket"
)

// The WebSocket is how a commenter's suggestion reaches an editor: the ready frame
// says who may suggest, an update from a commenter is committed and fanned out like
// any other, and an update that is more than a suggestion is refused.

func TestWebSocketCarriesACommentersSuggestionAndRefusesAnythingElse(t *testing.T) {
	w := newSuggesterWorld(t)
	broker, err := redisfanout.New(integrationRedisURL(t))
	if err != nil {
		t.Fatalf("create Redis broker: %v", err)
	}
	verifier := integrationWebSocketVerifier{"editor": w.editor, "commenter": w.commenter, "viewer": w.viewer}
	server := websocket.NewServer(verifier, collaboration.NewBodyReadUseCase(w.repo), w.repo, integrationOrigin, broker)
	mux := http.NewServeMux()
	mux.Handle("GET /api/v1/collaboration/{id}", server)
	httpServer := httptest.NewServer(mux)
	t.Cleanup(func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			t.Errorf("shut down collaboration server: %v", err)
		}
		httpServer.Close()
	})

	dial := func(token string) (*ws.Conn, integrationWebSocketFrame) {
		t.Helper()
		url := "ws" + strings.TrimPrefix(httpServer.URL, "http") + "/api/v1/collaboration/" + w.documentID.String()
		connection, err := ws.Dial(url, "", integrationOrigin)
		if err != nil {
			t.Fatalf("dial collaboration WebSocket: %v", err)
		}
		t.Cleanup(func() { _ = connection.Close() })
		connection.PayloadType = ws.TextFrame
		if err := ws.JSON.Send(connection, struct {
			Type        string    `json:"type"`
			Token       string    `json:"token"`
			WorkspaceID uuid.UUID `json:"workspaceID"`
		}{Type: "auth", Token: token, WorkspaceID: w.workspaceID}); err != nil {
			t.Fatalf("send WebSocket auth: %v", err)
		}
		return connection, readWebSocketFrame(t, connection)
	}
	flag := func(value *bool) string {
		if value == nil {
			return "missing"
		}
		if *value {
			return "true"
		}
		return "false"
	}

	editorSocket, editorReady := dial("editor")
	commenterSocket, commenterReady := dial("commenter")
	viewerSocket, viewerReady := dial("viewer")
	for name, tc := range map[string]struct {
		ready               integrationWebSocketFrame
		canEdit, canSuggest string
	}{
		"editor":    {editorReady, "true", "true"},
		"commenter": {commenterReady, "false", "true"},
		"viewer":    {viewerReady, "false", "false"},
	} {
		if tc.ready.Type != "ready" || flag(tc.ready.CanEdit) != tc.canEdit || flag(tc.ready.CanSuggest) != tc.canSuggest {
			t.Fatalf("%s ready = type %q canEdit %s canSuggest %s, want canEdit %s canSuggest %s",
				name, tc.ready.Type, flag(tc.ready.CanEdit), flag(tc.ready.CanSuggest), tc.canEdit, tc.canSuggest)
		}
	}

	// A commenter's suggestion is committed, acknowledged, and reaches the editor.
	suggestion, updateID := uuid.New(), uuid.New()
	update := w.update(func(tx *crdt.Transaction, root *crdt.YXmlElement) {
		w.text(root).Insert(tx, 5, " text", w.mark("insert", w.commenter, suggestion))
	})
	if err := sendWebSocketUpdate(commenterSocket, updateID, update); err != nil {
		t.Fatalf("send the commenter's suggestion: %v", err)
	}
	if ack := readWebSocketFrame(t, commenterSocket); ack.Type != "ack" || ack.UpdateID != updateID {
		t.Fatalf("commenter ACK = %+v, want the suggestion acknowledged", ack)
	}
	fanout := readWebSocketFrame(t, editorSocket)
	state := fanout.State
	if fanout.Type == "update" {
		client := crdt.New()
		defer client.Destroy()
		if err := crdt.ApplyUpdateV1(client, editorReady.State, nil); err != nil {
			t.Fatalf("load the editor's state: %v", err)
		}
		if err := crdt.ApplyUpdateV1(client, fanout.Update, nil); err != nil {
			t.Fatalf("apply the fanned-out update: %v", err)
		}
		state = crdt.EncodeStateAsUpdateV1(client, nil)
	} else if fanout.Type != "resync" {
		t.Fatalf("editor received %+v, want the commenter's suggestion", fanout)
	}
	infos, err := yjs.SuggestionsV1(state)
	if err != nil || len(infos) != 1 || infos[0].ID != suggestion || infos[0].Author != w.commenter {
		t.Fatalf("suggestions the editor received = (%+v, %v), want the commenter's", infos, err)
	}

	// Anything else from the commenter is refused, and nobody else hears of it.
	expectRefused := func(name, code string, change func(tx *crdt.Transaction, root *crdt.YXmlElement)) {
		t.Helper()
		before := w.state()
		id := uuid.New()
		if err := sendWebSocketUpdate(commenterSocket, id, w.update(change)); err != nil {
			t.Fatalf("send %s: %v", name, err)
		}
		// A state-only change is resynced to every peer, so the sender may still
		// have the resync for its earlier suggestion queued ahead of the refusal.
		refusal := readWebSocketFrame(t, commenterSocket)
		for refusal.Type == "resync" {
			refusal = readWebSocketFrame(t, commenterSocket)
		}
		if refusal.Type != "error" || refusal.Code != code || refusal.UpdateID != id {
			t.Fatalf("%s: response = %+v, want an %q error for the update", name, refusal, code)
		}
		if string(w.state()) != string(before) {
			t.Fatalf("%s was refused but changed the stored body", name)
		}
		if err := editorSocket.SetReadDeadline(time.Now().Add(600 * time.Millisecond)); err != nil {
			t.Fatalf("set the editor's deadline: %v", err)
		}
		for {
			var frame integrationWebSocketFrame
			if err := ws.JSON.Receive(editorSocket, &frame); err != nil {
				break
			}
			if frame.Type != "presence" {
				t.Fatalf("%s reached the editor: %+v", name, frame)
			}
		}
	}
	expectRefused("an edit to canonical text", "not_permitted", func(tx *crdt.Transaction, root *crdt.YXmlElement) {
		w.text(root).Insert(tx, 0, ">", crdt.Attributes{})
	})
	expectRefused("a suggestion in the editor's name", "not_permitted", func(tx *crdt.Transaction, root *crdt.YXmlElement) {
		w.text(root).Insert(tx, 0, "x", w.mark("insert", w.editor, uuid.New()))
	})
	// The editor makes a suggestion of their own; the commenter may not alter it.
	if _, err := w.commit(w.editor, w.update(func(tx *crdt.Transaction, root *crdt.YXmlElement) {
		w.text(root).Insert(tx, 0, "ED", w.mark("insert", w.editor, uuid.New()))
	})); err != nil {
		t.Fatalf("the editor's own suggestion: %v", err)
	}
	if err := editorSocket.SetReadDeadline(time.Now().Add(600 * time.Millisecond)); err != nil {
		t.Fatalf("set the editor's deadline: %v", err)
	}
	for {
		var frame integrationWebSocketFrame
		if err := ws.JSON.Receive(editorSocket, &frame); err != nil {
			break
		}
	}
	expectRefused("another user's suggestion changed", "not_permitted", func(tx *crdt.Transaction, root *crdt.YXmlElement) {
		w.text(root).Delete(tx, 0, 2)
	})
	expectRefused("too much suggested text", "suggestion_limit", func(tx *crdt.Transaction, root *crdt.YXmlElement) {
		w.text(root).Insert(tx, 0, strings.Repeat("a", yjs.MaxSuggestedTextBytesPerUser+1), w.mark("insert", w.commenter, uuid.New()))
	})

	// A viewer is refused as before.
	if err := sendWebSocketUpdate(viewerSocket, uuid.New(), w.update(func(tx *crdt.Transaction, root *crdt.YXmlElement) {
		w.text(root).Insert(tx, 0, "x", w.mark("insert", w.viewer, uuid.New()))
	})); err != nil {
		t.Fatalf("send the viewer's update: %v", err)
	}
	refusal := readWebSocketFrame(t, viewerSocket)
	for refusal.Type == "resync" {
		refusal = readWebSocketFrame(t, viewerSocket)
	}
	if refusal.Type != "error" || refusal.Code != "update_rejected" {
		t.Fatalf("viewer update response = %+v, want a rejection", refusal)
	}
	if w.runContent() != "plain" || w.bodyVersion() != 1 || len(w.suggestions()) != 2 {
		t.Fatalf("after the refusals the body is %q at version %d with %d suggestions, want the commenter's and the editor's only", w.runContent(), w.bodyVersion(), len(w.suggestions()))
	}
}
