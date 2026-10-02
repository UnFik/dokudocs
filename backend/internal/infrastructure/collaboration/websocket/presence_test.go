package websocket

import (
	"bufio"
	"context"
	"errors"
	"net"
	"net/http"
	"testing"
	"time"

	appauth "backend/internal/application/auth/dto"
	"backend/internal/application/collaboration"

	"github.com/google/uuid"
	ws "golang.org/x/net/websocket"
)

type tokenVerifier map[string]appauth.ResponseUser

func (v tokenVerifier) VerifyToken(token string) (appauth.ResponseUser, error) {
	user, ok := v[token]
	if !ok {
		return appauth.ResponseUser{}, errors.New("invalid token")
	}
	return user, nil
}

type fixedProfiles map[uuid.UUID]PresenceUser

func (p fixedProfiles) PresenceProfile(_ context.Context, id uuid.UUID) (PresenceUser, error) {
	return p[id], nil
}

type presenceClient struct {
	t    *testing.T
	conn *ws.Conn
}

func newPresenceServer(t *testing.T, users map[string]uuid.UUID, profiles ProfileReader) *Server {
	t.Helper()
	verifier := tokenVerifier{}
	for token, id := range users {
		verifier[token] = appauth.ResponseUser{ID: id.String(), Exp: time.Now().Add(time.Hour).Unix()}
	}
	server := NewServer(
		verifier,
		testGatewayReader{snapshot: collaboration.BodySnapshot{
			BodyVersion: 1, BodyEpoch: 1, BodySchemaVersion: 1, CanEdit: true, EncodedState: []byte("state"),
		}},
		&testGatewayWriter{},
		"https://docs.example.test",
		nil,
	)
	server.heartbeatEvery = time.Hour
	server.profiles = profiles
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = server.Shutdown(ctx)
	})
	return server
}

func dialPresence(t *testing.T, server *Server, documentID, workspaceID uuid.UUID, token string, capabilities ...string) *presenceClient {
	t.Helper()
	clientSide, serverSide := net.Pipe()
	serverRW := bufio.NewReadWriter(bufio.NewReader(serverSide), bufio.NewWriter(serverSide))
	hijack := &testHijackWriter{header: make(http.Header), conn: serverSide, rw: serverRW}
	go func() {
		request, err := http.ReadRequest(serverRW.Reader)
		if err != nil {
			return
		}
		request = request.WithContext(context.Background())
		request.SetPathValue("id", documentID.String())
		server.ServeHTTP(hijack, request)
	}()
	config, err := ws.NewConfig("ws://example.test/api/v1/collaboration/"+documentID.String(), "https://docs.example.test")
	if err != nil {
		t.Fatalf("NewConfig(): %v", err)
	}
	client, err := ws.NewClient(config, clientSide)
	if err != nil {
		t.Fatalf("WebSocket handshake: %v", err)
	}
	client.PayloadType = ws.TextFrame
	// Close the raw pipe: client.Close would block writing a close frame to a
	// server that is no longer reading.
	t.Cleanup(func() { _ = clientSide.Close(); _ = serverSide.Close() })
	if err := ws.JSON.Send(client, clientMessage{Type: "auth", Token: token, WorkspaceID: workspaceID, Capabilities: capabilities}); err != nil {
		t.Fatalf("send auth: %v", err)
	}
	return &presenceClient{t: t, conn: client}
}

func (c *presenceClient) next(timeout time.Duration) serverMessage {
	c.t.Helper()
	_ = c.conn.SetReadDeadline(time.Now().Add(timeout))
	var message serverMessage
	if err := ws.JSON.Receive(c.conn, &message); err != nil {
		c.t.Fatalf("receive: %v", err)
	}
	return message
}

// presence returns the next presence message, skipping other frames.
func (c *presenceClient) presence() []PresenceUser {
	c.t.Helper()
	for range 10 {
		if message := c.next(2 * time.Second); message.Type == "presence" {
			return message.Users
		}
	}
	c.t.Fatal("no presence message received")
	return nil
}

func ids(users []PresenceUser) []uuid.UUID {
	out := make([]uuid.UUID, len(users))
	for i, user := range users {
		out[i] = user.UserID
	}
	return out
}

func sameIDs(got []PresenceUser, want ...uuid.UUID) bool {
	g := ids(got)
	if len(g) != len(want) {
		return false
	}
	for i := range g {
		if g[i] != want[i] {
			return false
		}
	}
	return true
}

func TestPresenceListsEveryUserInTheDocumentRoom(t *testing.T) {
	// UUIDs chosen so the sorted order is a, b.
	a := uuid.MustParse("00000000-0000-4000-8000-00000000000a")
	b := uuid.MustParse("00000000-0000-4000-8000-00000000000b")
	server := newPresenceServer(t,
		map[string]uuid.UUID{"token-a": a, "token-b": b},
		fixedProfiles{a: {UserID: a, Name: "Ada"}, b: {UserID: b, Name: "Bo", AvatarURL: "/b.png"}},
	)
	documentID, workspaceID := uuid.New(), uuid.New()

	clientA := dialPresence(t, server, documentID, workspaceID, "token-a", "presence")
	if got := clientA.presence(); !sameIDs(got, a) || got[0].Name != "Ada" {
		t.Fatalf("first presence = %+v, want only Ada", got)
	}

	clientB := dialPresence(t, server, documentID, workspaceID, "token-b", "presence")
	if got := clientB.presence(); !sameIDs(got, a, b) || got[1].Name != "Bo" || got[1].AvatarURL != "/b.png" {
		t.Fatalf("B presence = %+v, want Ada and Bo with profile", got)
	}
	if got := clientA.presence(); !sameIDs(got, a, b) {
		t.Fatalf("A presence after B joined = %+v, want Ada and Bo", got)
	}

	_ = clientB.conn.Close()
	if got := clientA.presence(); !sameIDs(got, a) {
		t.Fatalf("A presence after B left = %+v, want only Ada", got)
	}
}

func TestPresenceCountsOneUserOnceAcrossTabsAndIgnoresOtherDocuments(t *testing.T) {
	a := uuid.MustParse("00000000-0000-4000-8000-00000000000a")
	b := uuid.MustParse("00000000-0000-4000-8000-00000000000b")
	server := newPresenceServer(t,
		map[string]uuid.UUID{"token-a": a, "token-b": b}, nil,
	)
	documentID, workspaceID := uuid.New(), uuid.New()

	first := dialPresence(t, server, documentID, workspaceID, "token-a", "presence")
	first.presence()
	second := dialPresence(t, server, documentID, workspaceID, "token-a", "presence")
	if got := second.presence(); !sameIDs(got, a) {
		t.Fatalf("second tab presence = %+v, want Ada once", got)
	}
	other := dialPresence(t, server, uuid.New(), workspaceID, "token-b", "presence")
	if got := other.presence(); !sameIDs(got, b) {
		t.Fatalf("other document presence = %+v, want only Bo", got)
	}

	_ = second.conn.Close()
	if got := first.presence(); !sameIDs(got, a) {
		t.Fatalf("presence after closing one tab = %+v, want Ada still present", got)
	}
}

func TestPresenceIsSentOnlyToClientsThatOptIn(t *testing.T) {
	a := uuid.MustParse("00000000-0000-4000-8000-00000000000a")
	b := uuid.MustParse("00000000-0000-4000-8000-00000000000b")
	server := newPresenceServer(t, map[string]uuid.UUID{"token-a": a, "token-b": b}, nil)
	documentID, workspaceID := uuid.New(), uuid.New()

	legacy := dialPresence(t, server, documentID, workspaceID, "token-b")
	if ready := legacy.next(2 * time.Second); ready.Type != "ready" {
		t.Fatalf("legacy first frame = %+v, want ready", ready)
	}
	modern := dialPresence(t, server, documentID, workspaceID, "token-a", "presence")
	// The legacy client is marked present just after its ready frame, so the
	// list that includes it may arrive as the modern client's second frame.
	awaitPresence(t, modern, a, b)

	_ = legacy.conn.SetReadDeadline(time.Now().Add(300 * time.Millisecond))
	var frame serverMessage
	if err := ws.JSON.Receive(legacy.conn, &frame); err == nil {
		t.Fatalf("legacy client received %+v, want no presence frame", frame)
	}
}

func (s *Server) roomCount() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.rooms)
}

func TestReadyFrameWriteToAClientThatNeverReadsIsAbandoned(t *testing.T) {
	a := uuid.MustParse("00000000-0000-4000-8000-00000000000a")
	server := newPresenceServer(t, map[string]uuid.UUID{"token-a": a}, nil)
	server.writeBase = 150 * time.Millisecond

	// Never read from this client: net.Pipe is unbuffered, so the server's
	// ready write blocks until its deadline.
	_ = dialPresence(t, server, uuid.New(), uuid.New(), "token-a")

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if server.roomCount() == 0 {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("server still holds the peer after the ready write deadline")
}

func TestClientThatNeverReadsReadyDoesNotBlockOthersInTheSameDocument(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	server := newPresenceServer(t, map[string]uuid.UUID{"token-a": a, "token-b": b}, nil)
	server.writeBase = 150 * time.Millisecond
	documentID, workspaceID := uuid.New(), uuid.New()

	_ = dialPresence(t, server, documentID, workspaceID, "token-a")
	other := dialPresence(t, server, documentID, workspaceID, "token-b")

	if frame := other.next(2 * time.Second); frame.Type != "ready" {
		t.Fatalf("second client first frame = %+v, want ready", frame)
	}
}
