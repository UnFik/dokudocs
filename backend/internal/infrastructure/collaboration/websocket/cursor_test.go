package websocket

import (
	"testing"
	"time"

	"github.com/google/uuid"
	ws "golang.org/x/net/websocket"
)

func (c *presenceClient) sendCursor(cursor *CursorSelection) {
	c.t.Helper()
	if err := ws.JSON.Send(c.conn, clientMessage{Type: "cursor", Cursor: cursor}); err != nil {
		c.t.Fatalf("send cursor: %v", err)
	}
}

// frame returns the next message of the given type, skipping other frames.
func (c *presenceClient) frame(kind string) serverMessage {
	c.t.Helper()
	for range 10 {
		if message := c.next(2 * time.Second); message.Type == kind {
			return message
		}
	}
	c.t.Fatalf("no %q frame received", kind)
	return serverMessage{}
}

func TestCursorIsRelayedToOtherCollaboratorsWithNameAndColorOnly(t *testing.T) {
	a := uuid.MustParse("00000000-0000-4000-8000-00000000000a")
	b := uuid.MustParse("00000000-0000-4000-8000-00000000000b")
	c := uuid.MustParse("00000000-0000-4000-8000-00000000000c")
	server := newPresenceServer(t,
		map[string]uuid.UUID{"token-a": a, "token-b": b, "token-c": c},
		fixedProfiles{
			a: {UserID: a, Name: "Ada", AvatarURL: "/a.png"},
			b: {UserID: b, Name: "Bo"},
			c: {UserID: c, Name: "Cy"},
		},
	)
	documentID, workspaceID := uuid.New(), uuid.New()

	clientA := dialPresence(t, server, documentID, workspaceID, "token-a", "presence", "cursor")
	clientA.presence()
	clientB := dialPresence(t, server, documentID, workspaceID, "token-b", "presence", "cursor")
	clientB.presence()
	clientA.presence()
	// C joined without the cursor capability: it must never receive cursor frames.
	clientC := dialPresence(t, server, documentID, workspaceID, "token-c", "presence")
	clientC.presence()
	clientA.presence()
	clientB.presence()

	clientA.sendCursor(&CursorSelection{Anchor: []byte{1, 2}, Head: []byte{3, 4}})

	got := clientB.frame("cursor").Cursor
	if got == nil || got.UserID != a || got.Name != "Ada" {
		t.Fatalf("cursor = %+v, want Ada's", got)
	}
	if got.Color == "" || string(got.Anchor) != "\x01\x02" || string(got.Head) != "\x03\x04" {
		t.Fatalf("cursor = %+v, want a color and the sent positions", got)
	}
	if got.ConnectionID == uuid.Nil {
		t.Fatalf("cursor has no connection ID")
	}

	// The sender and clients without the capability get nothing.
	_ = clientC.conn.SetReadDeadline(time.Now().Add(300 * time.Millisecond))
	var extra serverMessage
	if err := ws.JSON.Receive(clientC.conn, &extra); err == nil && (extra.Type == "cursor" || extra.Type == "cursor_leave") {
		t.Fatalf("client without the capability received %q", extra.Type)
	}

	// Closing the sender clears its cursor for the others.
	connectionID := got.ConnectionID
	_ = clientA.conn.Close()
	leave := clientB.frame("cursor_leave")
	if leave.Cursor == nil || leave.Cursor.ConnectionID != connectionID {
		t.Fatalf("cursor_leave = %+v, want connection %s", leave.Cursor, connectionID)
	}
}

func TestCursorFromAnOversizedOrEmptyPayloadIsRejected(t *testing.T) {
	a := uuid.MustParse("00000000-0000-4000-8000-00000000000a")
	b := uuid.MustParse("00000000-0000-4000-8000-00000000000b")
	server := newPresenceServer(t, map[string]uuid.UUID{"token-a": a, "token-b": b}, nil)
	documentID, workspaceID := uuid.New(), uuid.New()

	clientA := dialPresence(t, server, documentID, workspaceID, "token-a", "presence", "cursor")
	clientA.presence()
	clientB := dialPresence(t, server, documentID, workspaceID, "token-b", "presence", "cursor")
	clientB.presence()
	clientA.presence()

	clientA.sendCursor(&CursorSelection{Anchor: make([]byte, maxCursorBytes+1), Head: []byte{1}})
	if message := clientA.frame("error"); message.Code != "invalid_message" {
		t.Fatalf("error code = %q, want invalid_message", message.Code)
	}
}

func TestCursorClearedByClientIsForwardedAsLeave(t *testing.T) {
	a := uuid.MustParse("00000000-0000-4000-8000-00000000000a")
	b := uuid.MustParse("00000000-0000-4000-8000-00000000000b")
	server := newPresenceServer(t, map[string]uuid.UUID{"token-a": a, "token-b": b}, nil)
	documentID, workspaceID := uuid.New(), uuid.New()

	clientA := dialPresence(t, server, documentID, workspaceID, "token-a", "presence", "cursor")
	clientA.presence()
	clientB := dialPresence(t, server, documentID, workspaceID, "token-b", "presence", "cursor")
	clientB.presence()
	clientA.presence()

	clientA.sendCursor(nil)
	if leave := clientB.frame("cursor_leave"); leave.Cursor == nil || leave.Cursor.UserID != a {
		t.Fatalf("cursor_leave = %+v, want Ada's", leave.Cursor)
	}
}
