//go:build integration

package document

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"backend/internal/application/collaboration"
	"backend/internal/domain/documentbody"
	"backend/internal/infrastructure/collaboration/redisfanout"
	"backend/internal/infrastructure/collaboration/websocket"
	"backend/internal/infrastructure/collaboration/yjs"
	"backend/internal/infrastructure/database"
	"backend/internal/test/loadmetrics"
	"backend/internal/test/netdelay"

	"github.com/google/uuid"
	"github.com/reearth/ygo/crdt"
	ws "golang.org/x/net/websocket"
)

// loadScenario is one deployment shape the WebSocket load test runs against.
type loadScenario struct {
	Name      string
	Instances int           // server processes-in-test sharing one document
	Redis     bool          // fan-out across instances through Redis
	PGRTT     time.Duration // added round trip between the servers and PostgreSQL
}

type loadConfig struct {
	Editors, Viewers, CommitsPerEditor, Paragraphs int
	Interval                                       time.Duration
}

type loadResult struct {
	Scenario       loadScenario   `json:"scenario"`
	Config         loadConfig     `json:"config"`
	Nodes          int            `json:"nodes"`
	Commits        int            `json:"commits"`
	Sockets        int            `json:"sockets"`
	CommitsPerSec  float64        `json:"commitsPerSec"`
	Ack            latencySummary `json:"ack"`
	PeerReceive    latencySummary `json:"peerReceive"`
	UpdateFrames   int64          `json:"updateFrames"`
	ResyncFrames   int64          `json:"resyncFrames"`
	ExpectedFanout int            `json:"expectedFanout"`
	LaggingSockets int            `json:"socketsNotAtFinalVersion"`
	Errors         []string       `json:"errors,omitempty"`
	Environment    string         `json:"environment"`
	LoadAvg        string         `json:"loadAvgAtEnd"`
}

type latencySummary struct {
	Count int     `json:"count"`
	P50   float64 `json:"p50ms"`
	P95   float64 `json:"p95ms"`
	P99   float64 `json:"p99ms"`
	Max   float64 `json:"maxms"`
}

func summarizeMS(samples []time.Duration) latencySummary {
	s := loadmetrics.Summarize(samples)
	ms := func(d time.Duration) float64 { return float64(d.Microseconds()) / 1000 }
	return latencySummary{Count: s.Count, P50: ms(s.P50), P95: ms(s.P95), P99: ms(s.P99), Max: ms(s.Max)}
}

func envInt(name string, def int) int {
	if v, err := strconv.Atoi(os.Getenv(name)); err == nil && v > 0 {
		return v
	}
	return def
}

// TestWebSocketCollaborationLoad drives real WebSocket clients end to end:
// Yjs update -> server -> PostgreSQL commit -> ACK to the author and fan-out
// to every other socket. By default it is a small smoke run. WS_LOAD=1 runs the
// G6 gate shape (10 editors, 10 read-only peers, 2,000 nodes, 2 commits/s per
// editor) across three scenarios; WS_LOAD_REPORT=<path> writes the JSON results.
// Clients and servers share one process and one machine, so the numbers are
// local measurements, not production capacity.
func TestWebSocketCollaborationLoad(t *testing.T) {
	gate := os.Getenv("WS_LOAD") != ""
	cfg := loadConfig{Editors: 3, Viewers: 3, CommitsPerEditor: 5, Paragraphs: 50, Interval: 300 * time.Millisecond}
	scenarios := []loadScenario{
		{Name: "single-instance", Instances: 1},
		{Name: "two-instances-redis", Instances: 2, Redis: true},
		{Name: "two-instances-redis-pg-rtt", Instances: 2, Redis: true, PGRTT: time.Duration(envInt("WS_LOAD_PG_RTT_MS", 10)) * time.Millisecond},
	}
	if gate {
		cfg = loadConfig{
			Editors: envInt("WS_LOAD_EDITORS", 10), Viewers: envInt("WS_LOAD_VIEWERS", 10),
			CommitsPerEditor: envInt("WS_LOAD_COMMITS", 60), Paragraphs: envInt("WS_LOAD_PARAGRAPHS", 1000),
			Interval: time.Duration(envInt("WS_LOAD_INTERVAL_MS", 500)) * time.Millisecond,
		}
	}
	var results []loadResult
	for _, sc := range scenarios {
		sc := sc
		t.Run(sc.Name, func(t *testing.T) {
			res := runWebSocketLoad(t, sc, cfg)
			results = append(results, res)
			b, _ := json.Marshal(res)
			t.Logf("LOADRESULT %s", b)
			if len(res.Errors) > 0 {
				t.Fatalf("load run had %d errors, first: %s", len(res.Errors), res.Errors[0])
			}
			if res.LaggingSockets > 0 {
				t.Fatalf("%d sockets never reached the final body version", res.LaggingSockets)
			}
			if limit := envInt("WS_LOAD_ACK_P95_MS", 0); limit > 0 && res.Ack.P95 > float64(limit) {
				t.Fatalf("ACK p95 %.1f ms exceeds %d ms", res.Ack.P95, limit)
			}
			if limit := envInt("WS_LOAD_PEER_P95_MS", 0); limit > 0 && res.PeerReceive.P95 > float64(limit) {
				t.Fatalf("peer receive p95 %.1f ms exceeds %d ms", res.PeerReceive.P95, limit)
			}
		})
	}
	if path := os.Getenv("WS_LOAD_REPORT"); path != "" {
		b, _ := json.MarshalIndent(results, "", "  ")
		if err := os.WriteFile(path, b, 0o644); err != nil {
			t.Fatalf("write report: %v", err)
		}
	}
}

func runWebSocketLoad(t *testing.T, sc loadScenario, cfg loadConfig) loadResult {
	ctx := context.Background()
	seedDB, err := sql.Open("pgx", integrationDatabaseURL(t))
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	ownerID, viewerID := insertAccessTestUser(t, ctx, seedDB), insertAccessTestUser(t, ctx, seedDB)
	workspaceID, documentID := uuid.New(), uuid.New()
	t.Cleanup(func() {
		_, _ = seedDB.ExecContext(context.Background(), `DELETE FROM workspaces WHERE id = $1`, workspaceID)
		_, _ = seedDB.ExecContext(context.Background(), `DELETE FROM users WHERE id = $1`, ownerID)
		_, _ = seedDB.ExecContext(context.Background(), `DELETE FROM users WHERE id = $1`, viewerID)
		_ = seedDB.Close()
	})
	mustExec := func(q string, args ...any) {
		if _, err := seedDB.ExecContext(ctx, q, args...); err != nil {
			t.Fatalf("seed %q: %v", q, err)
		}
	}
	mustExec(`INSERT INTO workspaces (id, name, slug, created_by) VALUES ($1, 'WS load', $2, $3)`, workspaceID, "ws-load-"+workspaceID.String(), ownerID)
	mustExec(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`, workspaceID, ownerID)
	mustExec(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'member')`, workspaceID, viewerID)

	rootID := uuid.New()
	body := documentbody.Body{DocumentID: documentID, RootNodeID: rootID}
	body.Nodes = append(body.Nodes, documentbody.Node{DocumentID: documentID, NodeID: rootID, Type: "document", Attributes: []byte(`{}`), Version: 1})
	runs := make([]uuid.UUID, cfg.Paragraphs)
	for i := 0; i < cfg.Paragraphs; i++ {
		paragraphID := uuid.New()
		runs[i] = uuid.New()
		body.Nodes = append(body.Nodes,
			documentbody.Node{DocumentID: documentID, NodeID: paragraphID, ParentID: &rootID, SiblingOrder: float64(i), Type: "paragraph", Attributes: []byte(`{}`), Version: 1},
			documentbody.Node{DocumentID: documentID, NodeID: runs[i], ParentID: &paragraphID, SiblingOrder: 0, Type: "run", Content: fmt.Sprintf("paragraph %d", i), Attributes: []byte(`{}`), Version: 1},
		)
	}
	state, err := yjs.EncodeBodyV1(body)
	if err != nil {
		t.Fatalf("encode body: %v", err)
	}
	if err := seedCollaborativeDocument(ctx, seedDB, workspaceID, documentID, ownerID, body, state); err != nil {
		t.Fatalf("seed document: %v", err)
	}
	mustExec(`INSERT INTO document_accesses (document_id, user_id, access_level) VALUES ($1, $2, 'view')`, documentID, viewerID)

	// Servers reach PostgreSQL through the delaying proxy when the scenario asks.
	serverDBURL := integrationDatabaseURL(t)
	if sc.PGRTT > 0 {
		u, err := url.Parse(serverDBURL)
		if err != nil {
			t.Fatalf("parse database URL: %v", err)
		}
		proxy, err := netdelay.Start(u.Host, sc.PGRTT)
		if err != nil {
			t.Fatalf("start delay proxy: %v", err)
		}
		t.Cleanup(proxy.Close)
		u.Host = proxy.Addr()
		serverDBURL = u.String()
	}
	serverDB, err := sql.Open("pgx", serverDBURL)
	if err != nil {
		t.Fatalf("open server database: %v", err)
	}
	serverDB.SetMaxOpenConns(40)
	t.Cleanup(func() { _ = serverDB.Close() })
	repository := NewRepository(database.NewSQLDB(serverDB))
	bodyReader := collaboration.NewBodyReadUseCase(repository)
	verifier := integrationWebSocketVerifier{"owner-token": ownerID, "viewer-token": viewerID}

	var httpServers []*httptest.Server
	for i := 0; i < sc.Instances; i++ {
		var broker collaboration.Broker
		if sc.Redis {
			b, err := redisfanout.New(integrationRedisURL(t))
			if err != nil {
				t.Fatalf("create Redis broker: %v", err)
			}
			broker = b
		}
		server := websocket.NewServer(verifier, bodyReader, repository, integrationOrigin, broker)
		mux := http.NewServeMux()
		mux.Handle("GET /api/v1/collaboration/{id}", server)
		hs := httptest.NewServer(mux)
		httpServers = append(httpServers, hs)
		t.Cleanup(func() {
			c, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			_ = server.Shutdown(c)
			hs.Close()
		})
	}

	type socket struct {
		conn     *ws.Conn
		editor   bool
		maxSeen  atomic.Int64
		clientID int
	}
	var (
		mu         sync.Mutex
		sentAt     = map[uuid.UUID]time.Time{}
		ackSamples []time.Duration
		peerSample []time.Duration
		errs       []string
		updates    atomic.Int64
		resyncs    atomic.Int64
	)
	fail := func(format string, a ...any) {
		mu.Lock()
		defer mu.Unlock()
		if len(errs) < 20 {
			errs = append(errs, fmt.Sprintf(format, a...))
		}
	}
	total := cfg.Editors + cfg.Viewers
	sockets := make([]*socket, total)
	var readers sync.WaitGroup
	for i := range sockets {
		hs := httpServers[i%len(httpServers)]
		token := "viewer-token"
		if i < cfg.Editors {
			token = "owner-token"
		}
		wsURL := "ws" + strings.TrimPrefix(hs.URL, "http") + "/api/v1/collaboration/" + documentID.String()
		conn, err := ws.Dial(wsURL, "", integrationOrigin)
		if err != nil {
			t.Fatalf("dial socket %d: %v", i, err)
		}
		conn.PayloadType = ws.TextFrame
		if err := ws.JSON.Send(conn, map[string]any{"type": "auth", "token": token, "workspaceID": workspaceID}); err != nil {
			t.Fatalf("auth socket %d: %v", i, err)
		}
		_ = conn.SetReadDeadline(time.Now().Add(30 * time.Second))
		var ready integrationWebSocketFrame
		if err := ws.JSON.Receive(conn, &ready); err != nil || ready.Type != "ready" {
			t.Fatalf("socket %d ready = %+v, %v", i, ready, err)
		}
		_ = conn.SetReadDeadline(time.Time{})
		s := &socket{conn: conn, editor: i < cfg.Editors, clientID: i}
		s.maxSeen.Store(ready.BodyVersion)
		sockets[i] = s
		t.Cleanup(func() { _ = conn.Close() })
	}
	stopReaders := make(chan struct{})
	for _, s := range sockets {
		readers.Add(1)
		go func(s *socket) {
			defer readers.Done()
			for {
				var frame integrationWebSocketFrame
				err := ws.JSON.Receive(s.conn, &frame)
				now := time.Now()
				if err != nil {
					select {
					case <-stopReaders:
						return
					default:
					}
					fail("socket %d read: %v", s.clientID, err)
					return
				}
				switch frame.Type {
				case "ack":
					mu.Lock()
					if at, ok := sentAt[frame.UpdateID]; ok {
						ackSamples = append(ackSamples, now.Sub(at))
					}
					mu.Unlock()
				case "update":
					updates.Add(1)
					mu.Lock()
					if at, ok := sentAt[frame.UpdateID]; ok {
						peerSample = append(peerSample, now.Sub(at))
					}
					mu.Unlock()
				case "resync":
					resyncs.Add(1)
				case "error":
					fail("socket %d error frame %s", s.clientID, frame.Code)
				}
				if frame.BodyVersion > s.maxSeen.Load() {
					s.maxSeen.Store(frame.BodyVersion)
				}
			}
		}(s)
	}

	// Each editor owns a paragraph of its own and its own Yjs replica.
	started := time.Now()
	var writers sync.WaitGroup
	for i := 0; i < cfg.Editors; i++ {
		doc := crdt.New()
		t.Cleanup(doc.Destroy)
		if err := crdt.ApplyUpdateV1(doc, state, nil); err != nil {
			t.Fatalf("load editor %d: %v", i, err)
		}
		index := i * (cfg.Paragraphs / cfg.Editors)
		root := doc.GetXmlFragment("body").Children()[0].(*crdt.YXmlElement)
		text := root.Children()[index].(*crdt.YXmlElement).Children()[0].(*crdt.YXmlElement).Children()[0].(*crdt.YXmlText)
		writers.Add(1)
		go func(i int, doc *crdt.Doc, text *crdt.YXmlText) {
			defer writers.Done()
			time.Sleep(time.Duration(i) * cfg.Interval / time.Duration(cfg.Editors))
			for n := 0; n < cfg.CommitsPerEditor; n++ {
				vector, err := crdt.DecodeStateVectorV1(crdt.EncodeStateVectorV1(doc))
				if err != nil {
					fail("editor %d vector: %v", i, err)
					return
				}
				if err := doc.TransactE(func(tx *crdt.Transaction) error { text.Insert(tx, text.Len(), "x", nil); return nil }); err != nil {
					fail("editor %d edit: %v", i, err)
					return
				}
				update := crdt.EncodeStateAsUpdateV1(doc, vector)
				id := uuid.New()
				mu.Lock()
				sentAt[id] = time.Now()
				mu.Unlock()
				if err := sendWebSocketUpdate(sockets[i].conn, id, update); err != nil {
					fail("editor %d send: %v", i, err)
					return
				}
				time.Sleep(cfg.Interval)
			}
		}(i, doc, text)
	}
	writers.Wait()
	elapsed := time.Since(started)

	commits := cfg.Editors * cfg.CommitsPerEditor
	finalVersion := int64(1 + commits)
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		behind := 0
		for _, s := range sockets {
			if s.maxSeen.Load() < finalVersion {
				behind++
			}
		}
		if behind == 0 {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	lagging := 0
	for _, s := range sockets {
		if s.maxSeen.Load() < finalVersion {
			lagging++
		}
	}
	close(stopReaders)
	for _, s := range sockets {
		_ = s.conn.Close()
	}
	readers.Wait()

	mu.Lock()
	defer mu.Unlock()
	if len(ackSamples) != commits {
		errs = append(errs, fmt.Sprintf("received %d ACKs for %d commits", len(ackSamples), commits))
	}
	loadAvg, _ := os.ReadFile("/proc/loadavg")
	return loadResult{
		LoadAvg:  strings.TrimSpace(string(loadAvg)),
		Scenario: sc, Config: cfg, Nodes: cfg.Paragraphs*2 + 1, Commits: commits, Sockets: total,
		CommitsPerSec: float64(commits) / elapsed.Seconds(),
		Ack:           summarizeMS(ackSamples), PeerReceive: summarizeMS(peerSample),
		UpdateFrames: updates.Load(), ResyncFrames: resyncs.Load(),
		ExpectedFanout: commits * (total - 1), LaggingSockets: lagging, Errors: errs,
		Environment: "LOCAL: clients, servers, PostgreSQL and Redis share one machine; not production-like",
	}
}
