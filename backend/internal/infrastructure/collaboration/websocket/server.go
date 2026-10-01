package websocket

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"

	appauth "backend/internal/application/auth/dto"
	"backend/internal/application/collaboration"

	"github.com/google/uuid"
	ws "golang.org/x/net/websocket"
)

const (
	maxMessageBytes = 16 << 20
	writeTimeout    = 5 * time.Second
	writePerMB      = time.Second
	readTimeout     = 10 * time.Second
	resyncInterval  = 5 * time.Second
	// idleRevisionFlush matches the debounce of the rolling auto revision.
	idleRevisionFlush = 10 * time.Second
	peerQueueSize     = 64
	fanoutTimeout     = 5 * time.Second
	heartbeatInterval = 30 * time.Second
	pongTimeout       = 10 * time.Second
)

type TokenVerifier interface {
	VerifyToken(string) (appauth.ResponseUser, error)
}

type BodyReader interface {
	Read(context.Context, collaboration.Actor, uuid.UUID, uuid.UUID) (collaboration.BodySnapshot, error)
}

type UpdateWriter interface {
	CommitUpdate(context.Context, collaboration.Actor, collaboration.Update) (collaboration.CommitReceipt, error)
}

// PresenceUser is a collaborator currently connected to a document.
type PresenceUser struct {
	UserID    uuid.UUID `json:"userID"`
	Name      string    `json:"name,omitempty"`
	AvatarURL string    `json:"avatarURL,omitempty"`
}

// ProfileReader resolves display details for presence; it is optional.
type ProfileReader interface {
	PresenceProfile(context.Context, uuid.UUID) (PresenceUser, error)
}

// presenceRefresh is how often a connection renews its shared presence entry;
// entries expire after three times this, so a crashed instance disappears.
const presenceRefresh = 10 * time.Second

type Server struct {
	verifier          TokenVerifier
	presenceStore     collaboration.PresenceStore
	presenceCloseOnce sync.Once
	revisionFlusher   collaboration.RevisionFlusher
	idleFlushAfter    time.Duration
	presenceCloseErr  error
	presenceEvery     time.Duration
	presenceOnce      sync.Once
	roomReader        collaboration.RoomReader
	resyncEvery       time.Duration
	pollers           map[uuid.UUID]context.CancelFunc
	profiles          ProfileReader
	reader            BodyReader
	updates           *collaboration.UseCase
	broker            collaboration.Broker
	allowedOrigin     string
	writeBase         time.Duration
	heartbeatEvery    time.Duration
	heartbeatWait     time.Duration
	instanceID        uuid.UUID
	brokerCtx         context.Context
	brokerCancel      context.CancelFunc
	brokerClose       sync.Once
	brokerStarted     bool
	brokerCloseErr    error

	mu       sync.RWMutex
	rooms    map[uuid.UUID]map[*peer]struct{}
	wg       sync.WaitGroup
	stopping bool
}

type peer struct {
	server      *Server
	conn        *ws.Conn
	actor       collaboration.Actor
	workspaceID uuid.UUID
	documentID  uuid.UUID
	token       string
	out         chan outbound
	done        chan struct{}
	started     chan struct{}
	pong        chan uuid.UUID
	closeOnce   sync.Once

	mu          sync.Mutex
	bodyVersion int64
	bodyEpoch   int64
	canEdit     bool

	connectionID  uuid.UUID
	profile       PresenceUser
	wantsPresence bool
	present       bool
	presenceKey   string
}

type outbound struct {
	message serverMessage
	written chan error
}

type clientMessage struct {
	Type              string    `json:"type"`
	Token             string    `json:"token,omitempty"`
	WorkspaceID       uuid.UUID `json:"workspaceID,omitempty"`
	UpdateID          uuid.UUID `json:"updateID,omitempty"`
	PingID            uuid.UUID `json:"pingID,omitempty"`
	BodyEpoch         int64     `json:"bodyEpoch,omitempty"`
	BodySchemaVersion int       `json:"bodySchemaVersion,omitempty"`
	Update            []byte    `json:"update,omitempty"`
	// Capabilities lists optional server frames the client understands.
	Capabilities []string `json:"capabilities,omitempty"`
}

type serverMessage struct {
	Type              string         `json:"type"`
	Code              string         `json:"code,omitempty"`
	UpdateID          uuid.UUID      `json:"updateID,omitempty"`
	PingID            uuid.UUID      `json:"pingID,omitempty"`
	BodyVersion       int64          `json:"bodyVersion,omitempty"`
	BodyEpoch         int64          `json:"bodyEpoch,omitempty"`
	BodySchemaVersion int            `json:"bodySchemaVersion,omitempty"`
	CanEdit           *bool          `json:"canEdit,omitempty"`
	State             []byte         `json:"state,omitempty"`
	Update            []byte         `json:"update,omitempty"`
	Users             []PresenceUser `json:"users,omitempty"`
}

// WithPresenceStore shares presence across server instances. Without it,
// presence covers only the connections of this instance.
func (s *Server) WithPresenceStore(store collaboration.PresenceStore) *Server {
	s.presenceStore = store
	return s
}

// WithRevisionFlusher makes the server bring the rolling auto revision up to
// the latest body when the last peer leaves a room and when a room has had no
// new body version for idleFlushAfter.
func (s *Server) WithRevisionFlusher(flusher collaboration.RevisionFlusher) *Server {
	s.revisionFlusher = flusher
	return s
}

// WithProfiles sets the reader used to label presence entries.
func (s *Server) WithProfiles(profiles ProfileReader) *Server {
	s.profiles = profiles
	return s
}

func NewServer(verifier TokenVerifier, reader BodyReader, writer UpdateWriter, allowedOrigin string, broker collaboration.Broker) *Server {
	brokerCtx, brokerCancel := context.WithCancel(context.Background())
	server := &Server{
		verifier: verifier, reader: reader, allowedOrigin: allowedOrigin,
		resyncEvery: resyncInterval, idleFlushAfter: idleRevisionFlush, presenceEvery: presenceRefresh, pollers: make(map[uuid.UUID]context.CancelFunc),
		writeBase: writeTimeout, heartbeatEvery: heartbeatInterval, heartbeatWait: pongTimeout,
		rooms: make(map[uuid.UUID]map[*peer]struct{}), broker: broker,
		instanceID: uuid.New(), brokerCtx: brokerCtx, brokerCancel: brokerCancel,
	}
	server.updates = collaboration.NewUseCase(writer, server)
	if roomReader, ok := reader.(collaboration.RoomReader); ok {
		server.roomReader = roomReader
	}
	return server
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if !isUpgradeRequest(r) {
		http.Error(w, "WebSocket upgrade required", http.StatusBadRequest)
		return
	}
	documentID, err := uuid.Parse(r.PathValue("id"))
	if err != nil || documentID == uuid.Nil {
		http.Error(w, "invalid document ID", http.StatusBadRequest)
		return
	}
	origin, err := s.checkOrigin(r)
	if err != nil {
		http.Error(w, "origin not allowed", http.StatusForbidden)
		return
	}
	server := ws.Server{
		Config: ws.Config{Origin: origin},
		Handler: ws.Handler(func(conn *ws.Conn) {
			s.servePeer(r.Context(), conn, documentID)
		}),
	}
	server.ServeHTTP(w, r)
}

func (s *Server) checkOrigin(r *http.Request) (*url.URL, error) {
	raw := r.Header.Get("Origin")
	origin, err := url.Parse(raw)
	if err != nil || raw == "" || origin.Scheme == "" || origin.Host == "" || origin.User != nil ||
		(origin.Path != "" && origin.Path != "/") || origin.RawQuery != "" || origin.Fragment != "" {
		return nil, errors.New("invalid WebSocket origin")
	}
	if s.allowedOrigin != "*" && raw != s.allowedOrigin {
		return nil, errors.New("WebSocket origin is not allowed")
	}
	return origin, nil
}

func isUpgradeRequest(r *http.Request) bool {
	if !strings.EqualFold(strings.TrimSpace(r.Header.Get("Upgrade")), "websocket") {
		return false
	}
	for _, token := range strings.Split(r.Header.Get("Connection"), ",") {
		if strings.EqualFold(strings.TrimSpace(token), "upgrade") {
			return true
		}
	}
	return false
}

func (s *Server) servePeer(ctx context.Context, conn *ws.Conn, documentID uuid.UUID) {
	conn.MaxPayloadBytes = maxMessageBytes
	conn.PayloadType = ws.TextFrame
	_ = conn.SetReadDeadline(time.Now().Add(readTimeout))
	var auth clientMessage
	if err := ws.JSON.Receive(conn, &auth); err != nil || auth.Type != "auth" || auth.Token == "" || auth.WorkspaceID == uuid.Nil {
		return
	}
	user, err := s.verifier.VerifyToken(auth.Token)
	if err != nil {
		_ = conn.SetWriteDeadline(time.Now().Add(writeTimeout))
		_ = ws.JSON.Send(conn, serverMessage{Type: "error", Code: "unauthorized"})
		return
	}
	userID, err := uuid.Parse(user.ID)
	if err != nil || userID == uuid.Nil || user.Exp <= time.Now().Unix() {
		return
	}
	actor := collaboration.Actor{UserID: userID}
	snapshot, err := s.reader.Read(ctx, actor, auth.WorkspaceID, documentID)
	if err != nil {
		_ = conn.SetWriteDeadline(time.Now().Add(writeTimeout))
		_ = ws.JSON.Send(conn, serverMessage{Type: "error", Code: "forbidden"})
		return
	}
	if err := s.startBroker(); err != nil {
		_ = conn.SetWriteDeadline(time.Now().Add(writeTimeout))
		_ = ws.JSON.Send(conn, serverMessage{Type: "error", Code: "server_shutdown"})
		return
	}
	peer := &peer{
		server: s, conn: conn, actor: actor, workspaceID: auth.WorkspaceID,
		documentID: documentID, token: auth.Token, out: make(chan outbound, peerQueueSize),
		done: make(chan struct{}), started: make(chan struct{}),
		pong:        make(chan uuid.UUID, 1),
		bodyVersion: snapshot.BodyVersion, bodyEpoch: snapshot.BodyEpoch, canEdit: snapshot.CanEdit,
		connectionID: uuid.New(), profile: PresenceUser{UserID: userID}, wantsPresence: hasCapability(auth.Capabilities, "presence"),
	}
	if s.profiles != nil {
		if profile, err := s.profiles.PresenceProfile(ctx, userID); err == nil {
			profile.UserID = userID
			peer.profile = profile
		}
	}
	if !s.addPeer(peer) {
		_ = conn.SetWriteDeadline(time.Now().Add(writeTimeout))
		_ = ws.JSON.Send(conn, serverMessage{Type: "error", Code: "server_shutdown"})
		return
	}
	defer s.removePeer(peer)
	defer peer.close()
	go peer.writeLoop()

	// Register before the snapshot read to capture concurrent updates; prepareReady
	// removes updates already included in the snapshot before ready is sent.
	snapshot, err = s.readAuthorizedSnapshot(ctx, peer)
	if err != nil {
		return
	}
	peer.prepareReady(snapshot)
	// The snapshot can be large, so the deadline grows with its size; a client
	// that stops reading must not hold this goroutine indefinitely.
	_ = conn.SetWriteDeadline(time.Now().Add(s.writeBase + time.Duration(len(snapshot.EncodedState)>>20)*writePerMB))
	sendErr := ws.JSON.Send(conn, snapshotMessage("ready", snapshot))
	if sendErr != nil {
		return
	}
	close(peer.started)
	s.watchPresenceChanges()
	s.markPresent(peer)
	if s.presenceStore != nil {
		go peer.presenceLoop(ctx)
	}
	_ = conn.SetReadDeadline(time.Unix(user.Exp, 0))
	if s.roomReader == nil {
		go peer.watch(ctx)
	}
	go peer.heartbeat(ctx)
	peer.readLoop(ctx)
}

func (p *peer) readLoop(ctx context.Context) {
	for {
		var message clientMessage
		if err := ws.JSON.Receive(p.conn, &message); err != nil {
			return
		}
		if message.Type == "pong" {
			if message.PingID != uuid.Nil {
				select {
				case p.pong <- message.PingID:
				default:
				}
			}
			continue
		}
		if message.Type != "update" || message.UpdateID == uuid.Nil || len(message.Update) == 0 {
			if p.sendAndWait(serverMessage{Type: "error", Code: "invalid_message"}) != nil {
				return
			}
			continue
		}
		user, err := p.server.verifier.VerifyToken(p.token)
		if err != nil || user.ID != p.actor.UserID.String() {
			return
		}
		update := collaboration.Update{
			DocumentID: p.documentID, UpdateID: message.UpdateID,
			BodyEpoch: message.BodyEpoch, BodySchemaVersion: message.BodySchemaVersion, Bytes: message.Update,
		}
		receipt, err := p.server.updates.Apply(ctx, p.actor, update)
		if err != nil {
			if p.sendAndWait(serverMessage{Type: "error", UpdateID: message.UpdateID, Code: updateErrorCode(err)}) != nil {
				return
			}
			continue
		}
		ack := serverMessage{
			Type: "ack", UpdateID: receipt.UpdateID, BodyVersion: receipt.BodyVersion,
			BodyEpoch: receipt.BodyEpoch, BodySchemaVersion: message.BodySchemaVersion,
		}
		if err := p.sendAndWait(ack); err != nil {
			return
		}
		p.advance(receipt.BodyVersion, receipt.BodyEpoch)
		_ = p.server.updates.PublishAfterAck(ctx, receipt, update)
	}
}

func (p *peer) heartbeat(ctx context.Context) {
	ticker := time.NewTicker(p.server.heartbeatEvery)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-p.done:
			return
		case <-ticker.C:
		}

		pingID := uuid.New()
		if err := p.sendAndWait(serverMessage{Type: "ping", PingID: pingID}); err != nil {
			return
		}
		timer := time.NewTimer(p.server.heartbeatWait)
		ponged := false
		for !ponged {
			select {
			case <-ctx.Done():
				timer.Stop()
				return
			case <-p.done:
				timer.Stop()
				return
			case got := <-p.pong:
				ponged = got == pingID
			case <-timer.C:
				p.close()
				return
			}
		}
		timer.Stop()
	}
}

func (p *peer) writeLoop() {
	select {
	case <-p.done:
		_ = p.conn.Close()
		return
	case <-p.started:
	}
	for {
		select {
		case <-p.done:
			_ = p.conn.Close()
			return
		case item := <-p.out:
			_ = p.conn.SetWriteDeadline(time.Now().Add(writeTimeout))
			err := ws.JSON.Send(p.conn, item.message)
			if item.written != nil {
				item.written <- err
			}
			if err != nil {
				p.close()
				_ = p.conn.Close()
				return
			}
			p.advance(item.message.BodyVersion, item.message.BodyEpoch)
		}
	}
}

func (p *peer) watch(ctx context.Context) {
	ticker := time.NewTicker(p.server.resyncEvery)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			p.close()
			return
		case <-p.done:
			return
		case <-ticker.C:
			snapshot, err := p.server.readAuthorizedSnapshot(ctx, p)
			if err != nil {
				p.close()
				return
			}
			p.enqueueResyncIfAhead(snapshot)
			p.server.resendPresenceIfChanged(p)
		}
	}
}

func (p *peer) sendAndWait(message serverMessage) error {
	written := make(chan error, 1)
	select {
	case <-p.done:
		return errors.New("WebSocket peer is closed")
	case p.out <- outbound{message: message, written: written}:
	}
	select {
	case <-p.done:
		return errors.New("WebSocket peer is closed")
	case err := <-written:
		return err
	}
}

func (p *peer) enqueueResyncIfAhead(snapshot collaboration.BodySnapshot) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if snapshot.BodyEpoch == p.bodyEpoch {
		if snapshot.BodyVersion < p.bodyVersion || (snapshot.BodyVersion == p.bodyVersion && snapshot.CanEdit == p.canEdit) {
			return
		}
	}
	message := snapshotMessage("resync", snapshot)
	select {
	case <-p.done:
	case p.out <- outbound{message: message}:
		p.bodyVersion, p.bodyEpoch, p.canEdit = snapshot.BodyVersion, snapshot.BodyEpoch, snapshot.CanEdit
	default:
		p.close()
	}
}

func (p *peer) enqueueUpdate(receipt collaboration.CommitReceipt, schemaVersion int, update []byte, snapshot collaboration.BodySnapshot) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if snapshot.BodyEpoch != receipt.BodyEpoch || snapshot.BodySchemaVersion != schemaVersion ||
		receipt.BodyVersion > p.bodyVersion+1 || snapshot.CanEdit != p.canEdit {
		message := snapshotMessage("resync", snapshot)
		select {
		case <-p.done:
			return errors.New("WebSocket peer is closed")
		case p.out <- outbound{message: message}:
			p.bodyVersion, p.bodyEpoch, p.canEdit = snapshot.BodyVersion, snapshot.BodyEpoch, snapshot.CanEdit
			return nil
		default:
			p.close()
			return errors.New("WebSocket peer queue is full")
		}
	}
	// A committed Yjs state can advance even when its projected AST is
	// byte-for-byte unchanged (for example, tombstone/causal metadata). A
	// same-version update still needs to reach peers so they do not drift.
	if receipt.BodyVersion <= p.bodyVersion {
		if receipt.Changed && receipt.BodyVersion == p.bodyVersion {
			message := snapshotMessage("resync", snapshot)
			select {
			case <-p.done:
				return errors.New("WebSocket peer is closed")
			case p.out <- outbound{message: message}:
				p.bodyVersion, p.bodyEpoch, p.canEdit = snapshot.BodyVersion, snapshot.BodyEpoch, snapshot.CanEdit
				return nil
			default:
				p.close()
				return errors.New("WebSocket peer queue is full")
			}
		}
		return nil
	}
	message := serverMessage{
		Type: "update", UpdateID: receipt.UpdateID, BodyVersion: receipt.BodyVersion,
		BodyEpoch: receipt.BodyEpoch, BodySchemaVersion: schemaVersion, Update: update,
	}
	select {
	case <-p.done:
		return errors.New("WebSocket peer is closed")
	case p.out <- outbound{message: message}:
		p.bodyVersion, p.bodyEpoch = receipt.BodyVersion, receipt.BodyEpoch
		return nil
	default:
		p.close()
		return errors.New("WebSocket peer queue is full")
	}
}

func (p *peer) advance(version, epoch int64) {
	if version < 1 || epoch < 1 {
		return
	}
	p.mu.Lock()
	if epoch > p.bodyEpoch || (epoch == p.bodyEpoch && version > p.bodyVersion) {
		p.bodyVersion, p.bodyEpoch = version, epoch
	}
	p.mu.Unlock()
}

// prepareReady drops fan-out already represented by the initial snapshot while
// retaining any later updates queued during the snapshot read.
func (p *peer) prepareReady(snapshot collaboration.BodySnapshot) {
	p.mu.Lock()
	defer p.mu.Unlock()

	queued := make([]outbound, 0, len(p.out))
	for {
		select {
		case item := <-p.out:
			if item.written != nil || !coveredBySnapshot(item.message, snapshot) {
				queued = append(queued, item)
			}
		default:
			for _, item := range queued {
				p.out <- item
			}
			if snapshot.BodyEpoch > p.bodyEpoch ||
				(snapshot.BodyEpoch == p.bodyEpoch && snapshot.BodyVersion > p.bodyVersion) {
				p.bodyEpoch, p.bodyVersion = snapshot.BodyEpoch, snapshot.BodyVersion
			}
			p.canEdit = snapshot.CanEdit
			return
		}
	}
}

func coveredBySnapshot(message serverMessage, snapshot collaboration.BodySnapshot) bool {
	if message.Type != "update" && message.Type != "resync" {
		return false
	}
	return message.BodyEpoch < snapshot.BodyEpoch ||
		(message.BodyEpoch == snapshot.BodyEpoch && message.BodyVersion <= snapshot.BodyVersion)
}

func (p *peer) close() {
	p.closeOnce.Do(func() { close(p.done) })
}

func (s *Server) readAuthorizedSnapshot(ctx context.Context, p *peer) (collaboration.BodySnapshot, error) {
	user, err := s.verifier.VerifyToken(p.token)
	if err != nil || user.ID != p.actor.UserID.String() {
		return collaboration.BodySnapshot{}, errors.New("WebSocket session expired")
	}
	return s.reader.Read(ctx, p.actor, p.workspaceID, p.documentID)
}

func (s *Server) Publish(_ context.Context, receipt collaboration.CommitReceipt, update collaboration.Update) error {
	ctx, cancel := context.WithTimeout(context.Background(), fanoutTimeout)
	defer cancel()
	localErr := s.fanoutLocal(ctx, receipt, update)
	if s.broker == nil {
		return localErr
	}
	brokerErr := s.broker.PublishEvent(ctx, collaboration.BroadcastEvent{
		OriginID: s.instanceID, Receipt: receipt, Update: update,
	})
	return errors.Join(localErr, brokerErr)
}

func (s *Server) fanoutLocal(ctx context.Context, receipt collaboration.CommitReceipt, update collaboration.Update) error {
	s.mu.RLock()
	peers := make([]*peer, 0, len(s.rooms[receipt.DocumentID]))
	for p := range s.rooms[receipt.DocumentID] {
		peers = append(peers, p)
	}
	s.mu.RUnlock()
	if s.roomReader != nil && len(peers) > 0 {
		if err := s.fanoutFromRoomHead(ctx, peers, receipt, update); err == nil {
			return nil
		}
		// The room read failed; fall back to checking every peer on its own.
	}
	var firstError error
	for _, p := range peers {
		snapshot, err := s.readAuthorizedSnapshot(ctx, p)
		if err != nil {
			p.close()
			if firstError == nil {
				firstError = err
			}
			continue
		}
		if err := p.enqueueUpdate(receipt, update.BodySchemaVersion, update.Bytes, snapshot); err != nil && firstError == nil {
			firstError = err
		}
	}
	return firstError
}

func (s *Server) startBroker() error {
	if s.broker == nil {
		return nil
	}
	s.mu.Lock()
	if s.stopping {
		s.mu.Unlock()
		return errors.New("collaboration server is shutting down")
	}
	if s.brokerStarted {
		s.mu.Unlock()
		return nil
	}
	s.brokerStarted = true
	s.wg.Add(1)
	s.mu.Unlock()
	events, err := s.broker.Subscribe(s.brokerCtx)
	go s.readBrokerEvents(events, err)
	return nil
}

func (s *Server) readBrokerEvents(events <-chan collaboration.BroadcastEvent, subscribeErr error) {
	defer s.wg.Done()
	if subscribeErr != nil {
		events = nil
	}
	for {
		if events == nil {
			var err error
			events, err = s.broker.Subscribe(s.brokerCtx)
			if err != nil {
				timer := time.NewTimer(time.Second)
				select {
				case <-s.brokerCtx.Done():
					timer.Stop()
					return
				case <-timer.C:
				}
				continue
			}
		}
		select {
		case <-s.brokerCtx.Done():
			return
		case event, ok := <-events:
			if !ok {
				events = nil
				continue
			}
			if event.OriginID == s.instanceID || !validBroadcastEvent(event) {
				continue
			}
			_ = s.fanoutLocal(s.brokerCtx, event.Receipt, event.Update)
		}
	}
}

func validBroadcastEvent(event collaboration.BroadcastEvent) bool {
	return event.OriginID != uuid.Nil && event.Receipt.DocumentID != uuid.Nil &&
		event.Receipt.UpdateID != uuid.Nil && event.Receipt.BodyVersion > 0 && event.Receipt.BodyEpoch > 0 &&
		event.Receipt.Changed && event.Update.DocumentID == event.Receipt.DocumentID &&
		event.Update.UpdateID == event.Receipt.UpdateID && event.Update.BodyEpoch == event.Receipt.BodyEpoch &&
		event.Update.BodySchemaVersion > 0 && len(event.Update.Bytes) > 0
}

func (s *Server) addPeer(p *peer) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.stopping {
		return false
	}
	if s.rooms[p.documentID] == nil {
		s.rooms[p.documentID] = make(map[*peer]struct{})
		if s.roomReader != nil {
			pollCtx, cancel := context.WithCancel(s.brokerCtx)
			s.pollers[p.documentID] = cancel
			s.wg.Add(1)
			go s.pollRoom(pollCtx, p.documentID, p.workspaceID)
		}
	}
	s.rooms[p.documentID][p] = struct{}{}
	s.wg.Add(1)
	return true
}

func (s *Server) removePeer(p *peer) {
	s.mu.Lock()
	delete(s.rooms[p.documentID], p)
	roomEmptied := len(s.rooms[p.documentID]) == 0
	if roomEmptied {
		delete(s.rooms, p.documentID)
		if cancel, ok := s.pollers[p.documentID]; ok {
			cancel()
			delete(s.pollers, p.documentID)
		}
	}
	s.mu.Unlock()
	if roomEmptied {
		s.flushRevision(p.documentID)
	}
	if s.presenceStore != nil {
		ctx, cancel := context.WithTimeout(context.Background(), fanoutTimeout)
		_ = s.presenceStore.Leave(ctx, p.documentID, p.connectionID)
		cancel()
		s.notifyPresence(p.documentID)
	}
	s.broadcastPresence(p.documentID)
	s.wg.Done()
}

// flushRevision writes the pending rolling auto revision of a document. A
// failure is dropped: the next commit or flush rewrites the same revision.
func (s *Server) flushRevision(documentID uuid.UUID) {
	if s.revisionFlusher == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), fanoutTimeout)
	defer cancel()
	_ = s.revisionFlusher.FlushAutoRevision(ctx, documentID)
}

// markPresent makes the peer visible to the room once its ready frame is sent.
func (s *Server) markPresent(p *peer) {
	p.mu.Lock()
	p.present = true
	p.mu.Unlock()
	s.heartbeatPresence(p)
	s.notifyPresence(p.documentID)
	s.broadcastPresence(p.documentID)
}

func (s *Server) heartbeatPresence(p *peer) {
	if s.presenceStore == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), fanoutTimeout)
	defer cancel()
	_ = s.presenceStore.Heartbeat(ctx, p.documentID, collaboration.PresenceEntry{
		ConnectionID: p.connectionID, UserID: p.actor.UserID, Name: p.profile.Name, AvatarURL: p.profile.AvatarURL,
	})
}

func (s *Server) notifyPresence(documentID uuid.UUID) {
	if s.presenceStore == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), fanoutTimeout)
	defer cancel()
	_ = s.presenceStore.Notify(ctx, documentID)
}

// presenceUsers lists each connected user once. With a shared store that is
// everyone on every instance; if the store fails, this instance's view stands in.
func (s *Server) presenceUsers(documentID uuid.UUID, local []PresenceUser) []PresenceUser {
	if s.presenceStore == nil {
		return local
	}
	ctx, cancel := context.WithTimeout(context.Background(), fanoutTimeout)
	defer cancel()
	entries, err := s.presenceStore.List(ctx, documentID)
	if err != nil {
		return local
	}
	seen := make(map[uuid.UUID]struct{}, len(entries))
	users := make([]PresenceUser, 0, len(entries))
	for _, entry := range entries {
		if _, ok := seen[entry.UserID]; ok {
			continue
		}
		seen[entry.UserID] = struct{}{}
		users = append(users, PresenceUser{UserID: entry.UserID, Name: entry.Name, AvatarURL: entry.AvatarURL})
	}
	sort.Slice(users, func(i, j int) bool { return users[i].UserID.String() < users[j].UserID.String() })
	return users
}

// watchPresenceChanges re-broadcasts a document's presence whenever any
// instance reports a change, resubscribing if the stream ends.
func (s *Server) watchPresenceChanges() {
	if s.presenceStore == nil {
		return
	}
	s.presenceOnce.Do(func() {
		s.wg.Add(1)
		go func() {
			defer s.wg.Done()
			for {
				changes, err := s.presenceStore.Changes(s.brokerCtx)
				if err == nil {
					for documentID := range changes {
						s.mu.RLock()
						_, local := s.rooms[documentID]
						s.mu.RUnlock()
						if local {
							s.broadcastPresence(documentID)
						}
					}
				}
				select {
				case <-s.brokerCtx.Done():
					return
				case <-time.After(time.Second):
				}
			}
		}()
	})
}

// presenceLoop keeps a connection's shared entry alive and repairs its view if
// a change notification was missed.
func (p *peer) presenceLoop(ctx context.Context) {
	ticker := time.NewTicker(p.server.presenceEvery)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-p.done:
			return
		case <-ticker.C:
			p.server.heartbeatPresence(p)
			p.server.resendPresenceIfChanged(p)
		}
	}
}

// presenceSnapshot lists each connected user of a document once, in user ID
// order, so every peer sees the same list.
func (s *Server) presenceSnapshot(documentID uuid.UUID) (users []PresenceUser, peers []*peer) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	seen := make(map[uuid.UUID]struct{})
	for p := range s.rooms[documentID] {
		p.mu.Lock()
		present := p.present
		p.mu.Unlock()
		if !present {
			continue
		}
		peers = append(peers, p)
		if _, ok := seen[p.actor.UserID]; ok {
			continue
		}
		seen[p.actor.UserID] = struct{}{}
		users = append(users, p.profile)
	}
	sort.Slice(users, func(i, j int) bool { return users[i].UserID.String() < users[j].UserID.String() })
	return users, peers
}

func presenceKey(users []PresenceUser) string {
	var key strings.Builder
	for _, user := range users {
		key.WriteString(user.UserID.String())
		key.WriteByte('|')
		key.WriteString(user.Name)
		key.WriteByte('|')
		key.WriteString(user.AvatarURL)
		key.WriteByte(';')
	}
	return key.String()
}

func (s *Server) broadcastPresence(documentID uuid.UUID) {
	local, peers := s.presenceSnapshot(documentID)
	if len(peers) == 0 {
		return
	}
	users := s.presenceUsers(documentID, local)
	if len(users) == 0 {
		return
	}
	key := presenceKey(users)
	for _, p := range peers {
		p.enqueuePresence(users, key)
	}
}

// resendPresenceIfChanged repairs a peer whose presence frame was dropped
// because its queue was full.
func (s *Server) resendPresenceIfChanged(p *peer) {
	local, _ := s.presenceSnapshot(p.documentID)
	users := s.presenceUsers(p.documentID, local)
	if len(users) == 0 {
		return
	}
	p.enqueuePresence(users, presenceKey(users), true)
}

func hasCapability(capabilities []string, name string) bool {
	for _, capability := range capabilities {
		if capability == name {
			return true
		}
	}
	return false
}

// enqueuePresence skips peers that did not opt in: older clients close the
// socket on frame types they do not know.
func (p *peer) enqueuePresence(users []PresenceUser, key string, onlyIfChanged ...bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if !p.wantsPresence {
		return
	}
	if len(onlyIfChanged) > 0 && onlyIfChanged[0] && p.presenceKey == key {
		return
	}
	select {
	case <-p.done:
	case p.out <- outbound{message: serverMessage{Type: "presence", Users: users}}:
		p.presenceKey = key
	default:
		// Queue full: leave presenceKey stale so the next resync tick retries.
	}
}

func (s *Server) Shutdown(ctx context.Context) error {
	s.mu.Lock()
	s.stopping = true
	peers := make([]*peer, 0)
	for _, members := range s.rooms {
		for p := range members {
			peers = append(peers, p)
		}
	}
	s.mu.Unlock()
	if s.brokerCancel != nil {
		s.brokerCancel()
	}
	for _, p := range peers {
		p.close()
	}
	done := make(chan struct{})
	go func() {
		s.wg.Wait()
		close(done)
	}()
	select {
	case <-done:
		return errors.Join(s.closeBroker(), s.closePresenceStore())
	case <-ctx.Done():
		return errors.Join(ctx.Err(), s.closeBroker(), s.closePresenceStore())
	}
}

// closePresenceStore releases the store's connection once peers have left, if
// the store holds one.
func (s *Server) closePresenceStore() error {
	closer, ok := s.presenceStore.(io.Closer)
	if !ok {
		return nil
	}
	s.presenceCloseOnce.Do(func() { s.presenceCloseErr = closer.Close() })
	return s.presenceCloseErr
}

func (s *Server) closeBroker() error {
	if s.broker == nil {
		return nil
	}
	s.brokerClose.Do(func() { s.brokerCloseErr = s.broker.Close() })
	return s.brokerCloseErr
}

func snapshotMessage(kind string, snapshot collaboration.BodySnapshot) serverMessage {
	canEdit := snapshot.CanEdit
	return serverMessage{
		Type: kind, BodyVersion: snapshot.BodyVersion, BodyEpoch: snapshot.BodyEpoch,
		BodySchemaVersion: snapshot.BodySchemaVersion, CanEdit: &canEdit, State: snapshot.EncodedState,
	}
}

func updateErrorCode(err error) string {
	switch {
	case errors.Is(err, collaboration.ErrStaleBodyEpoch):
		return "stale_epoch"
	case errors.Is(err, collaboration.ErrBodySchemaMismatch):
		return "schema_mismatch"
	case errors.Is(err, collaboration.ErrBodyNotInitialized):
		return "body_not_initialized"
	default:
		return "update_rejected"
	}
}

func distinctUsers(peers []*peer) []uuid.UUID {
	seen := make(map[uuid.UUID]struct{}, len(peers))
	users := make([]uuid.UUID, 0, len(peers))
	for _, p := range peers {
		if _, ok := seen[p.actor.UserID]; ok {
			continue
		}
		seen[p.actor.UserID] = struct{}{}
		users = append(users, p.actor.UserID)
	}
	return users
}

// verifySession reports whether the peer's token is still valid for its user.
func (s *Server) verifySession(p *peer) bool {
	user, err := s.verifier.VerifyToken(p.token)
	return err == nil && user.ID == p.actor.UserID.String()
}

// fanoutFromRoomHead delivers an update after one access check for the whole
// room. A peer is read in full only when it must resync.
func (s *Server) fanoutFromRoomHead(ctx context.Context, peers []*peer, receipt collaboration.CommitReceipt, update collaboration.Update) error {
	head, err := s.roomReader.ReadRoomHead(ctx, peers[0].workspaceID, receipt.DocumentID, distinctUsers(peers))
	if err != nil {
		return err
	}
	var firstError error
	for _, p := range peers {
		access := head.Access[p.actor.UserID]
		if !access.CanRead || !s.verifySession(p) {
			p.close()
			continue
		}
		snapshot := collaboration.BodySnapshot{
			BodyVersion: head.BodyVersion, BodyEpoch: head.BodyEpoch,
			BodySchemaVersion: head.BodySchemaVersion, CanEdit: access.CanEdit,
		}
		if p.fanoutNeedsFullSnapshot(receipt, update.BodySchemaVersion, snapshot) {
			full, err := s.readAuthorizedSnapshot(ctx, p)
			if err != nil {
				p.close()
				if firstError == nil {
					firstError = err
				}
				continue
			}
			snapshot = full
		}
		if err := p.enqueueUpdate(receipt, update.BodySchemaVersion, update.Bytes, snapshot); err != nil && firstError == nil {
			firstError = err
		}
	}
	return firstError
}

// fanoutNeedsFullSnapshot mirrors the cases in enqueueUpdate that send a
// resync, which carries the encoded state.
func (p *peer) fanoutNeedsFullSnapshot(receipt collaboration.CommitReceipt, schemaVersion int, head collaboration.BodySnapshot) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	if head.BodyEpoch != receipt.BodyEpoch || head.BodySchemaVersion != schemaVersion ||
		receipt.BodyVersion > p.bodyVersion+1 || head.CanEdit != p.canEdit {
		return true
	}
	return receipt.BodyVersion <= p.bodyVersion && receipt.Changed && receipt.BodyVersion == p.bodyVersion
}

// pollRoom replaces per-peer polling: one cheap room read per tick covers
// access revocation and missed fan-out for everyone in the document.
func (s *Server) pollRoom(ctx context.Context, documentID, workspaceID uuid.UUID) {
	defer s.wg.Done()
	ticker := time.NewTicker(s.resyncEvery)
	defer ticker.Stop()
	var observed collaboration.RoomHead
	var observedAt time.Time
	var flushedVersion, flushedEpoch int64
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			head, ok := s.checkRoom(ctx, documentID, workspaceID)
			if !ok || s.revisionFlusher == nil {
				continue
			}
			if observedAt.IsZero() || head.BodyVersion != observed.BodyVersion || head.BodyEpoch != observed.BodyEpoch {
				observed, observedAt = head, time.Now()
				continue
			}
			if time.Since(observedAt) >= s.idleFlushAfter &&
				(flushedVersion != head.BodyVersion || flushedEpoch != head.BodyEpoch) {
				s.flushRevision(documentID)
				flushedVersion, flushedEpoch = head.BodyVersion, head.BodyEpoch
			}
		}
	}
}

func (s *Server) checkRoom(ctx context.Context, documentID, workspaceID uuid.UUID) (collaboration.RoomHead, bool) {
	_, peers := s.presenceSnapshot(documentID)
	if len(peers) == 0 {
		return collaboration.RoomHead{}, false
	}
	head, err := s.roomReader.ReadRoomHead(ctx, workspaceID, documentID, distinctUsers(peers))
	if err != nil {
		return collaboration.RoomHead{}, false
	}
	for _, p := range peers {
		access := head.Access[p.actor.UserID]
		if !access.CanRead || !s.verifySession(p) {
			p.close()
			continue
		}
		if p.behind(head, access.CanEdit) {
			snapshot, err := s.readAuthorizedSnapshot(ctx, p)
			if err != nil {
				p.close()
				continue
			}
			p.enqueueResyncIfAhead(snapshot)
		}
		s.resendPresenceIfChanged(p)
	}
	return head, true
}

// behind reports whether the peer must be resynced to match the head.
func (p *peer) behind(head collaboration.RoomHead, canEdit bool) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	if head.BodyEpoch == p.bodyEpoch &&
		(head.BodyVersion < p.bodyVersion || (head.BodyVersion == p.bodyVersion && canEdit == p.canEdit)) {
		return false
	}
	return true
}
