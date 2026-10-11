// Package sse writes server-sent events: one event at a time, flushed at once,
// with a write deadline that is pushed forward on every event so a long stream
// is not cut off by the server's write timeout.
package sse

import (
	"fmt"
	"net/http"
	"time"
)

const writeDeadline = 30 * time.Second

type Stream struct {
	w  http.ResponseWriter
	rc *http.ResponseController
}

// Open sends the stream headers. Nothing may have been written to w before.
func Open(w http.ResponseWriter) *Stream {
	header := w.Header()
	header.Set("Content-Type", "text/event-stream")
	header.Set("Cache-Control", "no-cache, no-transform")
	// Tells nginx not to hold the events back.
	header.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	return &Stream{w: w, rc: http.NewResponseController(w)}
}

// Event writes one event. data must be a single line, and id may be empty.
// It returns false once the client is gone.
func (s *Stream) Event(id, kind string, data []byte) bool {
	frame := ""
	if id != "" {
		frame = "id: " + id + "\n"
	}
	return s.write("%sevent: %s\ndata: %s\n\n", frame, kind, data)
}

// Heartbeat is a comment line: it keeps the connection open and is never an event.
func (s *Stream) Heartbeat() bool { return s.write(": keep-alive\n\n") }

func (s *Stream) write(format string, args ...any) bool {
	_ = s.rc.SetWriteDeadline(time.Now().Add(writeDeadline))
	if _, err := fmt.Fprintf(s.w, format, args...); err != nil {
		return false
	}
	return s.rc.Flush() == nil
}
