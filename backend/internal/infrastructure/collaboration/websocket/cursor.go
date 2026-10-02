package websocket

import (
	"hash/fnv"

	"github.com/google/uuid"
)

// maxCursorBytes bounds one encoded relative position. A Yjs relative
// position is a few dozen bytes; anything larger is not a cursor.
const maxCursorBytes = 256

// cursorColors are assigned per user so every collaborator sees the same
// color for the same person without storing a choice anywhere.
var cursorColors = []string{
	"#0369A1", "#B45309", "#15803D", "#B91C1C",
	"#7C3AED", "#0F766E", "#BE185D", "#4D7C0F",
}

// CursorSelection is a collaborator's selection as two encoded Yjs relative
// positions. It is the only editor state a client shares.
type CursorSelection struct {
	Anchor []byte `json:"anchor"`
	Head   []byte `json:"head"`
}

// RemoteCursor is what peers receive: display name and color, never the
// email, avatar, or any other profile field. It is relayed, not stored.
type RemoteCursor struct {
	ConnectionID uuid.UUID `json:"connectionID"`
	UserID       uuid.UUID `json:"userID"`
	Name         string    `json:"name,omitempty"`
	Color        string    `json:"color,omitempty"`
	Anchor       []byte    `json:"anchor,omitempty"`
	Head         []byte    `json:"head,omitempty"`
}

func cursorColor(userID uuid.UUID) string {
	hash := fnv.New32a()
	_, _ = hash.Write(userID[:])
	return cursorColors[int(hash.Sum32())%len(cursorColors)]
}

func validCursor(cursor *CursorSelection) bool {
	return len(cursor.Anchor) > 0 && len(cursor.Anchor) <= maxCursorBytes &&
		len(cursor.Head) > 0 && len(cursor.Head) <= maxCursorBytes
}

// relayCursor sends the sender's cursor (or its removal when cursor is nil)
// to every other connection in the same document that opted in. Frames are
// dropped when a peer's queue is full: cursors are ephemeral and the next
// one replaces the lost one.
func (s *Server) relayCursor(from *peer, cursor *CursorSelection) {
	remote := &RemoteCursor{ConnectionID: from.connectionID, UserID: from.actor.UserID}
	message := serverMessage{Type: "cursor_leave", Cursor: remote}
	if cursor != nil {
		remote.Name = from.profile.Name
		remote.Color = cursorColor(from.actor.UserID)
		remote.Anchor, remote.Head = cursor.Anchor, cursor.Head
		message.Type = "cursor"
	}
	s.mu.RLock()
	peers := make([]*peer, 0, len(s.rooms[from.documentID]))
	for p := range s.rooms[from.documentID] {
		if p != from && p.wantsCursor {
			peers = append(peers, p)
		}
	}
	s.mu.RUnlock()
	for _, p := range peers {
		p.mu.Lock()
		present := p.present
		p.mu.Unlock()
		if !present {
			continue
		}
		select {
		case <-p.done:
		case p.out <- outbound{message: message}:
		default:
		}
	}
}
